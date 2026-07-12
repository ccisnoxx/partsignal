"""账号初始化与生成诊断等后端维护命令。"""

from __future__ import annotations

import argparse
import json
import os
import sys

from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.security import hash_password
from app.services.generation_dispatch import generation_diagnostics
from app.services.integrity import publication_integrity_issues


def seed_demo(admin_password: str, engineer_password: str) -> None:
    """幂等创建管理员和内容工程师，不覆盖任何既有账号。"""
    if len(admin_password) < 12:
        raise ValueError("管理员初始密码至少需要 12 个字符")
    if len(engineer_password) < 12:
        raise ValueError("工程师初始密码至少需要 12 个字符")
    with SessionLocal.begin() as db:
        admin = db.scalar(select(User).where(User.username == "admin"))
        if admin is None:
            db.add(
                User(
                    username="admin",
                    display_name="系统管理员",
                    password_hash=hash_password(admin_password),
                    account_type="ADMIN",
                )
            )
        content_editor = db.scalar(select(User).where(User.username == "content_editor"))
        if content_editor is None:
            db.add(
                User(
                    username="content_editor",
                    display_name="内容运营",
                    password_hash=hash_password(engineer_password),
                    account_type="ENGINEER",
                    must_change_password=True,
                )
            )
    print("已创建或确认本地开发管理员和内容工程师账号。")


def main() -> None:
    """解析并执行后端维护子命令。"""
    parser = argparse.ArgumentParser(description="PartSignal 后端维护命令")
    subparsers = parser.add_subparsers(dest="command", required=True)
    seed_parser = subparsers.add_parser("seed-demo", help="创建虚构开发账号")
    seed_parser.add_argument(
        "--password",
        default=os.getenv("PARTSIGNAL_SEED_ADMIN_PASSWORD"),
        help="管理员初始密码，也可通过 PARTSIGNAL_SEED_ADMIN_PASSWORD 提供",
    )
    seed_parser.add_argument(
        "--engineer-password",
        default=os.getenv("PARTSIGNAL_SEED_ENGINEER_PASSWORD"),
        help="内容工程师初始密码，也可通过 PARTSIGNAL_SEED_ENGINEER_PASSWORD 提供",
    )
    subparsers.add_parser(
        "generation-diagnostics",
        help="输出生成作业积压、近期失败和供应商耗时摘要",
    )
    subparsers.add_parser(
        "preflight-integrity",
        help="只读检查阻断上线的历史业务完整性问题",
    )
    args = parser.parse_args()
    if args.command == "seed-demo":
        if not args.password:
            print("缺少管理员初始密码，请设置 PARTSIGNAL_SEED_ADMIN_PASSWORD。", file=sys.stderr)
            raise SystemExit(2)
        if not args.engineer_password:
            print(
                "缺少工程师初始密码，请设置 PARTSIGNAL_SEED_ENGINEER_PASSWORD。",
                file=sys.stderr,
            )
            raise SystemExit(2)
        seed_demo(args.password, args.engineer_password)
    elif args.command == "generation-diagnostics":
        print(json.dumps(generation_diagnostics(), ensure_ascii=False, sort_keys=True))
    elif args.command == "preflight-integrity":
        with SessionLocal() as db:
            issues = publication_integrity_issues(db)
        print(json.dumps(issues, ensure_ascii=False, sort_keys=True))
        if issues:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
