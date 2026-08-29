#!/usr/bin/env python3
"""生成不可覆盖且不含凭据的 Production 候选发布清单。"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

REQUIRED_TRACKED_FILES = {
    "deploy/compose.prod.yaml",
    "deploy/nginx/partsignal-security-headers.conf",
    "deploy/nginx/partsignal.conf.template",
    "deploy/scripts/activate-production.sh",
    "deploy/scripts/deploy.sh",
    "deploy/scripts/prepare-production-data.py",
    "deploy/scripts/rollback-production-frontend.sh",
}
REPO_DIGEST_PATTERN = re.compile(r"[^@\s]+@sha256:[0-9a-f]{64}")
V1_REPOSITORY_PATTERN = re.compile(
    r"(?:^|/)[^/:@]*(?:backend|frontend)-v1(?=[:@]|$)"
)
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def sha256(path: Path) -> str:
    """流式计算文件摘要，避免把发布包一次性读入内存。"""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_image(reference: str) -> dict[str, Any]:
    """读取本地镜像不可变标识，不构建、不拉取也不修改镜像。"""
    if V1_REPOSITORY_PATTERN.search(reference):
        raise ValueError(f"Production 候选不允许使用 V1 镜像仓库：{reference}")
    completed = subprocess.run(
        ["docker", "image", "inspect", reference],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(completed.stdout)
    if not isinstance(payload, list) or len(payload) != 1:
        raise ValueError(f"镜像检查结果数量异常：{reference}")
    image = payload[0]
    image_id = image.get("Id")
    repo_digests = image.get("RepoDigests") or []
    if not isinstance(image_id, str) or not image_id.startswith("sha256:"):
        raise ValueError(f"镜像缺少 sha256 ID：{reference}")
    if (
        not isinstance(repo_digests, list)
        or not repo_digests
        or not all(
            isinstance(value, str) and REPO_DIGEST_PATTERN.fullmatch(value)
            for value in repo_digests
        )
    ):
        raise ValueError(f"镜像缺少合法 RepoDigest：{reference}")
    return {
        "reference": reference,
        "image_id": image_id,
        "repo_digests": sorted(repo_digests),
    }


def parse_args() -> argparse.Namespace:
    """解析候选发布的显式身份、镜像和文件输入。"""
    parser = argparse.ArgumentParser(description="生成 PartSignal Production 候选发布清单")
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--source-archive", type=Path, required=True)
    parser.add_argument("--backend-image", required=True)
    parser.add_argument("--frontend-image", required=True)
    parser.add_argument("--rollback-frontend-image", required=True)
    parser.add_argument("--schema-head", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tracked-file", action="append", type=Path, default=[])
    return parser.parse_args()


def verify_release_source(commit: str, source_archive: Path) -> None:
    """证明候选来自 clean main、同步的 origin/main 和该提交的确定性归档。"""
    if os.getenv("PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS") == "1":
        return

    def git(*arguments: str) -> str:
        return subprocess.run(
            ["git", "-C", str(REPOSITORY_ROOT), *arguments],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    if git("branch", "--show-current") != "main":
        raise ValueError("Production 候选必须从 main 创建")
    if git("status", "--porcelain"):
        raise ValueError("Production 候选要求 clean working tree")
    if git("rev-parse", "HEAD") != commit:
        raise ValueError("manifest commit 与当前 HEAD 不一致")
    if git("rev-parse", "origin/main") != commit:
        raise ValueError("Production 候选要求 HEAD == origin/main")

    descriptor, expected_name = tempfile.mkstemp(suffix=".tar.gz")
    os.close(descriptor)
    expected_archive = Path(expected_name)
    try:
        subprocess.run(
            [
                "git",
                "-C",
                str(REPOSITORY_ROOT),
                "archive",
                "--format=tar.gz",
                f"--output={expected_archive}",
                commit,
            ],
            check=True,
        )
        if sha256(source_archive) != sha256(expected_archive):
            raise ValueError("source archive 不是 manifest commit 的 git archive")
    finally:
        expected_archive.unlink(missing_ok=True)


def main() -> None:
    """校验输入并以排他创建方式写入稳定排序的 JSON 清单。"""
    args = parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{7,127}", args.release_id):
        raise ValueError("release ID 格式无效")
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        raise ValueError("commit 必须是 40 位小写十六进制 SHA")
    if not re.fullmatch(r"[0-9a-z_]+", args.schema_head):
        raise ValueError("schema head 格式无效")
    if not args.source_archive.is_file():
        raise FileNotFoundError(f"缺少源代码归档：{args.source_archive}")
    if args.output.exists():
        raise FileExistsError(f"发布清单已存在，拒绝覆盖：{args.output}")
    verify_release_source(args.commit, args.source_archive)

    tracked_files: dict[str, Path] = {}
    for tracked_file in args.tracked_file:
        if tracked_file.is_symlink() or not tracked_file.is_file():
            raise ValueError(f"缺少普通 tracked file：{tracked_file}")
        canonical = tracked_file.resolve(strict=True)
        try:
            relative = canonical.relative_to(REPOSITORY_ROOT).as_posix()
        except ValueError as error:
            raise ValueError(f"tracked file 不在仓库内：{tracked_file}") from error
        tracked_files[relative] = canonical
    if set(tracked_files) != REQUIRED_TRACKED_FILES:
        missing = sorted(REQUIRED_TRACKED_FILES - set(tracked_files))
        extra = sorted(set(tracked_files) - REQUIRED_TRACKED_FILES)
        raise ValueError(f"tracked file allowlist 不匹配：missing={missing}, extra={extra}")

    manifest = {
        "release_id": args.release_id,
        "commit": args.commit,
        "schema_head": args.schema_head,
        "source_archive": {
            "name": args.source_archive.name,
            "sha256": sha256(args.source_archive),
        },
        "images": {
            "backend": inspect_image(args.backend_image),
            "frontend": inspect_image(args.frontend_image),
            "rollback_frontend": inspect_image(args.rollback_frontend_image),
        },
        "tracked_files": {
            relative: sha256(path)
            for relative, path in sorted(tracked_files.items())
        },
    }
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(args.output, flags, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        json.dump(manifest, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")
        output.flush()
        os.fsync(output.fileno())
    directory_descriptor = os.open(args.output.parent, os.O_RDONLY)
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)
    print(f"Production 候选发布清单已生成：{args.output}")


if __name__ == "__main__":
    main()
