#!/usr/bin/env python3
"""首次为服务器开发预览生成私有 runtime 文件；不部署、不上传、不覆盖既有配置。"""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


class InputError(ValueError):
    """仅携带固定错误码，禁止原始输入进入输出。"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True, help="预览站点 HTTPS origin，无路径")
    parser.add_argument("--output", type=Path, default=ROOT / ".env.staging")
    parser.add_argument(
        "--generator", choices=("deterministic", "openai-compatible"), default="deterministic"
    )
    args = parser.parse_args()
    try:
        origin = urlsplit(args.origin)
        if not (
            origin.scheme == "https"
            and origin.hostname
            and origin.path == ""
            and origin.username is None
            and origin.password is None
            and not origin.query
            and not origin.fragment
            and not any(ord(c) <= 32 or ord(c) == 127 or c in "$`\"'#" for c in args.origin)
        ):
            raise InputError("HTTPS_ORIGIN_REQUIRED")
        _ = origin.port
        if os.path.lexists(args.output):
            raise InputError("EXISTING_CONFIG_PRESERVED")
        template = (ROOT / ".env.staging.example").read_text()
        values = dict(
            line.split("=", 1)
            for line in template.splitlines()
            if line and not line.startswith("#")
        )
        values.update(
            {
                "APP_BASE_URL": args.origin,
                "CORS_ALLOWED_ORIGINS": args.origin,
                "OBJECT_STORAGE_PUBLIC_ENDPOINT": args.origin + "/object-storage",
                "CONTENT_GENERATOR": args.generator,
                "POSTGRES_PASSWORD": secrets.token_urlsafe(36),
                "SESSION_SECRET": secrets.token_urlsafe(48),
                "UPLOAD_SIGNING_SECRET": secrets.token_urlsafe(48),
                "PARTSIGNAL_SEED_ADMIN_PASSWORD": secrets.token_urlsafe(36),
                "PARTSIGNAL_SEED_ENGINEER_PASSWORD": secrets.token_urlsafe(36),
                "AI_CREDENTIAL_ENCRYPTION_KEY": base64.b64encode(secrets.token_bytes(32)).decode(),
            }
        )
        values["DATABASE_URL"] = (
            "postgresql+psycopg://"
            + values["POSTGRES_USER"]
            + ":"
            + values["POSTGRES_PASSWORD"]
            + "@postgres:5432/"
            + values["POSTGRES_DB"]
        )
        # 使用真实 Settings，在空 cwd 和清空的进程环境中校验；不读取另一份 .env。
        with tempfile.TemporaryDirectory(prefix="partsignal-preview-check-") as directory:
            result = subprocess.run(
                [sys.executable, "-B", "-c", "from app.config import settings"],
                cwd=directory,
                env={**values, "PYTHONPATH": str(ROOT / "backend")},
                capture_output=True,
            )
        if result.returncode:
            raise InputError("BACKEND_SETTINGS_REJECTED")
        # 完整写入受控暂存文件后排他安装；竞态下也不能覆盖已有配置或 symlink。
        with tempfile.NamedTemporaryFile(
            dir=args.output.parent, prefix=".partsignal-preview-", delete=False
        ) as staged:
            staged_path = Path(staged.name)
            try:
                os.fchmod(staged.fileno(), 0o600)
                staged.write(
                    (
                        "# 首次自动生成的服务器开发预览配置；后续发布复用。\n"
                        + "".join(f"{k}={v}\n" for k, v in values.items())
                    ).encode()
                )
                staged.flush()
                os.fsync(staged.fileno())
                os.link(staged_path, args.output, follow_symlinks=False)
            finally:
                staged_path.unlink()
        print(
            json.dumps(
                {
                    "status": "CREATED",
                    "runtime_keys": len(values),
                    "generated_secrets": 6,
                    "deployment": "NOT_RUN",
                }
            )
        )
        return 0
    except InputError as error:
        print(json.dumps({"status": "FAILED", "code": str(error)}))
    except Exception:
        print(json.dumps({"status": "FAILED", "code": "PREVIEW_ENV_PREPARATION_FAILED"}))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
