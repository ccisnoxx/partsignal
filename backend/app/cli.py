"""本地开发数据初始化命令。"""

from __future__ import annotations

import argparse
import os
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.security import hash_password


def seed_demo(password: str) -> None:
    """幂等创建明确的本地开发管理员账号。"""
    if len(password) < 12:
        raise ValueError("开发账号密码至少需要 12 个字符")
    with SessionLocal.begin() as db:
        user = db.scalar(select(User).where(User.username == "admin"))
        if user is None:
            db.add(
                User(
                    username="admin",
                    display_name="系统管理员",
                    password_hash=hash_password(password),
                    account_type="ADMIN",
                )
            )
    print("已创建或确认本地开发管理员账号。")


def main() -> None:
    """解析并执行后端维护子命令。"""
    parser = argparse.ArgumentParser(description="PartSignal 后端维护命令")
    subparsers = parser.add_subparsers(dest="command", required=True)
    seed_parser = subparsers.add_parser("seed-demo", help="创建虚构开发账号")
    seed_parser.add_argument(
        "--password",
        default=os.getenv("PARTSIGNAL_SEED_ADMIN_PASSWORD"),
        help="开发账号共用初始密码，也可通过 PARTSIGNAL_SEED_ADMIN_PASSWORD 提供",
    )
    args = parser.parse_args()
    if args.command == "seed-demo":
        if not args.password:
            print("缺少开发账号密码，请设置 PARTSIGNAL_SEED_ADMIN_PASSWORD。", file=sys.stderr)
            raise SystemExit(2)
        seed_demo(args.password)


if __name__ == "__main__":
    main()
