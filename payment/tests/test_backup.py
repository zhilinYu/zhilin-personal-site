import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy' / 'preflight_backup.py'


class BackupTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('preflight_backup', SCRIPT)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.state = self.root / 'state'
        self.state.mkdir()
        self.database = self.state / 'orders.sqlite3'
        self.connection = sqlite3.connect(self.database)
        self.connection.execute('PRAGMA journal_mode=WAL')
        self.connection.execute('CREATE TABLE orders(id TEXT PRIMARY KEY, status TEXT)')
        self.connection.execute("INSERT INTO orders VALUES('synthetic-order','PAID')")
        self.connection.commit()
        self.payment = self.root / 'payment'
        self.payment.mkdir()
        (self.payment / 'app.py').write_text('print("old code")\n')
        (self.payment / '.env').write_text('SECRET=do-not-copy\n')
        self.static = self.root / 'static'
        self.static.mkdir()
        (self.static / 'index.html').write_text('<h1>old site</h1>')
        self.unit = self.root / 'service.unit'
        self.unit.write_text('[Service]\nUser=zhilin-shop\n')
        self.env = self.root / 'shop.env'
        self.env.write_text('WX_API_V3_KEY=do-not-read-or-copy\nSHOP_DB=' + str(self.database) + '\n')

    def tearDown(self):
        self.connection.close()
        self.temp.cleanup()

    def run_backup(self, **overrides):
        kwargs = dict(database=self.database, state_root=self.state,
                      backup_root=self.state / 'backups', payment_root=self.payment,
                      static_root=self.static, unit_file=self.unit, run_id='123-1',
                      target_sha='a' * 40, rollback_sha='b' * 40)
        kwargs.update(overrides)
        return self.module.backup_release(**kwargs)

    def test_snapshot_preserves_wal_orders_without_copying_secrets(self):
        result = self.run_backup()
        destination = Path(result['backup_dir'])
        with sqlite3.connect(destination / 'orders.sqlite3') as saved:
            self.assertEqual(saved.execute('PRAGMA quick_check').fetchone()[0], 'ok')
            self.assertEqual(saved.execute('SELECT * FROM orders').fetchall(), [('synthetic-order', 'PAID')])
        self.assertTrue(result['verified'])
        self.assertEqual(destination.stat().st_mode & 0o777, 0o700)
        self.assertEqual((destination / 'orders.sqlite3').stat().st_mode & 0o777, 0o600)
        import tarfile
        with tarfile.open(destination / 'code.tar.gz') as archive:
            self.assertIn('payment/app.py', archive.getnames())
            self.assertIn('static/index.html', archive.getnames())
            self.assertFalse(any('.env' in name or 'shop.env' in name for name in archive.getnames()))
        self.assertEqual(self.connection.execute('SELECT * FROM orders').fetchall(), [('synthetic-order', 'PAID')])

    def test_database_setting_resolves_only_within_state_directory(self):
        self.assertEqual(self.module.resolve_database(self.env, self.state), self.database)
        self.env.write_text('SHOP_DB=/tmp/outside.sqlite3\n')
        with self.assertRaises(ValueError):
            self.module.resolve_database(self.env, self.state)

    def test_whitespace_database_setting_is_not_silently_ignored(self):
        alternate = self.state / 'alternate.sqlite3'
        self.env.write_text('  SHOP_DB=' + str(alternate) + '\n')
        self.assertEqual(self.module.resolve_database(self.env, self.state), alternate)
        self.env.write_text('export SHOP_DB=' + str(alternate) + '\n')
        with self.assertRaises(ValueError):
            self.module.resolve_database(self.env, self.state)

    def test_actual_final_size_is_checked_before_publication(self):
        original_verify = self.module.verify_backup
        def grows_after_copy(directory, manifest, *args, **kwargs):
            original_verify(directory, manifest, *args, **kwargs)
            (Path(directory) / 'unexpected.bin').write_bytes(b'x' * (3 * 1024 * 1024))
        with patch.object(self.module, 'verify_backup', side_effect=grows_after_copy):
            with self.assertRaises(ValueError):
                self.run_backup(max_backup_bytes=2 * 1024 * 1024)
        self.assertEqual(list((self.state / 'backups').iterdir()), [])

    def test_late_verification_timeout_blocks_publication(self):
        original_verify = self.module.verify_backup
        original_clock = self.module.time.monotonic
        elapsed = [0]
        def late_verification(directory, manifest, *args, **kwargs):
            original_verify(directory, manifest, *args, **kwargs)
            elapsed[0] = 60
        with patch.object(self.module.time, 'monotonic', side_effect=lambda: original_clock() + elapsed[0]):
            with patch.object(self.module, 'verify_backup', side_effect=late_verification):
                with self.assertRaises((ValueError, TimeoutError)):
                    self.run_backup()
        self.assertEqual(list((self.state / 'backups').iterdir()), [])

    def test_inline_service_credentials_are_not_backed_up(self):
        self.unit.write_text('[Service]\nEnvironment=WX_API_V3_KEY=synthetic-secret\n')
        with self.assertRaises(ValueError):
            self.run_backup()

    def test_whitespace_and_credential_unit_directives_are_rejected(self):
        for directive in ('Environment = WX_API_V3_KEY=synthetic-secret',
                          'SetCredential=key:synthetic-secret',
                          'SetCredentialEncrypted = key:synthetic-ciphertext'):
            with self.subTest(directive=directive.split('=')[0]):
                self.unit.write_text('[Service]\n' + directive + '\n')
                with self.assertRaises(ValueError):
                    self.run_backup()

    def test_missing_database_fails_before_publishing_backup(self):
        self.database = self.state / 'missing.sqlite3'
        with self.assertRaises((ValueError, FileNotFoundError)):
            self.run_backup()
        self.assertFalse((self.state / 'backups').exists())

    def test_low_disk_fails_without_deleting_existing_backups(self):
        backup_root = self.state / 'backups'
        backup_root.mkdir(mode=0o700)
        old = backup_root / 'keep.txt'
        old.write_text('must remain')
        usage = type('Usage', (), {'free': 1})()
        with patch.object(self.module.shutil, 'disk_usage', return_value=usage):
            with self.assertRaises(ValueError):
                self.run_backup()
        self.assertEqual(old.read_text(), 'must remain')
        self.assertEqual(list(backup_root.iterdir()), [old])

    def test_byte_budget_fails_closed(self):
        with self.assertRaises(ValueError):
            self.run_backup(max_backup_bytes=1)

    def test_preexisting_target_is_never_overwritten(self):
        first = self.run_backup()
        with self.assertRaises(FileExistsError):
            self.run_backup()
        self.assertTrue(Path(first['backup_dir']).is_dir())

    def test_symlink_code_is_rejected_instead_of_followed(self):
        (self.payment / 'app.py').unlink()
        (self.payment / 'app.py').symlink_to(self.env)
        with self.assertRaises(ValueError):
            self.run_backup()

    def test_verification_failure_removes_only_its_staging_directory(self):
        with patch.object(self.module, 'verify_backup', side_effect=ValueError('isolated corruption')):
            with self.assertRaises(ValueError):
                self.run_backup()
        self.assertEqual(list((self.state / 'backups').iterdir()), [])


if __name__ == '__main__':
    unittest.main()
