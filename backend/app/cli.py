"""本地开发数据初始化命令。"""

from __future__ import annotations

import argparse
import os
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Role, User
from app.schemas import RoleName
from app.security import hash_password

DEMO_USERS = {
    "admin": ("系统管理员", [RoleName.SYSTEM_ADMIN]),
    "product_editor": ("产品资料维护者", [RoleName.PRODUCT_EDITOR]),
    "product_reviewer": ("产品审核者", [RoleName.PRODUCT_REVIEWER]),
    "content_editor": ("内容运营", [RoleName.CONTENT_EDITOR]),
    "content_reviewer": ("内容审核者", [RoleName.CONTENT_REVIEWER]),
    "analyst": ("数据分析者", [RoleName.ANALYST]),
}


def seed_demo(password: str) -> None:
    """幂等创建固定角色和职责分离的虚构开发账号。"""
    if len(password) < 12:
        raise ValueError("开发账号密码至少需要 12 个字符")
    with SessionLocal.begin() as db:
        roles: dict[RoleName, Role] = {}
        for role_name in RoleName:
            role = db.get(Role, role_name.value)
            if role is None:
                role = Role(name=role_name.value)
                db.add(role)
            roles[role_name] = role
        db.flush()
        for username, (display_name, role_names) in DEMO_USERS.items():
            user = db.scalar(select(User).where(User.username == username))
            if user is None:
                db.add(
                    User(
                        username=username,
                        display_name=display_name,
                        password_hash=hash_password(password),
                        roles=[roles[role_name] for role_name in role_names],
                    )
                )
    print("已创建或确认 6 个职责分离的虚构开发账号。")


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
