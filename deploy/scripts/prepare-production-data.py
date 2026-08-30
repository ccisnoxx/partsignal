#!/usr/bin/env python3
"""以可续跑状态机隔离、验证和恢复 Production 数据目录。"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

STANDARD_DATA_ROOT = Path("/root/partsignal-data")
STANDARD_QUARANTINE_ROOT = Path("/root/partsignal-data-quarantine")
STANDARD_LOCK_FILE = Path("/run/lock/partsignal-production-maintenance.lock")
STATE_FILE_NAME = ".partsignal-production-cutover.json"
LEAVES = ("postgres", "redis", "objects")
RUNTIME_LEAVES = ("postgres", "redis")
RUN_ID_PATTERN = re.compile(r"prr_[0-9]{8}_[0-9]{6}")
REPO_DIGEST_PATTERN = re.compile(r"[^@\s]+@sha256:[0-9a-f]{64}")
V1_REPOSITORY_PATTERN = re.compile(
    r"(?:^|/)[^/:@]*(?:backend|frontend)-v1(?=[:@]|$)"
)
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
REQUIRED_TRACKED_FILES = {
    "deploy/compose.prod.yaml",
    "deploy/nginx/partsignal-maintenance.conf.template",
    "deploy/nginx/partsignal-security-headers.conf",
    "deploy/nginx/partsignal.conf.template",
    "deploy/scripts/activate-production.sh",
    "deploy/scripts/deploy.sh",
    "deploy/scripts/prepare-production-data.py",
    "deploy/scripts/rollback-production-frontend.sh",
}
rename_count = 0


class DataStateError(RuntimeError):
    """表示数据目录状态不满足安全转换合同。"""


def fsync_directory(path: Path) -> None:
    """同步目录项，确保 rename 或 mkdir 先于状态推进持久化。"""
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_rename(source: Path, destination: Path) -> None:
    """执行精确 rename；测试边界可在成功后注入一次进程故障。"""
    global rename_count
    if destination.exists():
        raise DataStateError(f"rename 目标已存在：{destination}")
    os.rename(source, destination)
    fsync_directory(source.parent)
    if destination.parent != source.parent:
        fsync_directory(destination.parent)
    rename_count += 1
    if os.getenv("PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS") == "1":
        fail_after = os.getenv("PARTSIGNAL_TEST_FAIL_AFTER_RENAMES")
        if fail_after and rename_count == int(fail_after):
            raise DataStateError(f"测试注入：第 {rename_count} 次 rename 后中断")


def configured_path(name: str, default: Path) -> Path:
    """读取绝对路径，并拒绝任一祖先符号链接或路径别名。"""
    raw = Path(os.getenv(name, str(default)))
    if not raw.is_absolute():
        raise DataStateError(f"{name} 必须是绝对路径：{raw}")
    absolute = Path(os.path.abspath(raw))
    existing = absolute
    missing_parts: list[str] = []
    while not existing.exists():
        missing_parts.append(existing.name)
        existing = existing.parent
    resolved_existing = existing.resolve(strict=True)
    if resolved_existing != existing:
        raise DataStateError(f"{name} 的现有路径包含符号链接或别名：{raw}")
    canonical = resolved_existing.joinpath(*reversed(missing_parts))
    if canonical == Path("/"):
        raise DataStateError(f"{name} 不能是根目录")
    return canonical


def configured_roots() -> tuple[Path, Path]:
    """返回经过 Production 固定路径或显式测试边界校验的两个根目录。"""
    data_root = configured_path("PARTSIGNAL_DATA_ROOT", STANDARD_DATA_ROOT)
    quarantine_root = configured_path(
        "PARTSIGNAL_QUARANTINE_ROOT", STANDARD_QUARANTINE_ROOT
    )
    allow_test_roots = os.getenv("PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS") == "1"
    if not allow_test_roots and (
        data_root != STANDARD_DATA_ROOT or quarantine_root != STANDARD_QUARANTINE_ROOT
    ):
        raise DataStateError("Production 数据脚本只允许固定的活动目录和隔离目录")
    if data_root == quarantine_root:
        raise DataStateError("活动数据目录与隔离目录不能相同")
    if data_root in quarantine_root.parents or quarantine_root in data_root.parents:
        raise DataStateError("活动数据目录与隔离目录不能相互嵌套")
    return data_root, quarantine_root


def ensure_plain_directory(path: Path, *, label: str) -> None:
    """拒绝缺失目录、符号链接和独立 mountpoint。"""
    if path.is_symlink() or not path.is_dir():
        raise DataStateError(f"{label} 缺少普通目录：{path}")
    if path.resolve(strict=True) != path:
        raise DataStateError(f"{label} 包含符号链接或路径别名：{path}")
    if path.is_mount():
        raise DataStateError(f"{label} 不能是独立挂载点：{path}")


def atomic_write_state(data_root: Path, state: dict[str, Any]) -> None:
    """同目录排他替换状态文件，并把文件与目录同步到磁盘。"""
    descriptor, temporary_name = tempfile.mkstemp(prefix=".cutover-state.", dir=data_root)
    temporary_path = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(state, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary_path, data_root / STATE_FILE_NAME)
        fsync_directory(data_root)
    finally:
        temporary_path.unlink(missing_ok=True)


def read_state(data_root: Path) -> dict[str, Any]:
    """读取并校验状态文件的基础结构与活动根身份。"""
    state_path = data_root / STATE_FILE_NAME
    if state_path.is_symlink() or not state_path.is_file():
        raise DataStateError(f"缺少 Production 数据状态文件：{state_path}")
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if state.get("schema_version") != 1:
        raise DataStateError("Production 数据状态文件版本不受支持")
    if state.get("data_root") != str(data_root):
        raise DataStateError("状态文件记录的活动数据根与当前路径不一致")
    return state


def file_sha256(path: Path) -> str:
    """流式计算候选清单摘要。"""
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def candidate_from_manifest(value: str) -> dict[str, Any]:
    """读取不可变候选身份，并绑定当前部署使用的镜像引用。"""
    manifest_path = Path(value)
    if not manifest_path.is_absolute() or manifest_path.is_symlink():
        raise DataStateError("Production 候选清单必须是绝对普通文件")
    try:
        canonical = manifest_path.resolve(strict=True)
    except OSError as error:
        raise DataStateError(f"无法解析 Production 候选清单：{manifest_path}") from error
    if canonical != manifest_path or not manifest_path.is_file():
        raise DataStateError("Production 候选清单包含路径别名或不是普通文件")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    try:
        candidate = {
            "manifest_sha256": file_sha256(manifest_path),
            "release_id": payload["release_id"],
            "commit": payload["commit"],
            "schema_head": payload["schema_head"],
            "backend_reference": payload["images"]["backend"]["reference"],
            "backend_image_id": payload["images"]["backend"]["image_id"],
            "backend_repo_digests": sorted(
                payload["images"]["backend"]["repo_digests"]
            ),
            "frontend_reference": payload["images"]["frontend"]["reference"],
            "frontend_image_id": payload["images"]["frontend"]["image_id"],
            "frontend_repo_digests": sorted(
                payload["images"]["frontend"]["repo_digests"]
            ),
            "rollback_frontend_reference": payload["images"]["rollback_frontend"][
                "reference"
            ],
            "rollback_frontend_image_id": payload["images"]["rollback_frontend"][
                "image_id"
            ],
            "rollback_frontend_repo_digests": sorted(
                payload["images"]["rollback_frontend"]["repo_digests"]
            ),
        }
    except (KeyError, TypeError) as error:
        raise DataStateError("Production 候选清单缺少必要身份字段") from error
    scalar_fields = (
        "manifest_sha256",
        "release_id",
        "commit",
        "schema_head",
        "backend_reference",
        "backend_image_id",
        "frontend_reference",
        "frontend_image_id",
        "rollback_frontend_reference",
        "rollback_frontend_image_id",
    )
    if not all(isinstance(candidate[name], str) and candidate[name] for name in scalar_fields):
        raise DataStateError("Production 候选清单身份字段格式无效")
    for role in ("backend", "frontend", "rollback_frontend"):
        reference = candidate[f"{role}_reference"]
        if V1_REPOSITORY_PATTERN.search(reference):
            raise DataStateError(
                f"Production 候选清单不允许使用 V1 {role} 镜像仓库：{reference}"
            )
    for role in ("backend", "frontend", "rollback_frontend"):
        digests = candidate[f"{role}_repo_digests"]
        if not isinstance(digests, list) or not digests or not all(
            isinstance(digest, str) and REPO_DIGEST_PATTERN.fullmatch(digest)
            for digest in digests
        ):
            raise DataStateError(f"Production 候选清单缺少合法 {role} RepoDigest")
    tracked_files = payload.get("tracked_files")
    if not isinstance(tracked_files, dict) or set(tracked_files) != REQUIRED_TRACKED_FILES:
        raise DataStateError("Production 候选清单 tracked file allowlist 不匹配")
    for relative_path, expected_digest in tracked_files.items():
        tracked_path = REPOSITORY_ROOT / relative_path
        if (
            tracked_path.is_symlink()
            or not tracked_path.is_file()
            or tracked_path.resolve(strict=True) != tracked_path
            or not isinstance(expected_digest, str)
            or not re.fullmatch(r"[0-9a-f]{64}", expected_digest)
            or file_sha256(tracked_path) != expected_digest
        ):
            raise DataStateError(f"Production 候选 tracked file 校验失败：{relative_path}")
    version = os.getenv("PARTSIGNAL_VERSION", "")
    if candidate["release_id"] != version:
        raise DataStateError("PARTSIGNAL_VERSION 必须与 manifest release ID 完全一致")
    expected_backend = (
        f"{os.getenv('PARTSIGNAL_BACKEND_IMAGE', '')}:"
        f"{version}"
    )
    expected_frontend = (
        f"{os.getenv('PARTSIGNAL_FRONTEND_IMAGE', '')}:"
        f"{version}"
    )
    if candidate["backend_reference"] != expected_backend:
        raise DataStateError("候选清单 backend 镜像与当前部署变量不一致")
    if candidate["frontend_reference"] != expected_frontend:
        raise DataStateError("候选清单 frontend 镜像与当前部署变量不一致")
    return candidate


def require_candidate(state: dict[str, Any], candidate: dict[str, Any]) -> None:
    """拒绝用另一候选继续已开始的部署或激活。"""
    if state.get("candidate") != candidate:
        raise DataStateError("当前候选与 Production 数据状态绑定的候选不一致")


def verify_candidate_images(candidate: dict[str, Any]) -> None:
    """确认本地镜像 ID 与候选清单一致。"""
    for role in ("backend", "frontend"):
        verify_image(candidate, role)
    print("Production 候选镜像身份校验通过。")


def verify_image(candidate: dict[str, Any], role: str) -> None:
    """核对一个本地镜像的 ID 与全部已冻结 RepoDigest。"""
    reference = candidate[f"{role}_reference"]
    payload = json.loads(
        subprocess.run(
            ["docker", "image", "inspect", reference],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    if not isinstance(payload, list) or len(payload) != 1:
        raise DataStateError(f"{role} 镜像检查结果数量异常")
    if payload[0].get("Id") != candidate[f"{role}_image_id"]:
        raise DataStateError(f"{role} 镜像 ID 与候选清单不一致")
    actual_digests = set(payload[0].get("RepoDigests") or [])
    if not set(candidate[f"{role}_repo_digests"]).issubset(actual_digests):
        raise DataStateError(f"{role} 镜像 RepoDigest 与候选清单不一致")


def verify_rollback_frontend(candidate: dict[str, Any]) -> None:
    """只允许使用当前候选冻结的上一份 V2 frontend。"""
    data_root, _ = configured_roots()
    state = read_state(data_root)
    if state.get("phase") != "PRODUCTION_INITIALIZED":
        raise DataStateError("frontend rollback 要求 PRODUCTION_INITIALIZED")
    require_candidate(state, candidate)
    expected_reference = (
        f"{os.getenv('PARTSIGNAL_ROLLBACK_FRONTEND_IMAGE', '')}:"
        f"{os.getenv('PARTSIGNAL_ROLLBACK_FRONTEND_VERSION', '')}"
    )
    if candidate["rollback_frontend_reference"] != expected_reference:
        raise DataStateError("frontend rollback 镜像不是 manifest 冻结的上一份 V2")
    verify_image(candidate, "rollback_frontend")
    print("Production frontend rollback 候选校验通过。")


def mark_frontend_rollback(candidate: dict[str, Any]) -> None:
    """记录当前 frontend 已切到 manifest 冻结的回滚镜像。"""
    data_root, _ = configured_roots()
    state = read_state(data_root)
    if state.get("phase") != "PRODUCTION_INITIALIZED":
        raise DataStateError("frontend rollback 记录要求 PRODUCTION_INITIALIZED")
    require_candidate(state, candidate)
    state["active_frontend"] = {
        "reference": candidate["rollback_frontend_reference"],
        "image_id": candidate["rollback_frontend_image_id"],
        "repo_digests": candidate["rollback_frontend_repo_digests"],
    }
    atomic_write_state(data_root, state)
    print("Production frontend rollback 状态已记录。")


def configured_lock_file() -> Path:
    """返回固定维护锁路径，测试只能通过显式边界改写。"""
    allow_test_roots = os.getenv("PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS") == "1"
    lock_file = configured_path(
        "PARTSIGNAL_MAINTENANCE_LOCK_FILE", STANDARD_LOCK_FILE
    )
    if not allow_test_roots and lock_file != STANDARD_LOCK_FILE:
        raise DataStateError("Production 维护锁只允许固定路径")
    return lock_file


@contextmanager
def maintenance_lock() -> Iterator[int]:
    """阻止 quarantine、deploy、activate 与 restore 脚本并发运行。"""
    lock_file = configured_lock_file()
    lock_file.parent.mkdir(parents=True, exist_ok=True)
    inherited_fd_text = os.getenv("PARTSIGNAL_MAINTENANCE_LOCK_FD")
    if inherited_fd_text:
        try:
            inherited_fd = int(inherited_fd_text)
            inherited_stat = os.fstat(inherited_fd)
            lock_stat = lock_file.stat()
        except (ValueError, OSError) as error:
            raise DataStateError("继承的 Production 维护锁文件描述符无效") from error
        if not stat.S_ISREG(inherited_stat.st_mode) or (
            inherited_stat.st_dev,
            inherited_stat.st_ino,
        ) != (lock_stat.st_dev, lock_stat.st_ino):
            raise DataStateError("继承的文件描述符不是已批准的 Production 维护锁")
        try:
            fcntl.flock(inherited_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise DataStateError("继承的 Production 维护锁未被当前操作持有") from error
        yield inherited_fd
        return

    descriptor = os.open(lock_file, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        os.fchmod(descriptor, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise DataStateError("已有 PartSignal Production 维护操作持有排他锁") from error
        yield descriptor
    finally:
        os.close(descriptor)


def run_locked(child_command: list[str]) -> int:
    """持有同一锁执行完整部署或激活脚本，并把锁身份安全传给子进程。"""
    if not child_command:
        raise DataStateError("run-locked 必须指定子命令")
    with maintenance_lock() as descriptor:
        os.set_inheritable(descriptor, True)
        environment = os.environ.copy()
        environment["PARTSIGNAL_MAINTENANCE_LOCK_FD"] = str(descriptor)
        try:
            result = subprocess.run(
                child_command,
                env=environment,
                pass_fds=(descriptor,),
                check=False,
            )
        finally:
            os.set_inheritable(descriptor, False)
    return result.returncode


def ensure_services_stopped(data_root: Path) -> None:
    """确认历史 Compose project 与所有活动数据挂载均没有运行容器。"""
    project = os.getenv("PARTSIGNAL_COMPOSE_PROJECT", "partsignal-staging")
    allow_test_roots = os.getenv("PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS") == "1"
    if not allow_test_roots and project != "partsignal-staging":
        raise DataStateError("Production Compose project 必须是固定的 partsignal-staging")
    project_ids = subprocess.run(
        [
            "docker",
            "ps",
            "-q",
            "--filter",
            f"label=com.docker.compose.project={project}",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()
    if project_ids:
        raise DataStateError(f"Compose project {project} 仍有运行容器，拒绝移动数据")

    running_ids = subprocess.run(
        ["docker", "ps", "-q"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()
    if not running_ids:
        return
    payload = json.loads(
        subprocess.run(
            ["docker", "inspect", *running_ids],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    protected_root = data_root.resolve(strict=True)
    mounted = sorted(
        {
            mount.get("Source")
            for container in payload
            for mount in container.get("Mounts", [])
            if isinstance(mount.get("Source"), str)
            and Path(mount["Source"]).is_absolute()
            and (
                (source := Path(os.path.realpath(mount["Source"]))) == protected_root
                or protected_root in source.parents
                or source in protected_root.parents
            )
        }
    )
    if mounted:
        raise DataStateError(f"仍有运行容器挂载活动数据目录：{', '.join(mounted)}")


def ensure_same_device(paths: list[Path]) -> int:
    """验证所有目录位于同一 rename 边界。"""
    devices = {path.stat().st_dev for path in paths}
    if len(devices) != 1:
        raise DataStateError("活动目录、叶目录与隔离目录不在同一文件系统")
    return devices.pop()


def require_run_id(value: str) -> str:
    """限制 run ID，避免把用户输入解释为路径。"""
    if not RUN_ID_PATTERN.fullmatch(value):
        raise DataStateError("run ID 必须符合 prr_YYYYMMDD_HHMMSS")
    return value


def target_for(state: dict[str, Any], quarantine_root: Path, run_id: str) -> Path:
    """校验状态中的隔离目标与当前固定根、run ID 一致。"""
    expected = quarantine_root / run_id
    if state.get("run_id") != run_id or state.get("quarantine_target") != str(expected):
        raise DataStateError("run ID 或隔离目标与状态文件不一致")
    return expected


def quarantine(run_id: str) -> None:
    """逐叶原子移动旧数据，并以持久阶段支持失败后原命令续跑。"""
    data_root, quarantine_root = configured_roots()
    ensure_plain_directory(data_root, label="活动数据根")
    ensure_services_stopped(data_root)
    quarantine_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    ensure_plain_directory(quarantine_root, label="隔离根")
    target = quarantine_root / run_id
    state_path = data_root / STATE_FILE_NAME

    if state_path.exists():
        state = read_state(data_root)
        if state.get("phase") not in {"QUARANTINING", "QUARANTINED"}:
            raise DataStateError(f"当前数据阶段不允许 quarantine：{state.get('phase')}")
        target_for(state, quarantine_root, run_id)
    else:
        if target.exists():
            raise DataStateError(f"隔离目标已存在且没有活动状态文件：{target}")
        metadata: dict[str, dict[str, int | str]] = {}
        leaves = []
        for leaf in LEAVES:
            source = data_root / leaf
            ensure_plain_directory(source, label=f"活动 {leaf}")
            leaves.append(source)
            stat = source.stat()
            metadata[leaf] = {
                "owner": stat.st_uid,
                "group": stat.st_gid,
                "mode": stat.st_mode & 0o7777,
                "position": "ACTIVE",
            }
        target.mkdir(mode=0o700)
        fsync_directory(quarantine_root)
        device = ensure_same_device([data_root, quarantine_root, target, *leaves])
        state = {
            "schema_version": 1,
            "phase": "QUARANTINING",
            "run_id": run_id,
            "data_root": str(data_root),
            "quarantine_target": str(target),
            "device": device,
            "leaves": metadata,
        }
        atomic_write_state(data_root, state)

    ensure_plain_directory(target, label="隔离目标")
    if state.get("device") != ensure_same_device([data_root, quarantine_root, target]):
        raise DataStateError("文件系统 device 与状态文件不一致")

    all_old_quarantined = all(
        state["leaves"][leaf]["position"] == "QUARANTINE" for leaf in LEAVES
    )
    for leaf in LEAVES:
        source = data_root / leaf
        destination = target / leaf
        position = state["leaves"][leaf]["position"]
        source_exists = source.exists()
        destination_exists = destination.exists()
        if position == "ACTIVE" and source_exists and not destination_exists:
            ensure_plain_directory(source, label=f"活动 {leaf}")
            if source.stat().st_dev != state["device"]:
                raise DataStateError(f"{leaf} 不在已批准的 rename device")
            atomic_rename(source, destination)
            state["leaves"][leaf]["position"] = "QUARANTINE"
            atomic_write_state(data_root, state)
        elif position == "ACTIVE" and not source_exists and destination_exists:
            state["leaves"][leaf]["position"] = "QUARANTINE"
            atomic_write_state(data_root, state)
        elif position == "QUARANTINE" and destination_exists:
            if source_exists:
                if not all_old_quarantined or leaf not in RUNTIME_LEAVES:
                    raise DataStateError(f"{leaf} 的活动/隔离位置不唯一，拒绝继续")
                ensure_plain_directory(source, label=f"新活动 {leaf}")
                if any(source.iterdir()):
                    raise DataStateError(f"新活动 {leaf} 目录不是空目录")
            continue
        else:
            raise DataStateError(f"{leaf} 的活动/隔离位置不唯一，拒绝继续")

    for leaf in RUNTIME_LEAVES:
        active = data_root / leaf
        metadata = state["leaves"][leaf]
        if active.exists():
            ensure_plain_directory(active, label=f"新活动 {leaf}")
            if any(active.iterdir()):
                raise DataStateError(f"新活动 {leaf} 目录不是空目录")
        else:
            active.mkdir()
            fsync_directory(data_root)
        os.chown(active, metadata["owner"], metadata["group"])
        os.chmod(active, metadata["mode"])

    state["phase"] = "QUARANTINED"
    atomic_write_state(data_root, state)
    print(f"旧数据已隔离到 {target}；状态为 QUARANTINED，未执行物理删除。")


def verify_phase(run_id: str, allowed: set[str]) -> dict[str, Any]:
    """校验固定根、run ID、隔离目标和当前阶段。"""
    data_root, quarantine_root = configured_roots()
    ensure_plain_directory(data_root, label="活动数据根")
    state = read_state(data_root)
    target = target_for(state, quarantine_root, run_id)
    ensure_plain_directory(target, label="隔离目标")
    if state.get("phase") not in allowed:
        raise DataStateError(f"当前数据阶段不允许该操作：{state.get('phase')}")
    if state.get("device") != ensure_same_device([data_root, quarantine_root, target]):
        raise DataStateError("文件系统 device 与状态文件不一致")
    return state


def begin_clean_init(run_id: str, candidate: dict[str, str]) -> None:
    """首次证明空目录并把整个 clean-init 部署绑定到唯一候选。"""
    data_root, _ = configured_roots()
    state = verify_phase(
        run_id, {"QUARANTINED", "CLEAN_INIT_DEPLOYING", "PRODUCTION_PREPARED"}
    )
    if state["phase"] == "PRODUCTION_PREPARED":
        require_candidate(state, candidate)
        state["phase"] = "CLEAN_INIT_DEPLOYING"
        atomic_write_state(data_root, state)
    if state["phase"] == "CLEAN_INIT_DEPLOYING":
        require_candidate(state, candidate)
        for leaf in RUNTIME_LEAVES:
            ensure_plain_directory(data_root / leaf, label=f"Production {leaf}")
        print("clean-init 候选与进行中的部署状态一致。")
        return
    for leaf in RUNTIME_LEAVES:
        active = data_root / leaf
        ensure_plain_directory(active, label=f"新活动 {leaf}")
        if any(active.iterdir()):
            raise DataStateError(f"clean-init 要求空目录：{active}")
    if (data_root / "objects").exists():
        raise DataStateError("clean-init 的活动数据根不能包含 objects")
    state["candidate"] = candidate
    state["phase"] = "CLEAN_INIT_DEPLOYING"
    atomic_write_state(data_root, state)
    print("clean-init 数据所有权与候选绑定校验通过。")


def transition_candidate(
    run_id: str, source: str, destination: str, candidate: dict[str, str]
) -> None:
    """在候选身份匹配后推进单向 Production 数据阶段。"""
    data_root, _ = configured_roots()
    state = verify_phase(run_id, {source})
    require_candidate(state, candidate)
    state["phase"] = destination
    atomic_write_state(data_root, state)
    print(f"Production 数据阶段已更新为 {destination}。")


def begin_upgrade(candidate: dict[str, str]) -> None:
    """从已初始化版本开始或续跑同一候选的 Production upgrade。"""
    data_root, _ = configured_roots()
    state = read_state(data_root)
    phase = state.get("phase")
    if phase == "PRODUCTION_INITIALIZED":
        if state.get("candidate") == candidate:
            raise DataStateError("当前候选已经初始化，拒绝重复创建 upgrade")
        state["previous_candidate"] = state.get("candidate")
        state["candidate"] = candidate
        state["phase"] = "UPGRADE_DEPLOYING"
        atomic_write_state(data_root, state)
    elif phase in {"UPGRADE_DEPLOYING", "UPGRADE_PREPARED"}:
        require_candidate(state, candidate)
        if phase == "UPGRADE_PREPARED":
            state["phase"] = "UPGRADE_DEPLOYING"
            atomic_write_state(data_root, state)
    else:
        raise DataStateError(f"当前数据阶段不允许 Production upgrade：{phase}")
    for leaf in RUNTIME_LEAVES:
        ensure_plain_directory(data_root / leaf, label=f"Production {leaf}")
    print("Production upgrade 数据所有权与候选绑定校验通过。")


def transition_upgrade(
    source: str, destination: str, candidate: dict[str, str]
) -> None:
    """推进与候选绑定的 upgrade 准备或激活阶段。"""
    data_root, _ = configured_roots()
    state = read_state(data_root)
    if state.get("phase") != source:
        raise DataStateError(f"当前数据阶段不允许该 upgrade 操作：{state.get('phase')}")
    require_candidate(state, candidate)
    state["phase"] = destination
    atomic_write_state(data_root, state)
    print(f"Production 数据阶段已更新为 {destination}。")


def verify_upgrade_prepared(candidate: dict[str, str]) -> None:
    """只允许激活本次已准备完成的 upgrade 候选。"""
    data_root, _ = configured_roots()
    state = read_state(data_root)
    if state.get("phase") != "UPGRADE_PREPARED":
        raise DataStateError("Production upgrade 尚未准备完成")
    require_candidate(state, candidate)
    print("Production upgrade 候选准备阶段校验通过。")


def restore(run_id: str) -> None:
    """以可续跑的逐叶状态机保留失败数据并恢复旧 Staging 目录。"""
    data_root, quarantine_root = configured_roots()
    ensure_plain_directory(data_root, label="活动数据根")
    ensure_services_stopped(data_root)
    state = verify_phase(
        run_id,
        {
            "QUARANTINED",
            "CLEAN_INIT_DEPLOYING",
            "PRODUCTION_PREPARED",
            "PRODUCTION_INITIALIZED",
            "UPGRADE_DEPLOYING",
            "UPGRADE_PREPARED",
            "RESTORING",
        },
    )
    target = target_for(state, quarantine_root, run_id)
    failed_target = target / "failed-production"

    if state["phase"] != "RESTORING":
        if failed_target.exists():
            raise DataStateError("失败 Production 目录已存在，但状态不是 RESTORING")
        for leaf in LEAVES:
            old = target / leaf
            ensure_plain_directory(old, label=f"隔离旧 {leaf}")
            active = data_root / leaf
            if active.exists():
                ensure_plain_directory(active, label=f"当前活动 {leaf}")
        failed_target.mkdir(mode=0o700)
        fsync_directory(target)
        state["phase"] = "RESTORING"
        state["restore_new"] = {
            leaf: "ACTIVE" if (data_root / leaf).exists() else "ABSENT" for leaf in LEAVES
        }
        state["restore_old"] = {leaf: "QUARANTINE" for leaf in LEAVES}
        atomic_write_state(data_root, state)
    else:
        ensure_plain_directory(failed_target, label="失败 Production 保留目录")

    for leaf in LEAVES:
        new_position = state["restore_new"][leaf]
        old_position = state["restore_old"][leaf]
        active = data_root / leaf
        failed = failed_target / leaf
        old = target / leaf
        for path, label in (
            (active, f"恢复活动 {leaf}"),
            (failed, f"失败 Production {leaf}"),
            (old, f"隔离旧 {leaf}"),
        ):
            if path.exists() or path.is_symlink():
                ensure_plain_directory(path, label=label)
                if path.stat().st_dev != state["device"]:
                    raise DataStateError(f"{label} 不在已批准的 rename device")
        if new_position == "ACTIVE" and old_position != "QUARANTINE":
            raise DataStateError(f"新旧 {leaf} 的恢复阶段组合无效")
        if new_position == "ACTIVE" and active.exists() and not failed.exists():
            atomic_rename(active, failed)
            state["restore_new"][leaf] = "FAILED_QUARANTINE"
            atomic_write_state(data_root, state)
            new_position = "FAILED_QUARANTINE"
        elif new_position == "ACTIVE" and not active.exists() and failed.exists():
            state["restore_new"][leaf] = "FAILED_QUARANTINE"
            atomic_write_state(data_root, state)
            new_position = "FAILED_QUARANTINE"
        elif new_position in {"ABSENT", "FAILED_QUARANTINE"}:
            expected_failed = new_position == "FAILED_QUARANTINE"
            active_may_be_restored_old = old_position == "ACTIVE" or (
                old_position == "QUARANTINE" and not old.exists() and active.exists()
            )
            if failed.exists() != expected_failed or (
                active.exists() and not active_may_be_restored_old
            ):
                raise DataStateError(f"新 {leaf} 的恢复位置不唯一，拒绝继续")
        else:
            raise DataStateError(f"新 {leaf} 的恢复阶段无效：{new_position}")

        old_position = state["restore_old"][leaf]
        if old_position == "QUARANTINE" and old.exists() and not active.exists():
            atomic_rename(old, active)
            state["restore_old"][leaf] = "ACTIVE"
            atomic_write_state(data_root, state)
        elif old_position == "QUARANTINE" and not old.exists() and active.exists():
            state["restore_old"][leaf] = "ACTIVE"
            atomic_write_state(data_root, state)
        elif old_position == "ACTIVE" and not old.exists() and active.exists():
            continue
        else:
            raise DataStateError(f"旧 {leaf} 的恢复位置不唯一，拒绝继续")

    state["phase"] = "RESTORED"
    for leaf in LEAVES:
        ensure_plain_directory(data_root / leaf, label=f"已恢复活动 {leaf}")
        if (data_root / leaf).stat().st_dev != state["device"]:
            raise DataStateError(f"已恢复活动 {leaf} 不在已批准的 rename device")
    atomic_write_state(data_root, state)
    print(f"旧数据已恢复；失败 Production 数据保留在 {failed_target}。")


def parse_args() -> argparse.Namespace:
    """解析唯一维护命令与必要 run ID。"""
    parser = argparse.ArgumentParser(description="管理 PartSignal Production 数据转换状态")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("quarantine", "restore"):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("run_id")
    for command in (
        "begin-clean-init",
        "mark-prepared",
        "verify-prepared",
        "mark-initialized",
    ):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("run_id")
        command_parser.add_argument("manifest")
    for command in (
        "begin-upgrade",
        "verify-candidate-images",
        "mark-upgrade-prepared",
        "verify-upgrade-prepared",
        "mark-upgrade-initialized",
        "verify-rollback-frontend",
        "mark-frontend-rollback",
    ):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("manifest")
    locked_parser = subparsers.add_parser("run-locked")
    locked_parser.add_argument("child_command", nargs=argparse.REMAINDER)
    return parser.parse_args()


def main() -> None:
    """在固定排他锁内执行或验证一个数据阶段。"""
    args = parse_args()
    try:
        if args.command == "run-locked":
            raise SystemExit(run_locked(args.child_command))
        with maintenance_lock():
            if args.command == "quarantine":
                quarantine(require_run_id(args.run_id))
            elif args.command == "begin-clean-init":
                begin_clean_init(
                    require_run_id(args.run_id), candidate_from_manifest(args.manifest)
                )
            elif args.command == "mark-prepared":
                transition_candidate(
                    require_run_id(args.run_id),
                    "CLEAN_INIT_DEPLOYING",
                    "PRODUCTION_PREPARED",
                    candidate_from_manifest(args.manifest),
                )
            elif args.command == "verify-prepared":
                state = verify_phase(
                    require_run_id(args.run_id), {"PRODUCTION_PREPARED"}
                )
                require_candidate(state, candidate_from_manifest(args.manifest))
                print("Production clean-init 准备阶段校验通过。")
            elif args.command == "mark-initialized":
                transition_candidate(
                    require_run_id(args.run_id),
                    "PRODUCTION_PREPARED",
                    "PRODUCTION_INITIALIZED",
                    candidate_from_manifest(args.manifest),
                )
            elif args.command == "begin-upgrade":
                begin_upgrade(candidate_from_manifest(args.manifest))
            elif args.command == "verify-candidate-images":
                verify_candidate_images(candidate_from_manifest(args.manifest))
            elif args.command == "mark-upgrade-prepared":
                transition_upgrade(
                    "UPGRADE_DEPLOYING",
                    "UPGRADE_PREPARED",
                    candidate_from_manifest(args.manifest),
                )
            elif args.command == "verify-upgrade-prepared":
                verify_upgrade_prepared(candidate_from_manifest(args.manifest))
            elif args.command == "mark-upgrade-initialized":
                transition_upgrade(
                    "UPGRADE_PREPARED",
                    "PRODUCTION_INITIALIZED",
                    candidate_from_manifest(args.manifest),
                )
            elif args.command == "verify-rollback-frontend":
                verify_rollback_frontend(candidate_from_manifest(args.manifest))
            elif args.command == "mark-frontend-rollback":
                mark_frontend_rollback(candidate_from_manifest(args.manifest))
            elif args.command == "restore":
                restore(require_run_id(args.run_id))
    except (
        DataStateError,
        json.JSONDecodeError,
        OSError,
        subprocess.SubprocessError,
        ValueError,
    ) as error:
        print(f"Production 数据状态操作失败：{error}", file=sys.stderr)
        raise SystemExit(2) from error


if __name__ == "__main__":
    main()
