"""在宿主机执行真实恢复测试，仅使用开发 Compose 的回环 PG16 容器。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = [
    "docker", "compose", "--env-file", ".env", "-f", "deploy/compose.dev.yaml",
    "--profile", "test",
]


def compose_output(*arguments: str) -> str:
    """配置中包含私有值；仅在内存读取，失败时不回显原始输出。"""
    result = subprocess.run(
        [*COMPOSE, *arguments], cwd=ROOT, capture_output=True, text=True, check=False
    )
    if result.returncode:
        raise SystemExit(f"恢复测试无法读取开发 Compose：{arguments[0]}，退出 {result.returncode}")
    return result.stdout.strip()


def main() -> int:
    if any(key.startswith("PG") for key in os.environ):
        raise SystemExit("恢复测试拒绝 PG* 环境覆盖；请使用显式开发 Compose 配置")
    config = json.loads(compose_output("config", "--format", "json"))
    profile = config["services"]["backend-test"]["environment"]
    source = make_url(profile["DATABASE_URL"])
    if source.host != "postgres" or source.port != 5432 or source.query:
        raise SystemExit("恢复测试只允许开发 Compose 的 postgres 服务连接")
    container = compose_output("ps", "-q", "postgres")
    if not container or "\n" in container:
        raise SystemExit("恢复测试要求唯一且已启动的开发 postgres 容器")
    mapped = compose_output("port", "postgres", "5432")
    host, port = mapped.rsplit(":", 1)
    if host != "127.0.0.1":
        raise SystemExit("恢复测试要求开发 postgres 端口仅绑定 127.0.0.1")
    admin = source.set(host=host, port=int(port)).render_as_string(hide_password=False)
    # 不把整个私有 env_file 复制到测试环境；复用 Compose 明确的测试身份。
    keys = (
        "SESSION_SECRET",
        "PARTSIGNAL_SEED_ADMIN_PASSWORD",
        "PARTSIGNAL_SEED_ENGINEER_PASSWORD",
        "AI_CREDENTIAL_ENCRYPTION_KEY",
    )
    environment = {
        **os.environ,
        **{key: profile[key] for key in keys},
        "APP_ENV": "test",
        "DATABASE_URL": admin,
        "PARTSIGNAL_TEST_DATABASE_URL": admin,
        "REDIS_URL": "redis://127.0.0.1:56379/15",
        "GEO_RECOVERY_PG_CONTAINER": container,
        "CONTENT_GENERATOR": "openai-compatible",
        "OBJECT_STORAGE_BACKEND": "development",
        "UPLOAD_SIGNING_SECRET": "partsignal-development-only-storage-key",
        "AI_ALLOW_LOCAL_HTTP": "true",
        "GEO_BROWSER_COLLECTION_ENABLED": "false",
    }
    # fixture 检查容器发布端口，只在随机来源库/恢复库调用工具并精确清理。
    return subprocess.run(
        [sys.executable, "-m", "pytest", "backend/tests/integration/test_geo_recovery.py"],
        cwd=ROOT,
        env=environment,
        check=False,
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
