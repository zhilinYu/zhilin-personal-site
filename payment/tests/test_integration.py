"""Local adapter/simulation tests; no merchant secrets or real provider calls."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("preview_payment", ROOT / "tools/preview-payment.py")
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app, self.gateway = preview.simulation_app(ROOT, Path(self.temp.name))
        self.client = self.app.test_client()
        self.origin = "http://127.0.0.1:8777"

    def tearDown(self):
        self.temp.cleanup()

    def call(self, method, url, **kwargs):
        return self.client.open(url, method=method, base_url=self.origin,
                                environ_base={"REMOTE_ADDR": "127.0.0.1"}, **kwargs)

    def test_local_origin_is_isolated_from_production_and_wrong_host(self):
        headers = {"Origin": "https://zhilin.club", "Idempotency-Key": "a"*64}
        self.assertEqual(self.call("POST", "/api/shop/orders", json={"sku": "quant-risk"}, headers=headers).status_code, 403)
        headers["Origin"] = self.origin
        self.assertEqual(self.call("POST", "/api/shop/orders", json={"sku": "quant-risk"}, headers=headers).status_code, 201)
        self.assertEqual(self.client.get("/", base_url="http://localhost:8777").status_code, 403)

    def test_production_origin_rejects_localhost_and_has_no_test_control_route(self):
        app = preview.create_app({"TESTING": True, "SHOP_ENABLED": True,
                                  "SHOP_ORIGIN": "https://zhilin.club",
                                  "SHOP_DB": str(Path(self.temp.name)/"separate-origin.sqlite3"),
                                  "SHOP_FILES": self.app.config["SHOP_FILES"]}, self.gateway)
        with app.test_client() as client:
            result = client.post("/api/shop/orders", json={"sku": "quant-risk"},
                                 headers={"Origin": self.origin, "Idempotency-Key": "c"*64})
            self.assertEqual(result.status_code, 403)
            self.assertEqual(client.post("/__test__/state", json={"action": "paid"}).status_code, 404)

    def test_simulation_static_root_never_serves_orders_products_or_payment_source(self):
        html = self.call("GET", "/").get_data(as_text=True)
        self.assertIn("本地支付模拟", html)
        modal = html.split('id="checkoutDialog"', 1)[1].split('</dialog>', 1)[0]
        self.assertIn("本地支付模拟 · 不会真实扣款", modal)
        self.assertIn("二维码不可支付", modal)
        for url in ("/payment/app.py", "/products/quant-risk.zip", "/orders.sqlite3", "/.env", "/tools/preview-payment.py", "/assets/../../payment/app.py"):
            self.assertEqual(self.call("GET", url).status_code, 404, url)
        self.assertEqual(self.call("POST", "/__test__/state", json={"fail_create": True}).status_code, 403)

    def test_mock_success_duplicate_callback_and_refund_revokes_redelivery(self):
        token = "b"*64
        created = self.call("POST", "/api/shop/orders", json={"sku": "quant-risk"},
                            headers={"Origin": self.origin, "Idempotency-Key": token})
        order_id = created.json["id"]
        auth = {"Authorization": "Bearer " + token}
        download = "/api/shop/orders/"+order_id+"/download"
        self.assertEqual(self.call("GET", download, headers=auth).status_code, 403)
        for _ in range(2):
            self.assertEqual(self.call("POST", "/__test__/state", json={"id": order_id, "action": "paid"}, headers={"Origin": self.origin}).status_code, 200)
        result = self.call("GET", download, headers=auth)
        self.assertEqual(result.status_code, 200); result.close()
        self.assertEqual(self.call("POST", "/__test__/state", json={"id": order_id, "action": "refund"}, headers={"Origin": self.origin}).status_code, 200)
        self.assertEqual(self.call("GET", download, headers=auth).status_code, 403)
