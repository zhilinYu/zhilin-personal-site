import base64
import io
import json
import sqlite3
import sys
import tempfile
import time
import unittest
import zipfile
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
