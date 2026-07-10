"""关键业务操作的追加式审计写入。"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog

SENSITIVE_KEYS = {
    "password",
    "password_hash",
    "cookie",
    "session_token",
    "access_key",
    "model_key",
}


def append_audit(
    db: Session,
    *,
    actor_id: uuid.UUID,
    action: str,
    target_type: str,
    target_id: uuid.UUID,
    request_id: str,
    details: dict[str, Any] | None = None,
) -> None:
    """在当前业务事务内追加不含敏感信息的审计记录。"""
    safe_details = details or {}
    if SENSITIVE_KEYS.intersection(key.lower() for key in safe_details):
        raise ValueError("审计详情包含禁止保存的敏感字段")
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id),
            request_id=request_id,
            details=safe_details,
        )
    )
