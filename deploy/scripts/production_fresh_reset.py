"""显式丢弃旧数据；固定目录身份与可续跑删除生命周期的唯一所有者。"""

from __future__ import annotations

import os
import re
import stat
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any


def identity(value: os.stat_result) -> dict[str, int]:
    """目录自身不删除，device/inode 因而能跨中断识别被替换的目录。"""
    return {"device": value.st_dev, "inode": value.st_ino}


def mount_points() -> set[Path]:
    """Linux mountinfo 包含同 device 的 bind mount，不能只依赖 is_mount。"""
    if not sys.platform.startswith("linux"):
        return set()
    result = set()
    for line in Path("/proc/self/mountinfo").read_text().splitlines():
        fields = line.split()
        if len(fields) < 7 or "-" not in fields:
            raise ValueError("无法证明清空目录的 mount 边界")
        name = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), fields[4])
        result.add(Path(name))
    return result


def require_fresh_candidate(owner: Any, candidate: dict[str, Any]) -> None:
    if candidate.get("recovery_strategy") != "fresh-rebuild":
        raise owner.DataStateError(
            "fresh-init/reset-data 要求 fresh-rebuild 候选恢复策略"
        )


def data_root(owner: Any) -> Path:
    """破坏性入口始终固定 Production root，不接受测试环境开关扩大范围。"""
    root = owner.configured_path("PARTSIGNAL_DATA_ROOT", owner.STANDARD_DATA_ROOT)
    if (
        root != owner.STANDARD_DATA_ROOT
        or Path(os.getenv("PARTSIGNAL_DATA_ROOT", str(root))) != root
    ):
        raise owner.DataStateError("reset-data 只允许固定的 Production 活动数据根")
    owner.ensure_plain_directory(root, label="清空活动数据根")
    if (
        os.getenv("PARTSIGNAL_COMPOSE_PROJECT", owner.PRODUCTION_COMPOSE_PROJECT)
        != owner.PRODUCTION_COMPOSE_PROJECT
        or os.getenv("COMPOSE_PROJECT_NAME", owner.PRODUCTION_COMPOSE_PROJECT)
        != owner.PRODUCTION_COMPOSE_PROJECT
    ):
        raise owner.DataStateError(
            "Production Compose project 必须是固定的 partsignal-staging"
        )
    return root


def directory_fd(owner: Any, path: Path) -> int:
    owner.ensure_plain_directory(path, label="清空目标")
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        if identity(os.fstat(descriptor)) != identity(path.stat()):
            raise owner.DataStateError("清空目录在打开期间发生替换")
    except BaseException:
        os.close(descriptor)
        raise
    return descriptor


def check_tree(
    owner: Any, descriptor: int, path: Path, device: int, mounts: set[Path]
) -> None:
    """删除前遍历真实目录，拒绝嵌套 mount；符号链接只作为目录项删除。"""
    if path in mounts or path.is_mount() or os.fstat(descriptor).st_dev != device:
        raise owner.DataStateError(f"清空目标包含独立挂载点：{path}")
    for name in os.listdir(descriptor):
        value = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        child_path = path / name
        if child_path in mounts or value.st_dev != device:
            raise owner.DataStateError(f"清空目标包含独立挂载点：{child_path}")
        if stat.S_ISDIR(value.st_mode):
            child = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor
            )
            try:
                if identity(os.fstat(child)) != identity(value):
                    raise owner.DataStateError("清空子目录在检查期间发生替换")
                check_tree(owner, child, child_path, device, mounts)
            finally:
                os.close(child)


def verify_directories(owner: Any, root: Path, state: dict[str, Any]) -> None:
    """RESET_READY 之后同样保持 root/三叶目录归属；不推断已被替换的目录。"""
    owner.ensure_plain_directory(root, label="清空活动数据根")
    # 同 device bind mount 可保留 inode 并绕过 is_mount，续跑和 fresh-init 都须重查。
    if root in mount_points():
        raise owner.DataStateError(f"清空活动数据根不能是独立挂载点：{root}")
    reset = state.get("fresh_reset")
    if not isinstance(reset, dict) or reset.get("root") != identity(root.stat()):
        raise owner.DataStateError("清空活动数据根身份与状态不一致")
    leaves = reset.get("leaves")
    if not isinstance(leaves, dict) or set(leaves) != set(owner.LEAVES):
        raise owner.DataStateError("清空叶目录状态不完整")
    for leaf in owner.LEAVES:
        path = root / leaf
        owner.ensure_plain_directory(path, label=f"清空 {leaf}")
        metadata = leaves[leaf]
        if (
            not isinstance(metadata, dict)
            or metadata.get("identity") != identity(path.stat())
            or path.stat().st_dev != reset["root"]["device"]
        ):
            raise owner.DataStateError(f"清空 {leaf} 目录身份与状态不一致")
        if metadata.get("status") not in {"PENDING", "EMPTY"}:
            raise owner.DataStateError("清空叶目录阶段无效")


def clear_directory(
    owner: Any, descriptor: int, path: Path, device: int, checkpoint: Callable[[], None]
) -> None:
    """相对于已打开目录删除；不跟随 symlink，不删除 canonical 叶目录自身。"""
    for name in os.listdir(descriptor):
        checkpoint()
        value = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        if value.st_dev != device or path / name in mount_points():
            raise owner.DataStateError("清空目录的 mount 边界在执行期间变化")
        if stat.S_ISDIR(value.st_mode):
            child = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor
            )
            try:
                if (
                    identity(os.fstat(child)) != identity(value)
                    or (path / name).is_mount()
                ):
                    raise owner.DataStateError("清空子目录身份或 mount 边界发生变化")
                clear_directory(owner, child, path / name, device, checkpoint)
                if identity(
                    os.stat(name, dir_fd=descriptor, follow_symlinks=False)
                ) != identity(value):
                    raise owner.DataStateError("清空子目录在删除期间发生替换")
                os.rmdir(name, dir_fd=descriptor)
            finally:
                os.close(child)
        else:
            os.unlink(name, dir_fd=descriptor)
        os.fsync(descriptor)
        checkpoint()


def reset_data(
    owner: Any,
    run_id: str,
    candidate: dict[str, Any],
    *,
    discard_data: bool,
    checkpoint: Callable[[], None],
) -> None:
    """同一维护锁与 supervisor 下清空；失败只保留 RESETTING，不补造完成事实。"""
    if not discard_data:
        raise owner.DataStateError("reset-data 必须显式指定 --discard-existing-data")
    require_fresh_candidate(owner, candidate)
    root = data_root(owner)
    owner.ensure_services_stopped(root)
    owner.verify_candidate_images(candidate)
    descriptors: dict[str, int] = {}
    root_fd = directory_fd(owner, root)
    try:
        for leaf in owner.LEAVES:
            descriptors[leaf] = directory_fd(owner, root / leaf)
        state_path = root / owner.STATE_FILE_NAME
        if state_path.exists() or state_path.is_symlink():
            state = owner.read_state(root)
            if (
                state.get("phase") not in {"RESETTING", "RESET_READY"}
                or state.get("run_id") != run_id
            ):
                raise owner.DataStateError("清空阶段或 run ID 与当前请求不一致")
            owner.require_candidate(state, candidate)
        else:
            state = {
                "schema_version": 1,
                "phase": "RESETTING",
                "run_id": run_id,
                "data_root": str(root),
                "candidate": candidate,
                "fresh_reset": {
                    "root": identity(os.fstat(root_fd)),
                    "leaves": {
                        leaf: {"identity": identity(os.fstat(fd)), "status": "PENDING"}
                        for leaf, fd in descriptors.items()
                    },
                },
            }
        verify_directories(owner, root, state)

        def guarded_checkpoint() -> None:
            checkpoint()
            verify_directories(owner, root, state)
            if identity(os.fstat(root_fd)) != state["fresh_reset"]["root"]:
                raise owner.DataStateError("清空 root 文件描述符身份发生变化")

        mounts = mount_points()
        for leaf, fd in descriptors.items():
            check_tree(
                owner, fd, root / leaf, state["fresh_reset"]["root"]["device"], mounts
            )
            if state["fresh_reset"]["leaves"][leaf]["status"] == "EMPTY" and os.listdir(
                fd
            ):
                raise owner.DataStateError(f"已清空 {leaf} 再次出现内容，拒绝续跑")
        guarded_checkpoint()
        owner.atomic_write_state(root, state)

        for leaf, fd in descriptors.items():
            guarded_checkpoint()
            if state["fresh_reset"]["leaves"][leaf]["status"] == "EMPTY":
                continue
            owner.ensure_services_stopped(root)
            clear_directory(
                owner,
                fd,
                root / leaf,
                state["fresh_reset"]["root"]["device"],
                guarded_checkpoint,
            )
            if os.listdir(fd):
                raise owner.DataStateError("清空目录仍有内容")
            state["fresh_reset"]["leaves"][leaf]["status"] = "EMPTY"
            owner.atomic_write_state(root, state)
        guarded_checkpoint()
        state["phase"] = "RESET_READY"
        owner.atomic_write_state(root, state)
    finally:
        for descriptor in descriptors.values():
            os.close(descriptor)
        os.close(root_fd)
    print("固定 postgres/redis/objects 内容已丢弃；状态为 RESET_READY，尚未初始化。")


def verify_phase(
    owner: Any, root: Path, state: dict[str, Any], run_id: str, allowed: set[str]
) -> dict[str, Any]:
    if state.get("run_id") != run_id or state.get("phase") not in allowed:
        raise owner.DataStateError("fresh-init run ID 或数据阶段不匹配")
    verify_directories(owner, root, state)
    if any(
        value["status"] != "EMPTY" for value in state["fresh_reset"]["leaves"].values()
    ):
        raise owner.DataStateError("fresh-init 尚未完成所有叶目录清空")
    return state


def begin_fresh_init(owner: Any, run_id: str, candidate: dict[str, Any]) -> None:
    require_fresh_candidate(owner, candidate)
    root, _ = owner.configured_roots()
    state = verify_phase(
        owner,
        root,
        owner.read_state(root),
        run_id,
        {"RESET_READY", "FRESH_INIT_DEPLOYING", "PRODUCTION_PREPARED"},
    )
    owner.require_candidate(state, candidate)
    if state["phase"] == "RESET_READY":
        owner.ensure_services_stopped(root)
        if any(any((root / leaf).iterdir()) for leaf in owner.LEAVES):
            raise owner.DataStateError("fresh-init 要求三个已清空目录为空")
    state["phase"] = "FRESH_INIT_DEPLOYING"
    owner.atomic_write_state(root, state)
    print("fresh-init 清空证明与候选绑定校验通过。")
