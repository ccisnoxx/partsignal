"""递归检查 FastAPI 运行时操作与冻结 OpenAPI 契约的语义漂移。"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path
from typing import Any, cast

import yaml

HTTP_METHODS = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
_STATUS_CODE = re.compile(r"^[1-5][0-9]{2}$")
_STATUS_RANGE = re.compile(r"^[1-5]XX$")


class _ComparatorError(Exception):
    """表示文档无法按已冻结的 OpenAPI 子集安全解释。"""


def json_pointer(*parts: object) -> str:
    """构造 RFC 6901 pointer；路径片段中的 ``~`` 和 ``/`` 必须转义。"""
    escaped = (str(part).replace("~", "~0").replace("/", "~1") for part in parts)
    return "/" + "/".join(escaped)


def _decode_pointer(pointer: str) -> list[str]:
    if pointer == "#":
        return []
    if not pointer.startswith("#/"):
        raise _ComparatorError("仅支持 document 内部 JSON Pointer")
    result: list[str] = []
    for part in pointer[2:].split("/"):
        decoded = ""
        index = 0
        while index < len(part):
            if part[index] != "~":
                decoded += part[index]
                index += 1
            elif part[index : index + 2] == "~0":
                decoded += "~"
                index += 2
            elif part[index : index + 2] == "~1":
                decoded += "/"
                index += 2
            else:
                raise _ComparatorError("非法 RFC 6901 转义")
        result.append(decoded)
    return result


def _lookup_local(document: dict[str, Any], ref: str) -> dict[str, Any]:
    """读取单个 local ref 目标；递归安全由调用者按语义处理。"""
    target: Any = document
    for part in _decode_pointer(ref):
        if isinstance(target, list):
            if not re.fullmatch(r"0|[1-9][0-9]*", part):
                raise _ComparatorError(f"非法 RFC 6901 数组索引 {part!r}")
            try:
                target = target[int(part)]
            except (ValueError, IndexError):
                raise _ComparatorError(f"引用目标不存在 {ref}") from None
        elif isinstance(target, dict) and part in target:
            target = target[part]
        else:
            raise _ComparatorError(f"引用目标不存在 {ref}")
    if not isinstance(target, dict):
        raise _ComparatorError(f"引用目标不是对象 {ref}")
    return target


def _resolve_local(
    document: dict[str, Any],
    value: Any,
    *,
    strict: bool = True,
    allow_annotation_siblings: bool = False,
) -> tuple[dict[str, Any], str]:
    if not isinstance(value, dict):
        raise _ComparatorError("对象必须是 mapping")
    allowed_siblings = {"summary", "description"}
    current = value
    seen: set[str] = set()
    final_ref = "#"
    while "$ref" in current:
        ref = current["$ref"]
        if not isinstance(ref, str) or not ref.startswith("#"):
            raise _ComparatorError(f"不支持外部或非法引用 {ref!r}")
        if strict and (
            set(current) != {"$ref"}
            and (not allow_annotation_siblings or set(current) - {"$ref"} - allowed_siblings)
        ):
            raise _ComparatorError("Reference Object 不允许未解释的 sibling 字段")
        if ref in seen:
            raise _ComparatorError(f"引用图存在循环 {ref}")
        seen.add(ref)
        final_ref = ref
        target = _lookup_local(document, ref)
        # Reference Object 的 summary/description 只属于引用使用点，不能污染
        # 被引用的 Response/Header machine object。
        current = target
    return current, final_ref


def resolve_schema(document: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    """解析现有请求/成功响应比较使用的内部引用。"""
    target, _ = _resolve_local(document, schema, strict=False)
    if target is not schema:
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


def compare_shape(
    contract_document: dict[str, Any],
    runtime_document: dict[str, Any],
    contract_schema: dict[str, Any],
    runtime_schema: dict[str, Any],
    label: str,
    failures: list[str],
) -> None:
    """递归比较 requestBody 使用的字段、必填性和机器约束。"""
    left = resolve_schema(contract_document, contract_schema)
    right = resolve_schema(runtime_document, runtime_schema)
    left_fields = set(left.get("properties", {}))
    right_fields = set(right.get("properties", {}))
    if left_fields != right_fields:
        failures.append(
            f"{label} 字段漂移: missing={sorted(left_fields - right_fields)}, "
            f"extra={sorted(right_fields - left_fields)}"
        )
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
            contract_document, runtime_document, left_items, right_items, f"{label}[]", failures
        )


def operation_map(document: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    operations: dict[tuple[str, str], dict[str, Any]] = {}
    paths = document.get("paths", {})
    if not isinstance(paths, dict):
        raise _ComparatorError("OpenAPI document.paths 必须是 mapping")
    for path, item in paths.items():
        if isinstance(path, str) and path.startswith("x-"):
            continue
        if not isinstance(path, str) or not path.startswith("/"):
            raise _ComparatorError("Path key 必须是以 '/' 开头的 string")
        if not isinstance(item, dict):
            raise _ComparatorError("Path Item 必须是 mapping 且 path 必须是 string")
        shared_parameters = item.get("parameters", [])
        if not isinstance(shared_parameters, list):
            raise _ComparatorError("Path Item parameters 必须是 array")
        for method, operation in item.items():
            if method not in HTTP_METHODS:
                continue
            if not isinstance(operation, dict):
                raise _ComparatorError(f"operation {path}/{method} 必须是 mapping")
            operation_parameters = operation.get("parameters", [])
            if not isinstance(operation_parameters, list):
                raise _ComparatorError(f"operation {path}/{method} parameters 必须是 array")
            merged = dict(operation)
            merged["parameters"] = [*shared_parameters, *operation_parameters]
            operations[(path, method)] = merged
    return operations


def parameter_map(
    document: dict[str, Any], operation: dict[str, Any]
) -> dict[tuple[str, str], dict[str, Any]]:
    """按名称和位置展开参数引用，供必填性与约束比较。"""
    parameters: dict[tuple[str, str], dict[str, Any]] = {}
    raw_parameters = operation.get("parameters", [])
    if not isinstance(raw_parameters, list):
        raise _ComparatorError("operation parameters 必须是 array")
    for parameter in raw_parameters:
        resolved = resolve_schema(document, parameter)
        if not isinstance(resolved.get("name"), str) or not isinstance(resolved.get("in"), str):
            raise _ComparatorError("Parameter 必须包含 name 和 in")
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


class _ResponseComparator:
    """完整 response comparator 的无 I/O 实现。"""

    _ANNOTATIONS = {"title", "description", "example", "examples", "$comment"}
    _SCHEMA_KEYS = {
        "$ref",
        "type",
        "enum",
        "const",
        "format",
        "default",
        "readOnly",
        "writeOnly",
        "discriminator",
        "deprecated",
        "multipleOf",
        "maximum",
        "exclusiveMaximum",
        "minimum",
        "exclusiveMinimum",
        "maxLength",
        "minLength",
        "pattern",
        "maxItems",
        "minItems",
        "uniqueItems",
        "maxContains",
        "minContains",
        "required",
        "properties",
        "patternProperties",
        "additionalProperties",
        "unevaluatedProperties",
        "items",
        "prefixItems",
        "contains",
        "propertyNames",
        "minProperties",
        "maxProperties",
        "allOf",
        "anyOf",
        "oneOf",
        "not",
        "if",
        "then",
        "else",
        "dependentRequired",
        "dependentSchemas",
        "contentEncoding",
        "contentMediaType",
    }

    def __init__(self, contract: dict[str, Any], runtime: dict[str, Any]) -> None:
        self.contract = contract
        self.runtime = runtime
        self.failures: list[dict[str, Any]] = []

    def add(
        self,
        kind: str,
        pointer: str,
        message: str,
        contract: Any = None,
        runtime: Any = None,
        direction: str | None = None,
    ) -> None:
        if direction is None:
            direction = (
                "missing_in_contract"
                if contract is None and runtime is not None
                else "missing_in_runtime"
                if runtime is None and contract is not None
                else "different"
            )
        self.failures.append(
            {
                "kind": kind,
                "pointer": pointer,
                "direction": direction,
                "message": message,
                "contract": contract,
                "runtime": runtime,
            }
        )

    @staticmethod
    def _status_key(key: Any) -> str:
        if isinstance(key, bool):
            raise _ComparatorError("status key 必须是三位状态码、default 或大写 wildcard")
        result = str(key) if isinstance(key, int) else key if isinstance(key, str) else None
        if result is None or not (
            _STATUS_CODE.fullmatch(result) or result == "default" or _STATUS_RANGE.fullmatch(result)
        ):
            raise _ComparatorError(f"非法 status key {key!r}")
        return result

    def statuses(
        self, operation: dict[str, Any], pointer: str, direction: str
    ) -> dict[str, Any]:
        responses = operation.get("responses")
        if not isinstance(responses, dict):
            self.add(
                "invalid_responses",
                pointer + "/responses",
                "responses 必须是 mapping",
                responses,
                direction=f"invalid_in_{direction}",
            )
            return {}
        result: dict[str, Any] = {}
        for raw_key, response in responses.items():
            try:
                key = self._status_key(raw_key)
            except _ComparatorError as error:
                self.add(
                    "invalid_status",
                    pointer + "/responses/" + json_pointer(raw_key)[1:],
                    str(error),
                    raw_key,
                    direction=f"invalid_in_{direction}",
                )
                continue
            if key in result:
                self.add(
                    "status_collision",
                    pointer + "/responses/" + json_pointer(key)[1:],
                    "status key 规范化后碰撞",
                    key,
                    direction=f"invalid_in_{direction}",
                )
            else:
                result[key] = response
        return result

    @staticmethod
    def _recursive_signature(
        document: dict[str, Any], ref: str
    ) -> tuple[str, tuple[tuple[str, str], ...], tuple[str, ...]] | None:
        """返回生产性递归 schema 图的稳定 bisimulation 标记。

        标记基于完整局部机器结构和引用边反复细化，而不是单侧遇到相似
        浅 shape 就停止展开。因此透明 alias 的跳数和等价循环节点数量不
        影响结果，但有限引用链仍会被终点节点区分。
        """
        annotations = {"title", "description", "example", "examples", "$comment"}
        raw_values = {"default", "enum", "const"}

        def structural_target(candidate: str) -> str | None:
            seen: set[str] = set()
            current = candidate
            while current not in seen:
                seen.add(current)
                target = _lookup_local(document, current)
                if set(target) - {"$ref"} - annotations:
                    return current
                next_ref = target.get("$ref")
                if not isinstance(next_ref, str) or not next_ref.startswith("#"):
                    return None
                current = next_ref
            return None

        start = structural_target(ref)
        if start is None:
            return None

        shapes: dict[str, Any] = {}
        edges: dict[str, list[tuple[str, str]]] = {}
        pending = [start]
        queued = {start}

        def normalize(value: Any, path: str, node_edges: list[tuple[str, str]]) -> Any:
            if isinstance(value, dict):
                normalized: dict[str, Any] = {}
                for key, child in value.items():
                    if key in annotations:
                        continue
                    child_path = f"{path}/{key}" if path else f"/{key}"
                    if key in raw_values:
                        normalized[key] = child
                        continue
                    if key == "$ref":
                        if isinstance(child, str) and child.startswith("#"):
                            target = structural_target(child)
                            if target is not None:
                                node_edges.append((path or "/", target))
                                normalized[key] = {"$graph_ref": path or "/"}
                                continue
                        normalized[key] = child
                        continue
                    normalized[key] = normalize(child, child_path, node_edges)
                return normalized
            if isinstance(value, list):
                return [
                    normalize(child, f"{path}/{index}", node_edges)
                    for index, child in enumerate(value)
                ]
            return value

        while pending:
            current = pending.pop(0)
            target_schema = _lookup_local(document, current)
            node_edges: list[tuple[str, str]] = []
            shapes[current] = normalize(target_schema, "", node_edges)
            edges[current] = node_edges
            for _, child in node_edges:
                if child not in queued:
                    queued.add(child)
                    pending.append(child)

        # 用每轮的等价类编号而非把上一轮长字符串嵌回自身，避免递归图的
        # 标记因循环深度持续增长。按 descriptor 排序使编号在两份文档间稳定。
        colors = {current: 0 for current in shapes}
        for _ in range(len(colors) + 1):
            descriptors = {
                current: json.dumps(
                    {
                        "shape": shapes[current],
                        "edges": sorted(
                            (path, colors[target]) for path, target in edges[current]
                        ),
                    },
                    sort_keys=True,
                    default=str,
                )
                for current in shapes
            }
            descriptor_ids = {
                descriptor: index
                for index, descriptor in enumerate(sorted(set(descriptors.values())))
            }
            refined = {
                current: descriptor_ids[descriptor]
                for current, descriptor in descriptors.items()
            }
            if refined == colors:
                break
            colors = refined
        # 不能只返回 root 的 class 编号：不同可达子图可能都恰好是 class 0。
        # 从 root 沿稳定 schema 路径重新编号，并保留完整 quotient graph。
        representatives: dict[int, str] = {}
        for node, color in colors.items():
            representatives[color] = min(node, representatives.get(color, node))
        root_color = colors[start]
        quotient_ids: dict[int, int] = {root_color: 0}
        pending_classes = [root_color]
        quotient: list[dict[str, Any]] = []
        while pending_classes:
            current_color = pending_classes.pop(0)
            representative = representatives[current_color]
            target_edges: list[tuple[str, int]] = []
            for path, target in sorted(
                edges[representative],
                key=lambda item: (
                    item[0],
                    json.dumps(shapes[item[1]], sort_keys=True, default=str),
                ),
            ):
                target_color = colors[target]
                if target_color not in quotient_ids:
                    quotient_ids[target_color] = len(quotient_ids)
                    pending_classes.append(target_color)
                target_edges.append((path, quotient_ids[target_color]))
            quotient.append(
                {
                    "shape": shapes[representative],
                    "edges": target_edges,
                }
            )
        return (
            json.dumps({"root": 0, "classes": quotient}, sort_keys=True, default=str),
            (),
            (),
        )

    @staticmethod
    def _has_schema_cycle(document: dict[str, Any], start_ref: str) -> bool:
        """仅确认目标图存在回到自身的 schema 引用路径。

        该检查不依据浅层 shape 折叠节点：只有图上已经确认存在生产性回路时，
        ``_schema_form`` 才会把等价循环节点归一化。有限引用链因此仍会完整展开。
        """
        ignored = {
            "$ref",
            "title",
            "description",
            "example",
            "examples",
            "default",
            "enum",
            "const",
            "format",
            "discriminator",
            "contentEncoding",
            "contentMediaType",
        }

        def refs(value: Any) -> list[str]:
            found: list[str] = []
            if isinstance(value, dict):
                raw_ref = value.get("$ref")
                if isinstance(raw_ref, str) and raw_ref.startswith("#"):
                    found.append(raw_ref)
                for key, child in value.items():
                    if key not in ignored:
                        found.extend(refs(child))
            elif isinstance(value, list):
                for child in value:
                    found.extend(refs(child))
            return found

        def reaches(current_ref: str, seen: set[str]) -> bool:
            if current_ref in seen:
                return current_ref == start_ref
            try:
                target = _lookup_local(document, current_ref)
            except _ComparatorError:
                return False
            next_seen = {*seen, current_ref}
            return any(reaches(child_ref, next_seen) for child_ref in refs(target))

        return reaches(start_ref, set())

    def _schema_form(
        self, document: dict[str, Any], schema: Any, stack: tuple[tuple[int, str], ...] = ()
    ) -> Any:
        if not isinstance(schema, dict):
            raise _ComparatorError("schema 必须是 mapping")
        if "$ref" in schema:
            ref = schema["$ref"]
            if not isinstance(ref, str) or not ref.startswith("#"):
                raise _ComparatorError(f"不支持外部或非法引用 {ref!r}")
            marker = (id(document), ref)
            if marker in stack:
                signature = self._recursive_signature(document, ref)
                if signature is None:
                    raise _ComparatorError("schema 存在纯 alias 引用循环")
                return {"$recursive": signature}
            target = _lookup_local(document, ref)
            # 只有已确认存在生产性回路，且当前节点与祖先节点结构等价时，
            # 才消除等价循环节点数量；不能用浅签名提前折叠有限引用链。
            signature = self._recursive_signature(document, ref)
            if signature is not None and self._has_schema_cycle(document, ref):
                for _, ancestor_ref in stack:
                    ancestor = _lookup_local(document, ancestor_ref)
                    if set(ancestor) <= {"$ref", "summary", "description"}:
                        continue
                    if self._recursive_signature(document, ancestor_ref) == signature:
                        return {"$recursive": signature}
            # OpenAPI 3.1 Schema Object 允许 $ref 与 machine siblings 并存；
            # siblings 与被引用 schema 合取，而不是覆盖或被静默丢弃。
            siblings = {key: value for key, value in schema.items() if key != "$ref"}
            if siblings:
                target_form = self._schema_form(document, target, (*stack, marker))
                sibling_form = self._schema_form(document, siblings, stack)
                return self._combine_conjuncts(target_form, sibling_form)
            return self._schema_form(document, target, (*stack, marker))
        if "nullable" in schema:
            raise _ComparatorError("旧式 nullable 不受支持")
        unknown = set(schema) - self._SCHEMA_KEYS - self._ANNOTATIONS
        if unknown:
            raise _ComparatorError(f"未知 schema machine field: {sorted(unknown)}")
        source = {key: value for key, value in schema.items() if key not in self._ANNOTATIONS}
        if "enum" in source and not isinstance(source["enum"], list):
            raise _ComparatorError("enum 必须是 array")
        if "const" in source:
            const_value = source.pop("const")
            if "enum" in source:
                source["enum"] = [item for item in source["enum"] if item == const_value]
            else:
                source["enum"] = [const_value]
        result: dict[str, Any] = {}
        type_value = source.get("type")
        if isinstance(type_value, list):
            if not type_value or any(not isinstance(item, str) for item in type_value):
                raise _ComparatorError("schema type array 非法")
            result["type"] = tuple(sorted(set(type_value)))
        elif type_value is not None:
            if not isinstance(type_value, str):
                raise _ComparatorError("schema type 非法")
            result["type"] = type_value
        if "additionalProperties" not in source and (
            type_value == "object" or "properties" in source or "patternProperties" in source
        ):
            result["additionalProperties"] = True
        for key in (
            "format",
            "default",
            "readOnly",
            "writeOnly",
            "discriminator",
            "deprecated",
            "multipleOf",
            "maximum",
            "exclusiveMaximum",
            "minimum",
            "exclusiveMinimum",
            "maxLength",
            "minLength",
            "pattern",
            "maxItems",
            "minItems",
            "maxProperties",
            "minProperties",
            "uniqueItems",
            "maxContains",
            "minContains",
            "contentEncoding",
            "contentMediaType",
        ):
            if key in source:
                result[key] = source[key]
        if "enum" in source:
            result["enum"] = tuple(
                sorted(
                    json.dumps(item, sort_keys=True, ensure_ascii=False) for item in source["enum"]
                )
            )
        for key in (
            "required",
            "prefixItems",
            "properties",
            "patternProperties",
            "dependentRequired",
            "dependentSchemas",
        ):
            if key not in source:
                continue
            value = source[key]
            if key == "required":
                if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
                    raise _ComparatorError("required 必须是 string array")
                result[key] = tuple(sorted(set(value)))
            elif key in {"properties", "patternProperties", "dependentSchemas"}:
                if not isinstance(value, dict):
                    raise _ComparatorError(f"{key} 必须是 mapping")
                result[key] = tuple(
                    sorted(
                        (name, self._schema_form(document, child, stack))
                        for name, child in value.items()
                    )
                )
            elif key == "dependentRequired":
                if not isinstance(value, dict):
                    raise _ComparatorError("dependentRequired 必须是 mapping")
                normalized: list[tuple[str, tuple[str, ...]]] = []
                for name, dependencies in value.items():
                    if not isinstance(name, str) or not isinstance(dependencies, list) or any(
                        not isinstance(item, str) for item in dependencies
                    ):
                        raise _ComparatorError("dependentRequired value 必须是 string array")
                    normalized.append((name, tuple(sorted(set(dependencies)))))
                result[key] = tuple(sorted(normalized))
            else:
                if not isinstance(value, list):
                    raise _ComparatorError(f"{key} 必须是 array")
                result[key] = tuple(self._schema_form(document, child, stack) for child in value)
        for key in (
            "additionalProperties",
            "unevaluatedProperties",
            "items",
            "contains",
            "propertyNames",
            "not",
            "if",
            "then",
            "else",
        ):
            if key not in source:
                continue
            value = source[key]
            result[key] = (
                value if isinstance(value, bool) else self._schema_form(document, value, stack)
            )
        for key in ("allOf", "anyOf", "oneOf"):
            if key not in source:
                continue
            value = source[key]
            if not isinstance(value, list):
                raise _ComparatorError(f"{key} 必须是 array")
            branches = [self._schema_form(document, item, stack) for item in value]
            if key == "anyOf":
                unique: dict[str, Any] = {}
                for branch in branches:
                    unique.setdefault(json.dumps(branch, sort_keys=True, default=str), branch)
                branches = sorted(
                    unique.values(),
                    key=lambda item: json.dumps(item, sort_keys=True, default=str),
                )
            else:
                branches.sort(key=lambda item: json.dumps(item, sort_keys=True, default=str))
            if key == "allOf":
                merged = self._merge_object_all_of(branches)
                if merged is not None:
                    combined_object = self._merge_object_all_of([result, merged])
                    result = (
                        combined_object
                        if combined_object is not None
                        else self._combine_conjuncts(result, merged)
                    )
                    continue
            result[key] = tuple(branches)
        if "anyOf" in result and len(result["anyOf"]) == 2:
            branches = list(result["anyOf"])
            null_branch = next((item for item in branches if item == {"type": "null"}), None)
            non_null = [item for item in branches if item != {"type": "null"}]
            if (
                null_branch is not None
                and len(non_null) == 1
                and isinstance(non_null[0], dict)
                and "type" in non_null[0]
            ):
                value = non_null[0]["type"]
                nullable_form = dict(non_null[0])
                nullable_form["type"] = tuple(
                    sorted(set((value,) if isinstance(value, str) else value) | {"null"})
                )
                result.pop("anyOf")
                result = self._combine_conjuncts(result, nullable_form)
        return result

    @staticmethod
    def _combine_object_projection(
        left: dict[str, Any], right: dict[str, Any]
    ) -> dict[str, Any] | None:
        """合并开放 object projection；typeless 分支不凭空增加 object 类型。"""
        def object_like(value: dict[str, Any]) -> bool:
            type_value = value.get("type")
            return type_value in (None, "object") or (
                isinstance(type_value, tuple) and "object" in type_value
            )

        if not object_like(left) or not object_like(right):
            return None
        for value in (left, right):
            for key in ("additionalProperties", "unevaluatedProperties"):
                if key in value and value[key] is not True:
                    return None
        result: dict[str, Any] = {}
        for key in set(left) | set(right):
            if key in {"properties", "required", "type", "additionalProperties"}:
                continue
            if key not in left:
                result[key] = right[key]
            elif key not in right or left[key] == right[key]:
                result[key] = left[key]
            else:
                return None
        left_type, right_type = left.get("type"), right.get("type")
        if left_type is not None and right_type is not None:
            left_types = {left_type} if isinstance(left_type, str) else set(left_type)
            right_types = {right_type} if isinstance(right_type, str) else set(right_type)
            type_values = tuple(sorted(left_types & right_types))
            result["type"] = type_values[0] if len(type_values) == 1 else type_values
        elif left_type is not None:
            result["type"] = left_type
        elif right_type is not None:
            result["type"] = right_type
        properties: dict[str, Any] = {}
        for value in (left, right):
            for name, schema in value.get("properties", ()):
                if name in properties and properties[name] != schema:
                    return None
                properties[name] = schema
        if properties:
            result["properties"] = tuple(sorted(properties.items()))
        required = set(left.get("required", ())) | set(right.get("required", ()))
        if required:
            result["required"] = tuple(sorted(required))
        additional_properties = [
            value["additionalProperties"]
            for value in (left, right)
            if "additionalProperties" in value
        ]
        if additional_properties:
            if any(item is not True for item in additional_properties):
                if any(item is True for item in additional_properties):
                    return None
                if any(item != additional_properties[0] for item in additional_properties):
                    return None
                result["additionalProperties"] = additional_properties[0]
            else:
                result["additionalProperties"] = True
        return result

    @staticmethod
    def _combine_conjuncts(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
        """合取可安全压缩的约束；无法压缩时保留有序 allOf 语义。"""
        object_projection = _ResponseComparator._combine_object_projection(left, right)
        if object_projection is not None and (
            "properties" in left or "properties" in right
        ):
            return object_projection
        result: dict[str, Any] = {}
        for key in set(left) | set(right):
            if key not in left:
                result[key] = right[key]
            elif key not in right or left[key] == right[key]:
                result[key] = left[key]
            elif key in {"minimum", "exclusiveMinimum", "minLength", "minItems", "minProperties"}:
                result[key] = max(left[key], right[key])
            elif key in {"maximum", "exclusiveMaximum", "maxLength", "maxItems", "maxProperties"}:
                result[key] = min(left[key], right[key])
            elif key == "enum":
                result[key] = tuple(sorted(set(left[key]) & set(right[key])))
            elif key == "type":
                left_types = {left[key]} if isinstance(left[key], str) else set(left[key])
                right_types = {right[key]} if isinstance(right[key], str) else set(right[key])
                common = tuple(sorted(left_types & right_types))
                result[key] = common[0] if len(common) == 1 else common
            else:
                branches = [left, right]
                return {
                    "allOf": tuple(
                        sorted(
                            branches,
                            key=lambda item: json.dumps(
                                item, sort_keys=True, default=str
                            ),
                        )
                    )
                }
        return result

    @staticmethod
    def _merge_object_all_of(branches: list[Any]) -> dict[str, Any] | None:
        if (
            not branches
            or any(not isinstance(item, dict) for item in branches)
            or any(
                item.get("type") not in (None, "object")
                or (
                    item.get("type") is None
                    and set(item)
                    - {"properties", "required", "additionalProperties", "unevaluatedProperties"}
                )
                for item in branches
            )
        ):
            return None
        # 任一分支的闭包约束可能拒绝另一个分支新增的 property；在这种
        # 情况下把 allOf 展平会改变交集语义，保留原始组合供比较。
        if any(
            item.get(key) is not None and item.get(key) is not True
            for item in branches
            for key in ("additionalProperties", "unevaluatedProperties")
        ):
            return None
        merged: dict[str, Any] = {}
        if any(item.get("type") == "object" for item in branches):
            merged["type"] = "object"
        properties: dict[str, Any] = {}
        required: set[str] = set()
        for branch in branches:
            for name, schema in branch.get("properties", ()):
                if name in properties and properties[name] != schema:
                    return None
                properties[name] = schema
            required.update(branch.get("required", ()))
            for key in ("additionalProperties", "unevaluatedProperties"):
                if key in branch:
                    if key in merged and merged[key] != branch[key]:
                        return None
                    merged[key] = branch[key]
        if properties:
            merged["properties"] = tuple(sorted(properties.items()))
        if required:
            merged["required"] = tuple(sorted(required))
        return merged

    def _compare_schema(self, left: Any, right: Any, pointer: str) -> None:
        left_form: Any = None
        right_form: Any = None
        try:
            left_form = self._schema_form(self.contract, left)
        except _ComparatorError as error:
            self.add("unsupported", pointer, str(error), left, None, "invalid_in_contract")
            self.failures[-1]["contract_target"] = self._terminal_ref(self.contract, left)
        try:
            right_form = self._schema_form(self.runtime, right)
        except _ComparatorError as error:
            self.add("unsupported", pointer, str(error), None, right, "invalid_in_runtime")
            self.failures[-1]["runtime_target"] = self._terminal_ref(self.runtime, right)
        if left_form is None or right_form is None:
            return
        if left_form != right_form:
            self.add(
                "schema_drift",
                self._first_schema_difference(left_form, right_form, pointer),
                "schema machine shape 漂移",
                left_form,
                right_form,
            )
            self.failures[-1]["contract_target"] = self._terminal_ref(self.contract, left)
            self.failures[-1]["runtime_target"] = self._terminal_ref(self.runtime, right)

    @staticmethod
    def _terminal_ref(document: dict[str, Any], schema: Any) -> str | None:
        """返回 schema root ref 链的最终 local target，inline schema 返回 None。"""
        if not isinstance(schema, dict) or "$ref" not in schema:
            return None
        seen: set[str] = set()
        current = schema
        final_ref: str | None = None
        while isinstance(current, dict) and "$ref" in current:
            ref = current["$ref"]
            if not isinstance(ref, str) or not ref.startswith("#") or ref in seen:
                return final_ref
            seen.add(ref)
            final_ref = ref
            try:
                current = _lookup_local(document, ref)
            except _ComparatorError:
                return final_ref
        return final_ref

    @staticmethod
    def _first_schema_difference(left: Any, right: Any, pointer: str) -> str:
        """返回稳定的最深可定位 schema 差异 pointer。"""
        if isinstance(left, dict) and isinstance(right, dict):
            for key in sorted(set(left) | set(right)):
                child_pointer = pointer + "/" + json_pointer(key)[1:]
                if key not in left or key not in right:
                    return child_pointer
                left_value, right_value = left[key], right[key]
                if left_value == right_value:
                    continue
                if key == "properties" and isinstance(left_value, tuple) and isinstance(
                    right_value, tuple
                ):
                    left_properties, right_properties = dict(left_value), dict(right_value)
                    for name in sorted(set(left_properties) | set(right_properties)):
                        property_pointer = child_pointer + "/" + json_pointer(name)[1:]
                        if name not in left_properties or name not in right_properties:
                            return property_pointer
                        if left_properties[name] != right_properties[name]:
                            return _ResponseComparator._first_schema_difference(
                                left_properties[name], right_properties[name], property_pointer
                            )
                elif isinstance(left_value, tuple) and isinstance(right_value, tuple):
                    for index in range(min(len(left_value), len(right_value))):
                        left_item, right_item = left_value[index], right_value[index]
                        if left_item != right_item:
                            return _ResponseComparator._first_schema_difference(
                                left_item, right_item, child_pointer + f"/{index}"
                            )
                    return child_pointer + f"/{min(len(left_value), len(right_value))}"
                return child_pointer
            return pointer
        return pointer

    @staticmethod
    def _content(response: dict[str, Any]) -> dict[str, Any]:
        if "content" not in response:
            return {}
        content = response["content"]
        if content == {}:
            return {}
        if not isinstance(content, dict):
            raise _ComparatorError("content 必须是 mapping")
        result: dict[str, Any] = {}
        for media, value in content.items():
            if not isinstance(media, str) or not isinstance(value, dict):
                raise _ComparatorError("media type 和 Media Type Object 非法")
            if ";" in media:
                raise _ComparatorError("media type 参数暂不支持")
            normalized = media.lower()
            if normalized in result:
                raise _ComparatorError(f"media type 大小写规范化后碰撞 {media}")
            result[normalized] = value
        return result

    @staticmethod
    def _headers(response: dict[str, Any]) -> dict[str, Any]:
        if "headers" not in response:
            return {}
        raw = response["headers"]
        if not isinstance(raw, dict):
            raise _ComparatorError("headers 必须是 mapping")
        result: dict[str, Any] = {}
        for name, value in raw.items():
            if not isinstance(name, str) or not isinstance(value, dict):
                raise _ComparatorError("header name 或 Header Object 非法")
            normalized = name.lower()
            if normalized in result:
                raise _ComparatorError(f"header name 大小写规范化后碰撞 {name}")
            result[normalized] = value
        return result

    @staticmethod
    def _validate_response(response: dict[str, Any]) -> None:
        """限制为已批准的 Response Object 字段，避免未知字段假绿。"""
        allowed = {"description", "headers", "content", "links"}
        unknown = set(response) - allowed
        if unknown:
            raise _ComparatorError(f"未知 response machine field: {sorted(unknown)}")
        if "description" not in response or not isinstance(response["description"], str):
            raise _ComparatorError("Response Object description 必须是 string")

    def _header_form(self, document: dict[str, Any], header: Any) -> Any:
        resolved, _ = _resolve_local(document, header, allow_annotation_siblings=True)
        has_schema, has_content = "schema" in resolved, "content" in resolved
        if has_schema and has_content:
            raise _ComparatorError("Header Object 的 schema 与 content 互斥")
        if not has_schema and not has_content:
            raise _ComparatorError("Header Object 必须恰有 schema 或 content")
        machine = {key: value for key, value in resolved.items() if key not in self._ANNOTATIONS}
        unknown = set(machine) - {
            "$ref",
            "required",
            "deprecated",
            "style",
            "explode",
            "schema",
            "content",
        }
        if unknown:
            raise _ComparatorError(f"未知 header machine field: {sorted(unknown)}")
        for key in ("required", "deprecated", "explode"):
            if key in machine and not isinstance(machine[key], bool):
                raise _ComparatorError(f"header {key} 必须是 bool")
        if "style" in machine and machine["style"] != "simple":
            raise _ComparatorError("header style 仅支持 simple")
        schema = self._schema_form(document, machine["schema"]) if "schema" in machine else None
        content = machine.get("content")
        if has_content:
            if not isinstance(content, dict) or len(content) != 1:
                raise _ComparatorError("Header content 必须恰有一个 media")
            media, media_object = next(iter(content.items()))
            if (
                not isinstance(media, str)
                or not isinstance(media_object, dict)
                or "schema" not in media_object
            ):
                raise _ComparatorError("Header content media/schema 非法")
            normalized_media = media.lower()
            if ";" in media:
                raise _ComparatorError("header content media type 参数暂不支持")
            if any(
                isinstance(other, str) and other.lower() == normalized_media and other != media
                for other in content
            ):
                raise _ComparatorError("Header content media 大小写规范化后碰撞")
            unknown_media = set(media_object) - {"schema", "example", "examples", "encoding"}
            if unknown_media:
                raise _ComparatorError(
                    f"未知 header media machine field: {sorted(unknown_media)}"
                )
            schema = (
                normalized_media,
                self._schema_form(document, media_object["schema"]),
                media_object.get("encoding"),
            )
        style = machine.get("style", "simple")
        explode = machine.get("explode", style == "form")
        return (
            bool(machine.get("required", False)),
            bool(machine.get("deprecated", False)),
            style,
            bool(explode),
            schema,
        )

    def _response(self, status: str, left: Any, right: Any, pointer: str) -> None:
        left_response: dict[str, Any] | None = None
        right_response: dict[str, Any] | None = None
        try:
            left_response, _ = _resolve_local(self.contract, left, allow_annotation_siblings=True)
        except _ComparatorError as error:
            self.add("unsupported", pointer, str(error), left, None, "invalid_in_contract")
        try:
            right_response, _ = _resolve_local(self.runtime, right, allow_annotation_siblings=True)
        except _ComparatorError as error:
            self.add("unsupported", pointer, str(error), None, right, "invalid_in_runtime")
        if left_response is None or right_response is None:
            return
        for response, side in ((left_response, "contract"), (right_response, "runtime")):
            try:
                self._validate_response(response)
            except _ComparatorError as error:
                self.add(
                    "unsupported",
                    pointer,
                    str(error),
                    response if side == "contract" else None,
                    response if side == "runtime" else None,
                    f"invalid_in_{side}",
                )
        if "links" in left_response or "links" in right_response:
            self.add("unsupported", pointer, "links machine field 暂不支持", left, right)
        try:
            left_content = self._content(left_response)
        except _ComparatorError as error:
            self.add(
                "invalid_content",
                pointer + "/content",
                str(error),
                left_response.get("content"),
                None,
                "invalid_in_contract",
            )
            left_content = {}
        try:
            right_content = self._content(right_response)
        except _ComparatorError as error:
            self.add(
                "invalid_content",
                pointer + "/content",
                str(error),
                None,
                right_response.get("content"),
                "invalid_in_runtime",
            )
            right_content = {}
        try:
            left_headers = self._headers(left_response)
        except _ComparatorError as error:
            self.add(
                "unsupported",
                pointer + "/headers",
                str(error),
                left_response.get("headers"),
                None,
                "invalid_in_contract",
            )
            left_headers = {}
        try:
            right_headers = self._headers(right_response)
        except _ComparatorError as error:
            self.add(
                "unsupported",
                pointer + "/headers",
                str(error),
                None,
                right_response.get("headers"),
                "invalid_in_runtime",
            )
            right_headers = {}
        if (status.startswith("1") or status in {"204", "205", "304"}) and (
            left_content or right_content
        ):
            self.add(
                "invalid_no_body",
                pointer + "/content",
                "该 status 不允许声明 response body",
                left_content,
                right_content,
            )
        self._compare_mapping_keys(left_content, right_content, pointer + "/content", "media")
        for media in sorted(set(left_content) & set(right_content)):
            lp = pointer + "/content/" + json_pointer(media)[1:]
            l_media, r_media = left_content[media], right_content[media]
            for media_object, side in ((l_media, "contract"), (r_media, "runtime")):
                unknown = set(media_object) - {"schema", "example", "examples", "encoding"}
                if unknown:
                    self.add(
                        "unsupported",
                        lp,
                        f"未知 media machine field: {sorted(unknown)}",
                        l_media if side == "contract" else None,
                        r_media if side == "runtime" else None,
                        f"invalid_in_{side}",
                    )
            if ("schema" in l_media) != ("schema" in r_media):
                self.add(
                    "schema_presence",
                    lp + "/schema",
                    "schema 存在性漂移",
                    l_media.get("schema"),
                    r_media.get("schema"),
                )
            elif "schema" in l_media:
                self._compare_schema(l_media["schema"], r_media["schema"], lp + "/schema")
            if l_media.get("encoding") != r_media.get("encoding"):
                self.add(
                    "media_drift",
                    lp + "/encoding",
                    "media serialization encoding 漂移",
                    l_media.get("encoding"),
                    r_media.get("encoding"),
                )
        self._compare_mapping_keys(left_headers, right_headers, pointer + "/headers", "header")
        for name in sorted(set(left_headers) & set(right_headers)):
            hp = pointer + "/headers/" + json_pointer(name)[1:]
            try:
                left_form = self._header_form(self.contract, left_headers[name])
            except _ComparatorError as error:
                self.add(
                    "unsupported",
                    hp,
                    str(error),
                    left_headers[name],
                    None,
                    "invalid_in_contract",
                )
                left_form = None
            try:
                right_form = self._header_form(self.runtime, right_headers[name])
            except _ComparatorError as error:
                self.add(
                    "unsupported",
                    hp,
                    str(error),
                    None,
                    right_headers[name],
                    "invalid_in_runtime",
                )
                right_form = None
            if left_form is None or right_form is None:
                continue
            if left_form != right_form:
                self.add(
                    "header_drift", hp, "Header Object machine shape 漂移", left_form, right_form
                )

    def _compare_mapping_keys(
        self, left: dict[str, Any], right: dict[str, Any], pointer: str, label: str
    ) -> None:
        for key in sorted(set(left) - set(right)):
            self.add(
                f"missing_{label}",
                pointer + "/" + json_pointer(key)[1:],
                f"{label} 仅存在于 contract",
                left[key],
                None,
            )
        for key in sorted(set(right) - set(left)):
            self.add(
                f"extra_{label}",
                pointer + "/" + json_pointer(key)[1:],
                f"{label} 仅存在于 runtime",
                None,
                right[key],
            )

    def run(self) -> list[dict[str, Any]]:
        left_ops, right_ops = operation_map(self.contract), operation_map(self.runtime)
        for key in sorted(set(left_ops) - set(right_ops)):
            self.add(
                "missing_operation",
                json_pointer("paths", key[0], key[1]),
                "operation 仅存在于 contract",
                left_ops[key],
                None,
            )
        for key in sorted(set(right_ops) - set(left_ops)):
            self.add(
                "extra_operation",
                json_pointer("paths", key[0], key[1]),
                "operation 仅存在于 runtime",
                None,
                right_ops[key],
            )
        for key in sorted(set(left_ops) & set(right_ops)):
            operation_pointer = json_pointer("paths", key[0], key[1])
            left_statuses = self.statuses(left_ops[key], operation_pointer, "contract")
            right_statuses = self.statuses(right_ops[key], operation_pointer, "runtime")
            response_pointer = json_pointer("paths", key[0], key[1], "responses")
            for status in sorted(set(left_statuses) - set(right_statuses)):
                self.add(
                    "missing_status",
                    response_pointer + "/" + json_pointer(status)[1:],
                    "status 仅存在于 contract",
                    left_statuses[status],
                    None,
                )
            for status in sorted(set(right_statuses) - set(left_statuses)):
                self.add(
                    "extra_status",
                    response_pointer + "/" + json_pointer(status)[1:],
                    "status 仅存在于 runtime",
                    None,
                    right_statuses[status],
                )
            for status in sorted(set(left_statuses) & set(right_statuses)):
                self._response(
                    status,
                    left_statuses[status],
                    right_statuses[status],
                    response_pointer + "/" + json_pointer(status)[1:],
                )
        self.failures.sort(
            key=lambda item: (item["pointer"], item["kind"], item["direction"], item["message"])
        )
        return self.failures


def compare_response_contracts(
    contract_document: dict[str, Any], runtime_document: dict[str, Any]
) -> list[dict[str, Any]]:
    """比较两份已解析 document；纯层不读文件、不访问 app，也不修改输入。"""
    if not isinstance(contract_document, dict) or not isinstance(runtime_document, dict):
        raise _ComparatorError("OpenAPI document 必须是 mapping")
    if not isinstance(contract_document.get("paths"), dict) or not isinstance(
        runtime_document.get("paths"), dict
    ):
        raise _ComparatorError("OpenAPI document.paths 必须是 mapping")
    return _ResponseComparator(contract_document, runtime_document).run()


def check(contract_path: Path) -> list[str]:
    """执行完整默认契约门禁并返回稳定排序后的漂移诊断。"""
    from app.main import app

    contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
    runtime = copy.deepcopy(app.openapi())
    response_failures = compare_response_contracts(contract, runtime)
    failures: list[str] = []
    contract_ops, runtime_ops = operation_map(contract), operation_map(runtime)
    contract_components = contract.get("components", {})
    runtime_components = runtime.get("components", {})
    if not isinstance(contract_components, dict) or not isinstance(runtime_components, dict):
        raise _ComparatorError("OpenAPI document.components 必须是 mapping")
    contract_schemes = contract_components.get("securitySchemes", {})
    runtime_schemes = runtime_components.get("securitySchemes", {})
    if not isinstance(contract_schemes, dict) or not isinstance(runtime_schemes, dict):
        raise _ComparatorError("securitySchemes 必须是 mapping")
    for name, expected in contract_schemes.items():
        actual = runtime_schemes.get(name)
        if actual is None:
            failures.append(f"缺少安全方案 {name}")
            continue
        if not isinstance(expected, dict) or not isinstance(actual, dict):
            raise _ComparatorError(f"安全方案 {name} 必须是 mapping")
        for field in ("type", "in", "name"):
            if expected.get(field) != actual.get(field):
                failures.append(f"安全方案 {name}.{field} 漂移")
    for key in sorted(set(contract_ops).intersection(runtime_ops)):
        left_op, right_op = contract_ops[key], runtime_ops[key]
        if left_op.get("operationId") != right_op.get("operationId"):
            failures.append(f"{key} operationId 漂移")
        compare_parameters(contract, runtime, left_op, right_op, str(key), failures)
        left_security = left_op.get("security", contract.get("security", []))
        right_security = right_op.get("security", runtime.get("security", []))
        if left_security != right_security:
            failures.append(f"{key} security 漂移")
        left_body, right_body = left_op.get("requestBody"), right_op.get("requestBody")
        if bool(left_body) != bool(right_body):
            failures.append(f"{key} requestBody 存在性漂移")
        elif left_body and right_body:
            left_schema, right_schema = (
                json_schema(resolve_schema(contract, left_body)),
                json_schema(resolve_schema(runtime, right_body)),
            )
            if left_schema and right_schema:
                compare_shape(
                    contract, runtime, left_schema, right_schema, f"{key} request", failures
                )
    failures.extend(
        json.dumps(failure, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        for failure in response_failures
    )
    failures.sort()
    return failures


def _default_contract_path() -> Path:
    return Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"


def main() -> None:
    """命令行入口；默认执行完整 response 与非 response 契约门禁。"""
    parser = argparse.ArgumentParser(description="检查 FastAPI 与 OpenAPI 契约漂移")
    parser.add_argument("contract_path", nargs="?", type=Path, default=_default_contract_path())
    args = parser.parse_args()
    try:
        failures = check(args.contract_path)
    except (OSError, UnicodeError, yaml.YAMLError, _ComparatorError) as error:
        print(f"contract-check error: {error}", file=sys.stderr)
        raise SystemExit(2) from None
    if failures:
        print("\n".join(failures), file=sys.stderr)
        raise SystemExit(1)
    print("FastAPI 运行时操作与 OpenAPI 完整契约一致。")


if __name__ == "__main__":
    main()
