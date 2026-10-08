#!/usr/bin/env python3
"""以可续跑状态机隔离、验证和恢复 Production 数据目录。"""

from __future__ import annotations

import argparse
import fcntl
import getpass
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import uuid
import warnings
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from production_deployment import execute as execute_deployment
import production_fresh_reset as fresh_reset
from production_maintenance_execution import ExecutionResult, exit_code, supervise
from production_upgrade_recovery import verify_archives
from production_migration_runtime import image_runtime_fingerprint, source_digest, validate_fingerprint

STANDARD_DATA_ROOT = Path("/root/partsignal-data")
STANDARD_QUARANTINE_ROOT = Path("/root/partsignal-data-quarantine")
STANDARD_LOCK_FILE = Path("/run/lock/partsignal-production-maintenance.lock")
STATE_FILE_NAME = ".partsignal-production-cutover.json"
LEAVES = ("postgres", "redis", "objects")
RUNTIME_LEAVES = ("postgres", "redis")
RUN_ID_PATTERN = re.compile(r"prr_[0-9]{8}_[0-9]{6}")
REPO_DIGEST_PATTERN = re.compile(r"[^@\s]+@sha256:[0-9a-f]{64}")
V1_REPOSITORY_PATTERN = re.compile(r"(?:^|/)[^/:@]*(?:backend|frontend)-v1(?=[:@]|$)")
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PRODUCTION_COMPOSE_PROJECT = "partsignal-staging"
PRODUCTION_API_SERVICE = "api"
PRODUCTION_APPLICATION_ROOT = PurePosixPath("/app")
BACKEND_BOOTSTRAP_RESULT_MAX_BYTES = 64 * 1024
BACKEND_BOOTSTRAP_INPUT_MAX_BYTES = 64 * 1024
BOOTSTRAP_RESULT_FIELDS = {
    "status",
    "request_id",
    "channel_id",
    "channel_revision",
    "channel_enabled",
    "channel_configured",
    "model_id",
    "model_revision",
    "model_test_status",
    "model_enabled",
    "model_configured",
}
REQUIRED_TRACKED_FILES = {
    "deploy/compose.prod.yaml",
    "deploy/nginx/partsignal-maintenance.conf.template",
    "deploy/nginx/partsignal-security-headers.conf",
    "deploy/nginx/partsignal.conf.template",
    "deploy/scripts/activate-production.sh",
    "deploy/scripts/check-production-inputs.py",
    "deploy/scripts/deploy.sh",
    "deploy/scripts/prepare-production-data.py",
    "deploy/scripts/production_upgrade_recovery.py",
    "deploy/scripts/production_migration_runtime.py",
    "deploy/scripts/production_maintenance_execution.py",
    "deploy/scripts/production_deployment.py",
    "deploy/scripts/production_fresh_reset.py",
    "deploy/scripts/rollback-production-frontend.sh",
}
rename_count = 0


class DataStateError(RuntimeError):
    """表示数据目录状态不满足安全转换合同。"""


class BootstrapResultUnknown(DataStateError):
    """backend 可能已提交，但 host 无法证明完整结果。"""


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
    allow_test_roots = (
        os.getenv("PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS") == "1"
    )
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
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".cutover-state.", dir=data_root
    )
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
        raise DataStateError(
            f"无法解析 Production 候选清单：{manifest_path}"
        ) from error
    if canonical != manifest_path or not manifest_path.is_file():
        raise DataStateError("Production 候选清单包含路径别名或不是普通文件")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    recovery_strategy = payload.get("recovery_strategy", "previous-frontend")
    if not isinstance(recovery_strategy, str) or recovery_strategy not in {"previous-frontend", "fresh-rebuild"}:
        raise DataStateError("Production 候选恢复策略无效")
    fresh = recovery_strategy == "fresh-rebuild"
    try:
        candidate = {
            "manifest_sha256": file_sha256(manifest_path),
            "release_id": payload["release_id"],
            "commit": payload["commit"],
            "schema_head": payload["schema_head"],
            "migration_runtime": payload["migration_runtime"],
            "migration_reference": payload["images"]["migration"]["reference"],
            "migration_image_id": payload["images"]["migration"]["image_id"],
            "migration_repo_digests": sorted(payload["images"]["migration"]["repo_digests"]),
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
        }
        if fresh:
            if payload["images"]["rollback_frontend"] != {"status": "NOT_APPLICABLE"}:
                raise DataStateError("fresh-rebuild 必须显式声明 rollback_frontend NOT_APPLICABLE")
            candidate["recovery_strategy"] = recovery_strategy
        else:
            for field in ("reference", "image_id", "repo_digests"):
                value = payload["images"]["rollback_frontend"][field]
                candidate[f"rollback_frontend_{field}"] = sorted(value) if field == "repo_digests" else value
    except (KeyError, TypeError) as error:
        raise DataStateError("Production 候选清单缺少必要身份字段") from error
    validate_fingerprint(candidate["migration_runtime"])
    scalar_fields = (
        "manifest_sha256",
        "release_id",
        "commit",
        "schema_head",
        "backend_reference",
        "backend_image_id",
        "migration_reference",
        "migration_image_id",
        "frontend_reference",
        "frontend_image_id",
    )
    if not fresh:
        scalar_fields += ("rollback_frontend_reference", "rollback_frontend_image_id")
    if not all(
        isinstance(candidate[name], str) and candidate[name] for name in scalar_fields
    ):
        raise DataStateError("Production 候选清单身份字段格式无效")
    image_roles = ("backend", "migration", "frontend") + (() if fresh else ("rollback_frontend",))
    for role in image_roles:
        reference = candidate[f"{role}_reference"]
        if V1_REPOSITORY_PATTERN.search(reference):
            raise DataStateError(
                f"Production 候选清单不允许使用 V1 {role} 镜像仓库：{reference}"
            )
    for role in image_roles:
        digests = candidate[f"{role}_repo_digests"]
        if (
            not isinstance(digests, list)
            or not digests
            or not all(
                isinstance(digest, str) and REPO_DIGEST_PATTERN.fullmatch(digest)
                for digest in digests
            )
        ):
            raise DataStateError(f"Production 候选清单缺少合法 {role} RepoDigest")
    tracked_files = payload.get("tracked_files")
    if (
        not isinstance(tracked_files, dict)
        or set(tracked_files) != REQUIRED_TRACKED_FILES
    ):
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
            raise DataStateError(
                f"Production 候选 tracked file 校验失败：{relative_path}"
            )
    version = os.getenv("PARTSIGNAL_VERSION", "")
    if candidate["release_id"] != version:
        raise DataStateError("PARTSIGNAL_VERSION 必须与 manifest release ID 完全一致")
    expected_backend = f"{os.getenv('PARTSIGNAL_BACKEND_IMAGE', '')}:{version}"
    expected_frontend = f"{os.getenv('PARTSIGNAL_FRONTEND_IMAGE', '')}:{version}"
    if candidate["backend_reference"] != expected_backend:
        raise DataStateError("候选清单 backend 镜像与当前部署变量不一致")
    if candidate["migration_reference"] != os.getenv("PARTSIGNAL_MIGRATION_IMAGE", expected_backend):
        raise DataStateError("候选清单 migration 镜像与当前部署变量不一致")
    if candidate["frontend_reference"] != expected_frontend:
        raise DataStateError("候选清单 frontend 镜像与当前部署变量不一致")
    return candidate


def require_candidate(state: dict[str, Any], candidate: dict[str, Any]) -> None:
    """拒绝用另一候选继续已开始的部署或激活。"""
    if state.get("candidate") != candidate:
        raise DataStateError("当前候选与 Production 数据状态绑定的候选不一致")


def verify_candidate_images(candidate: dict[str, Any]) -> None:
    """确认本地镜像 ID 与候选清单一致。"""
    for role in ("backend", "migration", "frontend"):
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
    if candidate.get("recovery_strategy") == "fresh-rebuild":
        raise DataStateError("fresh-rebuild 的 frontend rollback 为 NOT_APPLICABLE；保持维护并前向重建")
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
    if candidate.get("recovery_strategy") == "fresh-rebuild":
        raise DataStateError("fresh-rebuild 的 frontend rollback 为 NOT_APPLICABLE")
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
    allow_test_roots = (
        os.getenv("PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS") == "1"
    )
    lock_file = configured_path("PARTSIGNAL_MAINTENANCE_LOCK_FILE", STANDARD_LOCK_FILE)
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
            raise DataStateError(
                "已有 PartSignal Production 维护操作持有排他锁"
            ) from error
        yield descriptor
    finally:
        os.close(descriptor)


def run_locked(child_command: list[str]) -> int:
    """继承 FD 只复用锁；公开 run-locked 始终创建本次 supervisor。"""
    if not child_command:
        raise DataStateError("run-locked 必须指定子命令")
    with maintenance_lock() as descriptor:
        def operation(publish: Callable[[dict[str, Any]], None]) -> int:
            publish({})
            environment = {**os.environ, "PARTSIGNAL_MAINTENANCE_LOCK_FD": str(descriptor)}
            result = subprocess.run(child_command, env=environment, pass_fds=(descriptor,))
            return exit_code(result.returncode)
        return supervise(operation).exit_code


def supervised_operation(operation: Callable[[Callable[[dict[str, Any]], None]], int]) -> ExecutionResult:
    """在 worker 内保留具体错误；父级只依据自己的真实退出观测。"""
    def worker(publish: Callable[[dict[str, Any]], None]) -> int:
        try:
            return operation(publish)
        except subprocess.CalledProcessError as error:
            if isinstance(error.cmd, list) and error.cmd[:3] == ["docker", "image", "inspect"]:
                print(f"Production 镜像身份检查失败：{error.cmd[-1]}", file=sys.stderr)
            else:
                print("Production 维护命令失败；保留未初始化状态。", file=sys.stderr)
            return exit_code(error.returncode)
        except (DataStateError, OSError, ValueError) as error:
            print(f"Production 数据状态操作失败：{error}", file=sys.stderr)
            return 2
    return supervise(worker)


def read_bootstrap_credential(
    *,
    reader: Callable[[str], str] | None = None,
    stdin: Any = None,
    stderr: Any = None,
    prompt: str = "AI API Key: ",
) -> str:
    """只从真实交互式 TTY 读取一次无回显 credential。"""
    input_stream = sys.stdin if stdin is None else stdin
    error_stream = sys.stderr if stderr is None else stderr
    if not input_stream.isatty() or not error_stream.isatty():
        raise DataStateError("Production AI credential 要求交互式 TTY")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            credential = (
                getpass.getpass(prompt, stream=error_stream)
                if reader is None
                else reader(prompt)
            )
    except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
        raise DataStateError("Production AI credential 读取失败") from None
    except Exception:
        raise DataStateError("Production AI credential 读取失败") from None
    if not isinstance(credential, str) or not credential:
        raise DataStateError("Production AI credential 不能为空")
    return credential


def _bootstrap_header_specs(args: argparse.Namespace) -> list[tuple[str, bool]]:
    """在接收值前拒绝非法或大小写重复的 Header 名；backend 继续最终裁决。"""
    specs: list[tuple[str, bool]] = []
    seen: set[str] = set()
    for field, sensitive in (("header_name", False), ("sensitive_header_name", True)):
        for name in getattr(args, field, []):
            normalized = name.casefold()
            if (
                len(name) > 160
                or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name)
                or normalized in {"authorization", "host", "content-length", "connection", "transfer-encoding"}
                or normalized in seen
            ):
                raise DataStateError("Production AI Header 名称无效、保留或重复")
            seen.add(normalized)
            specs.append((name, sensitive))
    return specs


def _bootstrap_payload(envelope: dict[str, Any]) -> bytes:
    """在持久 attempt 前检查完整 stdin 上限，错误不包含输入值。"""
    try:
        payload = json.dumps(
            envelope, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise DataStateError("Production AI bootstrap 输入无法编码") from None
    if len(payload) > BACKEND_BOOTSTRAP_INPUT_MAX_BYTES:
        raise DataStateError("Production AI bootstrap 输入超过 64 KiB")
    return payload


def _application_code_bind_mount(mounts: Any) -> bool:
    """识别覆盖镜像内 `/app` 代码树的 bind mount。"""
    if not isinstance(mounts, list):
        raise DataStateError("Production API 容器 mount metadata 无效")
    for mount in mounts:
        if not isinstance(mount, dict):
            raise DataStateError("Production API 容器 mount metadata 无效")
        if mount.get("Type") != "bind":
            continue
        destination_value = mount.get("Destination")
        if not isinstance(destination_value, str):
            raise DataStateError("Production API 容器 bind mount 目标无效")
        destination = PurePosixPath(destination_value)
        if not destination.is_absolute():
            raise DataStateError("Production API 容器 bind mount 目标无效")
        if (
            destination == PRODUCTION_APPLICATION_ROOT
            or destination in PRODUCTION_APPLICATION_ROOT.parents
            or PRODUCTION_APPLICATION_ROOT in destination.parents
        ):
            return True
    return False


def running_api_container_id(
    candidate: dict[str, Any],
    *,
    runner: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
) -> str:
    """只读取安全 Docker metadata 并验证唯一运行 API 容器身份。"""
    identifiers = runner(
        [
            "docker",
            "ps",
            "-q",
            "--no-trunc",
            "--filter",
            f"label=com.docker.compose.project={PRODUCTION_COMPOSE_PROJECT}",
            "--filter",
            f"label=com.docker.compose.service={PRODUCTION_API_SERVICE}",
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()
    if len(identifiers) != 1 or re.fullmatch(r"[0-9a-f]{64}", identifiers[0]) is None:
        raise DataStateError("Production 必须恰有一个完整 ID 的运行 API 容器")
    container_id = identifiers[0]
    safe_format = "|".join(
        (
            "{{.Id}}",
            "{{.Image}}",
            "{{.State.Status}}",
            "{{.State.Running}}",
            '{{index .Config.Labels "com.docker.compose.project"}}',
            '{{index .Config.Labels "com.docker.compose.service"}}',
            "{{json .Mounts}}",
        )
    )
    metadata = (
        runner(
            ["docker", "inspect", "--format", safe_format, container_id],
            check=True,
            capture_output=True,
            text=True,
        )
        .stdout.rstrip("\n")
        .split("|", 6)
    )
    if len(metadata) != 7:
        raise DataStateError("Production API 容器 metadata 不完整")
    (
        inspected_id,
        image_id,
        status_value,
        running_value,
        project_label,
        service_label,
        mounts_value,
    ) = metadata
    try:
        mounts = json.loads(mounts_value)
    except json.JSONDecodeError as error:
        raise DataStateError("Production API 容器 mount metadata 无效") from error
    if inspected_id != container_id:
        raise DataStateError("Production API 容器完整 ID 在检查期间发生变化")
    if (
        project_label != PRODUCTION_COMPOSE_PROJECT
        or service_label != PRODUCTION_API_SERVICE
    ):
        raise DataStateError("Production API 容器 Compose label 不匹配")
    if image_id != candidate["backend_image_id"]:
        raise DataStateError("Production API 容器镜像不是当前 candidate backend")
    if status_value != "running" or running_value != "true":
        raise DataStateError("Production API 容器不是 running 状态")
    if _application_code_bind_mount(mounts):
        raise DataStateError("Production API 容器存在覆盖应用代码的 bind mount")
    return container_id


def _strict_json_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """拒绝重复 JSON key，保持 host/backend 对输入输出的唯一解释。"""
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("JSON key 重复")
        result[key] = value
    return result


def _validate_backend_bootstrap_result(
    raw: bytes | str,
    *,
    request_id: str,
) -> dict[str, Any]:
    """只接受固定字段、完整 EOF 和与本次 attempt 一致的 backend 结果。"""
    encoded = raw.encode("utf-8") if isinstance(raw, str) else raw
    if not encoded or len(encoded) > BACKEND_BOOTSTRAP_RESULT_MAX_BYTES:
        raise BootstrapResultUnknown("Production AI bootstrap 结果缺失或超限")
    try:
        result = json.loads(
            encoded.decode("utf-8"), object_pairs_hook=_strict_json_object
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise BootstrapResultUnknown("Production AI bootstrap 结果无法确认") from error
    if not isinstance(result, dict) or result.get("request_id") != request_id:
        raise BootstrapResultUnknown(
            "Production AI bootstrap request identity 无法确认"
        )
    status_value = result.get("status")
    if set(result) != BOOTSTRAP_RESULT_FIELDS:
        raise BootstrapResultUnknown("Production AI bootstrap 结果字段无法确认")
    for field in ("channel_id", "model_id"):
        try:
            parsed = uuid.UUID(result[field])
        except (AttributeError, TypeError, ValueError) as error:
            raise BootstrapResultUnknown(
                "Production AI bootstrap UUID 无法确认"
            ) from error
        if str(parsed) != result[field]:
            raise BootstrapResultUnknown("Production AI bootstrap UUID 无法确认")
    for field in ("channel_revision", "model_revision"):
        if type(result[field]) is not int or result[field] < 0:
            raise BootstrapResultUnknown("Production AI bootstrap revision 无法确认")
    for field in (
        "channel_enabled",
        "channel_configured",
        "model_enabled",
        "model_configured",
    ):
        if type(result[field]) is not bool:
            raise BootstrapResultUnknown("Production AI bootstrap 状态无法确认")
    if result["model_test_status"] not in {"UNTESTED", "PASSED", "FAILED"}:
        raise BootstrapResultUnknown("Production AI bootstrap 测试状态无法确认")
    if status_value == "SUCCEEDED":
        if (
            result["model_test_status"] != "PASSED"
            or not result["channel_enabled"]
            or not result["channel_configured"]
            or not result["model_enabled"]
            or not result["model_configured"]
        ):
            raise BootstrapResultUnknown("Production AI bootstrap 成功状态不完整")
    elif status_value == "FAILED":
        if (
            result["model_test_status"] != "FAILED"
            or result["channel_enabled"]
            or not result["channel_configured"]
            or result["model_enabled"]
            or not result["model_configured"]
        ):
            raise BootstrapResultUnknown("Production AI bootstrap 失败状态不安全")
    else:
        raise BootstrapResultUnknown("Production AI bootstrap 结果状态无法确认")
    return result


def _backend_bootstrap_result(
    *,
    container_id: str,
    envelope: dict[str, Any],
    request_id: str,
    runner: Callable[..., subprocess.CompletedProcess[Any]],
) -> dict[str, Any]:
    """以 shell=False 的 stdin pipe 调用容器内 maintenance command。"""
    payload = _bootstrap_payload(envelope)
    try:
        completed = runner(
            [
                "docker",
                "exec",
                "-i",
                container_id,
                "python",
                "-m",
                "app.cli",
                "bootstrap-production-ai",
            ],
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            shell=False,
        )
    except (OSError, KeyboardInterrupt, subprocess.SubprocessError) as error:
        raise BootstrapResultUnknown(
            "Production AI bootstrap transport 结果未知"
        ) from error
    result = _validate_backend_bootstrap_result(completed.stdout, request_id=request_id)
    expected_return_codes = {
        "SUCCEEDED": {0},
        "FAILED": {1},
    }
    if completed.returncode not in expected_return_codes[result["status"]]:
        raise BootstrapResultUnknown("Production AI bootstrap 退出状态无法确认")
    return result


def _request_parameters(value: str) -> dict[str, Any]:
    """host 先校验显式非 secret JSON，backend 仍执行最终 Schema 校验。"""
    try:
        parsed = json.loads(value, object_pairs_hook=_strict_json_object)
    except (json.JSONDecodeError, ValueError) as error:
        raise DataStateError("模型 request parameters 必须是单个 JSON 对象") from error
    if not isinstance(parsed, dict):
        raise DataStateError("模型 request parameters 必须是单个 JSON 对象")
    if {"model", "messages", "stream"}.intersection(parsed):
        raise DataStateError("模型 request parameters 包含系统保留字段")
    return parsed


def _attempt_status(state: dict[str, Any]) -> str | None:
    """校验持久 attempt 的最小结构；未知结构一律 fail closed。"""
    if "ai_bootstrap_attempt" not in state:
        return None
    attempt = state["ai_bootstrap_attempt"]
    if (
        not isinstance(attempt, dict)
        or set(attempt) != {"request_id", "status"}
        or not isinstance(attempt.get("request_id"), str)
        or re.fullmatch(
            r"production-bootstrap-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-"
            r"[89ab][0-9a-f]{3}-[0-9a-f]{12}",
            attempt["request_id"],
        )
        is None
        or not isinstance(attempt.get("status"), str)
        or attempt.get("status") not in {"STARTED", "FAILED", "SUCCEEDED"}
    ):
        raise DataStateError("Production AI bootstrap attempt 状态无效")
    return attempt["status"]


def require_activation_safe_bootstrap_attempt(state: dict[str, Any]) -> None:
    """clean-init activation 只接受结构合法且已成功的 bootstrap attempt。"""
    status_value = _attempt_status(state)
    if status_value != "SUCCEEDED":
        raise DataStateError("Production AI bootstrap 尚未取得可激活的成功结果")


def bootstrap_ai(
    args: argparse.Namespace,
    *,
    credential_reader: Callable[[str], str] | None = None,
    runner: Callable[..., subprocess.CompletedProcess[Any]] = subprocess.run,
    stdin: Any = None,
    stderr: Any = None,
) -> None:
    """在同一 maintenance lock 内拥有 attempt、容器身份与 backend 调用。"""
    data_root, _ = configured_roots()
    run_id = require_run_id(args.run_id)
    candidate = candidate_from_manifest(args.manifest)
    state = verify_phase(run_id, {"PRODUCTION_PREPARED"})
    require_candidate(state, candidate)
    if _attempt_status(state) is not None:
        raise DataStateError("Production AI bootstrap attempt 已存在，拒绝重入")
    request_parameters = _request_parameters(args.request_parameters_json)
    header_specs = _bootstrap_header_specs(args)
    container_id = running_api_container_id(candidate, runner=runner)
    credential = read_bootstrap_credential(
        reader=credential_reader,
        stdin=stdin,
        stderr=stderr,
    )
    headers = []
    for index, (name, sensitive) in enumerate(header_specs, start=1):
        value = read_bootstrap_credential(
            reader=credential_reader, stdin=stdin, stderr=stderr,
            prompt=f"AI Header value ({index}/{len(header_specs)}): ",
        )
        if any(ord(character) < 32 or ord(character) == 127 or ord(character) > 255 for character in value):
            raise DataStateError("Production AI Header 值包含非法字符")
        headers.append({"name": name, "is_sensitive": sensitive, "value": value})
    request_id = f"production-bootstrap-{uuid.uuid4()}"
    envelope = {
        "request_id": request_id,
        "credential": credential,
        "headers": headers,
        "channel": {
            "name": args.channel_name,
            "description": args.channel_description,
            "protocol_type": args.protocol_type,
            "provider_brand": args.provider_brand,
            "base_url": args.base_url,
            "timeout_seconds": args.timeout_seconds,
        },
        "model": {
            "display_name": args.model_display_name,
            "model_id": args.model_id,
            "request_parameters": request_parameters,
        },
    }
    _bootstrap_payload(envelope)
    state["ai_bootstrap_attempt"] = {"request_id": request_id, "status": "STARTED"}
    atomic_write_state(data_root, state)
    result = _backend_bootstrap_result(
        container_id=container_id,
        envelope=envelope,
        request_id=request_id,
        runner=runner,
    )
    if result["status"] != "SUCCEEDED":
        state["ai_bootstrap_attempt"]["status"] = "FAILED"
        atomic_write_state(data_root, state)
        raise DataStateError("Production AI bootstrap 明确失败")
    state["ai_bootstrap_attempt"]["status"] = "SUCCEEDED"
    atomic_write_state(data_root, state)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


def ensure_services_stopped(data_root: Path) -> None:
    """确认历史 Compose project 与所有活动数据挂载均没有运行容器。"""
    project = os.getenv("PARTSIGNAL_COMPOSE_PROJECT", "partsignal-staging")
    allow_test_roots = (
        os.getenv("PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS") == "1"
    )
    if not allow_test_roots and project != "partsignal-staging":
        raise DataStateError(
            "Production Compose project 必须是固定的 partsignal-staging"
        )
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
    if not isinstance(payload, list) or len(payload) != len(running_ids) or any(
        not isinstance(container, dict) or not isinstance(container.get("Mounts"), list)
        or any(not isinstance(mount, dict) or not isinstance(mount.get("Source"), str) for mount in container["Mounts"])
        for container in payload
    ):
        raise DataStateError("运行容器的活动数据 mount metadata 不完整，拒绝维护数据")
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
    if "fresh_reset" in state:
        return fresh_reset.verify_phase(sys.modules[__name__], data_root, state, run_id, allowed)
    target = target_for(state, quarantine_root, run_id)
    ensure_plain_directory(target, label="隔离目标")
    if state.get("phase") not in allowed:
        raise DataStateError(f"当前数据阶段不允许该操作：{state.get('phase')}")
    if state.get("device") != ensure_same_device([data_root, quarantine_root, target]):
        raise DataStateError("文件系统 device 与状态文件不一致")
    return state


def begin_clean_init(run_id: str, candidate: dict[str, str]) -> None:
    """首次证明空目录并把整个 clean-init 部署绑定到唯一候选。"""
    if candidate.get("recovery_strategy") == "fresh-rebuild":
        raise DataStateError("fresh-rebuild 候选必须使用 fresh-init")
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
    if source == "PRODUCTION_PREPARED" and destination == "PRODUCTION_INITIALIZED":
        require_activation_safe_bootstrap_attempt(state)
    state["phase"] = destination
    atomic_write_state(data_root, state)
    print(f"Production 数据阶段已更新为 {destination}。")


def upgrade_entry_state(candidate: dict[str, Any]) -> dict[str, Any]:
    """交付镜像前只读裁决升级资格，不修改阶段或伪造历史策略。"""
    if candidate.get("recovery_strategy") == "fresh-rebuild":
        raise DataStateError("fresh-rebuild 候选必须使用 fresh-init")
    data_root, _ = configured_roots()
    state = read_state(data_root)
    phase = state.get("phase")
    if phase == "PRODUCTION_INITIALIZED":
        if state.get("candidate") == candidate:
            raise DataStateError("当前候选已经初始化，拒绝重复创建 upgrade")
    elif phase in {"UPGRADE_DEPLOYING", "UPGRADE_PREPARED"}:
        require_candidate(state, candidate)
    else:
        raise DataStateError(f"当前数据阶段不允许 Production upgrade：{phase}")
    return state


def begin_upgrade(candidate: dict[str, str]) -> None:
    """从已初始化版本开始或续跑同一候选的 Production upgrade。"""
    data_root, _ = configured_roots()
    state = upgrade_entry_state(candidate)
    phase = state["phase"]
    if phase == "PRODUCTION_INITIALIZED":
        # 在第一次迁移前记录执行条件；恢复不能把当前检查伪造为历史证明。
        cache_policy = prove_upgrade_cache_policy(candidate)
        runtime_proof = prove_upgrade_runtime(candidate)
        state["previous_candidate"] = state.get("candidate")
        state["candidate"] = candidate
        state["upgrade_migration_cache_policy"] = cache_policy
        state["upgrade_migration_runtime"] = runtime_proof
        state["phase"] = "UPGRADE_DEPLOYING"
    elif phase in {"UPGRADE_DEPLOYING", "UPGRADE_PREPARED"}:
        if state.get("upgrade_migration_runtime") != {"candidate": candidate, "fingerprint": candidate["migration_runtime"]}:
            raise DataStateError("升级缺少迁移执行前冻结的运行时证明，拒绝历史补造")
        prove_upgrade_runtime(candidate)
        if phase == "UPGRADE_PREPARED":
            state["phase"] = "UPGRADE_DEPLOYING"
    for leaf in RUNTIME_LEAVES:
        ensure_plain_directory(data_root / leaf, label=f"Production {leaf}")
    # 每次真实重入建立新 attempt；旧失败仍保留，但不能证明正在重试的候选失败。
    state["upgrade_attempt"] = {
        "attempt_id": "upa_" + uuid.uuid4().hex,
        "candidate": candidate,
        "status": "RUNNING",
    }
    state.pop("current_upgrade_failure_id", None)
    atomic_write_state(data_root, state)
    print("Production upgrade 数据所有权与候选绑定校验通过。")


def prove_upgrade_runtime(candidate: dict[str, Any]) -> dict[str, Any]:
    """在首次迁移前冻结完整迁移镜像，并核对 checkout 的 Alembic 树。"""
    fingerprint = candidate["migration_runtime"]
    verify_migration_image(candidate, fingerprint["source_sha256"])
    if source_digest(REPOSITORY_ROOT / "backend") != fingerprint["source_sha256"]:
        raise DataStateError("升级 Alembic 源码树与 manifest 不一致")
    return {"candidate": candidate, "fingerprint": fingerprint}


UPGRADE_FAILURE_STAGES = (
    "data_services", "configuration_preflight", "integrity_preflight",
    "stop_application", "migration", "integrity_post_migration", "account_initialization", "application_start",
    "status", "api_readiness", "frontend_readiness", "prepared_proof",
)


def require_low_sensitive_ref(value: str) -> str:
    """只记录明确低敏引用，不接收日志、正文或自由文本。"""
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}", value):
        raise DataStateError("升级失败/恢复必须提供低敏精确引用")
    return value


def persist_upgrade_failure(candidate: dict[str, Any], fields: dict[str, Any], phase: str) -> dict[str, Any]:
    """状态所有者保留失败事实；不能覆盖已有失败或为无 attempt 的历史补证。"""
    data_root, _ = configured_roots()
    state = read_state(data_root)
    require_candidate(state, candidate)
    attempt = state.get("upgrade_attempt")
    if state.get("phase") != phase or not isinstance(attempt, dict) or attempt.get("candidate") != candidate:
        raise DataStateError("升级失败记录缺少匹配阶段和候选的部署 attempt")
    failures = state.get("upgrade_failures", [])
    if attempt.get("status") == "FAILED":
        repeated = next((f for f in failures if f["failure_id"] == state.get("current_upgrade_failure_id")), None)
        if repeated and all(repeated.get(key) == value for key, value in fields.items()):
            return repeated
        raise DataStateError("升级失败记录与已有不可变事实冲突")
    expected = "RUNNING" if phase == "UPGRADE_DEPLOYING" else "PREPARED"
    if attempt.get("status") != expected:
        raise DataStateError("升级失败记录要求有效的当前部署 attempt")
    record = {
        **fields,
        "failure_id": "upf_" + uuid.uuid4().hex,
        "attempt_id": attempt["attempt_id"],
        "candidate": candidate,
        "phase_at_failure": phase,
        "failed_at": datetime.now(timezone.utc).isoformat(),
    }
    state["upgrade_failures"] = [*failures, record]
    state["current_upgrade_failure_id"] = record["failure_id"]
    state["upgrade_attempt"] = {**attempt, "status": "FAILED"}
    atomic_write_state(data_root, state)
    print(f"升级失败事实已记录：{record['failure_id']}；候选与阶段保持。")
    return record


def record_observed_upgrade_failure(candidate: dict[str, Any], result: ExecutionResult) -> dict[str, Any] | None:
    """持锁 supervisor 在全部子孙停止后记录自己观察到的本次退出。"""
    attempt_id, stage = result.progress.get("attempt_id"), result.progress.get("stage")
    if not result.exit_code or not attempt_id:
        return
    if stage not in UPGRADE_FAILURE_STAGES:
        raise DataStateError("部署退出缺少本次执行阶段，保持维护且不补造失败")
    data_root, _ = configured_roots()
    state = read_state(data_root)
    attempt = state.get("upgrade_attempt")
    if not isinstance(attempt, dict) or attempt.get("attempt_id") != attempt_id:
        raise DataStateError("部署退出不属于当前 attempt，拒绝记录失败")
    runtime = state.get("upgrade_migration_runtime")
    if runtime != {"candidate": candidate, "fingerprint": candidate["migration_runtime"]}:
        raise DataStateError("部署失败缺少迁移前冻结证明")
    return persist_upgrade_failure(candidate, {
        "stage": stage, "exit_code": result.exit_code, "signal": result.signal or None,
        "worker_exit_code": result.worker_exit_code,
        "failure_kind": "DEPLOYMENT_SIGNALLED" if result.signal else "DEPLOYMENT_COMMAND_FAILED",
        "evidence_ref": f"deploy-owner/{attempt_id}/{stage}",
        "migration_runtime_proof": runtime,
    }, state["phase"])


def declare_pre_activation_failure(candidate: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    """明确标记操作员批准声明；不把准备后发现的问题伪装为部署退出。"""
    return persist_upgrade_failure(candidate, {
        "stage": "pre_activation", "exit_code": None, "signal": None,
        "failure_kind": "OPERATOR_DECLARED_PRE_ACTIVATION_FAILURE",
        "evidence_ref": require_low_sensitive_ref(args.evidence_ref),
        "declaration_approval_ref": require_low_sensitive_ref(args.approval_ref),
    }, "UPGRADE_PREPARED")


def prove_upgrade_cache_policy(candidate: dict[str, Any]) -> dict[str, Any]:
    """首次 upgrade 入场证明 runtime/host/冻结镜像不改迁移缓存位置。"""
    validate_recovery_boundary()
    image = json.loads(subprocess.run(
        ["docker", "image", "inspect", candidate["migration_image_id"]],
        check=True, capture_output=True, text=True,
    ).stdout)
    if not isinstance(image, list) or len(image) != 1 or image[0].get("Id") != candidate["migration_image_id"]:
        raise DataStateError("upgrade 迁移缓存策略的冻结镜像身份无效")
    config = image[0].get("Config")
    if not isinstance(config, dict) or not isinstance(config.get("Env"), list) or not all(isinstance(value, str) for value in config["Env"]):
        raise DataStateError("upgrade 迁移缓存策略的镜像环境无法证明")
    if any(value.partition("=")[0] == "PYTHONPYCACHEPREFIX" and value.partition("=")[2] for value in config["Env"]):
        raise DataStateError("upgrade 镜像指定树外迁移编译缓存目录")
    return {"policy": "DEFAULT_PYTHON_CACHE_V1", "candidate": candidate}


def transition_upgrade(
    source: str, destination: str, candidate: dict[str, str]
) -> None:
    """推进与候选绑定的 upgrade 准备或激活阶段。"""
    data_root, _ = configured_roots()
    state = read_state(data_root)
    if state.get("phase") != source:
        raise DataStateError(f"当前数据阶段不允许该 upgrade 操作：{state.get('phase')}")
    require_candidate(state, candidate)
    attempt = state.get("upgrade_attempt")
    required_status = "RUNNING" if destination == "UPGRADE_PREPARED" else "PREPARED"
    require_upgrade_attempt(state, candidate, required_status)
    if state.get("upgrade_recoveries") and state["upgrade_recoveries"][-1]["candidate"] == candidate:
        if "ai_bootstrap_attempt" in state:
            require_activation_safe_bootstrap_attempt(state)
        if destination == "UPGRADE_PREPARED":
            verify_recovery_database(candidate)
    state["phase"] = destination
    if destination == "UPGRADE_PREPARED":
        state["upgrade_attempt"] = {**attempt, "status": "PREPARED"}
    else:
        state["upgrade_attempt"] = {**attempt, "status": "INITIALIZED"}
    atomic_write_state(data_root, state)
    print(f"Production 数据阶段已更新为 {destination}。")


def verify_upgrade_prepared(candidate: dict[str, str]) -> None:
    """只允许激活本次已准备完成的 upgrade 候选。"""
    data_root, _ = configured_roots()
    state = read_state(data_root)
    if state.get("phase") != "UPGRADE_PREPARED":
        raise DataStateError("Production upgrade 尚未准备完成")
    require_candidate(state, candidate)
    require_upgrade_attempt(state, candidate, "PREPARED")
    if state.get("upgrade_recoveries") and state["upgrade_recoveries"][-1]["candidate"] == candidate:
        if "ai_bootstrap_attempt" in state:
            require_activation_safe_bootstrap_attempt(state)
    print("Production upgrade 候选准备阶段校验通过。")


def require_upgrade_attempt(state: dict[str, Any], candidate: dict[str, Any], status: str) -> None:
    """已声明失败的 prepared 候选不能继续激活，也不能跳过新的部署 attempt。"""
    attempt = state.get("upgrade_attempt")
    if not isinstance(attempt, dict) or attempt.get("candidate") != candidate or attempt.get("status") != status:
        raise DataStateError(f"upgrade 要求当前有效且未失败的 {status} 部署 attempt")


def recover_upgrade(args: argparse.Namespace, *, checkpoint: Callable[[], None] = lambda: None) -> None:
    """显式 CAS 前向接管；完整证明后仅原子写状态，不换镜像或触碰数据。"""
    validate_recovery_boundary()
    data_root, _ = configured_roots()
    ensure_plain_directory(data_root, label="活动数据根")
    state = read_state(data_root)
    if state.get("phase") not in {"UPGRADE_DEPLOYING", "UPGRADE_PREPARED"}:
        raise DataStateError("恢复要求未初始化的 UPGRADE_DEPLOYING/UPGRADE_PREPARED")
    if not re.fullmatch(r"upr_[0-9]{8}_[0-9]{6}", args.recovery_id):
        raise DataStateError("升级恢复 ID 格式无效")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}", args.approval_ref):
        raise DataStateError("升级恢复必须提供低敏精确批准引用")
    fixed = candidate_from_manifest(args.manifest)
    if fixed.get("recovery_strategy") == "fresh-rebuild":
        raise DataStateError("升级恢复不能切换到 fresh-rebuild；必须保留既有升级恢复合同")
    history = state.get("upgrade_recoveries", [])
    repeated = next((r for r in history if r["recovery_id"] == args.recovery_id), None)
    failed = repeated["failed_candidate"] if repeated else state.get("candidate")
    if (
        not isinstance(failed, dict)
        or failed.get("release_id") != args.failed_release_id
        or failed.get("manifest_sha256") != args.failed_manifest_sha256
    ):
        raise DataStateError("升级恢复失败候选身份与状态不一致")
    failure_record = repeated.get("failure_record") if repeated else next((
        record for record in state.get("upgrade_failures", [])
        if record.get("failure_id") == state.get("current_upgrade_failure_id")
    ), None)
    if not isinstance(failure_record, dict) or failure_record.get("candidate") != failed:
        raise DataStateError("升级恢复缺少绑定当前候选的持久化失败记录")
    if failure_record.get("failure_id") != args.failure_id:
        raise DataStateError("升级恢复失败记录身份不一致")
    if not repeated:
        attempt = state.get("upgrade_attempt")
        if not isinstance(attempt, dict) or attempt.get("status") != "FAILED" or attempt.get("candidate") != failed or attempt.get("attempt_id") != failure_record.get("attempt_id"):
            raise DataStateError("升级恢复缺少当前 attempt 的终态失败记录")
        if any(r.get("failure_record", {}).get("failure_id") == args.failure_id for r in history):
            raise DataStateError("升级失败记录已经被消费")
    failed_cache_policy = repeated.get("failed_cache_policy") if repeated else state.get("upgrade_migration_cache_policy")
    if failed_cache_policy != {"policy": "DEFAULT_PYTHON_CACHE_V1", "candidate": failed}:
        raise DataStateError("失败执行缺少绑定候选的迁移缓存策略证明，拒绝历史推断")
    failed_runtime = repeated.get("failed_migration_runtime") if repeated else state.get("upgrade_migration_runtime")
    if failed_runtime != {"candidate": failed, "fingerprint": failed.get("migration_runtime")} or not failed.get("migration_runtime"):
        raise DataStateError("失败执行缺少迁移运行时冻结证明，拒绝历史补造")
    if fixed["migration_runtime"] != failed["migration_runtime"]:
        raise DataStateError("恢复候选迁移运行时与失败执行不一致")
    if fixed["migration_image_id"] != failed.get("migration_image_id"):
        raise DataStateError("严格失败恢复必须保留失败执行的冻结迁移镜像身份")
    if fixed["schema_head"] != failed.get("schema_head"):
        raise DataStateError("升级恢复只允许相同 schema head")
    if fixed["release_id"] == failed["release_id"] or fixed == state.get("previous_candidate"):
        raise DataStateError("升级恢复必须是新的前向修复候选")
    if all(fixed[f"{role}_image_id"] == failed.get(f"{role}_image_id") for role in ("backend", "frontend")):
        raise DataStateError("升级恢复要求实际修正 artifact 镜像身份")
    predecessors = [state.get("previous_candidate"), *(r["failed_candidate"] for r in history)]
    if any(
        isinstance(previous, dict) and (
            fixed["release_id"] == previous.get("release_id")
            or all(fixed[f"{role}_image_id"] == previous.get(f"{role}_image_id") for role in ("backend", "frontend"))
        )
        for previous in predecessors
    ):
        raise DataStateError("升级恢复不允许重新启用旧候选或已失败镜像")
    if "ai_bootstrap_attempt" in state:
        require_activation_safe_bootstrap_attempt(state)
    for leaf in RUNTIME_LEAVES:
        ensure_plain_directory(data_root / leaf, label=f"Production {leaf}")
    ensure_services_stopped(data_root)
    verify_candidate_images(fixed)
    migrations = verify_archives(
        failed, fixed, failed_manifest=args.failed_manifest, manifest=args.manifest,
        failed_archive=args.failed_source_archive, archive=args.source_archive,
        repository=REPOSITORY_ROOT,
    )
    # 同名 revision 不证明旧镜像实际提交的 DDL 正确；两端都必须匹配。
    verify_migration_image(failed, migrations)
    verify_migration_image(fixed, migrations)
    receipt = {
        "recovery_id": args.recovery_id, "approval_ref": args.approval_ref,
        "failed_candidate": failed, "candidate": fixed,
        "migration_tree_sha256": migrations,
        "migration_runtime_sha256": fixed["migration_runtime"]["migration_runtime_sha256"],
        "failed_migration_runtime": failed_runtime,
        "failed_cache_policy": failed_cache_policy,
        "failure_record": failure_record,
    }
    if repeated:
        if repeated != receipt or state.get("candidate") != fixed or state["phase"] != "UPGRADE_DEPLOYING" or state.get("upgrade_attempt") is not None:
            raise DataStateError("升级恢复重复请求与持久回执或当前阶段冲突")
        print("升级恢复已记录；重放同一回执，不重新切换候选。")
        return
    checkpoint()
    state["candidate"] = fixed
    state["upgrade_migration_cache_policy"] = {"policy": "DEFAULT_PYTHON_CACHE_V1", "candidate": fixed}
    state["upgrade_migration_runtime"] = {"candidate": fixed, "fingerprint": fixed["migration_runtime"]}
    state["phase"] = "UPGRADE_DEPLOYING"
    state["upgrade_recoveries"] = [*history, receipt]
    state.pop("current_upgrade_failure_id", None)
    state.pop("upgrade_attempt", None)
    atomic_write_state(data_root, state)
    print("升级前向恢复候选已显式绑定；仍未初始化，必须重新 deploy 和验收。")


def verify_migration_image(candidate: dict[str, Any], expected: str) -> None:
    """导出未启动的冻结镜像；不执行镜像 Python 或其可能被投毒的 loader。"""
    actual = image_runtime_fingerprint(candidate["migration_image_id"])
    if actual["source_sha256"] != expected:
        raise DataStateError("恢复镜像内迁移源码闭包与 source archive 不一致")
    if actual != candidate["migration_runtime"]:
        raise DataStateError("恢复镜像迁移运行时与 manifest 不一致")


def validate_recovery_boundary() -> str:
    """恢复同样受生产配置/Compose/Browser 边界约束，不另设旁路。"""
    runtime = os.environ.get("PARTSIGNAL_RUNTIME_ENV_FILE", "")
    if not runtime or not Path(runtime).is_file():
        raise DataStateError("升级恢复缺少 Production runtime env")
    subprocess.run(
        [sys.executable, str(REPOSITORY_ROOT / "deploy/scripts/check-production-inputs.py"),
         "--deployment-boundary", runtime], check=True,
    )
    return runtime


def verify_recovery_database(candidate: dict[str, Any]) -> None:
    """恢复候选 prepared 前，以固定 Compose/镜像验证真实完整性和 schema。"""
    verify_candidate_images(candidate)
    runtime = validate_recovery_boundary()
    command = [
        "docker", "compose", "--project-name", PRODUCTION_COMPOSE_PROJECT,
        "--env-file", runtime, "-f", str(REPOSITORY_ROOT / "deploy/compose.prod.yaml"),
        "run", "--rm", "--pull", "never", "--no-deps", "api",
    ]
    subprocess.run([*command, "python", "-m", "app.cli", "preflight-integrity", "--require-schema"], check=True)
    probe = (
        "import json; from sqlalchemy import text; from app.db import engine; "
        "connection=engine.connect(); "
        "print(json.dumps(list(connection.execute(text('SELECT version_num FROM alembic_version')).scalars()))); "
        "connection.close(); engine.dispose()"
    )
    result = subprocess.run([*command, "python", "-c", probe], check=True, capture_output=True, text=True)
    if json.loads(result.stdout) != [candidate["schema_head"]]:
        raise DataStateError("恢复数据库 schema head 与候选 manifest 不一致")


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
    if "fresh_reset" in state:
        raise DataStateError("fresh-init 已丢弃旧数据，restore 为 NOT_APPLICABLE")
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
            leaf: "ACTIVE" if (data_root / leaf).exists() else "ABSENT"
            for leaf in LEAVES
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
    parser = argparse.ArgumentParser(
        description="管理 PartSignal Production 数据转换状态"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("quarantine", "restore"):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("run_id")
    reset_parser = subparsers.add_parser("reset-data")
    reset_parser.add_argument("run_id")
    reset_parser.add_argument("manifest")
    reset_parser.add_argument("--discard-existing-data", action="store_true")
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
        "verify-upgrade-entry",
        "verify-candidate-images",
        "verify-upgrade-prepared",
        "mark-upgrade-initialized",
        "verify-rollback-frontend",
        "mark-frontend-rollback",
    ):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("manifest")
    recovery_parser = subparsers.add_parser("recover-upgrade")
    recovery_parser.add_argument("manifest")
    for field in (
        "failed-manifest", "failed-source-archive", "source-archive",
        "failed-release-id", "failed-manifest-sha256", "recovery-id", "approval-ref", "failure-id",
    ):
        recovery_parser.add_argument(f"--{field}", required=True)
    declaration_parser = subparsers.add_parser("declare-pre-activation-failure")
    declaration_parser.add_argument("manifest")
    declaration_parser.add_argument("--approval-ref", required=True)
    declaration_parser.add_argument("--evidence-ref", required=True)
    bootstrap_parser = subparsers.add_parser("bootstrap-ai")
    bootstrap_parser.add_argument("run_id")
    bootstrap_parser.add_argument("manifest")
    bootstrap_parser.add_argument("--channel-name", required=True)
    bootstrap_parser.add_argument("--channel-description", required=True)
    bootstrap_parser.add_argument(
        "--protocol-type",
        required=True,
        choices=("openai-compatible-chat-completions",),
    )
    bootstrap_parser.add_argument(
        "--provider-brand",
        required=True,
        choices=(
            "OPENAI",
            "ANTHROPIC",
            "GOOGLE",
            "AZURE_OPENAI",
            "ZHIPU",
            "QWEN",
            "CUSTOM",
        ),
    )
    bootstrap_parser.add_argument("--base-url", required=True)
    bootstrap_parser.add_argument(
        "--timeout-seconds", required=True, type=int, choices=range(10, 601)
    )
    bootstrap_parser.add_argument("--model-display-name", required=True)
    bootstrap_parser.add_argument("--model-id", required=True)
    bootstrap_parser.add_argument("--request-parameters-json", required=True)
    bootstrap_parser.add_argument(
        "--header-name", action="append", default=[],
        help="可选普通 Header 名，可重复指定；值随后从无回显 TTY 输入",
    )
    bootstrap_parser.add_argument(
        "--sensitive-header-name", action="append", default=[],
        help="可选敏感 Header 名，可重复指定；值随后从无回显 TTY 输入并加密保存",
    )
    subparsers.add_parser("deploy-production")
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
            elif args.command == "reset-data":
                validate_recovery_boundary()
                run_id = require_run_id(args.run_id)
                candidate = candidate_from_manifest(args.manifest)
                result = supervised_operation(lambda publish: (
                    fresh_reset.reset_data(sys.modules[__name__], run_id, candidate, discard_data=args.discard_existing_data, checkpoint=lambda: publish({})) or 0
                ))
                raise SystemExit(result.exit_code)
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
                require_activation_safe_bootstrap_attempt(state)
                print("Production clean-init 准备阶段校验通过。")
            elif args.command == "mark-initialized":
                transition_candidate(
                    require_run_id(args.run_id),
                    "PRODUCTION_PREPARED",
                    "PRODUCTION_INITIALIZED",
                    candidate_from_manifest(args.manifest),
                )
            elif args.command == "verify-upgrade-entry":
                upgrade_entry_state(candidate_from_manifest(args.manifest))
                print("Production upgrade 只读入场资格校验通过。")
            elif args.command == "recover-upgrade":
                result = supervised_operation(lambda publish: (
                    recover_upgrade(args, checkpoint=lambda: publish({})) or 0
                ))
                raise SystemExit(result.exit_code)
            elif args.command == "deploy-production":
                result = supervised_operation(lambda publish: execute_deployment(sys.modules[__name__], publish))
                if (os.getenv("PARTSIGNAL_DEPLOY_MODE") or "upgrade") == "upgrade" and result.progress.get("attempt_id"):
                    data_root, _ = configured_roots()
                    # 身份已由本次 worker 冻结在 state；父级依据私有 pipe 的 attempt 关联。
                    candidate = read_state(data_root)["candidate"]
                    record_observed_upgrade_failure(candidate, result)
                raise SystemExit(result.exit_code)
            elif args.command == "declare-pre-activation-failure":
                declare_pre_activation_failure(candidate_from_manifest(args.manifest), args)
            elif args.command == "verify-candidate-images":
                verify_candidate_images(candidate_from_manifest(args.manifest))
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
            elif args.command == "bootstrap-ai":
                bootstrap_ai(args)
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
