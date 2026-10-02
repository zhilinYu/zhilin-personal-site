"""Fail-closed, same-server release backup. Never exports data or copies credentials."""
import argparse
import hashlib
import json
import os
import re
import shutil
import signal
import sqlite3
import tarfile
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

MIB = 1024 * 1024
MAX_BACKUP_BYTES = 256 * MIB
MAX_TOTAL_BYTES = 1024 * MIB
MIN_FREE_BYTES = 256 * MIB


def contained(path, root):
    path, root = Path(path).resolve(), Path(root).resolve()
    if path != root and root not in path.parents:
        raise ValueError('Database must remain inside the payment state directory')
    return path


def resolve_database(env_file, state_root):
    """Read only the non-secret SHOP_DB setting; never log or copy the environment file."""
    env_file = Path(env_file)
    if not env_file.is_file() or env_file.stat().st_size > 65536:
        raise ValueError('Missing or unexpectedly large payment environment file')
    values = []
    with env_file.open(encoding='utf-8') as config:
        for line in config:
            line = line.strip()
            if re.match(r'(?:export\s+)?SHOP_DB(?:\s*=|\s+)', line) and not line.startswith('SHOP_DB='):
                raise ValueError('Unsupported SHOP_DB assignment; deployment blocked')
            if line.startswith('SHOP_DB='):
                value = line.split('=', 1)[1].strip()
                if value[:1] in ('"', "'") and value[-1:] == value[:1]:
                    value = value[1:-1]
                if not re.fullmatch(r'/[A-Za-z0-9_./-]+', value):
                    raise ValueError('Unsupported SHOP_DB format; review without exposing credentials')
                values.append(value)
    if len(values) > 1:
        raise ValueError('Ambiguous SHOP_DB configuration')
    return contained(values[0] if values else Path(state_root) / 'orders.sqlite3', state_root)


def digest(path, check=None):
    result = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            if check:
                check()
            result.update(block)
    return result.hexdigest()


def code_files(payment_root, static_root, unit_file):
    payment_root, static_root, unit_file = map(Path, (payment_root, static_root, unit_file))
    files = []
    for root, prefix in ((payment_root, 'payment'), (static_root, 'static')):
        for path in sorted(root.rglob('*')):
            relative = path.relative_to(root)
            if prefix == 'payment':
                eligible = path.suffix == '.py' or relative.as_posix() in ('README.md', 'requirements.txt')
            else:
                eligible = (relative.parts[0] in ('assets', 'resume') or relative.as_posix() in ('index.html', 'photo.png')) and path.suffix.lower() in ('.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.woff', '.woff2')
            if not eligible:
                continue
            if path.is_symlink() or any(parent.is_symlink() for parent in path.parents if parent != root.parent):
                raise ValueError('Refusing to follow code symlinks in a release backup')
            if path.is_file():
                files.append((path, prefix + '/' + relative.as_posix()))
    if not (payment_root / 'app.py').is_file() or not (static_root / 'index.html').is_file():
        raise ValueError('Current deployment code is incomplete')
    if not unit_file.is_file() or unit_file.is_symlink():
        raise ValueError('Missing or symlinked service unit')
    for line in unit_file.read_text(encoding='utf-8').splitlines():
        setting = line.strip()
        if setting.startswith(('#', ';')):
            continue
        key, separator, value = setting.partition('=')
        key, value = key.strip(), value.strip()
        if separator and ((key == 'Environment' and value != 'PYTHONDONTWRITEBYTECODE=1')
                          or key in ('SetCredential', 'SetCredentialEncrypted')):
            raise ValueError('Unexpected inline service credential setting; refuse to copy it')
    files.append((unit_file, 'systemd/zhilin-shop.service'))
    return files


def verify_backup(directory, manifest, check=None):
    directory = Path(directory)
    connection = sqlite3.connect('file:' + quote(str(directory / 'orders.sqlite3')) + '?mode=ro', uri=True)
    try:
        if check:
            connection.set_progress_handler(lambda: (check() or 0), 1000)
        if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ValueError('SQLite backup integrity verification failed')
        if not connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='orders'").fetchone():
            raise ValueError('SQLite backup does not contain the order table')
    finally:
        connection.close()
    with tarfile.open(directory / 'code.tar.gz', 'r:gz') as archive:
        if sorted(archive.getnames()) != sorted(manifest['code_files']):
            raise ValueError('Code backup file list verification failed')
        for member in archive:
            if not member.isfile():
                raise ValueError('Non-file entry in code backup')
            with archive.extractfile(member) as content:
                checksum_builder = hashlib.sha256()
                for block in iter(lambda: content.read(1024 * 1024), b''):
                    if check:
                        check()
                    checksum_builder.update(block)
                checksum = checksum_builder.hexdigest()
            if checksum != manifest['code_files'][member.name]['sha256']:
                raise ValueError('Code backup checksum verification failed')
    for name in ('orders.sqlite3', 'code.tar.gz'):
        if digest(directory / name, check) != manifest['sha256'][name]:
            raise ValueError('Backup checksum verification failed')


def backup_release(database, state_root, backup_root, payment_root, static_root, unit_file,
                   run_id, target_sha, rollback_sha, max_backup_bytes=MAX_BACKUP_BYTES):
    if not re.fullmatch(r'[0-9]+-[0-9]+', run_id) or not all(re.fullmatch(r'[a-f0-9]{40}', value) for value in (target_sha, rollback_sha)):
        raise ValueError('Invalid release identifiers')
    deadline = time.monotonic() + 30
    state_root = Path(state_root).resolve()
    database = contained(database, state_root)
    unresolved_backup = Path(backup_root)
    if unresolved_backup.is_symlink() or any(parent.is_symlink() for parent in unresolved_backup.parents):
        raise ValueError('Refusing a symlinked backup destination')
    backup_root = contained(unresolved_backup, state_root)
    if not database.is_file():
        raise FileNotFoundError('Live order database is missing; deployment blocked')
    files = code_files(payment_root, static_root, unit_file)
    if backup_root.exists() and (backup_root.is_symlink() or backup_root.stat().st_mode & 0o077):
        raise ValueError('Existing backup directory is not private; deployment blocked')
    target = backup_root / (run_id + '-' + target_sha[:12])
    if target.exists():
        raise FileExistsError('Backup target already exists and will not be overwritten')
    old_size = sum(path.stat().st_size for path in backup_root.rglob('*') if path.is_file()) if backup_root.exists() else 0
    source = sqlite3.connect('file:' + quote(str(database)) + '?mode=ro', uri=True, timeout=5)
    try:
        if not source.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='orders'").fetchone():
            raise ValueError('Configured database is not the order database')
        database_size = source.execute('PRAGMA page_count').fetchone()[0] * source.execute('PRAGMA page_size').fetchone()[0]
        estimate = database_size + sum(path.stat().st_size for path, _ in files) + MIB
        free = shutil.disk_usage(state_root).free
        if estimate > max_backup_bytes or old_size + estimate > MAX_TOTAL_BYTES or free < estimate + MIN_FREE_BYTES:
            raise ValueError('Backup size or free-disk limit exceeded; deployment blocked without deleting older backups')
        backup_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.staging-', dir=backup_root) as temporary:
            staging = Path(temporary)
            def check():
                if time.monotonic() > deadline:
                    raise TimeoutError('Whole backup deadline exceeded')
                actual = sum(path.stat().st_size for path in staging.rglob('*') if path.is_file())
                total = sum(path.stat().st_size for path in backup_root.rglob('*') if path.is_file())
                if actual > max_backup_bytes or total > MAX_TOTAL_BYTES or shutil.disk_usage(state_root).free < MIN_FREE_BYTES:
                    raise ValueError('Actual backup size or free-disk limit exceeded')
            saved_database = staging / 'orders.sqlite3'
            descriptor = os.open(saved_database, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            os.close(descriptor)
            destination = sqlite3.connect(saved_database)
            def progress(status, remaining, total):
                check()
            try:
                source.backup(destination, pages=128, progress=progress, sleep=0.05)
            finally:
                destination.close()
            archive_path = staging / 'code.tar.gz'
            manifest = {'target_sha': target_sha, 'rollback_git_sha': rollback_sha, 'run_id': run_id,
                        'code_files': {name: {'sha256': digest(path, check), 'bytes': path.stat().st_size} for path, name in files},
                        'rollback_note': 'Restore code only for ordinary rollback; retain the live database and all new orders.'}
            with archive_path.open('xb') as raw:
                os.chmod(archive_path, 0o600)
                class CheckedWriter:
                    def write(self, data):
                        check()
                        count = raw.write(data)
                        raw.flush()
                        check()
                        return count
                    def __getattr__(self, name):
                        return getattr(raw, name)
                with tarfile.open(fileobj=CheckedWriter(), mode='w:gz') as archive:
                    for path, name in files:
                        if time.monotonic() > deadline:
                            raise ValueError('Code backup runtime limit exceeded')
                        archive.add(path, arcname=name, recursive=False)
            manifest['sha256'] = {name: digest(staging / name, check) for name in ('orders.sqlite3', 'code.tar.gz')}
            verify_backup(staging, manifest, check)
            check()
            manifest_path = staging / 'manifest.json'
            with manifest_path.open('x', encoding='utf-8') as output:
                os.chmod(manifest_path, 0o600)
                json.dump(manifest, output, ensure_ascii=False, indent=2)
                output.write('\n')
            check()
            staging.rename(target)
        return {'verified': True, 'backup_dir': str(target), 'target_sha': target_sha,
                'rollback_git_sha': rollback_sha, 'copied_credentials': False}
    finally:
        source.close()


def main():
    def interrupted(signum, frame):
        raise TimeoutError('Backup command interrupted; deployment blocked')
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--target-sha', required=True)
    parser.add_argument('--rollback-sha', required=True)
    args = parser.parse_args()
    state_root = Path('/var/lib/zhilin-shop')
    database = resolve_database('/etc/zhilin-shop/shop.env', state_root)
    result = backup_release(database, state_root, state_root / 'backups' / 'releases',
                            '/opt/zhilin-shop/payment', '/usr/share/nginx/html',
                            '/etc/systemd/system/zhilin-shop.service', args.run_id,
                            args.target_sha, args.rollback_sha)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
