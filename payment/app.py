"""Native payment and private prompt delivery. No mock payment mode."""
import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import qrcode
import qrcode.image.svg
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from flask import Flask, jsonify, request, send_file
from werkzeug.middleware.proxy_fix import ProxyFix

CATALOG = {
    "quant-risk": ("量化风控", 990),
    "trend-leader": ("趋势龙头", 990),
    "hot-money": ("游资弹性", 990),
    "countertrend": ("逆势抗跌", 990),
    "limit-up-pullback": ("涨停回吐", 990),
    "research-bundle": ("全套研究提示词", 3990),
}


class PaymentError(Exception):
    pass


class InvalidPayment(PaymentError):
    pass


class WechatPay:
    def __init__(self, config):
        self.mchid = config["WX_MCH_ID"]
        self.appid = config["WX_APP_ID"]
        self.notify_url = config["WX_NOTIFY_URL"]
        cert = x509.load_pem_x509_certificate(Path(config["WX_CERT_PATH"]).read_bytes())
        self.serial = format(cert.serial_number, "X")
        self.private = serialization.load_pem_private_key(
            Path(config["WX_PRIVATE_KEY_PATH"]).read_bytes(), password=None
        )
        if self.private.public_key().public_numbers() != cert.public_key().public_numbers():
            raise ValueError("merchant certificate does not match its private key")
        self.public = serialization.load_pem_public_key(
            Path(config["WX_PLATFORM_PUBLIC_KEY_PATH"]).read_bytes()
        )
        self.public_id = config["WX_PLATFORM_PUBLIC_KEY_ID"]
        self.api_key = config["WX_API_V3_KEY"].encode()
        if len(self.api_key) != 32 or not self.public_id.startswith("PUB_KEY_ID_"):
            raise ValueError("invalid WeChat payment configuration")

    def verify(self, headers, body):
        serial = headers.get("Wechatpay-Serial", "")
        stamp = headers.get("Wechatpay-Timestamp", "")
        nonce = headers.get("Wechatpay-Nonce", "")
        signature = headers.get("Wechatpay-Signature", "")
        if serial != self.public_id or not stamp.isdigit() or abs(time.time() - int(stamp)) > 300:
            raise InvalidPayment("untrusted payment signature metadata")
        message = stamp.encode() + b"\n" + nonce.encode() + b"\n" + body + b"\n"
        try:
            self.public.verify(
                base64.b64decode(signature, validate=True),
                message, padding.PKCS1v15(), hashes.SHA256(),
            )
        except Exception as exc:
            raise InvalidPayment("invalid payment signature") from exc

    def api(self, method, path, payload=None):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode() if payload is not None else b""
        stamp, nonce = str(int(time.time())), secrets.token_hex(16)
        message = f"{method}\n{path}\n{stamp}\n{nonce}\n".encode() + body + b"\n"
        signature = base64.b64encode(
            self.private.sign(message, padding.PKCS1v15(), hashes.SHA256())
        ).decode()
        authorization = (
            f'WECHATPAY2-SHA256-RSA2048 mchid="{self.mchid}",nonce_str="{nonce}",'
            f'timestamp="{stamp}",serial_no="{self.serial}",signature="{signature}"'
        )
        req = urllib.request.Request(
            "https://api.mch.weixin.qq.com" + path,
            data=body if payload is not None else None, method=method,
            headers={"Authorization": authorization, "Content-Type": "application/json",
                     "Accept": "application/json", "User-Agent": "ZhilinShop/1.0",
                     "Wechatpay-Serial": self.public_id},
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                raw = response.read(262144)
                self.verify(response.headers, raw)
                return json.loads(raw)
        except urllib.error.HTTPError as exc:
            raw = exc.read(262144)
            self.verify(exc.headers, raw)
            raise PaymentError("wechat rejected request") from exc
        except (OSError, ValueError) as exc:
            raise PaymentError("payment service unavailable") from exc

    def create(self, order):
        expiry = datetime.fromtimestamp(order["expires"], timezone.utc).isoformat()
        return self.api("POST", "/v3/pay/transactions/native", {
            "appid": self.appid, "mchid": self.mchid,
            "description": "致凌工作室-" + CATALOG[order["sku"]][0] + "研究提示词",
            "out_trade_no": order["id"], "time_expire": expiry,
            "notify_url": self.notify_url,
            "amount": {"total": order["amount"], "currency": "CNY"},
        })

    def query(self, order_id):
        path = f"/v3/pay/transactions/out-trade-no/{order_id}?mchid={self.mchid}"
        return self.api("GET", path)

    def notification(self, headers, body):
        self.verify(headers, body)
        event = json.loads(body)
        resource = event.get("resource", {})
        if resource.get("algorithm") != "AEAD_AES_256_GCM":
            raise InvalidPayment("unsupported notification encryption")
        try:
            plain = AESGCM(self.api_key).decrypt(
                resource["nonce"].encode(), base64.b64decode(resource["ciphertext"], validate=True),
                resource.get("associated_data", "").encode(),
            )
            return json.loads(plain)
        except Exception as exc:
            raise InvalidPayment("invalid notification") from exc


def create_app(config=None, gateway=None):
    app = Flask(__name__)
    app.config.update(
        SHOP_ENABLED=os.environ.get("SHOP_ENABLED") == "1",
        SHOP_ORIGIN=os.environ.get("SHOP_ORIGIN", "https://zhilin.club"),
        SHOP_DB=os.environ.get("SHOP_DB", "/var/lib/zhilin-shop/orders.sqlite3"),
        SHOP_FILES=os.environ.get("SHOP_FILES", "/var/lib/zhilin-shop/products"),
        MAX_CONTENT_LENGTH=65536,
    )
    if config:
        app.config.update(config)
    # Only one trusted reverse proxy can reach the loopback-bound service.
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
    db_path = Path(app.config["SHOP_DB"])
    db_path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def db():
        conn = sqlite3.connect(str(db_path), timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    with db() as conn:
        conn.executescript("""
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS orders(
                id TEXT PRIMARY KEY, sku TEXT NOT NULL, amount INTEGER NOT NULL,
                token_hash TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'CREATING',
                code_url TEXT, transaction_id TEXT UNIQUE, created INTEGER NOT NULL,
                expires INTEGER NOT NULL, last_query INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS limits(
                bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);
        """)
    payment = gateway
    if payment is None and app.config["SHOP_ENABLED"]:
        try:
            payment = WechatPay(os.environ)
        except (KeyError, ValueError, OSError):
            app.logger.error("Payment configuration is incomplete; checkout disabled")

    def ready():
        return bool(app.config["SHOP_ENABLED"] and payment and all(
            (Path(app.config["SHOP_FILES"]) / (sku + ".zip")).is_file() for sku in CATALOG
        ))

    def error(message, status):
        return jsonify({"error": message}), status

    def token_hash(value):
        return hashlib.sha256(value.encode()).hexdigest()

    def owned(order_id):
        token = request.headers.get("Authorization", "").removeprefix("Bearer ")
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            return None
        with db() as conn:
            row = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        return row if row and hmac.compare_digest(row["token_hash"], token_hash(token)) else None

    def limited(key, count=8, duration=60):
        now = int(time.time())
        with db() as conn:
            conn.execute("DELETE FROM limits WHERE expires < ?", (now,))
            conn.execute("""
                INSERT INTO limits VALUES(?,1,?) ON CONFLICT(bucket)
                DO UPDATE SET count=count+1
            """, (key, now + duration))
            row = conn.execute("SELECT count FROM limits WHERE bucket=?", (key,)).fetchone()
        return row["count"] > count

    def record_payment(data):
        if data.get("mchid") != getattr(payment, "mchid", ""):
            raise InvalidPayment("merchant mismatch")
        if data.get("appid") != getattr(payment, "appid", ""):
            raise InvalidPayment("application mismatch")
        state = data.get("trade_state")
        trade_type = data.get("trade_type")
        # WeChat omits trade_type for NOTPAY; successful payments must identify NATIVE.
        if trade_type not in (None, "NATIVE") or (
            state in ("SUCCESS", "REFUND") and trade_type != "NATIVE"
        ):
            raise InvalidPayment("payment type mismatch")
        order_id = data.get("out_trade_no")
        with db() as conn:
            row = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
            if not row:
                raise InvalidPayment("unknown order")
            amount = data.get("amount", {})
            if type(amount.get("total")) is not int or amount["total"] != row["amount"] or amount.get("currency") != "CNY":
                raise InvalidPayment("amount mismatch")
            if state == "SUCCESS":
                transaction = data.get("transaction_id")
                if not transaction:
                    raise InvalidPayment("missing transaction identifier")
                if row["transaction_id"] and row["transaction_id"] != transaction:
                    raise InvalidPayment("transaction mismatch")
                conn.execute(
                    "UPDATE orders SET status='PAID', transaction_id=? WHERE id=? AND status!='REFUNDED'",
                    (transaction, order_id),
                )
            elif state == "REFUND":
                conn.execute("UPDATE orders SET status='REFUNDED' WHERE id=?", (order_id,))
            elif state in ("CLOSED", "REVOKED", "PAYERROR"):
                conn.execute(
                    "UPDATE orders SET status='CLOSED' WHERE id=? AND status NOT IN ('PAID','REFUNDED')",
                    (order_id,),
                )

    def sync_order(order):
        if not payment:
            raise PaymentError("payment unavailable")
        record_payment(payment.query(order["id"]))
        with db() as conn:
            return conn.execute("SELECT * FROM orders WHERE id=?", (order["id"],)).fetchone()

    @app.after_request
    def headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.get("/api/shop/status")
    def status():
        return jsonify({"available": ready(), "method": "wechat_native"})

    @app.post("/api/shop/orders")
    def create_order():
        if request.headers.get("Origin") != app.config["SHOP_ORIGIN"]:
            return error("请求来源无效", 403)
        if not ready():
            return error("微信支付尚未开放，请稍后再试", 503)
        body = request.get_json(silent=True) or {}
        if not isinstance(body, dict):
            return error("请求参数无效", 400)
        sku = body.get("sku")
        token = request.headers.get("Idempotency-Key", "")
        if not isinstance(sku, str) or sku not in CATALOG or not re.fullmatch(r"[a-f0-9]{64}", token):
            return error("商品或请求参数无效", 400)
        key = token_hash(token)
        with db() as conn:
            existing = conn.execute("SELECT * FROM orders WHERE token_hash=?", (key,)).fetchone()
        if existing:
            if existing["sku"] != sku:
                return error("订单商品不一致", 409)
            if existing["expires"] <= time.time() and existing["status"] != "PAID":
                return error("订单已到期，请重新购买", 410)
            return jsonify({"id": existing["id"], "status": existing["status"]})
        if limited("create:" + str(request.remote_addr)):
            return error("操作频繁，请一分钟后重试", 429)
        now = int(time.time())
        order_id = "ZL" + datetime.now(timezone.utc).strftime("%Y%m%d") + secrets.token_hex(10)
        try:
            with db() as conn:
                conn.execute(
                    "INSERT INTO orders(id,sku,amount,token_hash,created,expires) VALUES(?,?,?,?,?,?)",
                    (order_id, sku, CATALOG[sku][1], key, now, now + 900),
                )
                order = conn.execute("SELECT * FROM orders WHERE id=?", (order_id,)).fetchone()
        except sqlite3.IntegrityError:
            with db() as conn:
                order = conn.execute("SELECT * FROM orders WHERE token_hash=?", (key,)).fetchone()
            if not order or order["sku"] != sku:
                return error("订单冲突", 409)
            return jsonify({"id": order["id"], "status": order["status"]})
        try:
            result = payment.create(order)
            code = result.get("code_url", "")
            if not code.startswith("weixin://wxpay/"):
                raise InvalidPayment("invalid payment code")
            with db() as conn:
                conn.execute(
                    "UPDATE orders SET code_url=?,status=CASE WHEN status='CREATING' THEN 'PENDING' ELSE status END WHERE id=?",
                    (code, order_id),
                )
        except PaymentError:
            app.logger.warning("WeChat order creation failed: %s", order_id)
            # Keep the order number so a delayed payment can still be reconciled.
            return jsonify({"id": order_id, "status": "UNAVAILABLE",
                            "error": "暂时无法获取支付二维码，请稍后查询该订单"}), 502
        return jsonify({"id": order_id, "status": "PENDING"}), 201

    @app.get("/api/shop/orders/<order_id>")
    def get_order(order_id):
        order = owned(order_id)
        if not order:
            return error("订单不存在或无权访问", 404)
        # Claim a query slot atomically so concurrent polls do not hammer WeChat.
        now = int(time.time())
        with db() as conn:
            claimed = conn.execute(
                "UPDATE orders SET last_query=? WHERE id=? AND last_query<? AND status NOT IN ('PAID','REFUNDED','CLOSED')",
                (now, order_id, now - 5),
            ).rowcount
        if claimed:
            try:
                order = sync_order(order)
            except PaymentError:
                return error("支付状态暂时无法确认，请稍后重试", 502)
        state = order["status"]
        if state in ("CREATING", "PENDING") and order["expires"] <= now:
            state = "EXPIRED"
        return jsonify({"id": order["id"], "sku": order["sku"], "amount": order["amount"],
                        "status": state, "expires": order["expires"],
                        "qr_available": bool(order["code_url"]),
                        "name": CATALOG[order["sku"]][0]})

    @app.get("/api/shop/orders/<order_id>/qr")
    def qr(order_id):
        order = owned(order_id)
        if not order:
            return error("订单不存在或无权访问", 404)
        if order["status"] not in ("CREATING", "PENDING") or order["expires"] <= time.time() or not order["code_url"]:
            return error("此订单暂时无法付款，请查询订单状态", 409)
        code = qrcode.QRCode(border=4, box_size=8, error_correction=qrcode.constants.ERROR_CORRECT_M)
        code.add_data(order["code_url"])
        code.make(fit=True)
        image = code.make_image(image_factory=qrcode.image.svg.SvgPathImage)
        output = io.BytesIO()
        image.save(output)
        output.seek(0)
        return send_file(output, mimetype="image/svg+xml")

    @app.get("/api/shop/orders/<order_id>/download")
    def download(order_id):
        order = owned(order_id)
        if not order:
            return error("订单不存在或无权访问", 404)
        # Re-query before each delivery to catch refunds performed in the merchant dashboard.
        if limited("download:" + order_id, count=5):
            return error("下载过于频繁，请稍后重试", 429)
        try:
            order = sync_order(order)
        except PaymentError:
            return error("暂时无法确认付款，请稍后重新领取", 502)
        if order["status"] != "PAID":
            return error("付款确认后才能下载", 403)
        path = Path(app.config["SHOP_FILES"]) / (order["sku"] + ".zip")
        if not path.is_file():
            app.logger.error("Purchased delivery file is unavailable: %s", order["sku"])
            return error("交付文件暂时不可用，请联系 yuzhilinvip@163.com", 503)
        return send_file(path, as_attachment=True, download_name=CATALOG[order["sku"]][0] + ".zip")

    @app.post("/api/shop/wechat/notify")
    def notify():
        if not payment:
            return jsonify({"code": "FAIL", "message": "payment unavailable"}), 503
        try:
            data = payment.notification(request.headers, request.get_data())
            record_payment(data)
        except (PaymentError, ValueError, KeyError, sqlite3.IntegrityError):
            app.logger.warning("Rejected payment notification")
            return jsonify({"code": "FAIL", "message": "notification rejected"}), 400
        return "", 204

    return app
