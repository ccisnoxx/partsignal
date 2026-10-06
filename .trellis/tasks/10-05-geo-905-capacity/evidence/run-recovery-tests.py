"""只读现有连接身份，使用显式本地PG16工具；不打印连接秘密。"""
import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy.engine import make_url
from app.config import settings

root = Path(__file__).resolve().parents[4]
admin = make_url(settings.database_url).set(host='127.0.0.1', port=55432)
environment = {
    **os.environ,
    'APP_ENV': 'test',
    'PARTSIGNAL_TEST_DATABASE_URL': admin.render_as_string(hide_password=False),
    'DATABASE_URL': admin.render_as_string(hide_password=False),
    'REDIS_URL': 'redis://127.0.0.1:56379/14',
    'GEO_RECOVERY_PG_CONTAINER': 'partsignal-dev-postgres-1',
    'SESSION_SECRET': 'development-only-change-me-32-bytes',
    'UPLOAD_SIGNING_SECRET': 'partsignal-development-only-storage-key',
    'AI_CREDENTIAL_ENCRYPTION_KEY': 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'OBJECT_STORAGE_BACKEND': 'development',
    'AI_ALLOW_LOCAL_HTTP': 'true',
}
result = subprocess.run(
    [sys.executable, '-m', 'pytest', 'backend/tests/integration/test_geo_recovery.py'],
    cwd=root, env=environment, capture_output=True, text=True,
)
output = result.stdout + result.stderr
for value in (settings.database_url, admin.render_as_string(hide_password=False),
              admin.password, settings.session_secret, settings.ai_credential_encryption_key):
    if value:
        output = output.replace(value, '[REDACTED]')
print(output, end='')
raise SystemExit(result.returncode)
