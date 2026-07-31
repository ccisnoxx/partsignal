"""创建和删除单次 E2E 运行专属的 PostgreSQL 数据库。"""

from __future__ import annotations

import argparse
import os
import re
from urllib.parse import urlsplit, urlunsplit

import psycopg
from psycopg import sql


DATABASE_NAME_PATTERN = re.compile(r"^partsignal_e2e_\d{8}_\d+$")


def database_url(source_url: str, database_name: str) -> str:
    """保留连接参数，仅替换数据库名。"""
    parts = urlsplit(source_url)
    return urlunsplit(
        (parts.scheme, parts.netloc, f"/{database_name}", parts.query, parts.fragment)
    )


def psycopg_url(value: str) -> str:
    """将 SQLAlchemy URL 转换为 psycopg URL。"""
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def main() -> None:
    """按动作管理经过前缀校验的 E2E 数据库。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("create", "drop"))
    parser.add_argument("database_name")
    args = parser.parse_args()
    if not DATABASE_NAME_PATTERN.fullmatch(args.database_name):
        raise ValueError("E2E 数据库名不符合受控前缀")

    source_url = os.environ["DATABASE_URL"]
    admin_url = psycopg_url(database_url(source_url, "postgres"))
    with psycopg.connect(admin_url, autocommit=True) as connection:
        if args.action == "create":
            connection.execute(
                sql.SQL("CREATE DATABASE {}").format(sql.Identifier(args.database_name))
            )
            print(database_url(source_url, args.database_name))
            return
        connection.execute(
            sql.SQL("DROP DATABASE {} WITH (FORCE)").format(
                sql.Identifier(args.database_name)
            )
        )
        print(f"E2E_CLEANUP database={args.database_name} status=deleted")


if __name__ == "__main__":
    main()
