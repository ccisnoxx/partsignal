"""Compose 使用的显式开发对象存储进程入口。"""

from __future__ import annotations

import uvicorn

from app.dev_storage import app


def main() -> None:
    """仅在开发容器内监听对象存储端口。"""
    uvicorn.run(app, host="0.0.0.0", port=9000)


if __name__ == "__main__":
    main()
