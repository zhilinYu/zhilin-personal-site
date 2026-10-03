import base64
import io
import json
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from unittest.mock import patch
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import CATALOG, InvalidPayment, PaymentError, WechatPay, create_app


class FakeGateway:
    mchid = "test-merchant"
    appid = "test-app"

    def __init__(self):
        self.created = []
        self.transactions = {}
        self.fail_create = False

    def create(self, order):
        self.created.append(dict(order))
        self.transactions[order["id"]] = {
            "out_trade_no": order["id"], "mchid": self.mchid, "appid": self.appid,
            "trade_type": "NATIVE", "trade_state": "NOTPAY",
            "amount": {"total": order["amount"], "currency": "CNY"},
        }
        if self.fail_create:
            raise PaymentError("isolated test failure")
        return {"code_url": "weixin://wxpay/bizpayurl?pr=isolated-test"}

    def query(self, order_id):
        return self.transactions[order_id]

    def notification(self, headers, body):
        return json.loads(body)

    def paid(self, order_id):
        self.transactions[order_id].update(trade_state="SUCCESS", transaction_id="transaction-" + order_id)
        return self.transactions[order_id]


class OrderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.files = root / "products"
        self.files.mkdir()
        for sku in CATALOG:
            with zipfile.ZipFile(self.files / (sku + ".zip"), "w") as archive:
                archive.writestr("test.md", "isolated test product")
        self.gateway = FakeGateway()
        self.app = create_app({
            "TESTING": True, "SHOP_ENABLED": True,
            "SHOP_DB": str(root / "orders.sqlite3"), "SHOP_FILES": str(self.files),
        }, self.gateway)
        self.client = self.app.test_client()
        self.token = "a" * 64

    def tearDown(self):
        self.temp.cleanup()

    def order(self, sku="quant-risk", token=None, **extra):
        return self.client.post("/api/shop/orders", json={"sku": sku, **extra},
                                headers={"Origin": "https://zhilin.club",
                                         "Idempotency-Key": token or self.token})

    def auth(self):
        return {"Authorization": "Bearer " + self.token}

    def test_price_is_set_by_server(self):
        response = self.order(amount=1)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.gateway.created[-1]["amount"], 990)
        self.assertEqual(self.order("research-bundle", token="b" * 64).status_code, 201)
        self.assertEqual(self.gateway.created[-1]["amount"], 3990)

    def test_duplicate_request_does_not_create_another_payment(self):
        first = self.order()
        second = self.order()
        self.assertEqual(first.json["id"], second.json["id"])
        self.assertEqual(len(self.gateway.created), 1)
        self.assertEqual(self.order("hot-money").status_code, 409)

    def test_expired_lost_creation_response_retains_recoverable_order_identity(self):
        order_id = self.order().json["id"]
        with sqlite3.connect(self.app.config["SHOP_DB"]) as conn:
            conn.execute("UPDATE orders SET expires=? WHERE id=?", (int(time.time()) - 1, order_id))
        response = self.order()
        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json.get("id"), order_id)
        self.assertEqual(len(self.gateway.created), 1)
        # A delayed valid payment still reconciles against the original retained order.
        self.client.post("/api/shop/wechat/notify", json=self.gateway.paid(order_id))
        self.assertEqual(self.client.get("/api/shop/orders/" + order_id,
                                        headers=self.auth()).json["status"], "PAID")

    def test_failed_creation_can_retry_same_order_after_cooldown(self):
        self.gateway.fail_create = True
        first = self.order()
        order_id = first.json["id"]
        self.assertTrue(first.json.get("retryable"))
        self.assertGreater(first.json.get("retry_after", 0), 0)
        original = self.gateway.created[0]
        self.gateway.fail_create = False
        # A double click during the cooldown does not call the provider again.
        self.assertEqual(self.order().json["id"], order_id)
        self.assertEqual(len(self.gateway.created), 1)
        with patch("app.time.time", return_value=time.time() + 6):
            retry = self.order()
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json["id"], order_id)
        self.assertEqual(retry.json["status"], "PENDING")
        self.assertEqual(len(self.gateway.created), 2)
        repeated = self.gateway.created[-1]
        for field in ("id", "sku", "amount", "expires", "token_hash"):
            self.assertEqual(repeated[field], original[field])
        self.assertEqual(self.client.get("/api/shop/orders/" + order_id + "/qr",
                                        headers=self.auth()).status_code, 200)

    def test_failed_creation_query_exposes_manual_retry_when_provider_has_no_order(self):
        self.gateway.fail_create = True
        order_id = self.order().json["id"]
        def missing(_):
            raise PaymentError("isolated order not found")
        self.gateway.query = missing
        response = self.client.get("/api/shop/orders/" + order_id, headers=self.auth())
        self.assertEqual(response.status_code, 502)
        self.assertTrue(response.json.get("retryable"))

    def test_concurrent_creation_retry_calls_provider_once(self):
        self.gateway.fail_create = True
        order_id = self.order().json["id"]
        self.gateway.fail_create = False
        with sqlite3.connect(self.app.config["SHOP_DB"]) as conn:
            conn.execute("UPDATE creation_attempts SET lease_until=0 WHERE order_id=?", (order_id,))
        entered, release = threading.Event(), threading.Event()
        original_create = self.gateway.create
        responses = []
        failures = []
        def slow_create(order):
            entered.set()
            if not release.wait(3):
                raise AssertionError("test did not release provider")
            return original_create(order)
        def retry_in_thread():
            try:
                with self.app.test_client() as client:
                    responses.append(client.post("/api/shop/orders", json={"sku": "quant-risk"},
                        headers={"Origin": "https://zhilin.club", "Idempotency-Key": self.token}))
            except BaseException as error:
                failures.append(error)
        self.gateway.create = slow_create
        # A separate app instance represents another Gunicorn worker on the same database.
        second_app = create_app(dict(self.app.config), self.gateway)
        original_app = self.app
        self.app = second_app
        worker = threading.Thread(target=retry_in_thread)
        worker.start()
        try:
            self.assertTrue(entered.wait(2))
            duplicate = self.order()
            self.assertEqual(duplicate.status_code, 200)
            self.assertEqual(duplicate.json["id"], order_id)
        finally:
            release.set()
            worker.join(4)
            self.app = original_app
        self.assertFalse(worker.is_alive())
        self.assertFalse(failures)
        self.assertEqual(responses[0].json["status"], "PENDING")
        self.assertEqual(len(self.gateway.created), 2)

    def test_retry_reconciles_paid_order_before_reentering_native_create(self):
        self.gateway.fail_create = True
        order_id = self.order().json["id"]
        self.gateway.paid(order_id)
        with patch("app.time.time", return_value=time.time() + 6):
            retry = self.order()
        self.assertEqual(retry.json["status"], "PAID")
        self.assertEqual(len(self.gateway.created), 1)

    def test_retry_does_not_extend_order_in_final_ninety_seconds(self):
        self.gateway.fail_create = True
        order_id = self.order().json["id"]
        self.gateway.fail_create = False
        with patch("app.time.time", return_value=time.time() + 811):
            retry = self.order()
        self.assertEqual(retry.status_code, 200)
        self.assertFalse(retry.json["retryable"])
        self.assertEqual(len(self.gateway.created), 1)

    def test_retry_never_reopens_expired_order(self):
        self.gateway.fail_create = True
        order_id = self.order().json["id"]
        self.gateway.fail_create = False
        with patch("app.time.time", return_value=time.time() + 901):
            retry = self.order()
        self.assertEqual(retry.status_code, 410)
        self.assertEqual(retry.json["id"], order_id)
        self.assertEqual(len(self.gateway.created), 1)

    def test_delayed_creation_result_does_not_downgrade_paid_or_refunded_order(self):
        for state in ("PAID", "REFUNDED"):
            with self.subTest(state=state):
                original_create = FakeGateway.create.__get__(self.gateway)
                def notify_while_creating(order):
                    result = original_create(order)
                    payment = self.gateway.paid(order["id"])
                    if state == "REFUNDED":
                        payment["trade_state"] = "REFUND"
                    with self.app.test_client() as client:
                        self.assertEqual(client.post("/api/shop/wechat/notify", json=payment).status_code, 204)
                    return result
                self.gateway.create = notify_while_creating
                response = self.order(token=("b" if state == "PAID" else "c") * 64)
                self.assertEqual(response.json["status"], state)

    def test_stale_creation_owner_cannot_overwrite_or_release_newer_claim(self):
        for fails in (False, True):
            with self.subTest(fails=fails):
                def stale_create(order):
                    with sqlite3.connect(self.app.config["SHOP_DB"]) as conn:
                        conn.execute("UPDATE creation_attempts SET claim_token='new-owner', lease_until=? WHERE order_id=?",
                                     (2000000000, order["id"]))
                        conn.execute("UPDATE orders SET status='PENDING',code_url='weixin://wxpay/newer-code' WHERE id=?",
                                     (order["id"],))
                    if fails:
                        raise PaymentError("stale creation failure")
                    return {"code_url": "weixin://wxpay/obsolete-code"}
                self.gateway.create = stale_create
                response = self.order(token=("b" if fails else "c") * 64)
                self.assertEqual(response.json["status"], "PENDING")
                with sqlite3.connect(self.app.config["SHOP_DB"]) as conn:
                    code = conn.execute("SELECT code_url FROM orders WHERE id=?", (response.json["id"],)).fetchone()[0]
                    claim = conn.execute("SELECT claim_token,lease_until FROM creation_attempts WHERE order_id=?",
                                         (response.json["id"],)).fetchone()
                self.assertEqual(code, "weixin://wxpay/newer-code")
                self.assertEqual(claim, ("new-owner", 2000000000))

    def test_callback_during_creation_failure_returns_current_terminal_state(self):
        for state in ("SUCCESS", "REFUND", "CLOSED"):
            with self.subTest(state=state):
                original_create = FakeGateway.create.__get__(self.gateway)
                def fail_after_callback(order):
                    original_create(order)
                    event = self.gateway.paid(order["id"])
                    event["trade_state"] = state
                    with self.app.test_client() as client:
                        self.assertEqual(client.post("/api/shop/wechat/notify", json=event).status_code, 204)
                    raise PaymentError("response lost after callback")
                self.gateway.create = fail_after_callback
                token = {"SUCCESS": "b", "REFUND": "c", "CLOSED": "d"}[state] * 64
                response = self.order(token=token)
                self.assertEqual(response.status_code, 201)
                self.assertEqual(response.json["status"], {"SUCCESS": "PAID", "REFUND": "REFUNDED", "CLOSED": "CLOSED"}[state])
                self.assertFalse(response.json["retryable"])

    def test_malformed_creation_response_fails_closed_and_is_recoverable(self):
        self.gateway.create = lambda order: {"code_url": 123}
        response = self.order()
        self.assertEqual(response.status_code, 502)
        self.assertTrue(response.json["retryable"])
        self.assertEqual(self.client.get("/api/shop/orders/" + response.json["id"] + "/qr",
                                        headers=self.auth()).status_code, 409)

    def test_query_failure_does_not_hide_a_concurrent_paid_callback(self):
        order_id = self.order().json["id"]
        def callback_then_fail(order_id):
            with self.app.test_client() as client:
                client.post("/api/shop/wechat/notify", json=self.gateway.paid(order_id))
            raise PaymentError("query response lost")
        self.gateway.query = callback_then_fail
        response = self.client.get("/api/shop/orders/" + order_id, headers=self.auth())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "PAID")
        self.assertFalse(response.json["retryable"])

    def test_retry_does_not_call_create_if_claim_is_lost_during_reconciliation(self):
        self.gateway.fail_create = True
        order_id = self.order().json["id"]
        self.gateway.fail_create = False
        original_query = self.gateway.query
        def query_after_lease_replaced(order_id):
            with sqlite3.connect(self.app.config["SHOP_DB"]) as conn:
                conn.execute("UPDATE creation_attempts SET claim_token='new-owner',lease_until=? WHERE order_id=?",
                             (2000000000, order_id))
            return original_query(order_id)
        self.gateway.query = query_after_lease_replaced
        with patch("app.time.time", return_value=time.time() + 6):
            self.order()
        self.assertEqual(len(self.gateway.created), 1)

    def test_retry_recovers_when_initial_request_never_reached_provider(self):
        original_create = self.gateway.create
        calls = []
        def unavailable_once(order):
            calls.append(dict(order))
            if len(calls) == 1:
                raise PaymentError("network failed before provider accepted order")
            return original_create(order)
        def query_missing(order_id):
            if order_id not in self.gateway.transactions:
                raise PaymentError("provider order not found")
            return self.gateway.transactions[order_id]
        self.gateway.create, self.gateway.query = unavailable_once, query_missing
        first = self.order()
        self.assertEqual(first.status_code, 502)
        with patch("app.time.time", return_value=time.time() + 6):
            retry = self.order()
        self.assertEqual(retry.json["id"], first.json["id"])
        self.assertEqual(retry.json["status"], "PENDING")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0]["id"], calls[1]["id"])
        self.assertEqual(calls[0]["expires"], calls[1]["expires"])

    def test_existing_database_adds_lease_table_without_changing_orders(self):
        order_id = self.order().json["id"]
        with sqlite3.connect(self.app.config["SHOP_DB"]) as conn:
            original = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
            conn.execute("DROP TABLE creation_attempts")
        upgraded = create_app(dict(self.app.config), self.gateway)
        with sqlite3.connect(upgraded.config["SHOP_DB"]) as conn:
            self.assertEqual(conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone(), original)
            self.assertEqual(conn.execute("SELECT count(*) FROM creation_attempts").fetchone()[0], 0)

    def test_origin_and_product_validation(self):
        self.assertEqual(self.client.post("/api/shop/orders", json={"sku": "quant-risk"}).status_code, 403)
        self.assertEqual(self.order("unknown").status_code, 400)
        self.assertEqual(self.client.post("/api/shop/orders", json=["quant-risk"],
                                         headers={"Origin": "https://zhilin.club"}).status_code, 400)

    def test_no_payment_no_download_and_no_public_order_access(self):
        order_id = self.order().json["id"]
        prefix = "/api/shop/orders/" + order_id
        self.assertEqual(self.client.get(prefix).status_code, 404)
        self.assertEqual(self.client.get(prefix + "/qr").status_code, 404)
        self.assertEqual(self.client.get(prefix + "/download").status_code, 404)
        self.assertEqual(self.client.get(prefix + "/download", headers=self.auth()).status_code, 403)
        self.assertEqual(self.client.get(prefix + "/qr", headers=self.auth()).mimetype, "image/svg+xml")

    def test_unpaid_query_may_omit_trade_type_but_success_must_include_it(self):
        order_id = self.order().json["id"]
        # The real signed WeChat NOTPAY response omits trade_type.
        self.gateway.transactions[order_id].pop("trade_type")
        prefix = "/api/shop/orders/" + order_id
        response = self.client.get(prefix, headers=self.auth())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "PENDING")
        self.assertEqual(self.client.get(prefix + "/download", headers=self.auth()).status_code, 403)
        payment = self.gateway.paid(order_id)
        self.assertEqual(self.client.post("/api/shop/wechat/notify", json=payment).status_code, 400)
        self.assertEqual(self.client.get(prefix + "/download", headers=self.auth()).status_code, 502)

    def test_paid_order_and_duplicate_notification_allow_delivery(self):
        order_id = self.order().json["id"]
        payment = self.gateway.paid(order_id)
        for _ in range(2):
            response = self.client.post("/api/shop/wechat/notify", json=payment)
            self.assertEqual(response.status_code, 204)
        prefix = "/api/shop/orders/" + order_id
        self.assertEqual(self.client.get(prefix, headers=self.auth()).json["status"], "PAID")
        response = self.client.get(prefix + "/download", headers=self.auth())
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
            self.assertEqual(archive.read("test.md"), b"isolated test product")
        response.close()

    def test_wrong_amount_merchant_app_and_transaction_are_rejected(self):
        order_id = self.order().json["id"]
        valid = dict(self.gateway.paid(order_id))
        for key, value in [("mchid", "other"), ("appid", "other"), ("trade_type", "JSAPI"),
                           ("amount", {"total": 1, "currency": "CNY"})]:
            wrong = {**valid, key: value}
            self.assertEqual(self.client.post("/api/shop/wechat/notify", json=wrong).status_code, 400)
        self.assertEqual(self.client.post("/api/shop/wechat/notify", json=valid).status_code, 204)
        wrong = {**valid, "transaction_id": "another-transaction"}
        self.assertEqual(self.client.post("/api/shop/wechat/notify", json=wrong).status_code, 400)

    def test_refund_in_merchant_dashboard_blocks_redelivery(self):
        order_id = self.order().json["id"]
        self.client.post("/api/shop/wechat/notify", json=self.gateway.paid(order_id))
        self.gateway.transactions[order_id]["trade_state"] = "REFUND"
        prefix = "/api/shop/orders/" + order_id
        self.assertEqual(self.client.get(prefix + "/download", headers=self.auth()).status_code, 403)
        self.assertEqual(self.client.get(prefix, headers=self.auth()).json["status"], "REFUNDED")
        self.client.post("/api/shop/wechat/notify", json=self.gateway.paid(order_id))
        self.assertEqual(self.client.get(prefix, headers=self.auth()).json["status"], "REFUNDED")

    def test_missing_file_disables_checkout(self):
        (self.files / "research-bundle.zip").unlink()
        self.assertFalse(self.client.get("/api/shop/status").json["available"])
        self.assertEqual(self.order().status_code, 503)

    def test_lost_creation_response_preserves_order_number(self):
        self.gateway.fail_create = True
        response = self.order()
        self.assertEqual(response.status_code, 502)
        order_id = response.json["id"]
        self.assertEqual(self.order().json["id"], order_id)
        self.assertEqual(len(self.gateway.created), 1)
        self.client.post("/api/shop/wechat/notify", json=self.gateway.paid(order_id))
        self.assertEqual(self.client.get("/api/shop/orders/" + order_id,
                                        headers=self.auth()).json["status"], "PAID")


class SignatureTests(unittest.TestCase):
    def setUp(self):
        self.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.gateway = WechatPay.__new__(WechatPay)
        self.gateway.public = self.private.public_key()
        self.gateway.public_id = "PUB_KEY_ID_TEST"
        self.gateway.api_key = b"a" * 32

    def signed(self, body, stamp=None):
        stamp = str(stamp or int(time.time()))
        nonce = "test-nonce"
        message = stamp.encode() + b"\n" + nonce.encode() + b"\n" + body + b"\n"
        signature = self.private.sign(message, padding.PKCS1v15(), hashes.SHA256())
        return {"Wechatpay-Serial": self.gateway.public_id,
                "Wechatpay-Timestamp": stamp, "Wechatpay-Nonce": nonce,
                "Wechatpay-Signature": base64.b64encode(signature).decode()}

    def test_signed_notification_is_decrypted(self):
        data = {"out_trade_no": "test-order", "amount": {"total": 990}}
        nonce, aad = "0123456789ab", "transaction"
        cipher = AESGCM(self.gateway.api_key).encrypt(nonce.encode(), json.dumps(data).encode(), aad.encode())
        body = json.dumps({"resource": {"algorithm": "AEAD_AES_256_GCM", "nonce": nonce,
                                       "associated_data": aad,
                                       "ciphertext": base64.b64encode(cipher).decode()}}).encode()
        self.assertEqual(self.gateway.notification(self.signed(body), body), data)

    def test_forged_replayed_and_unknown_key_signatures_fail(self):
        body = b'{"amount":990}'
        headers = self.signed(body)
        with self.assertRaises(InvalidPayment):
            self.gateway.verify(headers, b'{"amount":1}')
        with self.assertRaises(InvalidPayment):
            self.gateway.verify(self.signed(body, int(time.time()) - 3600), body)
        headers["Wechatpay-Serial"] = "PUB_KEY_ID_OTHER"
        with self.assertRaises(InvalidPayment):
            self.gateway.verify(headers, body)


if __name__ == "__main__":
    unittest.main()
