"""验证审计强契约、事务边界和双重安全投影。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy.orm import Session

from app.audit import append_audit, commit_audit, validate_audit_entry
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.models.identity import AuditLog
from app.services.audit_logs import project_audit_log


def audit_entry(**overrides: object) -> AuditEntry:
    """创建不含业务载荷的最小有效审计。"""
    values: dict[str, object] = {
        "actor_id": uuid.uuid4(),
        "business_module": AuditModule.IDENTITY,
        "action": "user.updated",
        "target_type": "User",
        "target_id": uuid.uuid4(),
        "request_id": "audit-unit-test",
        "outcome": AuditOutcome.SUCCESS,
        "result_message": "用户资料更新完成",
        "details": {
            "changes": [{"field": "is_active", "before": True, "after": False}],
            "facts": {"source": "BULK_STATUS", "status": "DISABLED"},
        },
    }
    values.update(overrides)
    return AuditEntry(**values)  # type: ignore[arg-type]


class AddOnlySession:
    """只允许 add，用于证明 append_audit 不会提交调用者事务。"""

    def __init__(self) -> None:
        self.records: list[AuditLog] = []

    def add(self, record: AuditLog) -> None:
        self.records.append(record)


def test_append_audit_builds_record_without_committing() -> None:
    session = AddOnlySession()
    append_audit(cast(Session, session), audit_entry())

    assert len(session.records) == 1
    record = session.records[0]
    assert record.business_module == "IDENTITY"
    assert record.outcome == "SUCCESS"
    assert record.error_code is None
    assert record.details["changes"][0]["before"] is True


@pytest.mark.parametrize(
    ("details", "message"),
    [
        ({"status": "DISABLED"}, "changes 和 facts"),
        ({"facts": [], "changes": []}, "facts 必须是对象"),
        (
            {"facts": {"nested": {"authorization": "Bearer secret"}}},
            "敏感字段",
        ),
        (
            {"changes": [{"field": "temporary_password", "before": None, "after": "secret"}]},
            "敏感字段",
        ),
        ({"changes": [{"field": "is_active"}]}, "before 或 after"),
    ],
)
def test_audit_details_reject_unknown_shapes_and_sensitive_nested_keys(
    details: dict[str, object],
    message: str,
) -> None:
    with pytest.raises(ValueError, match=message):
        validate_audit_entry(audit_entry(details=details))


def test_audit_outcome_requires_stable_error_semantics() -> None:
    with pytest.raises(ValueError, match="成功审计不能包含错误码"):
        validate_audit_entry(audit_entry(error_code="REVISION_CONFLICT"))
    with pytest.raises(ValueError, match="必须包含稳定错误码"):
        validate_audit_entry(audit_entry(outcome=AuditOutcome.FAILED))
    with pytest.raises(ValueError, match="错误码格式无效"):
        validate_audit_entry(
            audit_entry(
                outcome=AuditOutcome.DENIED,
                error_code="permission denied",
            )
        )


def test_commit_audit_rejects_success_outcome() -> None:
    with pytest.raises(ValueError, match="只允许 FAILED 或 DENIED"):
        commit_audit(cast(Session, object()), audit_entry())


def test_read_projection_ignores_unknown_and_sensitive_stored_details() -> None:
    record = AuditLog(
        id=uuid.uuid4(),
        actor_id=None,
        business_module="IDENTITY",
        action="user.updated",
        target_type="User",
        target_id=str(uuid.uuid4()),
        outcome="SUCCESS",
        result_message="用户资料更新完成",
        error_code=None,
        request_id="stored-audit",
        created_at=datetime.now(UTC),
        details={
            "facts": {
                "status": "DISABLED",
                "unknown": "不得返回",
                "authorization": "Bearer secret",
            }
        },
    )

    projected = project_audit_log(record, None)

    assert projected.actor is None
    assert projected.change_summary == {}
    assert "Bearer secret" not in str(projected.model_dump())


def test_read_projection_ignores_unapproved_change_fields() -> None:
    """读取边界不得因为字段名不含敏感词就返回未批准的历史变化。"""
    record = AuditLog(
        id=uuid.uuid4(),
        actor_id=None,
        business_module="IDENTITY",
        action="user.updated",
        target_type="User",
        target_id=str(uuid.uuid4()),
        outcome="SUCCESS",
        result_message="用户资料更新完成",
        error_code=None,
        request_id="stored-audit",
        created_at=datetime.now(UTC),
        details={
            "changes": [
                {"field": "is_active", "before": True, "after": False},
                {"field": "unapproved_profile_value", "before": "旧值", "after": "新值"},
            ]
        },
    )

    projected = project_audit_log(record, None)

    assert projected.change_summary == {
        "changes": [{"field": "is_active", "before": True, "after": False}]
    }
    assert "unapproved_profile_value" not in str(projected.model_dump())
