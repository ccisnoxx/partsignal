"""升级修复的归档证明；不拥有状态、锁或运行服务。"""

from __future__ import annotations

import hashlib
import json
import tarfile
from pathlib import Path
from typing import Any

from production_migration_runtime import (
    canonical_path,
    checkout_source_files,
    files_digest,
    source_files,
)


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def plain_file(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise ValueError("恢复材料必须是绝对普通文件")
    if path.resolve(strict=True) != path:
        raise ValueError("恢复材料不能包含路径别名")
    return path


def archive_migrations(path: Path) -> dict[str, str]:
    """只读归档中的 Alembic 树；完整程序由冻结迁移镜像单独证明。"""
    inventory: dict[str, bytes] = {}
    seen: set[str] = set()
    links: set[str] = set()
    with tarfile.open(path, "r:*") as archive:
        for member in archive:
            name = canonical_path(member.name, directory=member.isdir())
            if not name.startswith("backend/"):
                continue
            if name in seen:
                raise ValueError("source archive 包含重复迁移成员")
            seen.add(name)
            relative = name.removeprefix("backend/")
            if relative.endswith((".pyc", ".pyo")):
                raise ValueError("source archive 包含应用或迁移编译缓存")
            if member.isdir():
                continue
            if not member.isfile():
                if relative.startswith(("alembic/", "app/models/")):
                    raise ValueError("source archive 迁移成员必须是普通文件")
                links.add(relative)
                continue
            source = archive.extractfile(member)
            if source is None:
                raise ValueError("source archive 迁移成员无法读取")
            with source:
                inventory[relative] = source.read()
    result = source_files(inventory)
    if links:
        raise ValueError("source archive 迁移加载根成员必须是普通文件")
    return {"backend/" + name: value for name, value in result.items()}


def authenticated_archive(
    manifest: str, archive: str, candidate: dict[str, Any]
) -> Path:
    manifest_path = plain_file(manifest)
    content = manifest_path.read_bytes()
    if hashlib.sha256(content).hexdigest() != candidate["manifest_sha256"]:
        raise ValueError("恢复 manifest SHA-256 与冻结候选不一致")
    payload = json.loads(content)
    source = payload.get("source_archive")
    path = plain_file(archive)
    if (
        not isinstance(source, dict)
        or source.get("name") != path.name
        or source.get("sha256") != digest(path)
    ):
        raise ValueError("恢复 source archive 与 manifest 不一致")
    return path


def verify_archives(
    failed: dict[str, Any],
    fixed: dict[str, Any],
    *,
    failed_manifest: str,
    manifest: str,
    failed_archive: str,
    archive: str,
    repository: Path,
) -> str:
    """认证旧、新归档与 checkout 的 Alembic 树；不执行归档代码。"""
    old = archive_migrations(
        authenticated_archive(failed_manifest, failed_archive, failed)
    )
    new = archive_migrations(authenticated_archive(manifest, archive, fixed))
    if old != new:
        raise ValueError("恢复候选迁移树与失败候选不一致")
    current = {"backend/" + name: value for name, value in
               checkout_source_files(repository / "backend").items()}
    if current != new:
        raise ValueError("当前迁移树与恢复 source archive 不一致")
    return files_digest({name.removeprefix("backend/"): value for name, value in new.items()})
