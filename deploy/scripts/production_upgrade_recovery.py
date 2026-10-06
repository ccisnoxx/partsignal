"""升级修复的归档证明；不拥有状态、锁或运行服务。"""

from __future__ import annotations

import hashlib
import json
import tarfile
from pathlib import Path, PurePosixPath
from typing import Any


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


def migration_path(name: str) -> bool:
    return name == "backend/alembic.ini" or name.startswith("backend/alembic/")


def archive_migrations(path: Path) -> dict[str, str]:
    """只读归档成员，不解包；拒绝迁移路径别名、重复和链接。"""
    result: dict[str, str] = {}
    seen: set[str] = set()
    with tarfile.open(path, "r:*") as archive:
        for member in archive:
            name = member.name.rstrip("/")
            parts = PurePosixPath(name).parts
            if (
                name.startswith("/")
                or ".." in parts
                or str(PurePosixPath(name)) != name
            ):
                raise ValueError("source archive 包含路径别名")
            if not migration_path(name):
                continue
            if name in seen:
                raise ValueError("source archive 包含重复迁移成员")
            seen.add(name)
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError("source archive 迁移成员必须是普通文件")
            source = archive.extractfile(member)
            if source is None:
                raise ValueError("source archive 迁移成员无法读取")
            with source:
                result[name] = hashlib.file_digest(source, "sha256").hexdigest()
    if (
        "backend/alembic.ini" not in result
        or "backend/alembic/env.py" not in result
        or not any(name.startswith("backend/alembic/versions/") for name in result)
    ):
        raise ValueError("source archive 缺少完整迁移树")
    return result


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
    """证明修复只改变 artifact，不重写已提交或待重入的迁移历史。"""
    old = archive_migrations(
        authenticated_archive(failed_manifest, failed_archive, failed)
    )
    new = archive_migrations(authenticated_archive(manifest, archive, fixed))
    if old != new:
        raise ValueError("恢复候选迁移树与失败候选不一致")
    paths = [repository / "backend/alembic", repository / "backend/alembic.ini"]
    paths.extend((repository / "backend/alembic").rglob("*"))
    current: dict[str, str] = {}
    for path in paths:
        if "__pycache__" in path.parts or path.suffix == ".pyc":
            continue
        if path.is_symlink():
            raise ValueError("当前迁移树不能包含符号链接")
        if path.is_file():
            current[path.relative_to(repository).as_posix()] = digest(path)
    if current != new:
        raise ValueError("当前迁移树与恢复 source archive 不一致")
    return hashlib.sha256(json.dumps(new, sort_keys=True).encode()).hexdigest()
