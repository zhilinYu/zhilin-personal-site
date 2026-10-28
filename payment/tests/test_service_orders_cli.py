import csv
import io
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "list_service_orders.py"


class ServiceOrderCliTests(unittest.TestCase):
    def test_only_paid_service_contacts_and_no_database_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / "orders with spaces.sqlite3"
            with sqlite3.connect(database) as conn:
                conn.executescript("""
                    CREATE TABLE orders(id TEXT, sku TEXT, status TEXT, created INTEGER);
                    CREATE TABLE service_contacts(order_id TEXT, phone TEXT);
                    INSERT INTO orders VALUES('paid-1','investment-agent-remote','PAID',0);
                    INSERT INTO orders VALUES('paid-2','one-on-one','PAID',1);
                    INSERT INTO orders VALUES('paid-3','workflow-building','PAID',2);
                    INSERT INTO orders VALUES('pending','one-on-one','PENDING',2);
                    INSERT INTO orders VALUES('refunded','one-on-one','REFUNDED',3);
                    INSERT INTO orders VALUES('digital','trend-leader','PAID',4);
                    INSERT INTO service_contacts VALUES('paid-1','13800138000');
                    INSERT INTO service_contacts VALUES('paid-2','13900139000');
                    INSERT INTO service_contacts VALUES('paid-3','13700137000');
                    INSERT INTO service_contacts VALUES('pending','13000000000');
                    INSERT INTO service_contacts VALUES('refunded','13100000000');
                    INSERT INTO service_contacts VALUES('digital','13200000000');
                """)
            before = database.read_bytes()
            result = subprocess.run([sys.executable, str(SCRIPT), str(database)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            rows = list(csv.reader(io.StringIO(result.stdout)))
            self.assertEqual(len(rows), 4)
            self.assertEqual(rows[1], ['paid-1', '远程协助搭建 AI 投研智能体', '13800138000', '1970-01-01 00:00:00'])
            self.assertEqual(rows[2], ['paid-2', '一对一 AI 投研咨询', '13900139000', '1970-01-01 00:00:01'])
            self.assertEqual(rows[3], ['paid-3', 'AI 投研工作流定制定金', '13700137000', '1970-01-01 00:00:02'])
            self.assertEqual(before, database.read_bytes())
            self.assertEqual(result.stderr, '')

    def test_missing_or_old_database_fails_without_creating_or_modifying_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / 'missing.sqlite3'
            result = subprocess.run([sys.executable, str(SCRIPT), str(missing)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(missing.exists())
            old = Path(tmp) / 'old.sqlite3'
            with sqlite3.connect(old) as conn:
                conn.execute('CREATE TABLE orders(id TEXT)')
            before = old.read_bytes()
            result = subprocess.run([sys.executable, str(SCRIPT), str(old)], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(before, old.read_bytes())
            self.assertIn('初始化', result.stderr)


if __name__ == '__main__':
    unittest.main()
