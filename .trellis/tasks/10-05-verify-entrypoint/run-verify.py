"""为完整本地门禁显式选择开发回环连接与专用 Redis DB 13，不写私有配置。"""

import json
import os
import subprocess
from pathlib import Path

from sqlalchemy.engine import make_url

root = Path(__file__).resolve().parents[3]
compose = ["docker", "compose", "--env-file", ".env", "-f", "deploy/compose.dev.yaml"]
result = subprocess.run(
    [*compose, "--profile", "test", "config", "--format", "json"],
    cwd=root, capture_output=True, text=True, check=True,
)
source = make_url(json.loads(result.stdout)["services"]["backend-test"]["environment"]["DATABASE_URL"])
assert source.host == "postgres" and source.port == 5432 and not source.query
database = source.set(host="127.0.0.1", port=55432).render_as_string(hide_password=False)
environment = {
    **os.environ,
    "DATABASE_URL": database,
    "REDIS_URL": "redis://127.0.0.1:56379/13",
    "GEO_BROWSER_COLLECTION_ENABLED": "false",
}
raise SystemExit(subprocess.run(["make", "verify"], cwd=root, env=environment, check=False).returncode)
