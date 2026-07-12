"""发布、任务终态与发布异常修复的领域应用服务。"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from urllib.parse import urlparse

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.errors import AppError, not_found
from app.models import (
    ContentTask,
    ContentVersion,
    FactVersion,
    FileRecord,
    PlatformAccount,
    PlatformProfile,
    PlatformProfileVersion,
    PlatformType,
    Product,
    PublicationAttachment,
    PublicationAttention,
    PublicationRecord,
    PublicationStatusEvent,
    QueryTopic,
    User,
)
from app.schemas import (
    FactVersionCandidate,
    FileRecordOut,
    ManualPublicationCreate,
    PlatformAccountOut,
    PlatformVersionCandidate,
    ProductOut,
    PublicationAttentionList,
    PublicationAttentionOut,
    PublicationCandidate,
    PublicationCandidateList,
    PublicationCommand,
    PublicationEvent,
    PublicationRecordOut,
    PublicationRepairContext,
    PublicationRepairDefaults,
    PublicationRepairTaskCreate,
    QueryTopicOut,
    ResolvePublicationAttentionRequest,
    VersionChange,
    VersionDifference,
)
from app.services.projections import (
    IN_FLIGHT_PUBLICATION_STATUSES,
    content_task_out,
    content_version_out,
    fact_version_out,
    platform_version_out,
)

PUBLICATION_TRANSITIONS = {
    ("PENDING_MANUAL_PUBLISH", "mark-platform-review"): "PLATFORM_REVIEW",
    ("PENDING_MANUAL_PUBLISH", "reject"): "REJECTED",
    ("PLATFORM_REVIEW", "mark-published"): "PUBLISHED",
    ("PLATFORM_REVIEW", "reject"): "REJECTED",
    ("PUBLISHED", "verify"): "VERIFIED",
    ("PUBLISHED", "remove"): "REMOVED",
    ("PUBLISHED", "mark-verification-failed"): "VERIFICATION_FAILED",
    ("VERIFIED", "remove"): "REMOVED",
    ("VERIFIED", "mark-verification-failed"): "VERIFICATION_FAILED",
}

def domain_allowed(url: str, allowed_domains: list[str]) -> bool:
    """仅允许 HTTP(S) 且主机等于或属于平台配置域名。"""
    parsed = urlparse(url)
    host = (parsed.hostname or "").casefold().strip(".")
    if parsed.scheme not in {"http", "https"} or not host:
        return False
    return any(host == domain or host.endswith(f".{domain}") for domain in allowed_domains)


def verified_files(db: Session, file_ids: list[uuid.UUID]) -> list[FileRecord]:
    """附件只能绑定现存且已完成完整性校验的文件。"""
    if len(file_ids) != len(set(file_ids)):
        raise AppError("VALIDATION_ERROR", "附件文件 ID 重复", 422)
    files = (
        list(db.scalars(select(FileRecord).where(FileRecord.id.in_(file_ids))))
        if file_ids
        else []
    )
    if len(files) != len(file_ids) or any(file.status != "VERIFIED" for file in files):
        raise AppError("FILE_INTEGRITY_FAILED", "附件必须全部处于 VERIFIED 状态", 422)
    return files


def require_publishable(db: Session, content_id: uuid.UUID) -> ContentVersion:
    """读取可发布内容，并重新校验不可变事实与任务状态。"""
    content = db.get(ContentVersion, content_id)
    if content is None:
        raise not_found("内容版本")
    fact = db.get(FactVersion, content.fact_version_id)
    task = db.scalar(
        select(ContentTask).where(ContentTask.id == content.task_id).with_for_update()
    )
    if content.status != "APPROVED" or fact is None or fact.status != "APPROVED":
        raise AppError("CONTENT_NOT_APPROVED", "只有绑定有效批准事实的批准内容可以发布", 409)
    if task is None or task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能创建新发布", 409)
    return content


def _task_for_publication(db: Session, publication: PublicationRecord) -> ContentTask:
    task = db.scalar(
        select(ContentTask)
        .join(ContentVersion, ContentVersion.task_id == ContentTask.id)
        .where(ContentVersion.id == publication.content_version_id)
    )
    if task is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布记录关联的内容任务不存在", 409)
    return task


def publication_out(db: Session, publication: PublicationRecord) -> PublicationRecordOut:
    """投影发布详情及服务端允许动作。"""
    task = _task_for_publication(db, publication)
    events = list(
        db.scalars(
            select(PublicationStatusEvent)
            .where(PublicationStatusEvent.publication_id == publication.id)
            .order_by(PublicationStatusEvent.created_at, PublicationStatusEvent.id)
        )
    )
    files = list(
        db.scalars(
            select(FileRecord)
            .join(PublicationAttachment, PublicationAttachment.file_id == FileRecord.id)
            .where(PublicationAttachment.publication_id == publication.id)
            .order_by(FileRecord.created_at, FileRecord.id)
        )
    )
    return PublicationRecordOut(
        id=publication.id,
        content_version_id=publication.content_version_id,
        task_id=task.id,
        platform_account_id=publication.platform_account_id,
        section_url=publication.section_url,
        actual_title=publication.actual_title,
        final_url=publication.final_url,
        published_at=publication.published_at,
        status=publication.status,
        content_hash=publication.content_hash,
        created_by=publication.created_by,
        created_at=publication.created_at,
        status_events=[
            PublicationEvent(
                status=event.status,
                comment=event.comment,
                actor_id=event.actor_id,
                created_at=event.created_at,
            )
            for event in events
        ],
        attachments=[FileRecordOut.model_validate(file) for file in files],
        available_actions=[
            command
            for (source, command), _target in PUBLICATION_TRANSITIONS.items()
            if source == publication.status
        ],
    )


def list_publication_candidates(db: Session) -> PublicationCandidateList:
    """返回锁定平台及其活跃账号，避免前端重建平台一致性规则。"""
    rows = db.execute(
        select(ContentVersion, ContentTask, PlatformProfileVersion, PlatformProfile)
        .join(ContentTask, ContentTask.id == ContentVersion.task_id)
        .join(FactVersion, FactVersion.id == ContentVersion.fact_version_id)
        .join(
            PlatformProfileVersion,
            PlatformProfileVersion.id == ContentTask.platform_profile_version_id,
        )
        .join(PlatformProfile, PlatformProfile.id == PlatformProfileVersion.platform_profile_id)
        .where(
            ContentVersion.status == "APPROVED",
            FactVersion.status == "APPROVED",
            ContentTask.status == "OPEN",
        )
        .order_by(ContentVersion.created_at.desc(), ContentVersion.id)
    ).all()
    candidates: list[PublicationCandidate] = []
    for content, task, platform_version, profile in rows:
        accounts = list(
            db.scalars(
                select(PlatformAccount)
                .where(
                    PlatformAccount.platform_profile_id == profile.id,
                    PlatformAccount.is_active.is_(True),
                )
                .order_by(PlatformAccount.label, PlatformAccount.id)
            )
        )
        candidates.append(
            PublicationCandidate(
                content_version=content_version_out(content),
                task_id=task.id,
                platform_profile_id=profile.id,
                platform_profile_name=profile.name,
                platform_profile_version_id=platform_version.id,
                platform_profile_version=platform_version.version,
                matching_accounts=[PlatformAccountOut.model_validate(item) for item in accounts],
            )
        )
    return PublicationCandidateList(items=candidates)


def create_manual_publication(
    *,
    db: Session,
    payload: ManualPublicationCreate,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> PublicationRecordOut:
    """幂等登记人工发布，并在服务端校验任务锁定平台。"""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": idempotency_key},
    )
    existing = db.scalar(
        select(PublicationRecord).where(PublicationRecord.idempotency_key == idempotency_key)
    )
    if existing is not None:
        existing_file_ids = set(
            db.scalars(
                select(PublicationAttachment.file_id).where(
                    PublicationAttachment.publication_id == existing.id
                )
            )
        )
        if (
            existing.content_version_id != payload.content_version_id
            or existing.platform_account_id != payload.platform_account_id
            or existing.section_url != str(payload.section_url)
            or existing_file_ids != set(payload.attachment_file_ids)
        ):
            raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一发布登记", 409)
        return publication_out(db, existing)

    content = require_publishable(db, payload.content_version_id)
    task = db.get(ContentTask, content.task_id)
    account = db.get(PlatformAccount, payload.platform_account_id)
    if task is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "内容任务不存在", 409)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能创建新发布", 409)
    if account is None or not account.is_active:
        raise AppError("INVALID_STATE_TRANSITION", "平台账号不存在或已停用", 409)
    platform_version = db.get(PlatformProfileVersion, task.platform_profile_version_id)
    if (
        platform_version is None
        or account.platform_profile_id != platform_version.platform_profile_id
    ):
        raise AppError("PUBLICATION_PLATFORM_MISMATCH", "发布账号平台与内容任务锁定平台不一致", 422)
    profile = db.get(PlatformProfile, account.platform_profile_id)
    if profile is None or not domain_allowed(str(payload.section_url), profile.allowed_domains):
        raise AppError("VALIDATION_ERROR", "栏目 URL 不属于平台允许域名", 422)
    files = verified_files(db, payload.attachment_file_ids)
    publication = PublicationRecord(
        idempotency_key=idempotency_key,
        content_version_id=content.id,
        platform_account_id=account.id,
        section_url=str(payload.section_url),
        status="PENDING_MANUAL_PUBLISH",
        content_hash=content.content_hash,
        created_by=actor.id,
    )
    db.add(publication)
    db.flush()
    db.add(
        PublicationStatusEvent(
            publication_id=publication.id,
            status=publication.status,
            comment="创建人工发布登记",
            actor_id=actor.id,
        )
    )
    db.add_all(
        PublicationAttachment(publication_id=publication.id, file_id=file.id) for file in files
    )
    append_audit(
        db,
        actor_id=actor.id,
        action="publication.created",
        target_type="PublicationRecord",
        target_id=publication.id,
        request_id=request_id,
        details={"content_version_id": str(content.id), "task_id": str(task.id)},
    )
    db.commit()
    return publication_out(db, publication)


def command_publication(
    *,
    db: Session,
    publication_id: uuid.UUID,
    command: str,
    payload: PublicationCommand,
    actor: User,
    request_id: str,
) -> PublicationRecordOut:
    """锁定发布与任务后原子执行发布状态、任务终态和异常待办。"""
    publication = db.scalar(
        select(PublicationRecord)
        .where(PublicationRecord.id == publication_id)
        .with_for_update()
    )
    if publication is None:
        raise not_found("发布记录")
    target = PUBLICATION_TRANSITIONS.get((publication.status, command))
    if target is None:
        raise AppError(
            "INVALID_STATE_TRANSITION",
            f"发布记录不能从 {publication.status} 执行 {command}",
            409,
        )
    task = db.scalar(
        select(ContentTask)
        .join(ContentVersion, ContentVersion.task_id == ContentTask.id)
        .where(ContentVersion.id == publication.content_version_id)
        .with_for_update()
    )
    if task is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布记录关联的内容任务不存在", 409)
    if command == "mark-published":
        if (
            payload.actual_title is None
            or payload.final_url is None
            or payload.published_at is None
        ):
            raise AppError(
                "VALIDATION_ERROR",
                "登记已发布必须填写实际标题、最终 URL 和发布时间",
                422,
            )
        account = db.get(PlatformAccount, publication.platform_account_id)
        profile = db.get(PlatformProfile, account.platform_profile_id) if account else None
        if profile is None or not domain_allowed(str(payload.final_url), profile.allowed_domains):
            raise AppError("VALIDATION_ERROR", "最终 URL 不属于平台允许域名", 422)
        publication.actual_title = payload.actual_title
        publication.final_url = str(payload.final_url)
        publication.published_at = payload.published_at
    if command == "verify" and payload.content_matches is not True:
        raise AppError("VALIDATION_ERROR", "验证发布必须明确确认页面正文匹配批准内容", 422)

    publication.status = target
    db.add(
        PublicationStatusEvent(
            publication_id=publication.id,
            status=target,
            comment=payload.comment,
            actor_id=actor.id,
        )
    )
    if target == "VERIFIED" and task.status == "OPEN":
        task.status = "COMPLETED"
        task.revision += 1
        append_audit(
            db,
            actor_id=actor.id,
            action="content_task.completed_by_verified_publication",
            target_type="ContentTask",
            target_id=task.id,
            request_id=request_id,
            details={"publication_id": str(publication.id), "revision": task.revision},
        )
    if target in {"REMOVED", "VERIFICATION_FAILED"}:
        attention = db.scalar(
            select(PublicationAttention).where(
                PublicationAttention.publication_record_id == publication.id
            )
        )
        if attention is None:
            attention = PublicationAttention(
                publication_record_id=publication.id,
                trigger_status=target,
                status="OPEN",
            )
            db.add(attention)
            db.flush()
            append_audit(
                db,
                actor_id=actor.id,
                action="publication_attention.opened",
                target_type="PublicationAttention",
                target_id=attention.id,
                request_id=request_id,
                details={"publication_id": str(publication.id), "trigger_status": target},
            )
    append_audit(
        db,
        actor_id=actor.id,
        action=f"publication.{re.sub('-', '_', command)}",
        target_type="PublicationRecord",
        target_id=publication.id,
        request_id=request_id,
        details={"status": target},
    )
    db.commit()
    return publication_out(db, publication)


def cancel_content_task(
    *,
    db: Session,
    task_id: uuid.UUID,
    expected_revision: int,
    comment: str,
    actor: User,
    request_id: str,
) -> ContentTask:
    """取消没有在途发布的 OPEN 任务。"""
    task = db.scalar(select(ContentTask).where(ContentTask.id == task_id).with_for_update())
    if task is None:
        raise not_found("内容任务")
    if task.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "内容任务已被其他请求修改", 409)
    if task.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "终态内容任务不能再次变更状态", 409)
    in_flight = db.scalar(
        select(PublicationRecord.id)
        .join(ContentVersion, ContentVersion.id == PublicationRecord.content_version_id)
        .where(
            ContentVersion.task_id == task.id,
            PublicationRecord.status.in_(IN_FLIGHT_PUBLICATION_STATUSES),
        )
        .limit(1)
    )
    if in_flight is not None:
        raise AppError("PUBLICATION_IN_FLIGHT", "任务存在进行中的发布，必须先处置发布记录", 409)
    task.status = "CANCELLED"
    task.revision += 1
    append_audit(
        db,
        actor_id=actor.id,
        action="content_task.cancelled",
        target_type="ContentTask",
        target_id=task.id,
        request_id=request_id,
        details={"comment": comment, "revision": task.revision},
    )
    db.commit()
    return task


def attention_out(db: Session, attention: PublicationAttention) -> PublicationAttentionOut:
    """投影异常待办及关联修复任务。"""
    publication = db.get(PublicationRecord, attention.publication_record_id)
    if publication is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "异常待办关联的发布记录不存在", 409)
    original_task = _task_for_publication(db, publication)
    repair_task_id = db.scalar(
        select(ContentTask.id).where(ContentTask.source_publication_attention_id == attention.id)
    )
    actions: list[str] = []
    if attention.status == "OPEN":
        if repair_task_id is None:
            actions.append("CREATE_REPAIR_TASK")
        actions.append("RESOLVE")
    return PublicationAttentionOut(
        id=attention.id,
        publication_record_id=attention.publication_record_id,
        original_task_id=original_task.id,
        trigger_status=attention.trigger_status,
        status=attention.status,
        revision=attention.revision,
        opened_at=attention.opened_at,
        resolved_at=attention.resolved_at,
        resolved_by=attention.resolved_by,
        resolution_comment=attention.resolution_comment,
        repair_task_id=repair_task_id,
        available_actions=actions,
    )


def list_attentions(db: Session, status_filter: str | None) -> PublicationAttentionList:
    query = select(PublicationAttention)
    if status_filter is not None:
        query = query.where(PublicationAttention.status == status_filter)
    attentions = list(
        db.scalars(query.order_by(PublicationAttention.opened_at.desc(), PublicationAttention.id))
    )
    return PublicationAttentionList(items=[attention_out(db, item) for item in attentions])


def get_attention(db: Session, attention_id: uuid.UUID) -> PublicationAttentionOut:
    attention = db.get(PublicationAttention, attention_id)
    if attention is None:
        raise not_found("发布异常待办")
    return attention_out(db, attention)


def _difference(
    from_id: uuid.UUID,
    to_id: uuid.UUID,
    before: dict[str, object],
    after: dict[str, object],
) -> VersionDifference:
    changes = [
        VersionChange(field=field, before=before.get(field), after=after.get(field))
        for field in sorted(set(before) | set(after))
        if before.get(field) != after.get(field)
    ]
    return VersionDifference(from_id=from_id, to_id=to_id, changes=changes)


def get_repair_context(db: Session, attention_id: uuid.UUID) -> PublicationRepairContext:
    """返回固定业务上下文、当前候选和确定性版本差异。"""
    attention = db.get(PublicationAttention, attention_id)
    if attention is None:
        raise not_found("发布异常待办")
    publication = db.get(PublicationRecord, attention.publication_record_id)
    if publication is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "异常待办关联的发布记录不存在", 409)
    task = _task_for_publication(db, publication)
    product = db.get(Product, task.product_id)
    topic = db.get(QueryTopic, task.query_topic_id)
    original_fact = db.get(FactVersion, task.fact_version_id)
    original_platform = db.get(PlatformProfileVersion, task.platform_profile_version_id)
    profile = (
        db.get(PlatformProfile, original_platform.platform_profile_id)
        if original_platform is not None
        else None
    )
    if any(item is None for item in (product, topic, original_fact, original_platform, profile)):
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布修复上下文不完整", 409)
    assert product is not None
    assert topic is not None
    assert original_fact is not None
    assert original_platform is not None
    assert profile is not None
    original_fact_out = fact_version_out(original_fact)
    original_platform_out = platform_version_out(original_platform)
    fact_candidates = list(
        db.scalars(
            select(FactVersion)
            .where(FactVersion.product_id == task.product_id, FactVersion.status == "APPROVED")
            .order_by(FactVersion.version.desc(), FactVersion.id)
        )
    )
    platform_candidates = list(
        db.scalars(
            select(PlatformProfileVersion)
            .where(
                PlatformProfileVersion.platform_profile_id == profile.id,
                PlatformProfileVersion.status == "ACTIVE",
            )
            .order_by(PlatformProfileVersion.version.desc(), PlatformProfileVersion.id)
        )
    )
    before_fact = original_fact_out.snapshot.model_dump(mode="json")
    before_platform = original_platform_out.rules.model_dump(mode="json")
    return PublicationRepairContext(
        attention=attention_out(db, attention),
        publication=publication_out(db, publication),
        original_task=content_task_out(db, task),
        product=ProductOut.model_validate(product),
        query_topic=QueryTopicOut.model_validate(topic),
        platform_profile_id=profile.id,
        platform_profile_name=profile.name,
        original_fact_version=original_fact_out,
        fact_candidates=[
            FactVersionCandidate(
                version=fact_version_out(candidate),
                difference=_difference(
                    original_fact.id,
                    candidate.id,
                    before_fact,
                    fact_version_out(candidate).snapshot.model_dump(mode="json"),
                ),
            )
            for candidate in fact_candidates
        ],
        original_platform_version=original_platform_out,
        platform_candidates=[
            PlatformVersionCandidate(
                version=platform_version_out(candidate),
                difference=_difference(
                    original_platform.id,
                    candidate.id,
                    before_platform,
                    platform_version_out(candidate).rules.model_dump(mode="json"),
                ),
            )
            for candidate in platform_candidates
        ],
        defaults=PublicationRepairDefaults(
            target_audience=task.target_audience,
            content_angle=task.content_angle,
            conversion_goal=task.conversion_goal,
            desired_format=task.desired_format,
            desired_length_min=task.desired_length_min,
            desired_length_max=task.desired_length_max,
            canonical_url=task.canonical_url,
        ),
    )


def create_repair_task(
    *,
    db: Session,
    attention_id: uuid.UUID,
    payload: PublicationRepairTaskCreate,
    actor: User,
    request_id: str,
) -> ContentTask:
    """锁定异常与候选版本，创建上下文不可漂移的标准内容任务。"""
    attention = db.scalar(
        select(PublicationAttention)
        .where(PublicationAttention.id == attention_id)
        .with_for_update()
    )
    if attention is None:
        raise not_found("发布异常待办")
    if attention.revision != payload.expected_attention_revision:
        raise AppError("REVISION_CONFLICT", "发布异常待办已被其他请求修改", 409)
    if attention.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "只有 OPEN 异常可以创建修复任务", 409)
    existing_task = db.scalar(
        select(ContentTask).where(ContentTask.source_publication_attention_id == attention.id)
    )
    if existing_task is not None:
        raise AppError("REPAIR_TASK_EXISTS", "该异常已经创建修复任务", 409)
    publication = db.get(PublicationRecord, attention.publication_record_id)
    if publication is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "异常待办关联的发布记录不存在", 409)
    original_task = _task_for_publication(db, publication)
    product = db.get(Product, original_task.product_id)
    if product is None or product.status != "ACTIVE":
        raise AppError("INVALID_STATE_TRANSITION", "已停用产品不能创建修复任务", 409)
    if db.get(QueryTopic, original_task.query_topic_id) is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "原任务目标问题不存在", 409)
    fact = db.scalar(
        select(FactVersion).where(FactVersion.id == payload.fact_version_id).with_for_update()
    )
    platform_version = db.scalar(
        select(PlatformProfileVersion)
        .where(PlatformProfileVersion.id == payload.platform_profile_version_id)
        .with_for_update()
    )
    original_platform = db.get(
        PlatformProfileVersion, original_task.platform_profile_version_id
    )
    if fact is None or fact.status != "APPROVED" or fact.product_id != original_task.product_id:
        raise AppError("FACT_NOT_APPROVED", "修复任务必须选择当前已批准的同产品事实版本", 409)
    if (
        platform_version is None
        or platform_version.status != "ACTIVE"
        or original_platform is None
        or platform_version.platform_profile_id != original_platform.platform_profile_id
    ):
        raise AppError("INVALID_STATE_TRANSITION", "修复任务必须选择原平台当前 ACTIVE 规则", 409)
    profile = db.get(PlatformProfile, platform_version.platform_profile_id)
    platform_type = (
        db.get(PlatformType, profile.platform_type_id)
        if profile is not None and profile.platform_type_id is not None
        else None
    )
    if platform_type is None:
        raise AppError("PLATFORM_TYPE_MISSING", "原平台类型不存在，不能创建修复任务", 409)
    task = ContentTask(
        query_topic_id=original_task.query_topic_id,
        product_id=original_task.product_id,
        fact_version_id=fact.id,
        platform_profile_version_id=platform_version.id,
        platform_type_id=platform_type.id,
        platform_type_snapshot={
            "id": str(platform_type.id),
            "name": platform_type.name,
            "slug": platform_type.slug,
        },
        user_prompt_markdown="",
        source_publication_attention_id=attention.id,
        target_audience=payload.target_audience,
        content_angle=payload.content_angle,
        conversion_goal=payload.conversion_goal,
        desired_format=payload.desired_format,
        desired_length_min=payload.desired_length_min,
        desired_length_max=payload.desired_length_max,
        canonical_url=str(payload.canonical_url),
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
    append_audit(
        db,
        actor_id=actor.id,
        action="publication_attention.repair_task_created",
        target_type="PublicationAttention",
        target_id=attention.id,
        request_id=request_id,
        details={
            "repair_task_id": str(task.id),
            "fact_version_id": str(fact.id),
            "platform_profile_version_id": str(platform_version.id),
        },
    )
    db.commit()
    return task


def resolve_attention(
    *,
    db: Session,
    attention_id: uuid.UUID,
    payload: ResolvePublicationAttentionRequest,
    actor: User,
    request_id: str,
) -> PublicationAttentionOut:
    """使用非空处置说明显式解决异常，修复任务状态不隐式参与。"""
    attention = db.scalar(
        select(PublicationAttention)
        .where(PublicationAttention.id == attention_id)
        .with_for_update()
    )
    if attention is None:
        raise not_found("发布异常待办")
    if attention.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "发布异常待办已被其他请求修改", 409)
    if attention.status != "OPEN":
        raise AppError("INVALID_STATE_TRANSITION", "只有 OPEN 异常可以解决", 409)
    comment = payload.resolution_comment.strip()
    if not comment:
        raise AppError("RESOLUTION_COMMENT_REQUIRED", "处置说明不能为空", 422)
    actor_id = actor.id
    attention.status = "RESOLVED"
    attention.revision += 1
    attention.resolved_at = datetime.now(UTC)
    attention.resolved_by = actor_id
    attention.resolution_comment = comment
    append_audit(
        db,
        actor_id=actor_id,
        action="publication_attention.resolved",
        target_type="PublicationAttention",
        target_id=attention.id,
        request_id=request_id,
        details={"revision": attention.revision},
    )
    db.commit()
    return attention_out(db, attention)


def open_attention_count(db: Session) -> int:
    """返回 OPEN 发布异常数量，供工作台消费同一业务状态。"""
    return int(
        db.scalar(
            select(func.count())
            .select_from(PublicationAttention)
            .where(PublicationAttention.status == "OPEN")
        )
        or 0
    )
