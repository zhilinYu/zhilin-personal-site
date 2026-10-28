"""List paid service contacts from the local private order database."""
import argparse
import csv
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from app import CATALOG, SERVICE_SKUS


def main(argv=None):
    parser = argparse.ArgumentParser(description="只读查看已付款服务订单；请勿将输出写入公开位置。")
    parser.add_argument("database", nargs="?", default="/var/lib/zhilin-shop/orders.sqlite3", help="私有订单数据库路径")
    args = parser.parse_args(argv)
    path = Path(args.database).expanduser().resolve()
    if not path.is_file():
        parser.exit(1, "无法打开订单数据库，请检查文件路径与访问权限。\n")
    try:
        conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=5)
        try:
            conn.execute("PRAGMA query_only=ON")
            marks = ",".join("?" for _ in SERVICE_SKUS)
            rows = conn.execute(
                "SELECT o.id,o.sku,c.phone,o.created FROM orders o "
                "JOIN service_contacts c ON c.order_id=o.id "
                f"WHERE o.status='PAID' AND o.sku IN ({marks}) ORDER BY o.created,o.id",
                tuple(sorted(SERVICE_SKUS)),
            )
            writer = csv.writer(sys.stdout, lineterminator="\n")
            writer.writerow(["订单号", "服务", "联系电话", "下单时间（UTC）"])
            for order_id, sku, phone, created in rows:
                stamp = datetime.fromtimestamp(created, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
                writer.writerow([order_id, CATALOG[sku][0], phone, stamp])
        finally:
            conn.close()
    except sqlite3.Error:
        parser.exit(1, "无法读取服务订单；请检查权限及支付服务是否已完成数据库初始化。\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
