"""捕获 source profiler 安全 JSON，校验固定合同后原子落盘。"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Never


PROFILE_CONTRACT_SHA256 = (
    "295a4fe72b549fc29fb8a4c310baca50e3002aeb32423c8ab129060a7a33d17b"
)
SANITIZER_SHA256 = "124c2182ff439c34991506e08a846beaf81b376092472d4f2a470cd7f889fd1d"
MATRIX_SHA256 = "71c86e68f8127530d6a559c797ce8cf116c98bd2b652a9e051e47b4dc4d638a6"
SCHEMA_SIGNATURE = "90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a"
RUN_ID = re.compile(r"pss_\d{8}_\d{2}")
SNAPSHOT_ID = re.compile(r"[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+")
PRODUCER_TIMEOUT_SECONDS = 15 * 60
SOURCE_CONTEXT_LIMIT_BYTES = 4096
SOURCE_DATABASE = "partsignal"
SOURCE_CONTEXT_KEYS = {"database", "role", "run_id", "snapshot_id"}
SOURCE_PROFILE_PATH = Path("/tmp/source-profile.json")
MAX_SOURCE_PROFILE_BYTES = 16 * 1024 * 1024
SOURCE_PGOPTIONS = (
    "-c default_transaction_read_only=on "
    "-c statement_timeout=15min "
    "-c lock_timeout=1s "
    "-c idle_in_transaction_session_timeout=35min"
)
TOP_LEVEL_KEYS = {
    "command",
    "status",
    "shape_version",
    "stage",
    "run_id",
    "schema_revision",
    "schema_signature",
    "snapshot_bound",
    "default_transaction_read_only",
    "transaction_read_only",
    "transaction_isolation",
    "object_payload_copied",
    "artifacts",
    "profile_contract_sha256",
    "profile",
}
PROFILE_KEYS = {
    "table_counts",
    "relationships",
    "value_distributions",
    "boolean_distributions",
    "revision_distributions",
    "timestamp_ranges",
    "length_buckets",
    "file_size_buckets",
}


class WrapperError(RuntimeError):
    """表示 wrapper 合同失败；对外只报告异常类型。"""


class ProducerFailed(WrapperError):
    """表示 profiler process 非零退出。"""


class ProfileContractMismatch(WrapperError):
    """表示 profiler 成功 JSON 不满足冻结合同。"""


class SafeArgumentParser(argparse.ArgumentParser):
    """将参数错误纳入安全 JSON 失败边界。"""

    def error(self, message: str) -> Never:
        raise ProfileContractMismatch from None


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    document: dict[str, Any] = {}
    for key, value in pairs:
        if key in document:
            raise ProfileContractMismatch
        document[key] = value
    return document


def _require_document(value: object, expected_run_id: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != TOP_LEVEL_KEYS:
        raise ProfileContractMismatch
    artifacts = value.get("artifacts")
    expected = {
        "command": "profile",
        "status": "passed",
        "shape_version": "production-snapshot-profile-v1",
        "stage": "source",
        "run_id": expected_run_id,
        "schema_revision": "0043_geo_platform_identity",
        "schema_signature": SCHEMA_SIGNATURE,
        "snapshot_bound": True,
        "default_transaction_read_only": True,
        "transaction_read_only": True,
        "transaction_isolation": "repeatable read",
        "object_payload_copied": 0,
        "profile_contract_sha256": PROFILE_CONTRACT_SHA256,
    }
    if any(
        value.get(key) != expected_value for key, expected_value in expected.items()
    ):
        raise ProfileContractMismatch
    profile = value["profile"]
    if (
        artifacts
        != {
            "matrix_sha256": MATRIX_SHA256,
            "sanitizer_commit": "217d011c",
            "sanitizer_sha256": SANITIZER_SHA256,
        }
        or not isinstance(profile, dict)
        or set(profile) != PROFILE_KEYS
    ):
        raise ProfileContractMismatch
    return value


def _parse_source_context(raw: bytes, expected_run_id: str) -> dict[str, str]:
    if not raw or len(raw) > SOURCE_CONTEXT_LIMIT_BYTES:
        raise ProfileContractMismatch
    try:
        value = json.loads(
            raw.decode("utf-8"), object_pairs_hook=_reject_duplicate_keys
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProfileContractMismatch from error
    expected_role = f"pss_export_{expected_run_id.removeprefix('pss_')}"
    if (
        not isinstance(value, dict)
        or set(value) != SOURCE_CONTEXT_KEYS
        or value.get("run_id") != expected_run_id
        or value.get("database") != SOURCE_DATABASE
        or value.get("role") != expected_role
        or not isinstance(value.get("snapshot_id"), str)
        or SNAPSHOT_ID.fullmatch(value["snapshot_id"]) is None
    ):
        raise ProfileContractMismatch
    return {key: value[key] for key in SOURCE_CONTEXT_KEYS}


def _producer_environment(source_context: dict[str, str]) -> dict[str, str]:
    run_id = source_context["run_id"]
    role = source_context["role"]
    database = source_context["database"]
    return {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "PGAPPNAME": f"{run_id}_profile",
        "PGOPTIONS": SOURCE_PGOPTIONS,
        "PGPASSFILE": "/dev/null",
        "PROFILE_RUN_ID": run_id,
        "SOURCE_EXPECTED_DATABASE": database,
        "SOURCE_SNAPSHOT_ID": source_context["snapshot_id"],
        "SOURCE_DATABASE_URL": (f"postgresql://{role}@127.0.0.1:5432/{database}"),
    }


def _write_atomic(output: Path, document: dict[str, Any]) -> None:
    partial = output.with_name(f"{output.name}.partial")
    if not output.parent.is_dir() or output.exists() or partial.exists():
        raise FileExistsError
    created = False
    try:
        descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        created = True
        with os.fdopen(descriptor, "w", encoding="utf-8") as target:
            json.dump(document, target, sort_keys=True, separators=(",", ":"))
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.replace(partial, output)
    except Exception:
        if created and partial.exists():
            partial.unlink()
        raise


def _run(
    expected_run_id: str,
    output: Path,
    producer: list[str],
    source_context: dict[str, str],
) -> dict[str, object]:
    if RUN_ID.fullmatch(expected_run_id) is None or not producer:
        raise ProfileContractMismatch
    completed = subprocess.run(
        producer,
        check=False,
        capture_output=True,
        env=_producer_environment(source_context),
        timeout=PRODUCER_TIMEOUT_SECONDS,
    )
    if completed.returncode != 0:
        raise ProducerFailed
    try:
        parsed = json.loads(
            completed.stdout.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_keys,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProfileContractMismatch from error
    document = _require_document(parsed, expected_run_id)
    _write_atomic(output, document)
    return {
        "command": "profile-wrapper",
        "status": "passed",
        "run_id": expected_run_id,
        "output_written": True,
        "checks": {
            "producer_exit_zero": True,
            "json_unique_keys": True,
            "top_level_shape": True,
            "identity": True,
            "readonly": True,
            "artifact_identity": True,
            "profile_shape": True,
            "atomic_write": True,
        },
        "profile_contract_sha256": PROFILE_CONTRACT_SHA256,
        "object_payload_copied": 0,
    }


def _read_handoff_artifact(
    input_path: Path, expected_run_id: str, *, enforce_canonical_path: bool = True
) -> bytes:
    """在容器内校验并读取 profile，供 exec 流式交接给 host。"""
    if enforce_canonical_path and input_path != SOURCE_PROFILE_PATH:
        raise ProfileContractMismatch
    try:
        descriptor = os.open(input_path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise ProfileContractMismatch from error
    with os.fdopen(descriptor, "rb") as source:
        metadata = os.fstat(source.fileno())
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or metadata.st_mode & 0o777 != 0o600
            or metadata.st_size > MAX_SOURCE_PROFILE_BYTES
        ):
            raise ProfileContractMismatch
        artifact = source.read(MAX_SOURCE_PROFILE_BYTES + 1)
    if len(artifact) != metadata.st_size:
        raise ProfileContractMismatch
    try:
        document = json.loads(
            artifact.decode("utf-8"), object_pairs_hook=_reject_duplicate_keys
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProfileContractMismatch from error
    if RUN_ID.fullmatch(expected_run_id) is None:
        raise ProfileContractMismatch
    _require_document(document, expected_run_id)
    return artifact


def _self_check() -> dict[str, object]:
    run_id = "pss_20990101_01"
    document: dict[str, Any] = {
        "command": "profile",
        "status": "passed",
        "shape_version": "production-snapshot-profile-v1",
        "stage": "source",
        "run_id": run_id,
        "schema_revision": "0043_geo_platform_identity",
        "schema_signature": SCHEMA_SIGNATURE,
        "snapshot_bound": True,
        "default_transaction_read_only": True,
        "transaction_read_only": True,
        "transaction_isolation": "repeatable read",
        "object_payload_copied": 0,
        "profile_contract_sha256": PROFILE_CONTRACT_SHA256,
        "artifacts": {
            "matrix_sha256": MATRIX_SHA256,
            "sanitizer_commit": "217d011c",
            "sanitizer_sha256": SANITIZER_SHA256,
        },
        "profile": {key: {} for key in PROFILE_KEYS},
    }
    encoded_source_context = json.dumps(
        {
            "database": SOURCE_DATABASE,
            "role": "pss_export_20990101_01",
            "run_id": run_id,
            "snapshot_id": "00000000-00000000-1",
        },
        separators=(",", ":"),
    )
    source_context = _parse_source_context(encoded_source_context.encode(), run_id)
    for rejected_context in (
        encoded_source_context.replace(
            '"database":"partsignal"',
            '"database":"partsignal","database":"partsignal"',
            1,
        ),
        encoded_source_context[:-1] + ',"unexpected":true}',
    ):
        try:
            _parse_source_context(rejected_context.encode(), run_id)
        except ProfileContractMismatch:
            pass
        else:
            raise AssertionError("source context 漂移未被拒绝")
    with tempfile.TemporaryDirectory() as directory:
        base = Path(directory)
        output = base / "source-profile.json"
        encoded = json.dumps(document, sort_keys=True, separators=(",", ":"))
        producer = [sys.executable, "-c", "import sys; print(sys.argv[1])", encoded]
        result = _run(run_id, output, producer, source_context)
        checks = result.get("checks")
        if not isinstance(checks, dict) or not all(checks.values()):
            raise AssertionError("wrapper 成功断言未全部通过")
        if output.stat().st_mode & 0o777 != 0o600:
            raise AssertionError("profile mode 不是 0600")
        _require_document(
            json.loads(output.read_text(), object_pairs_hook=_reject_duplicate_keys),
            run_id,
        )

        # docker cp 由 daemon 侧读取 rootfs，不能作为 /tmp tmpfs 的持久化合同。
        # 用一个不含 tmpfs 挂载内容的可见视图复现旧失败，再验证 exec 流式读取。
        visible_root = base / "daemon-visible-root"
        visible_root.mkdir()
        if (visible_root / "tmp" / output.name).exists():
            raise AssertionError("daemon 可见视图意外包含 tmpfs artifact")
        try:
            (visible_root / "tmp" / output.name).read_bytes()
        except FileNotFoundError:
            legacy_mount_copy_missing = True
        else:
            raise AssertionError("旧 docker cp mount 边界失败未复现")
        if not legacy_mount_copy_missing:
            raise AssertionError("旧 handoff 失败复现未通过")
        streamed_artifact = _read_handoff_artifact(
            output, run_id, enforce_canonical_path=False
        )
        if streamed_artifact != output.read_bytes():
            raise AssertionError("exec 流式 handoff 未保持 artifact 字节")
        symlinked_output = base / "source-profile-link.json"
        symlinked_output.symlink_to(output)
        for rejected_handoff in (
            (output, "pss_20990101_02", False),
            (base / "other-profile.json", run_id, False),
            (symlinked_output, run_id, False),
        ):
            try:
                _read_handoff_artifact(
                    rejected_handoff[0],
                    rejected_handoff[1],
                    enforce_canonical_path=rejected_handoff[2],
                )
            except WrapperError:
                pass
            else:
                raise AssertionError("handoff identity/path 漂移未被拒绝")

        rejected_inputs = {
            "producer-nonzero": [sys.executable, "-c", "raise SystemExit(2)"],
            "duplicate-key": [
                sys.executable,
                "-c",
                "import sys; print(sys.argv[1])",
                encoded.replace(
                    '"command":"profile"',
                    '"command":"profile","command":"profile"',
                    1,
                ),
            ],
            "extra-key": [
                sys.executable,
                "-c",
                "import sys; print(sys.argv[1])",
                json.dumps(document | {"unexpected": True}),
            ],
        }
        for name, rejected_producer in rejected_inputs.items():
            rejected_output = base / f"{name}.json"
            try:
                _run(run_id, rejected_output, rejected_producer, source_context)
            except WrapperError:
                pass
            else:
                raise AssertionError(f"{name} 未被拒绝")
            if (
                rejected_output.exists()
                or rejected_output.with_name(f"{rejected_output.name}.partial").exists()
            ):
                raise AssertionError(f"{name} 留下了输出")
    return {
        "command": "self-check",
        "status": "passed",
        "producer_started": True,
        "producer_scope": "local-only",
        "database_connected": False,
        "legacy_mount_copy_missing": True,
        "artifact_handoff_stream": True,
    }


def main() -> int:
    """执行固定 wrapper 或纯本地 self-check，并只输出安全 JSON。"""
    parser = SafeArgumentParser(add_help=False)
    subparsers = parser.add_subparsers(dest="command", required=True)
    run_parser = subparsers.add_parser("run", add_help=False)
    run_parser.add_argument("--expected-run-id", required=True)
    run_parser.add_argument("--output", required=True, type=Path)
    run_parser.add_argument("producer", nargs=argparse.REMAINDER)
    handoff_parser = subparsers.add_parser("handoff", add_help=False)
    handoff_parser.add_argument("--expected-run-id", required=True)
    handoff_parser.add_argument("--input", required=True, type=Path)
    subparsers.add_parser("self-check", add_help=False)
    try:
        arguments = parser.parse_args()
        if arguments.command == "run":
            producer = list(arguments.producer)
            if producer[:1] == ["--"]:
                producer = producer[1:]
            source_context = _parse_source_context(
                sys.stdin.buffer.read(SOURCE_CONTEXT_LIMIT_BYTES + 1),
                arguments.expected_run_id,
            )
            result = _run(
                arguments.expected_run_id,
                arguments.output,
                producer,
                source_context,
            )
        elif arguments.command == "handoff":
            sys.stdout.buffer.write(
                _read_handoff_artifact(arguments.input, arguments.expected_run_id)
            )
            sys.stdout.buffer.flush()
            return 0
        else:
            result = _self_check()
        print(json.dumps(result, sort_keys=True))
        return 0
    except (
        Exception
    ) as error:  # 安全边界：禁止展开 producer 输出、路径或 profile 内容。
        print(
            json.dumps(
                {
                    "command": "profile-wrapper",
                    "status": "failed",
                    "error_type": type(error).__name__,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
