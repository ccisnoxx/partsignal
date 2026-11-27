"""目标问题、平台身份和内容任务的事务命令。"""

from __future__ import annotations

import uuid

from sqlalchemy import exists, func, literal, select, text, union_all
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, in_use, not_found
from app.models.campaign import (
    ContentCampaign,
    ContentCampaignPlatform,
    ContentCampaignProduct,
    ContentCampaignTopic,
)
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformType, QueryTopic
from app.models.content import ContentBriefSnapshot, ContentTask, ContentTaskGeoSource
from app.models.geo_files import GeoObservation
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.schemas.configuration import (
    PlatformProfileCreate,
    QueryTopicCreate,
    QueryTopicListItem,
    QueryTopicListPage,
    QueryTopicListSort,
    QueryTopicOut,
    QueryTopicPageSize,
    QueryTopicReferenceSummary,
    QueryTopicUpdate,
)
from app.schemas.content import ContentBriefInput, ContentTaskCreate, ContentTaskTarget
from app.services.platform_configuration import lock_active_platform, lock_platform_prompt_bindings
from app.services.platform_logo_files import lock_platform_logo_change
from app.services.prompt_version_queries import latest_published_prompt_version

_QUERY_TOPIC_BLOCKERS = (
    ("CONTENT_TASK", "内容任务"),
    ("CONTENT_CAMPAIGN", "内容活动"),
    ("GEO_OPTIMIZATION_SOURCE", "GEO 优化来源"),
    ("GEO_OBSERVATION", "GEO 观测"),
    ("GEO_PROMPT_VARIANT", "GEO 问题变体"),
)


def _platform_slug_conflict() -> AppError:
    """返回可定位到平台 slug 字段的稳定重复错误。"""
    message = "平台 slug 已存在"
    return AppError(
        "PLATFORM_SLUG_EXISTS",
        message,
        409,
        {
            "errors": [
                {
                    "loc": ["body", "slug"],
                    "msg": message,
                    "type": "platform_slug_exists",
                }
            ]
        },
    )


class ContentTaskFactProductMismatch(Exception):
    """目标事实版本不属于内容任务产品。"""


def _query_topic_reference_counts(
    db: Session, topic_ids: list[uuid.UUID]
) -> dict[tuple[uuid.UUID, str], int]:
    """批量统计所有会阻断问题删除的直接引用。"""
    if not topic_ids:
        return {}
    direct_references = union_all(
        select(
            ContentTask.query_topic_id.label("resource_id"),
            literal("CONTENT_TASK").label("blocker_type"),
        ).where(ContentTask.query_topic_id.in_(topic_ids)),
        select(
            ContentCampaignTopic.query_topic_id.label("resource_id"),
            literal("CONTENT_CAMPAIGN").label("blocker_type"),
        ).where(ContentCampaignTopic.query_topic_id.in_(topic_ids)),
        select(
            ContentTaskGeoSource.query_topic_id.label("resource_id"),
            literal("GEO_OPTIMIZATION_SOURCE").label("blocker_type"),
        ).where(ContentTaskGeoSource.query_topic_id.in_(topic_ids)),
        select(
            GeoObservation.query_topic_id.label("resource_id"),
            literal("GEO_OBSERVATION").label("blocker_type"),
        ).where(GeoObservation.query_topic_id.in_(topic_ids)),
        select(
            GeoPromptVariant.query_topic_id.label("resource_id"),
            literal("GEO_PROMPT_VARIANT").label("blocker_type"),
        ).where(GeoPromptVariant.query_topic_id.in_(topic_ids)),
    ).subquery()
    return {
        (resource_id, blocker_type): int(count)
        for resource_id, blocker_type, count in db.execute(
            select(
                direct_references.c.resource_id,
                direct_references.c.blocker_type,
                func.count(),
            ).group_by(
                direct_references.c.resource_id,
                direct_references.c.blocker_type,
            )
        ).tuples()
    }


def _query_topic_blockers(
    reference_counts: dict[tuple[uuid.UUID, str], int], topic_id: uuid.UUID
) -> list[dict[str, str | int]]:
    """按稳定类型顺序返回一个问题的非零删除阻断。"""
    return [
        {"type": blocker_type, "count": count}
        for blocker_type, _label in _QUERY_TOPIC_BLOCKERS
        if (count := reference_counts.get((topic_id, blocker_type), 0))
    ]


def query_topics_out(
    db: Session,
    topics: list[QueryTopic],
    *,
    can_delete: bool,
    reference_counts: dict[tuple[uuid.UUID, str], int] | None = None,
) -> list[QueryTopicOut]:
    """批量投影目标问题，并仅向管理员公开删除资格。"""
    if not topics:
        return []
    if reference_counts is None:
        reference_counts = (
            _query_topic_reference_counts(db, [topic.id for topic in topics]) if can_delete else {}
        )
    items: list[QueryTopicOut] = []
    for topic in topics:
        blockers = _query_topic_blockers(reference_counts, topic.id)
        payload = {
            field: getattr(topic, field)
            for field in QueryTopicOut.model_fields
            if field not in {"available_actions", "deletion", "primary_task"}
        }
        payload["available_actions"] = [
            "UPDATE",
            *(["DELETE"] if can_delete and not blockers else []),
        ]
        payload["deletion"] = {"blockers": blockers} if can_delete else None
        payload["primary_task"] = "USE_FOR_OBSERVATION"
        items.append(QueryTopicOut.model_validate(payload))
    return items


def list_query_topic_items(
    *,
    db: Session,
    q: str | None,
    sort: QueryTopicListSort,
    page: int,
    page_size: QueryTopicPageSize,
    can_delete: bool,
    is_active: bool | None = None,
) -> QueryTopicListPage:
    """返回 V2 使用的服务端搜索、排序、分页和引用摘要。"""
    query = select(QueryTopic)
    if is_active is not None:
        query = query.where(QueryTopic.is_active.is_(is_active))
    if q is not None:
        term = q.strip()
        if not term:
            raise AppError("VALIDATION_ERROR", "搜索词不能为空", 422)
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        variant = func.unnest(QueryTopic.variants).column_valued("variant")
        query = query.where(
            QueryTopic.canonical_question.ilike(pattern, escape="\\")
            | QueryTopic.description.ilike(pattern, escape="\\")
            | exists(
                select(1).where(variant.ilike(pattern, escape="\\"))
            )
        )

    total = int(db.scalar(select(func.count()).select_from(query.subquery())) or 0)
    primary_order = {
        QueryTopicListSort.QUESTION_ASC: func.lower(QueryTopic.canonical_question).asc(),
        QueryTopicListSort.QUESTION_DESC: func.lower(QueryTopic.canonical_question).desc(),
        QueryTopicListSort.INTENT_ASC: QueryTopic.intent_type.asc(),
        QueryTopicListSort.INTENT_DESC: QueryTopic.intent_type.desc(),
    }[sort]
    topics = list(
        db.scalars(
            query.order_by(primary_order, QueryTopic.id.asc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    reference_counts = _query_topic_reference_counts(db, [topic.id for topic in topics])
    projected = query_topics_out(
        db,
        topics,
        can_delete=can_delete,
        reference_counts=reference_counts,
    )
    items = [
        QueryTopicListItem.model_validate(
            {
                **item.model_dump(),
                "references": QueryTopicReferenceSummary(
                    content_task_count=reference_counts.get((item.id, "CONTENT_TASK"), 0),
                    geo_optimization_count=reference_counts.get(
                        (item.id, "GEO_OPTIMIZATION_SOURCE"), 0
                    ),
                    observation_count=reference_counts.get((item.id, "GEO_OBSERVATION"), 0),
                    campaign_count=reference_counts.get((item.id, "CONTENT_CAMPAIGN"), 0),
                ),
            }
        )
        for item in projected
    ]
    return QueryTopicListPage(
        items=items,
        page=page,
        page_size=page_size,
        total=total,
    )


def query_topic_out(db: Session, topic: QueryTopic, *, can_delete: bool) -> QueryTopicOut:
    """投影单个目标问题及其当前动作。"""
    return query_topics_out(db, [topic], can_delete=can_delete)[0]


def create_query_topic(
    *, db: Session, payload: QueryTopicCreate, actor: User, request_id: str
) -> QueryTopic:
    """创建目标问题。"""
    topic = QueryTopic(
        canonical_question=payload.canonical_question,
        intent_type=payload.intent_type.value,
        variants=payload.variants,
        description=payload.description,
        is_active=True,
    )
    db.add(topic)
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="query_topic.created",
            target_type="QueryTopic",
            target_id=topic.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="GEO 问题已创建",
            details={"facts": {"revision": topic.revision, "is_active": topic.is_active}},
        ),
    )
    db.commit()
    return topic


def update_query_topic(
    *,
    db: Session,
    query_topic_id: uuid.UUID,
    payload: QueryTopicUpdate,
    actor: User,
    request_id: str,
) -> QueryTopic:
    """以 revision 乐观锁更新目标问题。"""
    topic = db.scalar(
        select(QueryTopic).where(QueryTopic.id == query_topic_id).with_for_update()
    )
    if topic is None:
        raise not_found("目标问题")
    if topic.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "目标问题已被其他请求修改", 409)
    topic.canonical_question = payload.canonical_question
    topic.intent_type = payload.intent_type.value
    topic.variants = payload.variants
    topic.description = payload.description
    if payload.is_active is not None:
        topic.is_active = payload.is_active
    topic.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="query_topic.updated",
            target_type="QueryTopic",
            target_id=topic.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="GEO 问题已更新",
            details={"facts": {"revision": topic.revision, "is_active": topic.is_active}},
        ),
    )
    db.commit()
    return topic


def delete_query_topic(
    *,
    db: Session,
    query_topic_id: uuid.UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> None:
    """仅删除当前 revision 且没有任何业务历史引用的目标问题。"""
    topic = db.scalar(select(QueryTopic).where(QueryTopic.id == query_topic_id).with_for_update())
    if topic is None:
        raise not_found("目标问题")
    if topic.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "目标问题已被其他请求修改", 409)
    reference_counts = _query_topic_reference_counts(db, [topic.id])
    references = [
        (blocker_type, label, reference_counts.get((topic.id, blocker_type), 0))
        for blocker_type, label in _QUERY_TOPIC_BLOCKERS
    ]
    if any(count for _, _, count in references):
        raise in_use("QUERY_TOPIC_IN_USE", "目标问题", references)
    deleted_revision = topic.revision
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONTENT_PLANNING,
            action="query_topic.deleted",
            target_type="QueryTopic",
            target_id=topic.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="GEO 问题已删除",
            details={"facts": {"revision": deleted_revision}},
        ),
    )
    db.delete(topic)
    db.commit()


def create_platform_profile(
    *, db: Session, payload: PlatformProfileCreate, actor: User, request_id: str
) -> PlatformProfile:
    """创建稳定平台身份，不隐式创建 Prompt。"""
    lock_platform_prompt_bindings(db)
    if db.get(PlatformType, payload.platform_type_id) is None:
        raise not_found("平台类型")
    bound_prompt_version_id: uuid.UUID | None = None
    if payload.platform_prompt_id is not None:
        selected_prompt_id = db.scalar(
            select(PlatformPrompt.id)
            .where(PlatformPrompt.id == payload.platform_prompt_id)
            .with_for_update()
        )
        if selected_prompt_id is None:
            raise not_found("平台 Prompt")
        latest_ver = latest_published_prompt_version(db, payload.platform_prompt_id)
        if latest_ver is None:
            raise AppError("PLATFORM_PROMPT_MISSING", "所选 Prompt 尚无已发布版本，不能绑定", 409)
        bound_prompt_version_id = latest_ver.id
    if db.scalar(select(PlatformProfile.id).where(PlatformProfile.slug == payload.slug)):
        raise _platform_slug_conflict()
    logo_file_id = lock_platform_logo_change(
        db,
        current_file_id=None,
        logo=payload.logo,
    )
    profile = PlatformProfile(
        name=payload.name,
        slug=payload.slug,
        allowed_domains=payload.allowed_domains,
        platform_type_id=payload.platform_type_id,
        platform_prompt_id=payload.platform_prompt_id,
        platform_prompt_version_id=bound_prompt_version_id,
        website_url=str(payload.website_url) if payload.website_url is not None else None,
        logo_file_id=logo_file_id,
        logo_external_url=None,
        is_active=True,
    )
    db.add(profile)
    try:
        db.flush()
    except IntegrityError as error:
        orig = error.orig
        sqlstate = getattr(orig, "sqlstate", None)
        constraint_name = getattr(getattr(orig, "diag", None), "constraint_name", None)
        if sqlstate != "23505" or constraint_name != "uq_platform_profiles_slug":
            raise
        db.rollback()
        raise _platform_slug_conflict() from error
    db.commit()
    return profile


def lock_content_task_creation_resources(
    db: Session,
    payload: ContentTaskTarget,
) -> PlatformProfile:
    """按统一顺序锁定并校验内容任务的三个权威目标资源。"""
    profile = lock_active_platform(db, payload.platform_profile_id)
    product = db.scalar(
        select(Product)
        .where(Product.id == payload.product_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if product is None or product.status != "ACTIVE":
        raise AppError("FACT_NOT_APPROVED", "已停用产品不能创建新任务", 409)
    fact_version = db.scalar(
        select(FactVersion)
        .where(FactVersion.id == payload.fact_version_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if (
        fact_version is None
        or fact_version.status != "APPROVED"
        or not fact_version.body_markdown.strip()
    ):
        raise AppError("FACT_NOT_APPROVED", "内容任务只能绑定非空的已批准事实版本", 409)
    if fact_version.product_id != payload.product_id:
        raise ContentTaskFactProductMismatch
    return profile


def _lock_campaign_for_task(
    db: Session,
    *,
    campaign_id: uuid.UUID,
    product_id: uuid.UUID,
    query_topic_id: uuid.UUID,
    platform_profile_id: uuid.UUID,
) -> ContentCampaign:
    """在资源锁之后锁定活动并校验状态与范围归属。"""
    campaign = db.scalar(
        select(ContentCampaign)
        .where(ContentCampaign.id == campaign_id)
        .execution_options(populate_existing=True)
        .with_for_update(key_share=True)
    )
    if campaign is None:
        raise not_found("内容活动")
    if campaign.status not in {"DRAFT", "ACTIVE"}:
        raise AppError(
            "INVALID_STATE_TRANSITION",
            "仅草稿或进行中的内容活动允许新建关联内容任务",
            409,
        )
    has_product = (
        db.scalar(
            select(ContentCampaignProduct.product_id).where(
                ContentCampaignProduct.campaign_id == campaign.id,
                ContentCampaignProduct.product_id == product_id,
            )
        )
        is not None
    )
    has_topic = (
        db.scalar(
            select(ContentCampaignTopic.query_topic_id).where(
                ContentCampaignTopic.campaign_id == campaign.id,
                ContentCampaignTopic.query_topic_id == query_topic_id,
            )
        )
        is not None
    )
    has_platform = (
        db.scalar(
            select(ContentCampaignPlatform.platform_profile_id).where(
                ContentCampaignPlatform.campaign_id == campaign.id,
                ContentCampaignPlatform.platform_profile_id == platform_profile_id,
            )
        )
        is not None
    )
    if not (has_product and has_topic and has_platform):
        raise AppError(
            "CAMPAIGN_SCOPE_MISMATCH",
            "所选产品、问题主题或目标平台不在该内容活动的规划范围内",
            422,
        )
    return campaign


def _brief_matches_input(
    snapshot: ContentBriefSnapshot | None, brief: ContentBriefInput | None
) -> bool:
    if brief is None:
        return snapshot is None
    if snapshot is None:
        return False
    return (
        snapshot.target_question == brief.target_question
        and snapshot.search_intent == brief.search_intent.value
        and snapshot.content_angle == brief.content_angle
        and snapshot.target_audience == brief.target_audience
        and snapshot.must_answer_questions == brief.must_answer_questions
        and snapshot.required_fact_points == brief.required_fact_points
        and snapshot.forbidden_expressions == brief.forbidden_expressions
        and snapshot.content_format == brief.content_format
        and snapshot.cta == brief.cta
        and snapshot.target_keywords == brief.target_keywords
        and (snapshot.success_metrics or {})
        == brief.success_metrics.model_dump(mode="json", exclude_none=True)
    )


def add_locked_content_task(
    *,
    db: Session,
    payload: ContentTaskTarget,
    profile: PlatformProfile,
    actor: User,
    idempotency_key: str | None,
    query_topic_id: uuid.UUID | None = None,
    campaign_id: uuid.UUID | None = None,
    brief: ContentBriefInput | None = None,
) -> ContentTask:
    """在调用方持有目标资源锁时构造并 flush 内容任务及其可选 Brief 快照。"""
    task = ContentTask(
        product_id=payload.product_id,
        fact_version_id=payload.fact_version_id,
        platform_profile_id=profile.id,
        platform_profile_name_snapshot=profile.name,
        platform_website_url_snapshot=profile.website_url,
        query_topic_id=query_topic_id,
        campaign_id=campaign_id,
        idempotency_key=idempotency_key,
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
    if brief is not None:
        snapshot = ContentBriefSnapshot(
            content_task_id=task.id,
            query_topic_id=query_topic_id,
            target_question=brief.target_question,
            search_intent=brief.search_intent.value,
            content_angle=brief.content_angle,
            target_audience=brief.target_audience,
            must_answer_questions=brief.must_answer_questions,
            required_fact_points=brief.required_fact_points,
            forbidden_expressions=brief.forbidden_expressions,
            content_format=brief.content_format,
            cta=brief.cta,
            target_keywords=brief.target_keywords,
            success_metrics=brief.success_metrics.model_dump(mode="json", exclude_none=True),
            created_by=actor.id,
        )
        db.add(snapshot)
        db.flush()
    return task


def _is_content_task_idempotency_integrity_error(error: IntegrityError) -> bool:
    """只识别普通任务幂等键的 PostgreSQL 最终唯一约束。"""
    original = error.orig
    return (
        getattr(original, "sqlstate", None) == "23505"
        and getattr(getattr(original, "diag", None), "constraint_name", None)
        == "uq_content_tasks_idempotency_key"
    )


def _content_task_has_ordinary_identity(
    db: Session,
    task: ContentTask,
    payload: ContentTaskTarget,
    *,
    require_complete: bool,
    query_topic_id: uuid.UUID | None = None,
    campaign_id: uuid.UUID | None = None,
    brief: ContentBriefInput | None = None,
) -> bool | None:
    """判断任务是否可证明属于同一内容任务创建命令的 canonical identity。"""
    if require_complete and (
        task.product_id is None
        or task.fact_version_id is None
        or task.platform_profile_id is None
    ):
        return None
    if db.get(ContentTaskGeoSource, task.id) is not None:
        return False
    if not (
        task.product_id == payload.product_id
        and task.query_topic_id == query_topic_id
        and task.campaign_id == campaign_id
        and task.fact_version_id == payload.fact_version_id
        and task.platform_profile_id == payload.platform_profile_id
    ):
        return False
    snapshot = db.get(ContentBriefSnapshot, task.id)
    return _brief_matches_input(snapshot, brief)


def _idempotency_conflict() -> AppError:
    """返回普通内容任务共用的幂等冲突错误。"""
    return AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一内容任务创建请求", 409)


def create_linked_content_task(
    *,
    db: Session,
    payload: ContentTaskTarget,
    actor: User,
    request_id: str,
    idempotency_key: str,
    query_topic_id: uuid.UUID | None = None,
    commit: bool = True,
) -> ContentTask:
    """由 GEO 机会行动等跨领域编排调用的无 Brief 联动内容任务创建。"""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"content-task-create:{idempotency_key}"},
    )
    existing = db.scalar(
        select(ContentTask).where(ContentTask.idempotency_key == idempotency_key)
    )
    if existing is not None:
        if (
            _content_task_has_ordinary_identity(
                db,
                existing,
                payload,
                require_complete=False,
                query_topic_id=query_topic_id,
                campaign_id=None,
                brief=None,
            )
            is not True
        ):
            raise _idempotency_conflict()
        return existing

    try:
        profile = lock_content_task_creation_resources(db, payload)
    except ContentTaskFactProductMismatch as error:
        raise AppError("VALIDATION_ERROR", "事实版本不属于所选产品", 422) from error
    if (
        query_topic_id is not None
        and db.scalar(
            select(QueryTopic.id).where(QueryTopic.id == query_topic_id).with_for_update()
        )
        is None
    ):
        raise not_found("GEO问题主题")
    task = add_locked_content_task(
        db=db,
        payload=payload,
        profile=profile,
        actor=actor,
        idempotency_key=idempotency_key,
        query_topic_id=query_topic_id,
    )
    if commit:
        db.commit()
    return task


def create_content_task(
    *,
    db: Session,
    payload: ContentTaskCreate,
    actor: User,
    request_id: str,
    idempotency_key: str,
    commit: bool = True,
) -> ContentTask:
    """幂等创建普通内容任务：强制绑定活跃问题主题与不可变 Brief 快照，可选校验活动范围。"""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"content-task-create:{idempotency_key}"},
    )
    existing = db.scalar(
        select(ContentTask).where(ContentTask.idempotency_key == idempotency_key)
    )
    if existing is not None:
        if (
            _content_task_has_ordinary_identity(
                db,
                existing,
                payload,
                require_complete=False,
                query_topic_id=payload.query_topic_id,
                campaign_id=payload.campaign_id,
                brief=payload.brief,
            )
            is not True
        ):
            raise _idempotency_conflict()
        return existing

    try:
        profile = lock_content_task_creation_resources(db, payload)
    except ContentTaskFactProductMismatch as error:
        raise AppError("VALIDATION_ERROR", "事实版本不属于所选产品", 422) from error

    topic = db.scalar(
        select(QueryTopic)
        .where(QueryTopic.id == payload.query_topic_id)
        .execution_options(populate_existing=True)
        .with_for_update()
    )
    if topic is None:
        raise not_found("GEO问题主题")
    if not topic.is_active:
        raise AppError("QUERY_TOPIC_INACTIVE", "已停用的目标问题不能用于创建新内容任务", 409)

    if payload.campaign_id is not None:
        _lock_campaign_for_task(
            db,
            campaign_id=payload.campaign_id,
            product_id=payload.product_id,
            query_topic_id=payload.query_topic_id,
            platform_profile_id=payload.platform_profile_id,
        )

    try:
        task = add_locked_content_task(
            db=db,
            payload=payload,
            profile=profile,
            actor=actor,
            idempotency_key=idempotency_key,
            query_topic_id=payload.query_topic_id,
            campaign_id=payload.campaign_id,
            brief=payload.brief,
        )
    except IntegrityError as error:
        # 外层事务协调者不能在root rollback释放锁后继续创建来源关联。
        if not commit or not _is_content_task_idempotency_integrity_error(error):
            raise
        db.rollback()
        winner = db.scalar(
            select(ContentTask).where(ContentTask.idempotency_key == idempotency_key)
        )
        if winner is None:
            raise error
        same_identity = _content_task_has_ordinary_identity(
            db,
            winner,
            payload,
            require_complete=True,
            query_topic_id=payload.query_topic_id,
            campaign_id=payload.campaign_id,
            brief=payload.brief,
        )
        if same_identity is None:
            raise error
        if not same_identity:
            raise _idempotency_conflict() from error
        return winner
    if commit:
        db.commit()
    return task
