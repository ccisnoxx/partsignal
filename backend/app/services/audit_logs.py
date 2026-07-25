"""全局审计日志的组合查询、当前身份投影与安全摘要。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from app.audit import contains_sensitive_key
from app.audit_types import AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.ai_generation import AIChannel, AIModel
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import GeoObservation
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion, Product
from app.models.publication import PlatformAccount, PublicationAttention, PublicationRecord
from app.schemas.common import (
    AccountType,
    AuditActor,
    AuditChange,
    AuditLogDetail,
    AuditLogFilterOptions,
    AuditLogList,
    AuditLogOut,
    AuditRelatedEntry,
)

_SAFE_FACT_KEYS: dict[str, frozenset[str]] = {
    AuditModule.IDENTITY.value: frozenset(
        {"account_type", "is_active", "source", "status", "row_count", "revision"}
    ),
    AuditModule.PRODUCT_FACTS.value: frozenset(
        {"product_id", "review_record_count", "revision", "status", "version"}
    ),
    AuditModule.CONTENT_PLANNING.value: frozenset(
        {
            "fact_version_id",
            "platform_profile_id",
            "platform_profile_version_id",
            "platform_type_id",
            "previous_active_version_id",
            "reason",
            "replacement_version_id",
            "revision",
            "status",
            "version",
        }
    ),
    AuditModule.CONTENT_PRODUCTION.value: frozenset(
        {
            "based_on_id",
            "content_version_id",
            "retry_of_id",
            "source_content_version_id",
            "task_id",
            "version",
        }
    ),
    AuditModule.CONTENT_REVIEW.value: frozenset({"revision", "status"}),
    AuditModule.PUBLICATION.value: frozenset(
        {
            "attachment_count",
            "content_version_id",
            "fact_version_id",
            "platform_profile_id",
            "platform_profile_version_id",
            "publication_id",
            "publication_reference_count",
            "repair_task_id",
            "revision",
            "status",
            "task_id",
            "trigger_status",
        }
    ),
    AuditModule.GEO_OBSERVATION.value: frozenset(
        {
            "article_count",
            "attachment_count",
            "product_id",
            "publication_count",
            "query_topic_id",
            "supersedes_id",
        }
    ),
    AuditModule.CONFIGURATION.value: frozenset(
        {
            "account_count",
            "allowed_domain_count",
            "channel_id",
            "configured",
            "header_name",
            "is_active",
            "is_sensitive",
            "model_count",
            "platform_profile_id",
            "platform_type_id",
            "previous_active_version_id",
            "protocol_type",
            "provider_brand",
            "reason",
            "reference_count",
            "replacement_version_id",
            "revision",
            "status",
            "test_status",
            "version",
        }
    ),
    AuditModule.FILE_MANAGEMENT.value: frozenset({"access_level", "category", "size", "status"}),
}
_SAFE_CHANGE_FIELDS: dict[str, frozenset[str]] = {
    AuditModule.IDENTITY.value: frozenset({"account_type", "display_name", "is_active"}),
    AuditModule.PRODUCT_FACTS.value: frozenset({"status"}),
    AuditModule.CONTENT_PLANNING.value: frozenset(
        {"generation_data_classification", "generation_input_configured", "status"}
    ),
    AuditModule.CONTENT_PRODUCTION.value: frozenset(),
    AuditModule.CONTENT_REVIEW.value: frozenset({"status"}),
    AuditModule.PUBLICATION.value: frozenset({"status"}),
    AuditModule.GEO_OBSERVATION.value: frozenset(),
    AuditModule.CONFIGURATION.value: frozenset(
        {
            "allowed_domain_count",
            "is_active",
            "is_configured",
            "logo_configured",
            "platform_type_id",
            "revision",
            "status",
            "website_configured",
        }
    ),
    AuditModule.FILE_MANAGEMENT.value: frozenset({"status"}),
}
_KEYWORD_FACT_KEYS = frozenset(
    {
        "account_type",
        "category",
        "protocol_type",
        "provider_brand",
        "reason",
        "source",
        "status",
        "test_status",
        "trigger_status",
        "version",
    }
)


def _safe_value(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, list):
        projected = [_safe_value(item) for item in value]
        return projected if all(item is not _UNSAFE for item in projected) else _UNSAFE
    return _UNSAFE


_UNSAFE = object()


def _project_details(record: AuditLog) -> tuple[list[AuditChange], dict[str, Any]]:
    """只读取当前模块批准的摘要键，未知或异常 JSON 结构一律忽略。"""
    details: dict[str, Any] = record.details if isinstance(record.details, dict) else {}
    if contains_sensitive_key(details):
        return [], {}
    allowed = _SAFE_FACT_KEYS.get(record.business_module, frozenset())
    nested_facts = details.get("facts")
    raw_facts: dict[str, Any] = nested_facts if isinstance(nested_facts, dict) else details
    facts: dict[str, Any] = {}
    for key in allowed:
        if key not in raw_facts:
            continue
        value = _safe_value(raw_facts[key])
        if value is not _UNSAFE:
            facts[key] = value

    changes: list[AuditChange] = []
    raw_changes = details.get("changes", [])
    allowed_changes = _SAFE_CHANGE_FIELDS.get(record.business_module, frozenset())
    if isinstance(raw_changes, list):
        for raw_change in raw_changes:
            if not isinstance(raw_change, dict) or not isinstance(raw_change.get("field"), str):
                continue
            field = raw_change["field"]
            if field not in allowed_changes or contains_sensitive_key({field: None}):
                continue
            values: dict[str, Any] = {"field": field}
            for side in ("before", "after"):
                if side in raw_change:
                    value = _safe_value(raw_change[side])
                    if value is not _UNSAFE:
                        values[side] = value
            if len(values) > 1:
                changes.append(AuditChange(**values))
    return changes, facts


def project_audit_log(record: AuditLog, actor: User | None) -> AuditLogOut:
    """把一条 ORM 记录和已联结操作者投影为安全列表项。"""
    changes, facts = _project_details(record)
    summary = dict(facts)
    if changes:
        summary["changes"] = [change.model_dump(exclude_unset=True) for change in changes]
    return AuditLogOut(
        id=record.id,
        actor_id=record.actor_id,
        actor=(
            AuditActor(
                id=actor.id,
                display_name=actor.display_name,
                account_type=AccountType(actor.account_type),
            )
            if actor is not None
            else None
        ),
        business_module=AuditModule(record.business_module),
        action=record.action,
        target_type=record.target_type,
        target_id=record.target_id,
        outcome=AuditOutcome(record.outcome),
        change_summary=summary,
        request_id=record.request_id,
        created_at=record.created_at,
    )


def _validate_time_window(
    created_from: datetime | None,
    created_to: datetime | None,
) -> None:
    for value in (created_from, created_to):
        if value is not None and value.utcoffset() is None:
            raise AppError("VALIDATION_ERROR", "审计时间必须包含时区", 422)
    if created_from is not None and created_to is not None and created_from >= created_to:
        raise AppError("VALIDATION_ERROR", "审计开始时间必须早于结束时间", 422)


def _escaped_keyword(value: str) -> str:
    term = value.strip()
    if not term:
        raise AppError("VALIDATION_ERROR", "审计关键字不能为空", 422)
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _conditions(
    *,
    created_from: datetime | None,
    created_to: datetime | None,
    actor_id: uuid.UUID | None,
    business_module: AuditModule | None,
    action: str | None,
    target_type: str | None,
    target_id: str | None,
    outcome: AuditOutcome | None,
    request_id: str | None,
    keyword: str | None,
) -> list[ColumnElement[bool]]:
    _validate_time_window(created_from, created_to)
    conditions: list[ColumnElement[bool]] = []
    if created_from is not None:
        conditions.append(AuditLog.created_at >= created_from)
    if created_to is not None:
        conditions.append(AuditLog.created_at < created_to)
    if actor_id is not None:
        conditions.append(AuditLog.actor_id == actor_id)
    if business_module is not None:
        conditions.append(AuditLog.business_module == business_module.value)
    if action is not None:
        conditions.append(AuditLog.action == action)
    if target_type is not None:
        conditions.append(AuditLog.target_type == target_type)
    if target_id is not None:
        conditions.append(AuditLog.target_id == target_id)
    if outcome is not None:
        conditions.append(AuditLog.outcome == outcome.value)
    if request_id is not None:
        conditions.append(AuditLog.request_id == request_id)
    if keyword is not None:
        pattern = _escaped_keyword(keyword)
        keyword_conditions: list[ColumnElement[bool]] = [
            AuditLog.target_id.ilike(pattern, escape="\\")
        ]
        for key in _KEYWORD_FACT_KEYS:
            keyword_conditions.extend(
                (
                    AuditLog.details[key].as_string().ilike(pattern, escape="\\"),
                    AuditLog.details["facts"][key].as_string().ilike(pattern, escape="\\"),
                )
            )
        conditions.append(or_(*keyword_conditions))
    return conditions


def list_audit_logs(
    *,
    db: Session,
    created_from: datetime | None,
    created_to: datetime | None,
    actor_id: uuid.UUID | None,
    business_module: AuditModule | None,
    action: str | None,
    target_type: str | None,
    target_id: str | None,
    outcome: AuditOutcome | None,
    request_id: str | None,
    keyword: str | None,
    page: int,
    page_size: int,
) -> AuditLogList:
    """按同一组 SQL 条件返回稳定分页窗口与总数。"""
    conditions = _conditions(
        created_from=created_from,
        created_to=created_to,
        actor_id=actor_id,
        business_module=business_module,
        action=action,
        target_type=target_type,
        target_id=target_id,
        outcome=outcome,
        request_id=request_id,
        keyword=keyword,
    )
    total = int(db.scalar(select(func.count()).select_from(AuditLog).where(*conditions)) or 0)
    rows = db.execute(
        select(AuditLog, User)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(*conditions)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return AuditLogList(
        items=[project_audit_log(record, actor) for record, actor in rows],
        page=page,
        page_size=page_size,
        total=total,
    )


def audit_log_filter_options(db: Session) -> AuditLogFilterOptions:
    """只返回审计表中真实存在的动作和对象类型。"""
    actions = list(db.scalars(select(AuditLog.action).distinct().order_by(AuditLog.action)))
    target_types = list(
        db.scalars(select(AuditLog.target_type).distinct().order_by(AuditLog.target_type))
    )
    return AuditLogFilterOptions(actions=actions, target_types=target_types)


def _uuid_target(record: AuditLog) -> uuid.UUID | None:
    if record.target_id is None:
        return None
    try:
        return uuid.UUID(record.target_id)
    except ValueError:
        return None


def _related_entry(db: Session, record: AuditLog) -> AuditRelatedEntry:
    target_id = _uuid_target(record)
    target_type = record.target_type
    if target_type == "Product":
        item = db.get(Product, target_id) if target_id is not None else None
        return _availability(target_type, item)
    if target_type == "FactVersion":
        fact_version = db.get(FactVersion, target_id) if target_id is not None else None
        return _availability(
            target_type,
            fact_version,
            str(fact_version.product_id) if fact_version is not None else None,
        )
    if target_type == "ContentTask":
        content_task = db.get(ContentTask, target_id) if target_id is not None else None
        return _availability(target_type, content_task)
    if target_type == "ContentVersion":
        content_version = db.get(ContentVersion, target_id) if target_id is not None else None
        return _availability(
            target_type,
            content_version,
            str(content_version.task_id) if content_version is not None else None,
        )
    if target_type == "PublicationRecord":
        publication = db.get(PublicationRecord, target_id) if target_id is not None else None
        return _availability(target_type, publication)
    if target_type == "PublicationAttention":
        attention = db.get(PublicationAttention, target_id) if target_id is not None else None
        return _availability(target_type, attention)
    if target_type == "GeoObservation":
        observation = db.get(GeoObservation, target_id) if target_id is not None else None
        return _availability(target_type, observation)
    if target_type == "PlatformProfile":
        profile = db.get(PlatformProfile, target_id) if target_id is not None else None
        return _availability(target_type, profile)
    if target_type == "PlatformProfileVersion":
        _changes, facts = _project_details(record)
        platform_profile_id = facts.get("platform_profile_id")
        return AuditRelatedEntry(
            status="MISSING",
            kind=target_type,
            parent_id=platform_profile_id if isinstance(platform_profile_id, str) else None,
        )
    if target_type == "PlatformAccount":
        account = db.get(PlatformAccount, target_id) if target_id is not None else None
        return _availability(
            target_type,
            account,
            str(account.platform_profile_id) if account is not None else None,
        )
    if target_type == "AIChannel":
        channel = db.get(AIChannel, target_id) if target_id is not None else None
        return _availability(target_type, channel)
    if target_type == "AIModel":
        model = db.get(AIModel, target_id) if target_id is not None else None
        return _availability(
            target_type,
            model,
            str(model.channel_id) if model is not None else None,
        )
    return AuditRelatedEntry(status="UNSUPPORTED", kind=None, parent_id=None)


def _availability(
    kind: str,
    item: object | None,
    parent_id: str | None = None,
) -> AuditRelatedEntry:
    return AuditRelatedEntry(
        status="AVAILABLE" if item is not None else "MISSING",
        kind=kind,
        parent_id=parent_id,
    )


def get_audit_log(db: Session, audit_log_id: uuid.UUID) -> AuditLogDetail:
    """按主键再次执行管理员详情所需的安全投影。"""
    row = db.execute(
        select(AuditLog, User)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .where(AuditLog.id == audit_log_id)
    ).one_or_none()
    if row is None:
        raise not_found("审计日志")
    record, actor = row
    base = project_audit_log(record, actor)
    changes, facts = _project_details(record)
    return AuditLogDetail(
        **base.model_dump(),
        changes=changes,
        facts=facts,
        result_message=record.result_message,
        error_code=record.error_code,
        related_entry=_related_entry(db, record),
    )
