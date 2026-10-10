"""Loopback-only payment simulation. Never imports production environment or calls WeChat.

Run after `npm run build`: python3 tools/preview-payment.py --port 8777
All orders and placeholder ZIPs are temporary, outside the served static roots.
No test-control routes exist in payment/app.py or the exported static package.
"""
import argparse
import json
import sqlite3
import sys
import tempfile
import time
import zipfile
from pathlib import Path

from flask import abort, jsonify, request, send_from_directory

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "payment"))
from app import CATALOG, PaymentError, create_app


class SimulationGateway:
    mchid = "isolated-test-merchant"
    appid = "isolated-test-app"

    def __init__(self):
        self.transactions = {}
        self.created = []
        self.fail_create = False

    def create(self, order):
        self.created.append(order["id"])
        if self.fail_create:
            raise PaymentError("isolated simulation failure")
        self.transactions.setdefault(order["id"], {
            "out_trade_no": order["id"], "mchid": self.mchid, "appid": self.appid,
            "trade_type": "NATIVE", "trade_state": "NOTPAY",
            "amount": {"total": order["amount"], "currency": "CNY"},
        })
        return {"code_url": "weixin://wxpay/isolated-local-test-not-payable"}

    def query(self, order_id):
        if order_id not in self.transactions:
            raise PaymentError("isolated simulation has no provider order")
        return dict(self.transactions[order_id])

    def notification(self, headers, body):
        # This gateway is injected ONLY by this local testing entry point.
        return json.loads(body)


def simulation_app(root, state, port=8777):
    origin = f"http://127.0.0.1:{port}"
    products = state / "products"
    products.mkdir()
    for sku in CATALOG:
        with zipfile.ZipFile(products / (sku + ".zip"), "w") as archive:
            archive.writestr("本地模拟说明.txt", "仅用于本地支付交互测试。没有真实付款，也不是付费提示词。")
    gateway = SimulationGateway()
    app = create_app({"TESTING": True, "SHOP_ENABLED": True, "SHOP_ORIGIN": origin,
                      "SHOP_DB": str(state / "orders.sqlite3"), "SHOP_FILES": str(products)}, gateway)

    @app.before_request
    def loopback_only():
        if request.remote_addr not in ("127.0.0.1", "::1") or request.host != f"127.0.0.1:{port}":
            abort(403)

    @app.get("/")
    def index():
        html = (root / "index.html").read_text()
        banner = '<aside style="position:sticky;top:0;z-index:20;background:#f8efdc;padding:8px 16px;text-align:center;font-size:12px">本地支付模拟 · 无真实付款 · 下载为测试占位文件</aside>'
        # A native modal makes the page banner inert and blurs it. Repeat the
        # simulation notice INSIDE the dialog so its QR can never look live.
        modal = '<dialog class="checkout-dialog" id="checkoutDialog" aria-labelledby="checkoutTitle">'
        notice = '<p role="note" style="background:#f8efdc;color:#674c20;padding:12px 14px;margin:12px 0 22px;border-radius:12px;font-size:13px;font-weight:600">本地支付模拟 · 不会真实扣款<br>二维码不可支付，下载仅为测试文件。</p>'
        html = html.replace(modal, modal + notice, 1)
        return html.replace("<body>", "<body>" + banner, 1)

    @app.get("/assets/<path:name>")
    @app.get("/admin/<path:name>")
    @app.get("/resume/<path:name>")
    def public_file(name):
        section = request.path.split("/")[1]
        if any(part.startswith(".") for part in Path(name).parts):
            abort(404)
        base = root / section
        target = (base / name).resolve()
        if not target.is_relative_to(base.resolve()):
            abort(404)
        return send_from_directory(base, name)

    @app.get("/admin/")
    @app.get("/resume/")
    def public_index():
        return send_from_directory(root / request.path.strip("/"), "index.html")

    @app.post("/__test__/state")
    def test_state():
        if request.headers.get("Origin") != origin:
            abort(403)
        data = request.get_json() or {}
        if "fail_create" in data:
            gateway.fail_create = data["fail_create"] is True
        if "available" in data:
            app.config["SHOP_ENABLED"] = data["available"] is True
        order_id = data.get("id")
        action = data.get("action")
        if order_id and action in ("paid", "refund", "closed"):
            if order_id not in gateway.transactions:
                abort(404)
            transaction = gateway.transactions[order_id]
            transaction.update(trade_state={"paid": "SUCCESS", "refund": "REFUND", "closed": "CLOSED"}[action],
                               transaction_id="isolated-" + order_id)
            with app.test_client() as client:
                result = client.post("/api/shop/wechat/notify", json=transaction,
                                     base_url=origin, environ_base={"REMOTE_ADDR": "127.0.0.1"})
                if result.status_code != 204:
                    abort(409)
        if order_id and action in ("expire", "release_retry"):
            with sqlite3.connect(app.config["SHOP_DB"]) as conn:
                if action == "expire":
                    conn.execute("UPDATE orders SET expires=? WHERE id=?", (int(time.time())-1, order_id))
                else:
                    conn.execute("UPDATE creation_attempts SET lease_until=0 WHERE order_id=?", (order_id,))
        return jsonify({"simulation": True, "provider_creations": len(gateway.created)})

    return app, gateway


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8777)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="zhilin-payment-simulation-") as temp:
        app, _ = simulation_app(ROOT, Path(temp), args.port)
        print(f"本地支付模拟：http://127.0.0.1:{args.port}/（无真实付款；退出后测试订单自动删除）", flush=True)
        app.run(host="127.0.0.1", port=args.port, debug=False, use_reloader=False)
