"""验证永久审计白名单、事务边界和双重安全投影。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy.orm import Session

from app.audit import append_audit, validate_audit_entry
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError
from app.models.identity import AuditLog
from app.services.audit_logs import _project_details, project_audit_log


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


def test_audit_only_accepts_successful_allowlisted_actions() -> None:
    with pytest.raises(ValueError, match="成功审计不能包含错误码"):
        validate_audit_entry(audit_entry(error_code="REVISION_CONFLICT"))
    with pytest.raises(ValueError, match="只允许记录成功结果"):
        validate_audit_entry(audit_entry(outcome=AuditOutcome.FAILED))
    with pytest.raises(ValueError, match="白名单"):
        validate_audit_entry(audit_entry(action="content_task.created"))


@pytest.mark.parametrize("action", ["product.created", "product.updated"])
def test_product_write_actions_are_retained(action: str) -> None:
    """Product Detail Activity 依赖的产品写入必须属于成功审计白名单。"""
    validate_audit_entry(
        audit_entry(
            business_module=AuditModule.PRODUCT_FACTS,
            action=action,
            target_type="Product",
            details={},
        )
    )


@pytest.mark.parametrize(
    "details",
    [
        {"facts": {"unknown": "不得返回"}},
        {"facts": {"authorization": "Bearer secret"}},
        {"facts": {"status": [["nested"]]}},
        {"changes": [{"field": "unapproved_profile_value", "after": "新值"}]},
    ],
)
def test_detail_projection_rejects_unknown_sensitive_and_nested_values(
    details: dict[str, object],
) -> None:
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
        details=details,
    )

    with pytest.raises(AppError) as raised:
        _project_details(record)

    assert raised.value.code == "AUDIT_PROJECTION_FAILED"
    assert raised.value.status_code == 409
    assert "unknown" not in raised.value.message
    assert "authorization" not in raised.value.message


def test_list_projection_does_not_read_details() -> None:
    """列表不得因异常历史详情失败，也不得携带第二份详情摘要。"""
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
        details={"facts": {"authorization": "Bearer secret"}},
    )

    projected = project_audit_log(record, None)

    assert projected.actor is None
    assert "change_summary" not in projected.model_dump()
    assert "Bearer secret" not in str(projected.model_dump())


@pytest.mark.parametrize(
    "details",
    [
        {"facts": {"unknown": "value"}},
        {"facts": {"status": [["nested"]]}},
        {"changes": [{"field": "unknown", "after": "value"}]},
    ],
)
def test_write_projection_rejects_unregistered_or_nested_values(
    details: dict[str, object],
) -> None:
    with pytest.raises(ValueError):
        validate_audit_entry(audit_entry(details=details))
