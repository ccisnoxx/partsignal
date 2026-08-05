"""关键业务操作的追加式审计写入。"""

from __future__ import annotations

import re
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.audit_types import (
    RETAINED_AUDIT_ACTIONS,
    AuditEntry,
    AuditModule,
    AuditOutcome,
)
from app.models.identity import AuditLog

SENSITIVE_KEYS = {
    "authorization",
    "proxy_authorization",
    "headers",
    "password",
    "password_hash",
    "cookie",
    "set_cookie",
    "session_token",
    "access_token",
    "refresh_token",
    "private_key",
    "secret",
    "access_key",
    "model_key",
    "api_key",
    "temporary_password",
    "old_password",
    "new_password",
    "encrypted_value",
    "plain_value",
    "prompt",
    "response",
}
_DETAIL_KEYS = frozenset({"changes", "facts"})
_CHANGE_KEYS = frozenset({"field", "before", "after"})


def contains_sensitive_key(value: Any) -> bool:
    """递归检查审计详情，防止敏感字段藏在嵌套对象中。"""
    if isinstance(value, dict):
        return any(
            _is_sensitive_key(str(key)) or contains_sensitive_key(item)
            for key, item in value.items()
        )
    if isinstance(value, list):
        return any(contains_sensitive_key(item) for item in value)
    return False


def _is_sensitive_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]+", "_", key.casefold()).strip("_")
    return (
        normalized in SENSITIVE_KEYS
        or normalized.endswith(("_password", "_token", "_secret", "_private_key"))
        or "prompt" in normalized
        or "response" in normalized
    )


def _validate_json_value(value: Any) -> None:
    if value is None or isinstance(value, str | int | float | bool):
        return
    if isinstance(value, list):
        for item in value:
            _validate_json_value(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise ValueError("审计详情对象的键必须是字符串")
            _validate_json_value(item)
        return
    raise ValueError("审计详情只能包含 JSON 值")


def validate_audit_entry(entry: AuditEntry) -> None:
    """校验结果语义、字段长度和安全摘要结构。"""
    if not isinstance(entry.business_module, AuditModule):
        raise ValueError("审计业务模块必须使用 AuditModule")
    if not isinstance(entry.outcome, AuditOutcome):
        raise ValueError("审计执行结果必须使用 AuditOutcome")
    if entry.outcome != AuditOutcome.SUCCESS:
        raise ValueError("永久审计只允许记录成功结果")
    if entry.action not in RETAINED_AUDIT_ACTIONS:
        raise ValueError("审计动作不在永久保留白名单中")
    if not isinstance(entry.actor_id, uuid.UUID):
        raise ValueError("审计操作者必须是真实用户 UUID")
    if entry.target_id is not None and not isinstance(entry.target_id, uuid.UUID | str):
        raise ValueError("审计对象标识必须是 UUID、字符串或空值")
    if not isinstance(entry.action, str) or not entry.action or len(entry.action) > 120:
        raise ValueError("审计动作长度必须为 1 至 120 个字符")
    if (
        not isinstance(entry.target_type, str)
        or not entry.target_type
        or len(entry.target_type) > 80
    ):
        raise ValueError("审计对象类型长度必须为 1 至 80 个字符")
    if entry.target_id is not None and len(str(entry.target_id)) > 100:
        raise ValueError("审计对象标识不能超过 100 个字符")
    if (
        not isinstance(entry.request_id, str)
        or not 1 <= len(entry.request_id) <= 100
        or any(ord(char) < 0x20 or ord(char) > 0x7E for char in entry.request_id)
    ):
        raise ValueError("审计请求 ID 必须是 1 至 100 个可打印 ASCII 字符")
    if (
        not isinstance(entry.result_message, str)
        or not entry.result_message.strip()
        or len(entry.result_message) > 500
    ):
        raise ValueError("审计结果说明长度必须为 1 至 500 个字符")
    if entry.error_code is not None:
        raise ValueError("成功审计不能包含错误码")
    if set(entry.details) - _DETAIL_KEYS:
        raise ValueError("审计详情只允许 changes 和 facts")
    changes = entry.details.get("changes", [])
    facts = entry.details.get("facts", {})
    if not isinstance(changes, list) or not isinstance(facts, dict):
        raise ValueError("审计 changes 必须是数组，facts 必须是对象")
    for change in changes:
        if not isinstance(change, dict) or set(change) - _CHANGE_KEYS:
            raise ValueError("审计变化项只允许 field、before 和 after")
        field = change.get("field")
        if not isinstance(field, str) or not field or _is_sensitive_key(field):
            raise ValueError("审计变化字段无效或属于敏感字段")
        if "before" not in change and "after" not in change:
            raise ValueError("审计变化项必须包含 before 或 after")
    _validate_json_value(entry.details)
    if contains_sensitive_key(entry.details):
        raise ValueError("审计详情包含禁止保存的敏感字段")


def _audit_record(entry: AuditEntry) -> AuditLog:
    validate_audit_entry(entry)
    return AuditLog(
        actor_id=entry.actor_id,
        business_module=entry.business_module.value,
        action=entry.action,
        target_type=entry.target_type,
        target_id=str(entry.target_id) if entry.target_id is not None else None,
        outcome=entry.outcome.value,
        result_message=entry.result_message,
        error_code=entry.error_code,
        request_id=entry.request_id,
        details=entry.details,
    )


def append_audit(db: Session, entry: AuditEntry) -> None:
    """在调用者当前业务事务内追加安全审计，不自行提交。"""
    db.add(_audit_record(entry))
