"""使用既有 canonical runner，在本地独占数据库验证 MANUAL 闭环并脱敏输出。"""
import os
import subprocess
from pathlib import Path

from sqlalchemy.engine import make_url

from app.config import settings

root = Path(__file__).resolve().parents[4]
admin = make_url(settings.database_url).set(host="127.0.0.1", port=55432)
environment = {
    **os.environ,
    "DATABASE_URL": admin.render_as_string(hide_password=False),
    "REDIS_URL": "redis://127.0.0.1:56379/13",
    "APP_ENV": "test",
    "SESSION_SECRET": "development-only-change-me-32-bytes",
    "UPLOAD_SIGNING_SECRET": "partsignal-development-only-storage-key",
    "AI_CREDENTIAL_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "PARTSIGNAL_E2E_GEO_MODE": "",
    "PARTSIGNAL_E2E_SPEC": "tests/e2e/geo-(loop|review)-real-stack.spec.ts",
    "PARTSIGNAL_SEED_ADMIN_PASSWORD": "partsignal-admin-dev",
    "PARTSIGNAL_SEED_ENGINEER_PASSWORD": "partsignal-engineer-dev",
    "OBJECT_STORAGE_BACKEND": "development",
    "AI_ALLOW_LOCAL_HTTP": "true",
}
result = subprocess.run(
    [str(root / "deploy/scripts/e2e-local.sh")],
    cwd=root,
    env=environment,
    capture_output=True,
    text=True,
)
output = result.stdout + result.stderr
for value in (
    settings.database_url,
    admin.render_as_string(hide_password=False),
    admin.password,
    settings.session_secret,
    settings.ai_credential_encryption_key,
):
    if value:
        output = output.replace(value, "[REDACTED]")
print(output, end="")
raise SystemExit(result.returncode)
