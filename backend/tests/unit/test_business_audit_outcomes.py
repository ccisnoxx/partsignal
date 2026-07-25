"""验证关键业务命令失败或权限拒绝后的独立审计接线。"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from types import ModuleType, SimpleNamespace
from typing import Any, cast

import pytest
from fastapi import Request
from sqlalchemy.orm import Session

from app.audit import validate_audit_entry
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError
from app.models.identity import User
from app.routers import observation, product_facts, production, publication


class _RollbackSession:
    def __init__(self) -> None:
        self.rollback_calls = 0
        self.events: list[str] = []

    def rollback(self) -> None:
        self.rollback_calls += 1
        self.events.append("rollback")


AuditCase = tuple[
    ModuleType,
    str,
    Callable[..., object],
    str,
    dict[str, object],
    str,
    str,
    uuid.UUID | None,
    AuditModule,
]

_CONTENT_ID = uuid.uuid4()
_PLATFORM_ACCOUNT_ID = uuid.uuid4()
_PUBLICATION_ID = uuid.uuid4()
_FACT_VERSION_ID = uuid.uuid4()
_COMMAND_PAYLOAD = SimpleNamespace(expected_revision=0, comment="")

AUDIT_CASES: tuple[AuditCase, ...] = (
    (
        production,
        "transition_content_version",
        production.approve_content_version,
        "reviewer",
        {"content_version_id": _CONTENT_ID, "payload": _COMMAND_PAYLOAD},
        "content_version.approve",
        "ContentVersion",
        _CONTENT_ID,
        AuditModule.CONTENT_REVIEW,
    ),
    (
        production,
        "transition_content_version",
        production.request_content_changes,
        "reviewer",
        {"content_version_id": _CONTENT_ID, "payload": _COMMAND_PAYLOAD},
        "content_version.request-changes",
        "ContentVersion",
        _CONTENT_ID,
        AuditModule.CONTENT_REVIEW,
    ),
    (
        publication,
        "delete_platform_account_command",
        publication.delete_platform_account,
        "admin",
        {"platform_account_id": _PLATFORM_ACCOUNT_ID},
        "platform_account.deleted",
        "PlatformAccount",
        _PLATFORM_ACCOUNT_ID,
        AuditModule.PUBLICATION,
    ),
    (
        publication,
        "create_manual_publication_service",
        publication.create_manual_publication,
        "editor",
        {"payload": object(), "idempotency_key": "audit-test-key"},
        "publication.created",
        "PublicationRecord",
        None,
        AuditModule.PUBLICATION,
    ),
    (
        publication,
        "command_publication",
        publication.command_publication_record,
        "editor",
        {
            "publication_id": _PUBLICATION_ID,
            "command": "mark-published",
            "payload": object(),
        },
        "publication.mark_published",
        "PublicationRecord",
        _PUBLICATION_ID,
        AuditModule.PUBLICATION,
    ),
    (
        observation,
        "create_geo_observation_command",
        observation.create_geo_observation,
        "analyst",
        {"payload": object()},
        "geo_observation.created",
        "GeoObservation",
        None,
        AuditModule.GEO_OBSERVATION,
    ),
    (
        product_facts,
        "transition_fact_version",
        product_facts.submit_fact_version,
        "editor",
        {"fact_version_id": _FACT_VERSION_ID, "payload": _COMMAND_PAYLOAD},
        "fact_version.submit",
        "FactVersion",
        _FACT_VERSION_ID,
        AuditModule.PRODUCT_FACTS,
    ),
)


def _invoke(
    case: AuditCase,
    *,
    account_type: str,
    monkeypatch: pytest.MonkeyPatch,
    service_error: AppError | None,
) -> tuple[_RollbackSession, AuditEntry]:
    (
        module,
        service_name,
        handler,
        actor_parameter,
        handler_kwargs,
        _action,
        _target_type,
        _target_id,
        _business_module,
    ) = case
    actor = cast(
        User,
        SimpleNamespace(id=uuid.uuid4(), account_type=account_type),
    )
    db = _RollbackSession()
    request = cast(
        Request,
        SimpleNamespace(state=SimpleNamespace(request_id="business-audit-test")),
    )
    entries: list[AuditEntry] = []

    def service(**_kwargs: Any) -> object:
        if service_error is None:
            raise AssertionError("权限拒绝时不应进入业务服务")
        raise service_error

    def record_audit(_source_db: Session, entry: AuditEntry) -> None:
        db.events.append("audit")
        entries.append(entry)

    monkeypatch.setattr(module, service_name, service)
    monkeypatch.setattr(module, "commit_audit", record_audit)
    with pytest.raises(AppError) as caught:
        handler(
            **handler_kwargs,
            request=request,
            db=cast(Session, db),
            **{actor_parameter: actor},
            _csrf=None,
        )
    expected_error = service_error.code if service_error is not None else "PERMISSION_DENIED"
    assert caught.value.code == expected_error
    assert len(entries) == 1
    validate_audit_entry(entries[0])
    return db, entries[0]


@pytest.mark.parametrize("case", AUDIT_CASES)
def test_business_command_failure_is_audited_after_rollback(
    case: AuditCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """业务错误只保存稳定错误码，且在原事务回滚后独立审计。"""
    db, entry = _invoke(
        case,
        account_type="ADMIN",
        monkeypatch=monkeypatch,
        service_error=AppError(
            "REVISION_CONFLICT",
            "这段异常自由文本不得进入审计",
            409,
        ),
    )
    _, _, _, _, _, action, target_type, target_id, business_module = case
    assert db.rollback_calls == 1
    assert db.events == ["rollback", "audit"]
    assert entry.business_module == business_module
    assert entry.action == action
    assert entry.target_type == target_type
    assert entry.target_id == target_id
    assert entry.outcome == AuditOutcome.FAILED
    assert entry.error_code == "REVISION_CONFLICT"
    assert "异常自由文本" not in entry.result_message


@pytest.mark.parametrize("case", AUDIT_CASES)
def test_business_command_permission_denial_is_audited_without_service_call(
    case: AuditCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    """已认证但账号类型无权执行时记录 DENIED，认证和 CSRF 仍在路由依赖层。"""
    db, entry = _invoke(
        case,
        account_type="UNAUTHORIZED",
        monkeypatch=monkeypatch,
        service_error=None,
    )
    _, _, _, _, _, action, target_type, target_id, business_module = case
    assert db.rollback_calls == 1
    assert db.events == ["rollback", "audit"]
    assert entry.business_module == business_module
    assert entry.action == action
    assert entry.target_type == target_type
    assert entry.target_id == target_id
    assert entry.outcome == AuditOutcome.DENIED
    assert entry.error_code == "PERMISSION_DENIED"
