"""校验 Phase B 逐 operation response 权威矩阵。

该工具只属于当前 Trellis Task，不参与产品运行时、代码生成或长期 CI。矩阵必须
能由当前 route/dependency/service 调用图重新证明，不能把冻结合同或通用错误构造器
当作行为权威。
"""

from __future__ import annotations

import argparse
import ast
import copy
import hashlib
import inspect
import json
import re
import subprocess
import sys
import textwrap
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import ModuleType
from typing import Any, Callable

import yaml


ROOT = Path(__file__).resolve().parents[4]
TASK_DIR = ROOT / ".trellis/tasks/09-01-frozen-contract-authority-reconciliation/research"
MATRIX_PATH = TASK_DIR / "final-response-authority-matrix.jsonl"
RECORD_PATH = TASK_DIR / "authority-matrix-validation.json"
VERIFIER_PATH = TASK_DIR / "verify_authority_matrix.py"
PRODUCT_OWNED = {
    "backend/tests/unit/test_contract.py",
    "contracts/openapi.yaml",
    "frontend/src/shared/api/generated/schema.d.ts",
}
SOURCE_ROOTS = (
    "backend/app",
    "backend/tests",
    "contracts/openapi.yaml",
    "frontend/src/shared/api/generated/schema.d.ts",
)
HTTP_METHODS = {"delete", "get", "patch", "post", "put"}
ERROR_STATUSES = {"401", "403", "404", "409", "422", "502", "503", "504"}
STATUS_EVIDENCE_KINDS = {
    "dependency",
    "handler",
    "provider",
    "route",
    "service",
    "storage",
}
METADATA_FIELDS = {
    "record_type",
    "schema_version",
    "source_revision",
    "authoritative_worktree_clean",
    "audited_at",
    "operation_count",
    "status_authority",
}
ROW_FIELDS = {
    "path",
    "method",
    "operationId",
    "current_contract_statuses",
    "phase_b_statuses",
    "release_statuses_after_phase_x",
    "status_evidence",
    "validation_source",
    "response_shape_notes",
    "phase_x_request_id",
    "cookie_sentinel",
}
EVIDENCE_FIELDS = {
    "route_connection",
    "owner_symbol",
    "source_kind",
    "throw_or_transform",
    "escape_or_transform",
    "evidence",
    "sentinel_or_test",
}
VALIDATION_FIELDS = {"kind", "inputs", "handler", "transform"}
VALIDATION_INPUT_FIELDS = {"location", "name", "owner_symbol", "evidence"}
PHASE_X_FIELDS = {"request_header", "invalid_value_400", "response_header"}
REQUEST_HEADER_FIELDS = {"name", "required", "evidence"}
INVALID_HEADER_FIELDS = {"status", "evidence"}
RESPONSE_HEADER_FIELDS = {"name", "required", "statuses", "evidence"}
PHASE_X_REQUEST_EVIDENCE = "backend/app/main.py:57"
PHASE_X_INVALID_EVIDENCE = "backend/app/main.py:64"
PHASE_X_RESPONSE_EVIDENCE = "backend/app/main.py:76"
VALIDATION_HANDLER_EVIDENCE = "backend/app/errors.py:51"
AUTH_EVIDENCE = "backend/app/deps.py:38"
PASSWORD_GATE_EVIDENCE = "backend/app/deps.py:57"
CSRF_EVIDENCE = "backend/app/deps.py:102"
ACCOUNT_TYPE_EVIDENCE = "backend/app/deps.py:111"
COOKIE_SENTINELS = {
    "login": {
        "route_connection": "backend/app/routers/identity.py:103",
        "production_anchors": [
            "backend/app/routers/identity.py:106",
            "backend/app/routers/identity.py:115",
        ],
    },
    "logout": {
        "route_connection": "backend/app/routers/identity.py:127",
        "production_anchors": [
            "backend/app/routers/identity.py:135",
            "backend/app/routers/identity.py:136",
        ],
    },
}
ALLOWED_TEMP_PASSWORD_ROUTES = {
    ("/api/v1/auth/change-password", "post"),
    ("/api/v1/auth/csrf", "get"),
    ("/api/v1/auth/logout", "post"),
    ("/api/v1/auth/me", "get"),
}
GENERATION_UNIONS = {
    "GenerationJobDetail.input_snapshot": (
        "LegacyGenerationSnapshot",
        "MarkdownGenerationSnapshotV2",
        "GenerationSnapshot",
        "LegacyHumanizationSnapshot",
        "HumanizationSnapshot",
    ),
    "GenerationTrace.input_snapshot": (
        "LegacyGenerationSnapshot",
        "MarkdownGenerationSnapshotV2",
        "GenerationSnapshot",
    ),
    "HumanizationTrace.input_snapshot": (
        "LegacyHumanizationSnapshot",
        "HumanizationSnapshot",
    ),
}


@dataclass(frozen=True)
class Authority:
    """一个能从 operation 边界到达的状态来源。"""

    status: str
    owner_symbol: str
    source_kind: str
    evidence: str
    throw_or_transform: str
    escape_or_transform: str = "escaped_to_http"


def operation_map(document: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    """取得唯一的 HTTP operation；重复 path/method 必须显式失败。"""
    result: dict[tuple[str, str], dict[str, Any]] = {}
    paths = document.get("paths")
    if not isinstance(paths, dict):
        raise ValueError("OpenAPI paths 必须是对象")
    for path, path_item in paths.items():
        if not isinstance(path, str) or not isinstance(path_item, dict):
            raise ValueError("OpenAPI path item 无效")
        for method, operation in path_item.items():
            if method not in HTTP_METHODS:
                continue
            if not isinstance(operation, dict):
                raise ValueError(f"{method} {path} operation 必须是对象")
            key = (path, method)
            if key in result:
                raise ValueError(f"OpenAPI operation 重复: {key}")
            result[key] = operation
    return result


def identity(row: dict[str, Any]) -> tuple[str, str, str]:
    """返回矩阵稳定身份。"""
    return (row["path"], row["method"], row["operationId"])


def read_matrix(path: Path = MATRIX_PATH) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """读取严格 JSONL；空行也视为不稳定序列化。"""
    raw_lines = path.read_text(encoding="utf-8").splitlines()
    if not raw_lines or any(not line.strip() for line in raw_lines):
        raise ValueError("权威矩阵为空或包含空行")
    parsed = [json.loads(line) for line in raw_lines]
    if not all(isinstance(item, dict) for item in parsed):
        raise ValueError("权威矩阵每行必须是 JSON 对象")
    return parsed[0], parsed[1:]


def _exact_fields(value: object, expected: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        actual = sorted(value) if isinstance(value, dict) else type(value).__name__
        raise ValueError(f"{label} 字段不精确: {actual}")
    return value


def _status_list(value: object, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{label} 必须是非空 status 数组")
    if not all(isinstance(status, str) and re.fullmatch(r"[1-5][0-9]{2}", status) for status in value):
        raise ValueError(f"{label} 包含无效 status")
    if value != sorted(set(value), key=int):
        raise ValueError(f"{label} 必须去重并按数值排序")
    return value


def _validate_file_line(value: object, label: str) -> str:
    """只接受仓库内相对 file:line，拒绝绝对路径和目录穿越。"""
    if not isinstance(value, str) or ":" not in value:
        raise ValueError(f"{label} 缺少 file:line 证据")
    path_text, line_text = value.rsplit(":", 1)
    candidate = Path(path_text)
    if candidate.is_absolute() or ".." in candidate.parts or "\\" in path_text:
        raise ValueError(f"{label} 必须是仓库内 POSIX 相对路径")
    if not line_text.isdigit() or int(line_text) < 1:
        raise ValueError(f"{label} 行号无效")
    path = (ROOT / candidate).resolve()
    try:
        path.relative_to(ROOT)
    except ValueError as error:
        raise ValueError(f"{label} 路径逃逸仓库") from error
    if not path.is_file():
        raise ValueError(f"{label} 文件不存在: {path_text}")
    if int(line_text) > len(path.read_text(encoding="utf-8").splitlines()):
        raise ValueError(f"{label} 行号超出文件范围")
    return value


def _validate_cookie_schema(row: dict[str, Any]) -> None:
    cookie = row["cookie_sentinel"]
    operation_id = row["operationId"]
    if operation_id not in {"login", "logout"}:
        if cookie != {"sentinel_status": "not_applicable"}:
            raise ValueError(f"{identity(row)} cookie_sentinel 非预期")
        return
    _exact_fields(
        cookie,
        {"sentinel_status", "route_connection", "production_anchors"},
        f"{identity(row)} cookie_sentinel",
    )
    if cookie["sentinel_status"] != "missing_deferred_to_phase_x":
        raise ValueError(f"{identity(row)} Set-Cookie sentinel 必须延后到 Phase X")
    _validate_file_line(cookie["route_connection"], f"{identity(row)} cookie route")
    anchors = cookie["production_anchors"]
    if not isinstance(anchors, list) or len(anchors) != 2:
        raise ValueError(f"{identity(row)} 必须记录两个 Set-Cookie 生产锚点")
    for anchor in anchors:
        _validate_file_line(anchor, f"{identity(row)} cookie production")
    expected = COOKIE_SENTINELS[operation_id]
    if cookie["route_connection"] != expected["route_connection"]:
        raise ValueError(f"{identity(row)} cookie route 未指向真实 endpoint")
    if anchors != expected["production_anchors"]:
        raise ValueError(f"{identity(row)} cookie 生产锚点未指向真实 set/delete_cookie")


def validate_matrix_schema(
    metadata: dict[str, Any], rows: list[dict[str, Any]], expected: int = 162
) -> None:
    """严格校验 JSONL schema，不接受额外字段、宽松类型或隐式默认。"""
    _exact_fields(metadata, METADATA_FIELDS, "metadata")
    if metadata["record_type"] != "metadata" or metadata["schema_version"] != "2.0":
        raise ValueError("metadata record_type/schema_version 无效")
    if metadata["authoritative_worktree_clean"] is not True:
        raise ValueError("matrix 未声明 authoritative_worktree_clean=true")
    if not isinstance(metadata["source_revision"], str) or not re.fullmatch(
        r"[0-9a-f]{40}", metadata["source_revision"]
    ):
        raise ValueError("matrix source_revision 必须是完整小写 SHA")
    if not isinstance(metadata["audited_at"], str):
        raise ValueError("matrix audited_at 必须是字符串")
    try:
        audited_at = datetime.fromisoformat(metadata["audited_at"])
    except ValueError as error:
        raise ValueError("matrix audited_at 不是 ISO 时间") from error
    if audited_at.tzinfo is None:
        raise ValueError("matrix audited_at 必须包含时区")
    if metadata["operation_count"] != expected or len(rows) != expected:
        raise ValueError(f"matrix operation 数量不是 {expected}")
    if not isinstance(metadata["status_authority"], str) or not metadata["status_authority"].strip():
        raise ValueError("matrix status_authority 为空")

    identities: list[tuple[str, str, str]] = []
    for index, row in enumerate(rows, start=2):
        _exact_fields(row, ROW_FIELDS, f"matrix 第 {index} 行")
        if not all(isinstance(row[field], str) and row[field] for field in ("path", "method", "operationId")):
            raise ValueError(f"matrix 第 {index} 行 identity 无效")
        if row["method"] not in HTTP_METHODS or not row["path"].startswith("/"):
            raise ValueError(f"{identity(row)} path/method 无效")
        identities.append(identity(row))
        current = _status_list(row["current_contract_statuses"], f"{identity(row)} current")
        phase = _status_list(row["phase_b_statuses"], f"{identity(row)} phase_b")
        release = _status_list(row["release_statuses_after_phase_x"], f"{identity(row)} release")
        if "400" in phase or set(release) != set(phase) | {"400"}:
            raise ValueError(f"{identity(row)} Phase X release status 分层无效")

        evidence = row["status_evidence"]
        if not isinstance(evidence, dict) or set(evidence) != set(phase):
            raise ValueError(f"{identity(row)} status evidence 与 phase_b 不精确一致")
        for status, item in evidence.items():
            _exact_fields(item, EVIDENCE_FIELDS, f"{identity(row)} status {status} evidence")
            if item["source_kind"] not in STATUS_EVIDENCE_KINDS:
                raise ValueError(f"{identity(row)} status {status} source_kind 无效")
            for field in ("owner_symbol", "throw_or_transform", "escape_or_transform"):
                if not isinstance(item[field], str) or not item[field].strip():
                    raise ValueError(f"{identity(row)} status {status} 缺少 {field}")
            _validate_file_line(item["route_connection"], f"{identity(row)} route_connection")
            _validate_file_line(item["evidence"], f"{identity(row)} status {status}")
            _validate_file_line(item["sentinel_or_test"], f"{identity(row)} status {status} corroboration")
            if status in {"404", "409"} and str(item["evidence"]).startswith("backend/app/errors.py:"):
                raise ValueError(f"{identity(row)} status {status} 不得以通用构造器作为实际证据")

        validation = _exact_fields(
            row["validation_source"], VALIDATION_FIELDS, f"{identity(row)} validation_source"
        )
        if validation["kind"] not in {"none", "route_parameter_or_body"}:
            raise ValueError(f"{identity(row)} validation_source.kind 无效")
        if not isinstance(validation["inputs"], list):
            raise ValueError(f"{identity(row)} validation_source.inputs 必须是数组")
        for input_item in validation["inputs"]:
            _exact_fields(input_item, VALIDATION_INPUT_FIELDS, f"{identity(row)} validation input")
            if input_item["location"] not in {"path", "query", "header", "cookie", "body"}:
                raise ValueError(f"{identity(row)} validation input location 无效")
            if not isinstance(input_item["name"], str) or not isinstance(input_item["owner_symbol"], str):
                raise ValueError(f"{identity(row)} validation input identity 无效")
            _validate_file_line(input_item["evidence"], f"{identity(row)} validation input")
        if "422" in phase:
            if (
                validation["kind"] != "route_parameter_or_body"
                or not validation["inputs"]
                or validation["handler"] != VALIDATION_HANDLER_EVIDENCE
                or not isinstance(validation["transform"], str)
                or not validation["transform"].strip()
            ):
                raise ValueError(f"{identity(row)} 422 缺少真实输入或 handler 转换证据")
        elif validation != {"kind": "none", "inputs": [], "handler": None, "transform": None}:
            raise ValueError(f"{identity(row)} 无 422 operation 不得保留 validation authority")

        notes = row["response_shape_notes"]
        if not isinstance(notes, list) or not notes or not all(
            isinstance(note, str) and note.strip() for note in notes
        ):
            raise ValueError(f"{identity(row)} response_shape_notes 无效")

        phase_x = _exact_fields(row["phase_x_request_id"], PHASE_X_FIELDS, f"{identity(row)} Phase X")
        request_header = _exact_fields(
            phase_x["request_header"], REQUEST_HEADER_FIELDS, f"{identity(row)} request header"
        )
        invalid = _exact_fields(
            phase_x["invalid_value_400"], INVALID_HEADER_FIELDS, f"{identity(row)} invalid header"
        )
        response_header = _exact_fields(
            phase_x["response_header"], RESPONSE_HEADER_FIELDS, f"{identity(row)} response header"
        )
        if request_header != {
            "name": "X-Request-ID",
            "required": False,
            "evidence": PHASE_X_REQUEST_EVIDENCE,
        }:
            raise ValueError(f"{identity(row)} request X-Request-ID 必须 optional 且有固定 owner")
        if invalid != {"status": "400", "evidence": PHASE_X_INVALID_EVIDENCE}:
            raise ValueError(f"{identity(row)} 非法 X-Request-ID 必须记录 middleware 400")
        if response_header != {
            "name": "X-Request-ID",
            "required": True,
            "statuses": release,
            "evidence": PHASE_X_RESPONSE_EVIDENCE,
        }:
            raise ValueError(f"{identity(row)} response X-Request-ID 与 release status 不一致")
        _validate_cookie_schema(row)
        del current

    if len(set(identities)) != expected:
        raise ValueError("matrix 存在重复 operation identity")
    if identities != sorted(identities):
        raise ValueError("matrix 未按 path、method、operationId 稳定排序")


def load_runtime() -> tuple[dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    """加载当前 FastAPI OpenAPI 与 operation map。"""
    from app.main import app

    document = app.openapi()
    return document, operation_map(document)


def load_contract(
    path: Path = ROOT / "contracts/openapi.yaml",
) -> tuple[dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    """加载文件合同。"""
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("OpenAPI 根节点必须是对象")
    return document, operation_map(document)


def git_output(*args: str) -> str:
    """执行只读 Git inventory 命令。"""
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, text=True, capture_output=True
    ).stdout.strip()


def validate_source_revision(
    metadata_revision: object, record_revision: object | None = None
) -> str:
    """把 matrix/record provenance 固定到当前 HEAD，拒绝合法但过期的提交。"""
    revisions = {"matrix": metadata_revision}
    if record_revision is not None:
        revisions["record"] = record_revision
    for owner, revision in revisions.items():
        if not isinstance(revision, str) or not re.fullmatch(r"[0-9a-f]{40}", revision):
            raise ValueError(f"{owner} source_revision 必须是完整小写 SHA")
    if record_revision is not None and record_revision != metadata_revision:
        raise ValueError("validation record source_revision 与 matrix 不一致")
    head_revision = git_output("rev-parse", "HEAD")
    if metadata_revision != head_revision:
        raise ValueError("matrix source_revision 与当前 HEAD 不一致")
    if record_revision is not None and record_revision != head_revision:
        raise ValueError("validation record source_revision 与当前 HEAD 不一致")
    return head_revision


def load_revision_contract(revision: str) -> tuple[dict[str, Any], dict[tuple[str, str], dict[str, Any]]]:
    """从 matrix source revision 读取实施前冻结合同。"""
    raw = git_output("show", f"{revision}:contracts/openapi.yaml")
    document = yaml.safe_load(raw)
    if not isinstance(document, dict):
        raise ValueError("source revision 中的冻结合同无效")
    return document, operation_map(document)


def runtime_routes() -> dict[tuple[str, str], Any]:
    """展开 FastAPI IncludedRouter，取得真实 route、endpoint 与 dependency 图。"""
    from app.main import app
    from fastapi.routing import APIRoute

    candidates: list[Any] = list(app.routes)
    for included in app.routes:
        router = getattr(included, "original_router", None)
        if router is not None:
            candidates.extend(router.routes)
    routes: dict[tuple[str, str], Any] = {}
    for route in candidates:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods or ():
            normalized = method.lower()
            if normalized not in HTTP_METHODS:
                continue
            key = (route.path, normalized)
            existing = routes.get(key)
            if existing is not None and existing.endpoint is not route.endpoint:
                raise ValueError(f"runtime route 重复且 endpoint 不同: {key}")
            routes[key] = route
    return routes


def _source_location(target: Callable[..., Any]) -> str:
    """返回 callable 的首个 decorator/定义行。"""
    source_file = inspect.getsourcefile(target)
    if source_file is None:
        raise ValueError(f"无法定位 callable: {target}")
    path = Path(source_file).resolve()
    try:
        relative = path.relative_to(ROOT)
    except ValueError as error:
        raise ValueError(f"callable 不在仓库内: {target}") from error
    _, start = inspect.getsourcelines(target)
    return f"{relative.as_posix()}:{start}"


def _callable_name(target: object) -> str:
    return str(getattr(target, "__name__", target.__class__.__name__))


def _parameter_evidence(target: Callable[..., Any], name: str) -> str:
    """定位真实函数签名中的参数名，避免只记录自动 422 metadata。"""
    source_file = inspect.getsourcefile(target)
    if source_file is None:
        raise ValueError(f"无法定位 validation owner: {target}")
    lines, start = inspect.getsourcelines(target)
    function_seen = False
    pattern = re.compile(rf"\b{re.escape(name)}\b")
    for offset, line in enumerate(lines):
        if re.search(r"\b(?:async\s+def|def)\b", line):
            function_seen = True
        if function_seen and pattern.search(line):
            path = Path(source_file).resolve().relative_to(ROOT).as_posix()
            return f"{path}:{start + offset}"
    raise ValueError(f"{_callable_name(target)} 找不到 validation 参数 {name}")


def _dependants(route: Any) -> list[Any]:
    result: list[Any] = []

    def walk(dependant: Any) -> None:
        result.append(dependant)
        for child in dependant.dependencies:
            walk(child)

    walk(route.dependant)
    return result


def route_dependency_names(route: Any) -> set[str]:
    """递归取得 route 实际依赖 callable 名称。"""
    return {_callable_name(node.call) for node in _dependants(route) if node.call is not None}


def expected_validation_inputs(route: Any) -> list[dict[str, str]]:
    """从 route/dependency 的真实 path/query/header/cookie/body 字段建立 422 owner。"""
    fields = (
        ("path", "path_params"),
        ("query", "query_params"),
        ("header", "header_params"),
        ("cookie", "cookie_params"),
        ("body", "body_params"),
    )
    inputs: dict[tuple[str, str, str, str], dict[str, str]] = {}
    for dependant in _dependants(route):
        owner = dependant.call
        if not callable(owner):
            continue
        try:
            source_file = inspect.getsourcefile(owner)
        except TypeError:
            source_file = None
        if source_file is None:
            continue
        owner_name = _callable_name(owner)
        for location, attribute in fields:
            for field in getattr(dependant, attribute):
                evidence = _parameter_evidence(owner, field.name)
                wire_name = field.alias
                if not isinstance(wire_name, str) or not wire_name:
                    raise ValueError(
                        f"{owner_name} validation 参数 {field.name} 缺少 wire alias"
                    )
                key = (location, wire_name, owner_name, evidence)
                inputs[key] = {
                    "location": location,
                    "name": wire_name,
                    "owner_symbol": owner_name,
                    "evidence": evidence,
                }
    return [inputs[key] for key in sorted(inputs)]


def _function_source(target: Callable[..., Any]) -> tuple[Path, int, ast.AST] | None:
    source_file = inspect.getsourcefile(target)
    if source_file is None:
        return None
    path = Path(source_file).resolve()
    app_root = (ROOT / "backend/app").resolve()
    if app_root not in path.parents:
        return None
    try:
        lines, start = inspect.getsourcelines(target)
        tree = ast.parse(textwrap.dedent("".join(lines)))
    except (OSError, TypeError, SyntaxError):
        return None
    function = next(
        (node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))),
        None,
    )
    if function is None:
        return None
    return path, start, function


def _resolve_call(target: Callable[..., Any], node: ast.expr) -> object | None:
    globals_map = getattr(target, "__globals__", {})
    if isinstance(node, ast.Name):
        return globals_map.get(node.id)
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        base = globals_map.get(node.value.id)
        if isinstance(base, ModuleType):
            return getattr(base, node.attr, None)
    return None


def _caught_app_error(node: ast.Try) -> bool:
    for handler in node.handlers:
        if handler.type is None:
            return True
        types = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
        names = {item.id for item in types if isinstance(item, ast.Name)}
        if names & {"AppError", "Exception", "BaseException"}:
            return True
    return False


def _app_error_status(target: Callable[..., Any], call: ast.Call) -> str | None:
    expression = call.args[2] if len(call.args) >= 3 else next(
        (keyword.value for keyword in call.keywords if keyword.arg == "status_code"), None
    )
    if isinstance(expression, ast.Constant) and isinstance(expression.value, int):
        return str(expression.value)
    if expression is None:
        return None
    try:
        value = eval(  # noqa: S307 - 只求值已解析的受信任仓库源码常量。
            compile(ast.Expression(expression), "<authority-matrix>", "eval"),
            target.__globals__,
        )
    except (AttributeError, NameError, TypeError, ValueError):
        return None
    return str(value) if isinstance(value, int) else None


def _source_kind(path: Path) -> str:
    relative = path.relative_to(ROOT).as_posix()
    if relative == "backend/app/main.py" or "/routers/" in relative:
        return "route"
    if relative.endswith("/pinned_http.py") or relative.endswith("/openai_client.py"):
        return "provider"
    if relative.endswith("/storage.py"):
        return "storage"
    return "service"


def reachable_error_authorities(endpoint: Callable[..., Any]) -> list[Authority]:
    """递归解析 route 的显式函数调用，跳过已捕获并转换的 AppError try body。"""
    found: list[Authority] = []
    visited: set[Callable[..., Any]] = set()

    def visit(target: Callable[..., Any]) -> None:
        if target in visited:
            return
        visited.add(target)
        source = _function_source(target)
        if source is None:
            return
        path, start, function = source
        relative = path.relative_to(ROOT).as_posix()

        def scan(nodes: list[ast.AST]) -> None:
            for node in nodes:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if isinstance(node, ast.Lambda):
                    scan([node.body])
                    continue
                if isinstance(node, ast.Try):
                    if not _caught_app_error(node):
                        scan(node.body)
                    scan(node.handlers)
                    scan(node.orelse)
                    scan(node.finalbody)
                    continue
                if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
                    call = node.exc
                    name = (
                        call.func.id
                        if isinstance(call.func, ast.Name)
                        else call.func.attr
                        if isinstance(call.func, ast.Attribute)
                        else ""
                    )
                    status = None
                    if name == "AppError":
                        status = _app_error_status(target, call)
                    elif name == "not_found":
                        status = "404"
                    elif name == "in_use":
                        status = "409"
                    if status in {"404", "409", "503"}:
                        found.append(
                            Authority(
                                status=status,
                                owner_symbol=_callable_name(target),
                                source_kind=_source_kind(path),
                                evidence=f"{relative}:{start + node.lineno - 1}",
                                throw_or_transform=(
                                    f"{_callable_name(target)} 的显式业务分支抛出 {status}，"
                                    "沿当前调用链逃逸到 AppError handler。"
                                ),
                            )
                        )
                    else:
                        resolved = _resolve_call(target, call.func)
                        if inspect.isfunction(resolved):
                            visit(resolved)
                if isinstance(node, ast.Call):
                    name = (
                        node.func.id
                        if isinstance(node.func, ast.Name)
                        else node.func.attr
                        if isinstance(node.func, ast.Attribute)
                        else ""
                    )
                    if name not in {"AppError", "in_use", "not_found"}:
                        resolved = _resolve_call(target, node.func)
                        if inspect.isfunction(resolved):
                            visit(resolved)
                for field_name, value in ast.iter_fields(node):
                    if isinstance(node, ast.Try) and field_name in {
                        "body",
                        "handlers",
                        "orelse",
                        "finalbody",
                    }:
                        continue
                    if isinstance(value, list):
                        scan([item for item in value if isinstance(item, ast.AST)])
                    elif isinstance(value, ast.AST):
                        scan([value])

        scan(list(function.body))

    visit(endpoint)
    unique: dict[tuple[str, str, str], Authority] = {}
    for authority in found:
        unique[(authority.status, authority.owner_symbol, authority.evidence)] = authority
    return [unique[key] for key in sorted(unique)]


def _fixed_authority(
    status: str,
    owner_symbol: str,
    source_kind: str,
    evidence: str,
    text: str,
    *,
    escape: str = "escaped_to_http",
) -> Authority:
    return Authority(status, owner_symbol, source_kind, evidence, text, escape)


def expected_status_authorities(
    runtime_ops: dict[tuple[str, str], dict[str, Any]], routes: dict[tuple[str, str], Any]
) -> dict[tuple[str, str], dict[str, list[Authority]]]:
    """从当前 route/dependency/service owner 计算每个 operation 的 Phase B status。"""
    result: dict[tuple[str, str], dict[str, list[Authority]]] = {}
    for key, route in routes.items():
        operation = runtime_ops[key]
        route_anchor = _source_location(route.endpoint)
        route_owner = _callable_name(route.endpoint)
        authorities: dict[str, list[Authority]] = {}
        for status in sorted(
            (str(value) for value in operation.get("responses", {})), key=int
        ):
            if status.startswith("2"):
                authorities[status] = [
                    _fixed_authority(
                        status,
                        route_owner,
                        "route",
                        route_anchor,
                        f"{route_owner} 的 route decorator/返回路径声明并产生 {status}。",
                        escape="returned_success",
                    )
                ]

        dependency_names = route_dependency_names(route)
        if route.operation_id == "login":
            authorities["401"] = [
                _fixed_authority(
                    "401",
                    "login",
                    "service",
                    "backend/app/services/identity.py:339",
                    "identity.login 对不存在、停用或密码不匹配的凭据抛出 AUTH_REQUIRED 401。",
                )
            ]
        elif {"get_current_session", "get_optional_current_session"} & dependency_names:
            authorities["401"] = [
                _fixed_authority(
                    "401",
                    "_resolve_current_session",
                    "dependency",
                    AUTH_EVIDENCE,
                    (
                        "CurrentSession 严格拒绝缺失/失效 Cookie；OptionalCurrentSession 仅在 Cookie "
                        "完全缺失时返回匿名，存在无效 Cookie 仍抛出 401。"
                    ),
                )
            ]

        static_authorities = reachable_error_authorities(route.endpoint)
        for authority in static_authorities:
            authorities.setdefault(authority.status, []).append(authority)

        if route.operation_id == "completeFileUpload" and "503" in authorities:
            authorities["503"] = [
                _fixed_authority(
                    "503",
                    "complete_file_upload",
                    "storage",
                    "backend/app/services/file_records.py:137",
                    (
                        "complete_file_upload 将底层对象存储缺失结果转换为 "
                        "STORAGE_UNAVAILABLE 503。"
                    ),
                )
            ]

        if route.operation_id == "getAuditLog":
            authorities.pop("409", None)

        has_current_session = "get_current_session" in dependency_names
        if route.operation_id == "getCsrfToken":
            authorities["403"] = [
                _fixed_authority(
                    "403",
                    "get_csrf_token",
                    "route",
                    "backend/app/routers/identity.py:157",
                    "get_csrf_token 对缺失或不匹配的 CSRF Cookie 抛出 CSRF_INVALID 403。",
                )
            ]
        elif has_current_session and key not in ALLOWED_TEMP_PASSWORD_ROUTES:
            authorities["403"] = [
                _fixed_authority(
                    "403",
                    "_resolve_current_session",
                    "dependency",
                    PASSWORD_GATE_EVIDENCE,
                    "CurrentSession 临时密码 gate 对未完成改密的受保护 operation 抛出 403。",
                )
            ]
        elif "require_csrf" in dependency_names:
            authorities["403"] = [
                _fixed_authority(
                    "403",
                    "require_csrf",
                    "dependency",
                    CSRF_EVIDENCE,
                    "CsrfProtected 对缺失或不匹配的 X-CSRF-Token 抛出 403。",
                )
            ]
        elif "check" in dependency_names:
            authorities["403"] = [
                _fixed_authority(
                    "403",
                    "assert_account_types",
                    "dependency",
                    ACCOUNT_TYPE_EVIDENCE,
                    "角色依赖通过 assert_account_types 对不允许的账号类型抛出 403。",
                )
            ]

        validation_inputs = expected_validation_inputs(route)
        if validation_inputs:
            first = validation_inputs[0]
            source_kind = (
                "dependency"
                if first["evidence"].startswith("backend/app/deps.py:")
                else "route"
            )
            authorities["422"] = [
                _fixed_authority(
                    "422",
                    first["owner_symbol"],
                    source_kind,
                    first["evidence"],
                    "真实 path/query/header/cookie/body 输入解析失败后形成 RequestValidationError。",
                    escape="transformed_by_validation_error_handler",
                )
            ]

        if route.operation_id == "discoverAIChannelModels":
            authorities["502"] = [
                _fixed_authority(
                    "502",
                    "PinnedHTTPTransport.request",
                    "provider",
                    "backend/app/services/pinned_http.py:255",
                    "provider 网络/HTTP/响应错误形成 502；discover command 在 revision 复核后重新抛出。",
                )
            ]
            authorities["504"] = [
                _fixed_authority(
                    "504",
                    "PinnedHTTPTransport.request",
                    "provider",
                    "backend/app/services/pinned_http.py:253",
                    "provider TimeoutError 形成 504；discover command 在 revision 复核后重新抛出。",
                )
            ]

        if route.operation_id == "testAIModel":
            authorities.pop("502", None)
            authorities.pop("504", None)

        result[key] = authorities
    return result


def _authority_matches(item: dict[str, Any], authority: Authority) -> bool:
    return (
        item["owner_symbol"] == authority.owner_symbol
        and item["source_kind"] == authority.source_kind
        and item["evidence"] == authority.evidence
        and item["escape_or_transform"] == authority.escape_or_transform
    )


def validate_rows_against_sources(
    metadata: dict[str, Any],
    rows: list[dict[str, Any]],
    baseline_ops: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> None:
    """复算身份、current/phase/release、validation 和逐 status authority。"""
    validate_matrix_schema(metadata, rows)
    _, runtime_ops = load_runtime()
    routes = runtime_routes()
    if set(runtime_ops) != set(routes):
        raise ValueError("运行时 OpenAPI 与真实 route identity 不一致")
    if baseline_ops is None:
        _, baseline_ops = load_revision_contract(metadata["source_revision"])
    matrix_ids = {identity(row) for row in rows}
    runtime_ids = {
        (path, method, operation.get("operationId"))
        for (path, method), operation in runtime_ops.items()
    }
    baseline_ids = {
        (path, method, operation.get("operationId"))
        for (path, method), operation in baseline_ops.items()
    }
    if len(matrix_ids) != 162 or matrix_ids != runtime_ids or matrix_ids != baseline_ids:
        raise ValueError("基线、运行时与矩阵必须是完整 162 operation identity")

    expected = expected_status_authorities(runtime_ops, routes)
    for row in rows:
        key = (row["path"], row["method"])
        current = sorted((str(status) for status in baseline_ops[key]["responses"]), key=int)
        if row["current_contract_statuses"] != current:
            raise ValueError(f"{identity(row)} current_contract_statuses 与 source revision 不一致")
        expected_statuses = sorted(expected[key], key=int)
        if row["phase_b_statuses"] != expected_statuses:
            raise ValueError(
                f"{identity(row)} phase_b status 与调用图不一致: "
                f"matrix={row['phase_b_statuses']} source={expected_statuses}"
            )
        expected_release = sorted(set(expected_statuses) | {"400"}, key=int)
        if row["release_statuses_after_phase_x"] != expected_release:
            raise ValueError(f"{identity(row)} release status 与 Phase X 分层不一致")

        expected_inputs = expected_validation_inputs(routes[key])
        expected_validation = (
            {
                "kind": "route_parameter_or_body",
                "inputs": expected_inputs,
                "handler": VALIDATION_HANDLER_EVIDENCE,
                "transform": "RequestValidationError 由 validation_error_handler 转换为项目 ErrorResponse。",
            }
            if expected_inputs
            else {"kind": "none", "inputs": [], "handler": None, "transform": None}
        )
        if row["validation_source"] != expected_validation:
            raise ValueError(f"{identity(row)} validation_source 与真实 dependant 不一致")

        route_anchor = _source_location(routes[key].endpoint)
        for status, item in row["status_evidence"].items():
            if item["route_connection"] != route_anchor:
                raise ValueError(f"{identity(row)} status {status} route_connection 不指向真实 endpoint")
            if not any(_authority_matches(item, authority) for authority in expected[key][status]):
                raise ValueError(f"{identity(row)} status {status} owner/evidence 与调用图不一致")

    complete = next(row for row in rows if row["operationId"] == "completeFileUpload")
    if complete["phase_b_statuses"] != ["200", "401", "403", "404", "409", "422", "503"]:
        raise ValueError("completeFileUpload Phase B status 必须精确固定")
    audit = next(row for row in rows if row["operationId"] == "getAuditLog")
    if "409" in audit["phase_b_statuses"]:
        raise ValueError("getAuditLog 不得保留虚假 409")


def _operation_by_id(document: dict[str, Any], operation_id: str) -> dict[str, Any]:
    matches = [
        operation
        for operation in operation_map(document).values()
        if operation.get("operationId") == operation_id
    ]
    if len(matches) != 1:
        raise ValueError(f"operationId 不是唯一项: {operation_id}")
    return matches[0]


def _generation_union(schemas: dict[str, Any], target: str) -> dict[str, Any]:
    if target == "GenerationJobDetail.input_snapshot":
        detail = schemas.get("GenerationJobDetail", {})
        all_of = detail.get("allOf")
        if not isinstance(all_of, list) or len(all_of) != 2:
            raise ValueError("GenerationJobDetail 必须保留两段 allOf")
        return all_of[1].get("properties", {}).get("input_snapshot", {})
    schema_name, property_name = target.split(".", 1)
    return schemas.get(schema_name, {}).get("properties", {}).get(property_name, {})


def _references_schema(document: dict[str, Any], operation_id: str, schema_name: str) -> bool:
    operation = _operation_by_id(document, operation_id)
    success = next(
        response
        for status, response in operation["responses"].items()
        if str(status).startswith("2")
    )
    schemas = document["components"]["schemas"]
    seen_refs: set[str] = set()

    def walk(value: object) -> bool:
        if isinstance(value, dict):
            ref = value.get("$ref")
            if ref == f"#/components/schemas/{schema_name}":
                return True
            if isinstance(ref, str) and ref.startswith("#/components/schemas/") and ref not in seen_refs:
                seen_refs.add(ref)
                if walk(schemas.get(ref.rsplit("/", 1)[-1], {})):
                    return True
            return any(walk(item) for key, item in value.items() if key != "$ref")
        if isinstance(value, list):
            return any(walk(item) for item in value)
        return False

    return walk(success)


def validate_semantics(document: dict[str, Any], rows: list[dict[str, Any]]) -> None:
    """校验 Phase B 共享 schema、ErrorResponse 与 CSV 的精确公共语义。"""
    components = document.get("components")
    if not isinstance(components, dict) or not isinstance(components.get("schemas"), dict):
        raise ValueError("OpenAPI components.schemas 缺失")
    schemas = components["schemas"]
    if schemas.get("ErrorDetail", {}).get("required") != [
        "code",
        "message",
        "details",
        "request_id",
    ]:
        raise ValueError("ErrorDetail.required 必须精确包含四个字段")

    health = schemas.get("HealthResponse", {})
    if "checks" in health.get("required", []):
        raise ValueError("HealthResponse.checks 必须 optional")
    checks = health.get("properties", {}).get("checks", {})
    if checks.get("type") != ["object", "null"]:
        raise ValueError("HealthResponse.checks 必须允许 object 或 null")

    geo = schemas.get("ContentTaskDetailGeoOptimization", {}).get("properties", {}).get("basis", {})
    expected_mapping = {
        "CONTENT_DECLINE": "#/components/schemas/ContentTaskDetailGeoContentDeclineBasis",
        "LONG_UNMENTIONED": "#/components/schemas/ContentTaskDetailGeoLongUnmentionedBasis",
        "QUESTION_COVERAGE_GAP": (
            "#/components/schemas/ContentTaskDetailGeoQuestionCoverageBasis"
        ),
    }
    if geo.get("discriminator") != {
        "propertyName": "rule_code",
        "mapping": expected_mapping,
    }:
        raise ValueError("Content Task Geo basis 缺少精确 rule_code discriminator")
    for operation_id in ("getContentTaskDetail", "getContentEditorContext"):
        if not _references_schema(document, operation_id, "ContentTaskDetailGeoOptimization"):
            raise ValueError(f"{operation_id} 未连接到带 discriminator 的 Geo basis")

    for target, expected_names in GENERATION_UNIONS.items():
        union = _generation_union(schemas, target)
        if set(union) != {"anyOf"} or not isinstance(union["anyOf"], list):
            raise ValueError(f"{target} 必须精确使用 anyOf")
        actual_names = tuple(
            branch.get("$ref", "").rsplit("/", 1)[-1]
            for branch in union["anyOf"]
            if isinstance(branch, dict)
        )
        if actual_names != expected_names:
            raise ValueError(f"{target} 分支集合或顺序无效")
        literals: list[str] = []
        for name in actual_names:
            branch = schemas.get(name, {})
            if "contract_version" not in branch.get("required", []):
                raise ValueError(f"{target} 分支 {name} 未 required contract_version")
            literal = branch.get("properties", {}).get("contract_version", {}).get("const")
            if not isinstance(literal, str) or not literal:
                raise ValueError(f"{target} 分支 {name} 缺少 contract_version literal")
            literals.append(literal)
        if len(literals) != len(set(literals)):
            raise ValueError(f"{target} contract_version literal 必须唯一")

    for operation_id in ("exportPlatformProfiles", "exportUsers"):
        response = _operation_by_id(document, operation_id)["responses"]["200"]
        content = response.get("content", {})
        if set(content) != {"text/csv"} or content["text/csv"].get("schema") != {"type": "string"}:
            raise ValueError(f"{operation_id} 必须精确声明 text/csv string")
        header = response.get("headers", {}).get("Content-Disposition")
        if header != {"required": True, "schema": {"type": "string"}}:
            raise ValueError(f"{operation_id} Content-Disposition 必须是 required string")
        if "Content-Type" in response.get("headers", {}):
            raise ValueError(f"{operation_id} 不得重复声明 Content-Type header")

    for row in rows:
        operation = document["paths"][row["path"]][row["method"]]
        for status in row["phase_b_statuses"]:
            if status in ERROR_STATUSES and operation.get("responses", {}).get(status) != {
                "$ref": "#/components/responses/ErrorResponse"
            }:
                raise ValueError(f"{identity(row)} status {status} 必须引用统一 ErrorResponse")


def validate_contract_identity(
    rows: list[dict[str, Any]], contract_ops: dict[tuple[str, str], dict[str, Any]]
) -> None:
    """拒绝 contract extra/missing/operationId drift。"""
    matrix_ids = {identity(row) for row in rows}
    contract_ids = {
        (path, method, operation.get("operationId"))
        for (path, method), operation in contract_ops.items()
    }
    if len(contract_ids) != 162 or contract_ids != matrix_ids:
        raise ValueError("contract operation identity 存在 extra/missing/operationId drift")


def validate_contract_statuses(
    rows: list[dict[str, Any]], contract_ops: dict[tuple[str, str], dict[str, Any]]
) -> None:
    """要求根合同与 phase_b_statuses 逐 operation 精确一致。"""
    validate_contract_identity(rows, contract_ops)
    for row in rows:
        actual = sorted(
            (str(status) for status in contract_ops[(row["path"], row["method"])]["responses"]),
            key=int,
        )
        if actual != row["phase_b_statuses"]:
            raise ValueError(
                f"{identity(row)} 状态不一致: contract={actual} "
                f"matrix={row['phase_b_statuses']}"
            )


VALIDATION_RECORD_FIELDS = {
    "record_type",
    "schema_version",
    "source_revision",
    "matrix_sha256",
    "contract_sha256",
    "generated_client_sha256",
    "contract_test_sha256",
    "non_owned_source_hashes",
    "source_hashes",
    "contract_operation_count",
    "runtime_operation_count",
    "matrix_operation_count",
    "verifier_sha256",
}


def tracked_sources() -> list[str]:
    """列出 inventory 覆盖的全部已跟踪源，包括三个 Phase B 产品输出。"""
    paths = git_output("ls-files", "--", *SOURCE_ROOTS).splitlines()
    result = sorted({path for path in paths if path})
    missing = sorted(PRODUCT_OWNED - set(result))
    if missing:
        raise ValueError(f"SOURCE_ROOTS 未覆盖 Phase B 产品输出: {missing}")
    return result


def file_hash(path: Path) -> str:
    """计算文件 SHA-256。"""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_hashes(paths: list[str]) -> dict[str, str]:
    """按仓库相对路径生成稳定 source hash inventory。"""
    return {path: file_hash(ROOT / path) for path in paths}


def assert_source_clean(*, include_owned: bool) -> None:
    """拒绝 SOURCE_ROOTS 中未授权的已跟踪或未跟踪改动。"""
    changed = set(git_output("diff", "--name-only", "HEAD", "--", *SOURCE_ROOTS).splitlines())
    untracked = set(
        git_output("ls-files", "--others", "--exclude-standard", "--", *SOURCE_ROOTS).splitlines()
    )
    dirty = changed | untracked
    if not include_owned:
        dirty -= PRODUCT_OWNED
    if dirty:
        raise ValueError(f"SOURCE_ROOTS 存在未授权改动: {sorted(dirty)}")


def validation_record() -> dict[str, Any]:
    """建立 pre-patch 只读 inventory；调用方负责持久化 stdout。"""
    metadata, rows = read_matrix()
    validate_source_revision(metadata["source_revision"])
    validate_rows_against_sources(metadata, rows)
    assert_source_clean(include_owned=True)
    _, contract_ops = load_contract()
    _, runtime_ops = load_runtime()
    paths = tracked_sources()
    hashes = source_hashes(paths)
    return {
        "record_type": "authority_matrix_validation",
        "schema_version": "2.0",
        "source_revision": metadata["source_revision"],
        "matrix_sha256": file_hash(MATRIX_PATH),
        "contract_sha256": hashes["contracts/openapi.yaml"],
        "generated_client_sha256": hashes[
            "frontend/src/shared/api/generated/schema.d.ts"
        ],
        "contract_test_sha256": hashes["backend/tests/unit/test_contract.py"],
        "non_owned_source_hashes": {
            path: value for path, value in hashes.items() if path not in PRODUCT_OWNED
        },
        "source_hashes": hashes,
        "contract_operation_count": len(contract_ops),
        "runtime_operation_count": len(runtime_ops),
        "matrix_operation_count": len(rows),
        "verifier_sha256": file_hash(VERIFIER_PATH),
    }


def read_validation_record(path: Path = RECORD_PATH) -> dict[str, Any]:
    """读取并严格校验人工 apply_patch 固化的 pre-patch inventory。"""
    record = json.loads(path.read_text(encoding="utf-8"))
    _exact_fields(record, VALIDATION_RECORD_FIELDS, "validation record")
    if record["record_type"] != "authority_matrix_validation" or record["schema_version"] != "2.0":
        raise ValueError("validation record record_type/schema_version 无效")
    if not isinstance(record["source_revision"], str) or not re.fullmatch(
        r"[0-9a-f]{40}", record["source_revision"]
    ):
        raise ValueError("validation record source_revision 无效")
    for field in (
        "matrix_sha256",
        "contract_sha256",
        "generated_client_sha256",
        "contract_test_sha256",
        "verifier_sha256",
    ):
        if not isinstance(record[field], str) or not re.fullmatch(r"[0-9a-f]{64}", record[field]):
            raise ValueError(f"validation record {field} 无效")
    for field in ("source_hashes", "non_owned_source_hashes"):
        hashes = record[field]
        if not isinstance(hashes, dict) or not hashes:
            raise ValueError(f"validation record {field} 必须是非空对象")
        for path, digest in hashes.items():
            if not isinstance(path, str) or not re.fullmatch(r"[0-9a-f]{64}", str(digest)):
                raise ValueError(f"validation record {field} 包含无效项")
    if set(record["source_hashes"]) != set(tracked_sources()):
        raise ValueError("validation record source_hashes 路径集合已漂移")
    expected_non_owned = set(record["source_hashes"]) - PRODUCT_OWNED
    if set(record["non_owned_source_hashes"]) != expected_non_owned:
        raise ValueError("validation record non_owned_source_hashes 路径集合无效")
    if any(record[field] != 162 for field in (
        "contract_operation_count",
        "runtime_operation_count",
        "matrix_operation_count",
    )):
        raise ValueError("validation record operation count 无效")
    return record


def validate_source_unchanged(record_path: Path = RECORD_PATH) -> None:
    """产品 patch 后只允许三个 owned output 变化，其他审计输入必须冻结。"""
    metadata, rows = read_matrix()
    record = read_validation_record(record_path)
    validate_source_revision(metadata["source_revision"], record["source_revision"])
    validate_rows_against_sources(metadata, rows)
    if record["matrix_sha256"] != file_hash(MATRIX_PATH):
        raise ValueError("authority matrix 在 pre-patch inventory 后发生变化")
    if record["verifier_sha256"] != file_hash(VERIFIER_PATH):
        raise ValueError("authority verifier 在 pre-patch inventory 后发生变化")
    assert_source_clean(include_owned=False)
    current_non_owned = source_hashes(sorted(record["non_owned_source_hashes"]))
    if current_non_owned != record["non_owned_source_hashes"]:
        raise ValueError("非 owned source 在 Phase B 产品 patch 中发生变化")


def validate_contract_file(contract_path: Path) -> None:
    """独立校验候选合同的完整身份、状态集合与全部 Phase B 特殊语义。"""
    metadata, rows = read_matrix()
    validate_matrix_schema(metadata, rows)
    contract, contract_ops = load_contract(contract_path)
    validate_contract_statuses(rows, contract_ops)
    validate_semantics(contract, rows)


def semantic_candidate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """只在内存构造合法 Phase B 合同，用于校验生产函数的正反向自检。"""
    current, _ = load_contract()
    document = copy.deepcopy(current)
    schemas = document["components"]["schemas"]
    schemas["ErrorDetail"]["required"] = ["code", "message", "details", "request_id"]
    health = schemas["HealthResponse"]
    health["required"] = [item for item in health.get("required", []) if item != "checks"]
    health["properties"]["checks"]["type"] = ["object", "null"]
    geo = schemas["ContentTaskDetailGeoOptimization"]["properties"]["basis"]
    geo["discriminator"] = {
        "propertyName": "rule_code",
        "mapping": {
            "CONTENT_DECLINE": "#/components/schemas/ContentTaskDetailGeoContentDeclineBasis",
            "LONG_UNMENTIONED": "#/components/schemas/ContentTaskDetailGeoLongUnmentionedBasis",
            "QUESTION_COVERAGE_GAP": (
                "#/components/schemas/ContentTaskDetailGeoQuestionCoverageBasis"
            ),
        },
    }
    generation = copy.deepcopy(schemas["GenerationInputSnapshot"]["oneOf"])
    humanization = copy.deepcopy(schemas["HumanizationInputSnapshot"]["oneOf"])
    schemas["GenerationJobDetail"]["allOf"][1]["properties"]["input_snapshot"] = {
        "anyOf": generation + humanization
    }
    schemas["GenerationTrace"]["properties"]["input_snapshot"] = {
        "anyOf": copy.deepcopy(generation)
    }
    schemas["HumanizationTrace"]["properties"]["input_snapshot"] = {
        "anyOf": copy.deepcopy(humanization)
    }
    for operation_id in ("exportPlatformProfiles", "exportUsers"):
        response = _operation_by_id(document, operation_id)["responses"]["200"]
        response["content"] = {"text/csv": {"schema": {"type": "string"}}}
        response["headers"] = {
            "Content-Disposition": {"required": True, "schema": {"type": "string"}}
        }
    for row in rows:
        operation = document["paths"][row["path"]][row["method"]]
        existing = operation["responses"]
        operation["responses"] = {
            status: (
                {"$ref": "#/components/responses/ErrorResponse"}
                if status in ERROR_STATUSES
                else copy.deepcopy(existing[status])
            )
            for status in row["phase_b_statuses"]
        }
    return document


def _must_reject(label: str, callback: Callable[[], None]) -> None:
    """断言生产校验函数拒绝一个变异。"""
    try:
        callback()
    except ValueError:
        return
    raise AssertionError(f"自检变异未被拒绝: {label}")


def resolve_cli_request(
    *,
    self_test: bool,
    mode: str | None,
    record: Path | None,
    contract: Path | None,
) -> tuple[str, Path | None]:
    """把批准的 CLI 参数组合解析为唯一动作，拒绝隐式默认和无关参数。"""
    if self_test:
        if mode is not None or record is not None or contract is not None:
            raise ValueError("--self-test 不能与 --mode、--record 或 --contract 同时使用")
        return "self-test", None
    if mode is None:
        raise ValueError("必须指定 --self-test 或 --mode")
    if mode == "inventory":
        if record is not None or contract is not None:
            raise ValueError("--mode inventory 不接受 --record 或 --contract")
        return mode, None
    if mode == "source-unchanged":
        if record is None:
            raise ValueError("--mode source-unchanged 必须指定 --record")
        if contract is not None:
            raise ValueError("--mode source-unchanged 不接受 --contract")
        return mode, record
    if mode == "contract":
        if contract is None:
            raise ValueError("--mode contract 必须指定 --contract")
        if record is not None:
            raise ValueError("--mode contract 不接受 --record")
        return mode, contract
    raise ValueError(f"--mode 无效: {mode}")


def run_self_test() -> None:
    """直接调用生产校验函数，覆盖 schema、身份、状态、语义与 inventory 漂移。"""
    metadata, rows = read_matrix()
    _, baseline_ops = load_revision_contract(metadata["source_revision"])
    validate_rows_against_sources(metadata, rows, baseline_ops)
    candidate = semantic_candidate(rows)
    candidate_ops = operation_map(candidate)
    validate_contract_statuses(rows, candidate_ops)
    validate_semantics(candidate, rows)
    validate_source_revision(metadata["source_revision"])
    old_revision = git_output("rev-parse", "HEAD^")
    if old_revision == metadata["source_revision"] or not re.fullmatch(
        r"[0-9a-f]{40}", old_revision
    ):
        raise AssertionError("自检需要一个与 HEAD 不同的合法旧 revision")
    _must_reject(
        "合法旧 source_revision",
        lambda: validate_source_revision(old_revision),
    )
    _must_reject(
        "matrix/record source_revision 不一致",
        lambda: validate_source_revision(metadata["source_revision"], old_revision),
    )

    changed_metadata = copy.deepcopy(metadata)
    changed_metadata["extra"] = True
    _must_reject("metadata 额外字段", lambda: validate_matrix_schema(changed_metadata, rows))
    changed_rows = copy.deepcopy(rows)
    changed_rows[0]["extra"] = True
    _must_reject("operation 行额外字段", lambda: validate_matrix_schema(metadata, changed_rows))
    changed_rows = copy.deepcopy(rows)
    first_status = changed_rows[0]["phase_b_statuses"][0]
    changed_rows[0]["status_evidence"][first_status]["evidence"] = "/tmp/source.py:1"
    _must_reject("绝对证据路径", lambda: validate_matrix_schema(metadata, changed_rows))
    _must_reject("缺失 identity", lambda: validate_matrix_schema(metadata, rows[:-1]))
    changed_rows = copy.deepcopy(rows)
    changed_rows[-1] = copy.deepcopy(changed_rows[0])
    _must_reject("重复 identity", lambda: validate_matrix_schema(metadata, changed_rows))
    _must_reject("identity 排序", lambda: validate_matrix_schema(metadata, list(reversed(rows))))
    changed_rows = copy.deepcopy(rows)
    changed_rows[0]["response_shape_notes"] = []
    _must_reject("空 response 说明", lambda: validate_matrix_schema(metadata, changed_rows))

    for field, label in (
        ("current_contract_statuses", "current 状态漂移"),
        ("phase_b_statuses", "phase 状态漂移"),
        ("release_statuses_after_phase_x", "release 状态漂移"),
    ):
        changed_rows = copy.deepcopy(rows)
        changed_rows[0][field] = ["599"]
        _must_reject(
            label,
            lambda changed_rows=changed_rows: validate_rows_against_sources(
                metadata, changed_rows, baseline_ops
            ),
        )

    changed_rows = copy.deepcopy(rows)
    changed_rows[0]["phase_x_request_id"]["request_header"]["required"] = True
    _must_reject("Phase X request optional", lambda: validate_matrix_schema(metadata, changed_rows))
    changed_rows = copy.deepcopy(rows)
    changed_rows[0]["phase_x_request_id"]["invalid_value_400"]["status"] = "422"
    _must_reject("Phase X invalid 400", lambda: validate_matrix_schema(metadata, changed_rows))
    changed_rows = copy.deepcopy(rows)
    changed_rows[0]["phase_x_request_id"]["response_header"]["statuses"] = ["200"]
    _must_reject("Phase X response statuses", lambda: validate_matrix_schema(metadata, changed_rows))
    login_index = next(index for index, row in enumerate(rows) if row["operationId"] == "login")
    changed_rows = copy.deepcopy(rows)
    changed_rows[login_index]["cookie_sentinel"] = {"sentinel_status": "not_applicable"}
    _must_reject("login cookie", lambda: validate_matrix_schema(metadata, changed_rows))
    changed_rows = copy.deepcopy(rows)
    changed_rows[login_index]["cookie_sentinel"]["production_anchors"][0] = (
        "backend/app/routers/identity.py:104"
    )
    _must_reject("login cookie 错误生产锚点", lambda: validate_matrix_schema(metadata, changed_rows))

    alias_cases = (
        ("logout", "header", "X-CSRF-Token", "x_csrf_token"),
        ("createGenerationJob", "header", "Idempotency-Key", "idempotency_key"),
        ("listAIChannels", "query", "status", "channel_status"),
    )
    for operation_id, location, wire_name, internal_name in alias_cases:
        row_index = next(
            index for index, row in enumerate(rows) if row["operationId"] == operation_id
        )
        input_index = next(
            index
            for index, item in enumerate(rows[row_index]["validation_source"]["inputs"])
            if item["location"] == location and item["name"] == wire_name
        )
        changed_rows = copy.deepcopy(rows)
        changed_rows[row_index]["validation_source"]["inputs"][input_index]["name"] = (
            internal_name
        )
        _must_reject(
            f"{operation_id} validation wire alias",
            lambda changed_rows=changed_rows: validate_rows_against_sources(
                metadata, changed_rows, baseline_ops
            ),
        )

    abort_index = next(
        index for index, row in enumerate(rows) if row["operationId"] == "abortFileUpload"
    )
    for status in ("404", "409"):
        if rows[abort_index]["status_evidence"][status]["source_kind"] != "service":
            raise AssertionError(f"abortFileUpload {status} 必须由 service owner 证明")
        changed_rows = copy.deepcopy(rows)
        changed_rows[abort_index]["status_evidence"][status]["source_kind"] = "storage"
        _must_reject(
            f"abortFileUpload {status} storage 整文件误分类",
            lambda changed_rows=changed_rows: validate_rows_against_sources(
                metadata, changed_rows, baseline_ops
            ),
        )

    removed = copy.deepcopy(candidate)
    first_path, first_method = rows[0]["path"], rows[0]["method"]
    del removed["paths"][first_path][first_method]
    _must_reject(
        "合同缺失 operation",
        lambda: validate_contract_identity(rows, operation_map(removed)),
    )
    extra = copy.deepcopy(candidate)
    extra["paths"]["/__authority_matrix_extra"] = {
        "get": copy.deepcopy(candidate["paths"][first_path][first_method])
    }
    extra["paths"]["/__authority_matrix_extra"]["get"]["operationId"] = "matrixSelfTestExtra"
    _must_reject("合同额外 operation", lambda: validate_contract_identity(rows, operation_map(extra)))
    operation_drift = copy.deepcopy(candidate)
    operation_drift["paths"][first_path][first_method]["operationId"] = "matrixSelfTestDrift"
    _must_reject(
        "operationId drift",
        lambda: validate_contract_identity(rows, operation_map(operation_drift)),
    )
    status_drift = copy.deepcopy(candidate)
    status_drift["paths"][first_path][first_method]["responses"]["599"] = {
        "$ref": "#/components/responses/ErrorResponse"
    }
    _must_reject(
        "合同状态漂移",
        lambda: validate_contract_statuses(rows, operation_map(status_drift)),
    )
    response_drift = copy.deepcopy(candidate)
    row_422 = next(row for row in rows if "422" in row["phase_b_statuses"])
    response_drift["paths"][row_422["path"]][row_422["method"]]["responses"]["422"] = {
        "description": "invalid"
    }
    _must_reject("422 ErrorResponse", lambda: validate_semantics(response_drift, rows))

    schema_mutations: list[tuple[str, Callable[[dict[str, Any]], None]]] = [
        (
            "ErrorDetail required",
            lambda document: document["components"]["schemas"]["ErrorDetail"].update(
                {"required": ["code", "message", "request_id"]}
            ),
        ),
        (
            "health nullable",
            lambda document: document["components"]["schemas"]["HealthResponse"][
                "properties"
            ]["checks"].update({"type": "object"}),
        ),
        (
            "health optional",
            lambda document: document["components"]["schemas"]["HealthResponse"].update(
                {"required": ["status", "checks"]}
            ),
        ),
        (
            "Geo discriminator",
            lambda document: document["components"]["schemas"][
                "ContentTaskDetailGeoOptimization"
            ]["properties"]["basis"].pop("discriminator"),
        ),
    ]
    for label, mutate in schema_mutations:
        changed = copy.deepcopy(candidate)
        mutate(changed)
        _must_reject(label, lambda changed=changed: validate_semantics(changed, rows))

    for target in GENERATION_UNIONS:
        changed = copy.deepcopy(candidate)
        union = _generation_union(changed["components"]["schemas"], target)
        union["oneOf"] = union.pop("anyOf")
        _must_reject(
            f"{target} anyOf",
            lambda changed=changed: validate_semantics(changed, rows),
        )
    first_union_names = GENERATION_UNIONS["GenerationTrace.input_snapshot"]
    changed = copy.deepcopy(candidate)
    branch = changed["components"]["schemas"][first_union_names[0]]
    branch["required"].remove("contract_version")
    _must_reject("contract_version required", lambda: validate_semantics(changed, rows))
    changed = copy.deepcopy(candidate)
    schemas = changed["components"]["schemas"]
    schemas[first_union_names[1]]["properties"]["contract_version"]["const"] = schemas[
        first_union_names[0]
    ]["properties"]["contract_version"]["const"]
    _must_reject("contract_version literal 唯一", lambda: validate_semantics(changed, rows))

    for operation_id in ("exportPlatformProfiles", "exportUsers"):
        changed = copy.deepcopy(candidate)
        response = _operation_by_id(changed, operation_id)["responses"]["200"]
        response["content"] = {"application/json": {"schema": {"type": "string"}}}
        _must_reject(
            f"{operation_id} CSV media",
            lambda changed=changed: validate_semantics(changed, rows),
        )
        changed = copy.deepcopy(candidate)
        response = _operation_by_id(changed, operation_id)["responses"]["200"]
        response["headers"]["Content-Disposition"]["required"] = False
        _must_reject(
            f"{operation_id} Content-Disposition",
            lambda changed=changed: validate_semantics(changed, rows),
        )
    changed = copy.deepcopy(candidate)
    response = _operation_by_id(changed, "exportUsers")["responses"]["200"]
    response["headers"]["Content-Type"] = {"required": True, "schema": {"type": "string"}}
    _must_reject("禁止 Content-Type header", lambda: validate_semantics(changed, rows))

    approved_cli = {
        "self-test": resolve_cli_request(
            self_test=True, mode=None, record=None, contract=None
        ),
        "inventory": resolve_cli_request(
            self_test=False, mode="inventory", record=None, contract=None
        ),
        "source-unchanged": resolve_cli_request(
            self_test=False,
            mode="source-unchanged",
            record=RECORD_PATH,
            contract=None,
        ),
        "contract": resolve_cli_request(
            self_test=False,
            mode="contract",
            record=None,
            contract=ROOT / "contracts/openapi.yaml",
        ),
    }
    if approved_cli != {
        "self-test": ("self-test", None),
        "inventory": ("inventory", None),
        "source-unchanged": ("source-unchanged", RECORD_PATH),
        "contract": ("contract", ROOT / "contracts/openapi.yaml"),
    }:
        raise AssertionError("批准的 CLI dispatcher 解析结果不一致")
    invalid_cli = (
        {"self_test": False, "mode": None, "record": None, "contract": None},
        {"self_test": True, "mode": "inventory", "record": None, "contract": None},
        {
            "self_test": False,
            "mode": "inventory",
            "record": RECORD_PATH,
            "contract": None,
        },
        {
            "self_test": False,
            "mode": "source-unchanged",
            "record": None,
            "contract": None,
        },
        {
            "self_test": False,
            "mode": "contract",
            "record": None,
            "contract": None,
        },
        {"self_test": False, "mode": "unknown", "record": None, "contract": None},
    )
    for index, arguments in enumerate(invalid_cli, start=1):
        _must_reject(
            f"CLI 参数组合 {index}",
            lambda arguments=arguments: resolve_cli_request(**arguments),
        )


class ChineseArgumentParser(argparse.ArgumentParser):
    """确保 argparse 自身的缺值或未知参数也只输出中文诊断。"""

    def error(self, message: str) -> None:
        diagnostic = message if re.search(r"[\u4e00-\u9fff]", message) else "存在未知参数或参数缺少值"
        self.print_usage(sys.stderr)
        self.exit(2, f"{self.prog}: 参数错误：{diagnostic}\n")


def main() -> int:
    """运行所选 fail-closed 门禁。"""
    parser = ChineseArgumentParser(description="校验 Phase B response 权威矩阵")
    parser.add_argument("--self-test", action="store_true", help="运行 fail-closed 变异自检")
    parser.add_argument(
        "--mode",
        metavar="MODE",
        help="运行 inventory、source-unchanged 或 contract 门禁",
    )
    parser.add_argument("--record", type=Path, help="pre-patch validation record 路径")
    parser.add_argument("--contract", type=Path, help="待校验 OpenAPI 合同路径")
    args = parser.parse_args()
    try:
        action, path = resolve_cli_request(
            self_test=args.self_test,
            mode=args.mode,
            record=args.record,
            contract=args.contract,
        )
        if action == "self-test":
            run_self_test()
            print("response 权威矩阵自检通过")
        elif action == "inventory":
            print(json.dumps(validation_record(), ensure_ascii=False, indent=2, sort_keys=True))
        elif action == "source-unchanged":
            if path is None:
                raise AssertionError("source-unchanged dispatcher 缺少 record 路径")
            validate_source_unchanged(path)
            print("response 权威矩阵源未变校验通过")
        else:
            if path is None:
                raise AssertionError("contract dispatcher 缺少合同路径")
            validate_contract_file(path)
            print("response 权威矩阵合同校验通过")
    except (AssertionError, json.JSONDecodeError, OSError, subprocess.CalledProcessError, ValueError, yaml.YAMLError) as error:
        print(f"response 权威矩阵校验失败: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
