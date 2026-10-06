"""验证仅有前端源码的构建边界；复用已安装依赖，不冒充 Docker 验证。"""
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[4]
with tempfile.TemporaryDirectory(prefix='geo-005-frontend-') as directory:
    frontend = Path(directory) / 'frontend'
    shutil.copytree(repo / 'frontend', frontend,
                    ignore=shutil.ignore_patterns('node_modules', 'dist', '.cache',
                                                 'test-results', 'playwright-report', '*.tsbuildinfo'))
    (frontend / 'node_modules').symlink_to(repo / 'frontend' / 'node_modules', target_is_directory=True)
    assert not (Path(directory) / 'backend').exists()
    result = subprocess.run(['npm', 'run', 'build'], cwd=frontend, check=False)
    raise SystemExit(result.returncode)
