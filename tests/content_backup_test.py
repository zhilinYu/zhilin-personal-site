import importlib.util
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location('backup', Path(__file__).resolve().parents[1] / 'deploy/preflight_backup.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)
with tempfile.TemporaryDirectory(dir=Path(tempfile.gettempdir()).resolve()) as directory:
    root = Path(directory)
    payment, static = root / 'payment', root / 'static'
    payment.mkdir()
    (payment / 'app.py').write_text('old payment')
    public = ['index.html', 'admin/index.html', 'admin/config.yml', 'admin/vendor/a.js', 'admin/vendor/a.wasm', 'admin/vendor/a.js.LICENSE.txt', 'admin/vendor/LICENSE', 'assets/uploads/example.zip', 'assets/uploads/example.gif']
    for name in public + ['admin/.env', 'admin/private.pem', '.env', 'content/private.json']:
        file = static / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text('synthetic fixture')
    unit = root / 'service.unit'
    unit.write_text('[Service]\nUser=zhilin-shop\n')
    files = {name for _, name in backup.code_files(payment, static, unit)}
    assert all('static/' + name in files for name in public), '后台与公开附件必须进入回滚备份'
    assert not any('.env' in name or '.pem' in name or '/content/' in name for name in files), '私有配置及草稿不得进入静态备份'
print('通过：后台运行文件与公开附件进入备份，私有文件被排除。')
