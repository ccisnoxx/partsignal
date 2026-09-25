"""创建和删除单次 E2E 运行专属的 PostgreSQL 数据库。"""

from __future__ import annotations

import argparse
import os
import re
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql


DATABASE_NAME_PATTERN = re.compile(r"^partsignal_e2e_[0-9]{8}_[0-9a-f]{32}$")
OWNER_TOKEN_PATTERN = re.compile(r"^[0-9a-f]{32}$")
OWNER_MARKER_PREFIX = "partsignal-e2e-owner:"


def database_url(source_url: str, database_name: str) -> str:
    """保留连接参数，仅替换数据库名。"""
    parts = urlsplit(source_url)
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


def psycopg_url(value: str) -> str:
    """将 SQLAlchemy URL 转换为 psycopg URL。"""
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def owner_marker(owner_token: str) -> str:
    """把受控随机 token 转换为数据库所有权标记。"""
    if not OWNER_TOKEN_PATTERN.fullmatch(owner_token):
        raise ValueError("E2E 数据库 owner token 不符合受控格式")
    return f"{OWNER_MARKER_PREFIX}{owner_token}"


def manage_database(
    action: str,
    database_name: str,
    owner_token: str,
    source_url: str,
) -> str:
    """只管理调用方精确提供且符合受控格式的单个 E2E 数据库。"""
    if not DATABASE_NAME_PATTERN.fullmatch(database_name):
        raise ValueError("E2E 数据库名不符合受控前缀")
    expected_owner_marker = owner_marker(owner_token)

    admin_url = psycopg_url(database_url(source_url, "postgres"))
    with psycopg.connect(admin_url, autocommit=True) as connection:
        if action == "create":
            connection.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database_name))
            )
            connection.execute(
                sql.SQL("COMMENT ON DATABASE {} IS {}").format(
                    sql.Identifier(database_name),
                    sql.Literal(expected_owner_marker),
                )
            )
            return database_url(source_url, database_name)
        if action != "drop":
            raise ValueError("不支持的 E2E 数据库动作")
        row = connection.execute(
            "SELECT shobj_description(oid, 'pg_database') "
            "FROM pg_database WHERE datname = %s",
            (database_name,),
        ).fetchone()
        if row is None:
            return f"E2E_CLEANUP database={database_name} status=absent"
        if row[0] != expected_owner_marker:
            raise ValueError("E2E 数据库所有权不匹配，拒绝删除")
        connection.execute(
            sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                sql.Identifier(database_name)
            )
        )
        return f"E2E_CLEANUP database={database_name} status=deleted"


def main() -> None:
    """按动作管理经过前缀校验的 E2E 数据库。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("create", "drop"))
    parser.add_argument("database_name")
    parser.add_argument("owner_token")
    args = parser.parse_args()
    print(
        manage_database(
            args.action,
            args.database_name,
            args.owner_token,
            os.environ["DATABASE_URL"],
        )
    )


if __name__ == "__main__":
    main()
