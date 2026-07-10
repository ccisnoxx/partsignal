"""递归检查 FastAPI 运行时操作与冻结 OpenAPI 契约的语义漂移。"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, cast

import yaml

from app.main import app

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def resolve_schema(document: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    """解析内部引用并合并 allOf，便于比较顶层字段契约。"""
    if "$ref" in schema:
        target: Any = document
        for part in schema["$ref"].removeprefix("#/").split("/"):
            target = target[part]
        return resolve_schema(document, target)
    if isinstance(schema.get("type"), list) and "null" in schema["type"]:
        normalized = dict(schema)
        non_null_types = [item for item in schema["type"] if item != "null"]
        normalized["type"] = non_null_types[0] if len(non_null_types) == 1 else non_null_types
        return normalized
    if "const" in schema and "enum" not in schema:
        normalized = dict(schema)
        normalized["enum"] = [normalized.pop("const")]
        return normalized
    if "allOf" in schema:
        merged: dict[str, Any] = {"type": "object", "properties": {}, "required": []}
        for component in schema["allOf"]:
            resolved = resolve_schema(document, component)
            merged["properties"].update(resolved.get("properties", {}))
            merged["required"].extend(resolved.get("required", []))
            if resolved.get("additionalProperties") is False:
                merged["additionalProperties"] = False
        merged["required"] = sorted(set(merged["required"]))
        return merged
    if "anyOf" in schema:
        alternatives = [
            resolve_schema(document, item)
            for item in schema["anyOf"]
            if resolve_schema(document, item).get("type") != "null"
        ]
        if len(alternatives) == 1:
            return alternatives[0]
    return schema


def json_schema(content_owner: dict[str, Any]) -> dict[str, Any] | None:
    content = content_owner.get("content", {})
    media = content.get("application/json")
    return cast(dict[str, Any], media.get("schema")) if media else None


def successful_response(operation: dict[str, Any]) -> dict[str, Any] | None:
    for code, response in operation.get("responses", {}).items():
        if str(code).startswith("2"):
            return cast(dict[str, Any], response)
    return None


def compare_shape(
    contract_document: dict[str, Any],
    runtime_document: dict[str, Any],
    contract_schema: dict[str, Any],
    runtime_schema: dict[str, Any],
    label: str,
    failures: list[str],
) -> None:
    """递归比较字段、必填性和机器可执行约束。"""
    left = resolve_schema(contract_document, contract_schema)
    right = resolve_schema(runtime_document, runtime_schema)
    left_fields = set(left.get("properties", {}))
    right_fields = set(right.get("properties", {}))
    if left_fields != right_fields:
        missing = sorted(left_fields - right_fields)
        extra = sorted(right_fields - left_fields)
        failures.append(f"{label} 字段漂移: missing={missing}, extra={extra}")
    if set(left.get("required", [])) != set(right.get("required", [])):
        failures.append(f"{label} required 字段漂移")
    constraints = {
        "type",
        "format",
        "enum",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "minLength",
        "maxLength",
        "minItems",
        "maxItems",
        "uniqueItems",
        "pattern",
        "additionalProperties",
        "default",
    }
    for constraint in constraints:
        if left.get(constraint) != right.get(constraint):
            failures.append(f"{label} {constraint} 漂移")
    for field in sorted(left_fields.intersection(right_fields)):
        compare_shape(
            contract_document,
            runtime_document,
            left["properties"][field],
            right["properties"][field],
            f"{label}.{field}",
            failures,
        )
    left_items = left.get("items")
    right_items = right.get("items")
    if bool(left_items) != bool(right_items):
        failures.append(f"{label} items 存在性漂移")
    elif left_items and right_items:
        compare_shape(
            contract_document,
            runtime_document,
            left_items,
            right_items,
            f"{label}[]",
            failures,
        )


def operation_map(document: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    operations: dict[tuple[str, str], dict[str, Any]] = {}
    for path, item in document.get("paths", {}).items():
        shared_parameters = item.get("parameters", [])
        for method, operation in item.items():
            if method not in HTTP_METHODS:
                continue
            merged = dict(operation)
            merged["parameters"] = [*shared_parameters, *operation.get("parameters", [])]
            operations[(path, method)] = merged
    return operations


def parameter_map(
    document: dict[str, Any], operation: dict[str, Any]
) -> dict[tuple[str, str], dict[str, Any]]:
    """按名称和位置展开参数引用，供必填性与约束比较。"""
    parameters: dict[tuple[str, str], dict[str, Any]] = {}
    for parameter in operation.get("parameters", []):
        resolved = resolve_schema(document, parameter)
        parameters[(resolved["name"], resolved["in"])] = resolved
    return parameters


def compare_parameters(
    contract: dict[str, Any],
    runtime: dict[str, Any],
    left_operation: dict[str, Any],
    right_operation: dict[str, Any],
    label: str,
    failures: list[str],
) -> None:
    """比较路径、查询和 Header 参数的存在性、必填性及关键约束。"""
    left = parameter_map(contract, left_operation)
    right = parameter_map(runtime, right_operation)
    if set(left) != set(right):
        failures.append(
            f"{label} 参数漂移: missing={sorted(set(left) - set(right))}, "
            f"extra={sorted(set(right) - set(left))}"
        )
        return
    constraint_keys = {
        "type",
        "format",
        "enum",
        "minimum",
        "maximum",
        "minLength",
        "maxLength",
        "pattern",
    }
    for key in left:
        if bool(left[key].get("required")) != bool(right[key].get("required")):
            failures.append(f"{label} 参数 {key} required 漂移")
        left_schema = resolve_schema(contract, left[key].get("schema", {}))
        right_schema = resolve_schema(runtime, right[key].get("schema", {}))
        for constraint in constraint_keys:
            if left_schema.get(constraint) != right_schema.get(constraint):
                failures.append(f"{label} 参数 {key} {constraint} 漂移")


def check(contract_path: Path) -> list[str]:
    """返回所有契约漂移；空列表表示 HTTP 操作与 Schema 语义一致。"""
    contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
    runtime = app.openapi()
    failures: list[str] = []
    contract_ops = operation_map(contract)
    runtime_ops = operation_map(runtime)
    contract_schemes = contract.get("components", {}).get("securitySchemes", {})
    runtime_schemes = runtime.get("components", {}).get("securitySchemes", {})
    for name, expected in contract_schemes.items():
        actual = runtime_schemes.get(name)
        if actual is None:
            failures.append(f"缺少安全方案 {name}")
            continue
        for field in ("type", "in", "name"):
            if expected.get(field) != actual.get(field):
                failures.append(f"安全方案 {name}.{field} 漂移")
    if set(contract_ops) != set(runtime_ops):
        failures.append(
            f"路径漂移: missing={sorted(set(contract_ops) - set(runtime_ops))}, "
            f"extra={sorted(set(runtime_ops) - set(contract_ops))}"
        )
    for key in sorted(set(contract_ops).intersection(runtime_ops)):
        left_op = contract_ops[key]
        right_op = runtime_ops[key]
        if left_op.get("operationId") != right_op.get("operationId"):
            failures.append(f"{key} operationId 漂移")
        compare_parameters(contract, runtime, left_op, right_op, str(key), failures)
        left_security = left_op.get("security", contract.get("security", []))
        right_security = right_op.get("security", runtime.get("security", []))
        if left_security != right_security:
            failures.append(f"{key} security 漂移")
        left_body = left_op.get("requestBody")
        right_body = right_op.get("requestBody")
        if bool(left_body) != bool(right_body):
            failures.append(f"{key} requestBody 存在性漂移")
        elif left_body and right_body:
            left_schema = json_schema(resolve_schema(contract, left_body))
            right_schema = json_schema(resolve_schema(runtime, right_body))
            if left_schema and right_schema:
                compare_shape(
                    contract,
                    runtime,
                    left_schema,
                    right_schema,
                    f"{key} request",
                    failures,
                )
        left_response = successful_response(left_op)
        right_response = successful_response(right_op)
        if left_response and right_response:
            left_response = resolve_schema(contract, left_response)
            right_response = resolve_schema(runtime, right_response)
            left_schema = json_schema(left_response)
            right_schema = json_schema(right_response)
            if left_schema and right_schema:
                compare_shape(
                    contract,
                    runtime,
                    left_schema,
                    right_schema,
                    f"{key} response",
                    failures,
                )
    return failures


def main() -> None:
    """命令行入口，发现漂移时返回非零状态。"""
    contract_path = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    failures = check(contract_path)
    if failures:
        print("\n".join(failures), file=sys.stderr)
        raise SystemExit(1)
    print("FastAPI 运行时操作与 OpenAPI 0.1.1 递归 Schema 语义一致。")


if __name__ == "__main__":
    main()
