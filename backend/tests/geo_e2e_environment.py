"""GEO-408 测试工厂的启动边界；校验成功前不得装配任何放宽。"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlsplit

import psycopg
from redis import Redis

PROVIDER_URL = "http://127.0.0.1:19012"
PROVIDER_API_URL = f"{PROVIDER_URL}/v1"
MODES = {
    "enabled": (True, True),
    "api-disabled": (True, False),
    "monitoring-disabled": (False, False),
}
DATABASE_PATTERN = re.compile(r"partsignal_e2e_[0-9]{8}_[0-9a-f]{32}", re.ASCII)
TOKEN_PATTERN = re.compile(r"[0-9a-f]{32}", re.ASCII)


@dataclass(frozen=True, repr=False)
class OwnedEnvironment:
    database_url: str
    database_name: str
    owner_token: str
    redis_url: str
    mode: str


def environment_values(values: Mapping[str, str]) -> OwnedEnvironment:
    """环境必须显式提供；错误不回显连接值、凭据或 owner token。"""
    if values.get("APP_ENV") != "test" or values.get("AI_ALLOW_LOCAL_HTTP") != "true":
        raise ValueError("GEO E2E 工厂仅允许显式 test 与本机 HTTP 配置")
    if values.get("PARTSIGNAL_E2E_GEO_PROVIDER_URL") != PROVIDER_URL:
        raise ValueError("GEO E2E provider 必须使用精确回环地址")
    mode = values.get("PARTSIGNAL_E2E_GEO_MODE", "")
    if mode not in MODES:
        raise ValueError("GEO E2E 模式无效")
    expected = MODES[mode]
    actual = tuple(
        values.get(key) for key in ("GEO_MONITORING_ENABLED", "GEO_API_COLLECTION_ENABLED")
    )
    if actual != tuple(str(flag).lower() for flag in expected):
        raise ValueError("GEO E2E 模式与功能开关不一致")
    database_url = values.get("DATABASE_URL", "")
    parsed = urlsplit(database_url)
    database_name = parsed.path.removeprefix("/")
    if (
        parsed.scheme not in {"postgresql", "postgresql+psycopg"}
        or not DATABASE_PATTERN.fullmatch(database_name)
        or parsed.fragment
    ):
        raise ValueError("GEO E2E 必须使用本轮随机 PostgreSQL 数据库")
    token = values.get("PARTSIGNAL_E2E_DATABASE_OWNER_TOKEN", "")
    if not TOKEN_PATTERN.fullmatch(token):
        raise ValueError("GEO E2E 数据库 owner token 无效")
    redis_url = values.get("REDIS_URL", "")
    client = Redis.from_url(redis_url)
    try:
        if int(client.connection_pool.connection_kwargs.get("db", 0)) == 0:
            raise ValueError("GEO E2E Redis 必须使用非 0 logical DB")
    finally:
        client.close()
    return OwnedEnvironment(database_url, database_name, token, redis_url, mode)


def validate_owned_environment() -> OwnedEnvironment:
    """以数据库实际名称和 comment 裁决所有权，不把命名规则当成删除/放宽权。"""
    environment = environment_values(os.environ)
    connection_url = environment.database_url.replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(connection_url, connect_timeout=5) as connection:
        row = connection.execute(
            "SELECT current_database(), shobj_description(oid, 'pg_database') "
            "FROM pg_database WHERE datname = current_database()"
        ).fetchone()
    if row != (environment.database_name, f"partsignal-e2e-owner:{environment.owner_token}"):
        raise ValueError("GEO E2E 数据库实际归属不匹配，拒绝装配")
    return environment
