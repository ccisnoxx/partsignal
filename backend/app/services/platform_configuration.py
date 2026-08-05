"""平台类型、Prompt 与平台配置的事务命令。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.sql import Select
from sqlalchemy.sql.elements import ColumnElement

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, in_use, not_found
from app.models.configuration import (
    ContentHumanizationPrompt,
    PlatformProfile,
    PlatformPrompt,
    PlatformType,
)
from app.models.content import ContentTask
from app.models.identity import User
from app.models.publication import PlatformAccount, PublicationWork
from app.schemas.common import RevisionRequest
from app.schemas.configuration import (
    ContentHumanizationPromptPut,
    PlatformAccountSummary,
    PlatformConfigurationStatus,
    PlatformProfileDetail,
    PlatformProfileList,
    PlatformProfileStatus,
    PlatformProfileSummary,
    PlatformProfileUpdate,
    PlatformPromptCreate,
    PlatformPromptDetail,
    PlatformPromptList,
    PlatformPromptListItem,
    PlatformPromptUpdate,
    PlatformReferenceSummary,
    PlatformTypeCreate,
    PlatformTypeOut,
    PlatformTypeUpdate,
)
from app.services.platform_logo_files import (
    lock_platform_logo_change,
    schedule_detached_platform_logo,
)
from app.services.projections import (
    IN_FLIGHT_PUBLICATION_STATUSES,
    platform_profile_out,
    platform_profiles_out,
)

HUMANIZATION_PROMPT_SINGLETON_ID = 1
PLATFORM_PROMPT_BINDING_LOCK = "platform-prompt-bindings"


def lock_platform_prompt_bindings(db: Session) -> None:
    """串行化低频 Prompt 绑定变更与解绑删除。"""
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": PLATFORM_PROMPT_BINDING_LOCK},
    )


def _platform_search_conditions(q: str | None) -> list[ColumnElement[bool]]:
    """把搜索通配符按普通字符匹配平台或类型名称。"""
    if q is None or not (term := q.strip()):
        return []
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pattern = f"%{escaped}%"
    return [
        or_(
            PlatformProfile.name.ilike(pattern, escape="\\"),
            PlatformType.name.ilike(pattern, escape="\\"),
        )
    ]


def _filtered_platform_profiles_query(
    *,
    q: str | None,
    platform_type_id: uuid.UUID | None,
    profile_status: PlatformProfileStatus | None,
    configuration_status: PlatformConfigurationStatus | None,
) -> Select[tuple[PlatformProfile]]:
    """构造列表与 CSV 共用的平台筛选和稳定排序。"""
    conditions = _platform_search_conditions(q)
    if platform_type_id is not None:
        conditions.append(PlatformProfile.platform_type_id == platform_type_id)
    if profile_status is not None:
        conditions.append(
            PlatformProfile.is_active.is_(profile_status == PlatformProfileStatus.ENABLED)
        )
    if configuration_status is not None:
        conditions.append(
            PlatformProfile.platform_prompt_id.is_not(None)
            if configuration_status == PlatformConfigurationStatus.COMPLETE
            else PlatformProfile.platform_prompt_id.is_(None)
        )
    return (
        select(PlatformProfile)
        .outerjoin(PlatformType, PlatformType.id == PlatformProfile.platform_type_id)
        .where(*conditions)
        .order_by(func.lower(PlatformProfile.name), PlatformProfile.id)
    )


def _platform_summary(db: Session) -> PlatformProfileSummary:
    """实时统计全部获权平台，结果不受管理列表筛选影响。"""
    totals = db.execute(
        select(
            func.count(PlatformProfile.id),
            func.count(PlatformProfile.id).filter(PlatformProfile.is_active.is_(True)),
            func.count(PlatformProfile.id).filter(PlatformProfile.platform_prompt_id.is_(None)),
            func.count(PlatformProfile.id).filter(
                PlatformProfile.platform_prompt_id.is_not(None)
            ),
        )
    ).one()
    return PlatformProfileSummary(
        platform_total=int(totals[0]),
        enabled_total=int(totals[1]),
        missing_prompt_total=int(totals[2]),
        configuration_complete_total=int(totals[3]),
    )


def list_platform_profiles(
    *,
    db: Session,
    q: str | None,
    platform_type_id: uuid.UUID | None,
    profile_status: PlatformProfileStatus | None,
    configuration_status: PlatformConfigurationStatus | None,
    page: int | None,
    page_size: int | None,
    can_manage: bool,
) -> PlatformProfileList:
    """返回兼容全量模式或成对分页的权威平台集合。"""
    if (page is None) != (page_size is None):
        raise AppError("VALIDATION_ERROR", "page 与 page_size 必须同时提供或同时省略", 422)
    query = _filtered_platform_profiles_query(
        q=q,
        platform_type_id=platform_type_id,
        profile_status=profile_status,
        configuration_status=configuration_status,
    )
    total = int(db.scalar(select(func.count()).select_from(query.order_by(None).subquery())) or 0)
    if page is None:
        profiles = list(db.scalars(query))
        response_page, response_page_size = 1, total
    else:
        assert page_size is not None
        profiles = list(db.scalars(query.offset((page - 1) * page_size).limit(page_size)))
        response_page, response_page_size = page, page_size
    return PlatformProfileList(
        items=platform_profiles_out(db, profiles, can_manage=can_manage),
        page=response_page,
        page_size=response_page_size,
        total=total,
        summary=_platform_summary(db),
    )


def export_platform_profiles(
    *,
    db: Session,
    q: str | None,
    platform_type_id: uuid.UUID | None,
    profile_status: PlatformProfileStatus | None,
    configuration_status: PlatformConfigurationStatus | None,
) -> str:
    """用列表同一筛选与排序生成不含签名 Logo 的 UTF-8 BOM CSV。"""
    profiles = list(
        db.scalars(
            _filtered_platform_profiles_query(
                q=q,
                platform_type_id=platform_type_id,
                profile_status=profile_status,
                configuration_status=configuration_status,
            )
        )
    )
    items = platform_profiles_out(db, profiles, can_manage=True)
    output = io.StringIO(newline="")
    output.write("\ufeff")
    writer = csv.writer(output)
    writer.writerow(
        [
            "平台名称",
            "所属平台类型",
            "官网",
            "允许域名",
            "平台状态",
            "Prompt 状态",
            "发布账号数量",
            "更新时间",
        ]
    )
    for item in items:
        writer.writerow(
            [
                item.name,
                item.platform_type.name if item.platform_type is not None else "",
                str(item.website_url) if item.website_url is not None else "",
                ";".join(item.allowed_domains),
                "ENABLED" if item.is_active else "DISABLED",
                "CONFIGURED" if item.platform_prompt is not None else "MISSING",
                item.platform_account_count,
                item.updated_at.isoformat() if item.updated_at is not None else "",
            ]
        )
    return output.getvalue()


def get_platform_profile_detail(
    db: Session,
    platform_profile_id: uuid.UUID,
    *,
    as_of: datetime | None = None,
) -> PlatformProfileDetail:
    """聚合平台当前配置、账号和同一时点的任务引用摘要。"""
    profile = db.get(PlatformProfile, platform_profile_id)
    if profile is None:
        raise not_found("平台")
    query_as_of = as_of or datetime.now(UTC)
    account_total, account_enabled = db.execute(
        select(
            func.count(PlatformAccount.id),
            func.count(PlatformAccount.id).filter(PlatformAccount.is_active.is_(True)),
        ).where(PlatformAccount.platform_profile_id == profile.id)
    ).one()
    all_time, recent = db.execute(
        select(
            func.count(func.distinct(ContentTask.id)),
            func.count(func.distinct(ContentTask.id)).filter(
                ContentTask.created_at >= query_as_of - timedelta(days=30),
                ContentTask.created_at < query_as_of,
            ),
        ).where(ContentTask.platform_profile_id == profile.id)
    ).one()
    profile_projection = platform_profile_out(db, profile, can_manage=True)
    enabled = int(account_enabled)
    total = int(account_total)
    return PlatformProfileDetail(
        profile=profile_projection,
        account_summary=PlatformAccountSummary(
            total=total,
            enabled=enabled,
            disabled=total - enabled,
        ),
        reference_summary=PlatformReferenceSummary(
            as_of=query_as_of,
            recent_30_days=int(recent),
            all_time=int(all_time),
        ),
    )


def lock_active_platform(db: Session, platform_profile_id: uuid.UUID) -> PlatformProfile:
    """锁定新建业务使用的平台，并以稳定错误拒绝停用状态。"""
    profile = db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    )
    if profile is None:
        raise not_found("平台配置")
    if not profile.is_active:
        raise AppError("PLATFORM_DISABLED", "所选平台已停用，不能创建新业务记录", 409)
    return profile


def set_platform_profile_enabled(
    *,
    db: Session,
    platform_profile_id: uuid.UUID,
    payload: RevisionRequest,
    actor: User,
    request_id: str,
    enabled: bool,
) -> PlatformProfile:
    """按 revision 显式启停平台，不联动账号、规则、Prompt 或历史。"""
    profile = db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    )
    if profile is None:
        raise not_found("平台")
    if profile.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台已被其他请求修改", 409)
    previous_enabled = profile.is_active
    profile.is_active = enabled
    profile.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action=f"platform_profile.{'enabled' if enabled else 'disabled'}",
            target_type="PlatformProfile",
            target_id=profile.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message=f"平台已{'启用' if enabled else '停用'}",
            details={
                "changes": [{"field": "is_active", "before": previous_enabled, "after": enabled}],
                "facts": {"revision": profile.revision},
            },
        ),
    )
    db.commit()
    return profile


def create_platform_type(
    *, db: Session, payload: PlatformTypeCreate, actor: User, request_id: str
) -> PlatformType:
    """创建平台类型。"""
    item = PlatformType(name=payload.name.strip(), slug=payload.slug, created_by=actor.id)
    db.add(item)
    db.flush()
    db.commit()
    return item


def platform_types_out(db: Session, items: list[PlatformType]) -> list[PlatformTypeOut]:
    """批量投影平台类型及无平台引用时的删除动作。"""
    if not items:
        return []
    item_ids = [item.id for item in items]
    profile_counts = {
        platform_type_id: int(count)
        for platform_type_id, count in db.execute(
            select(PlatformProfile.platform_type_id, func.count(PlatformProfile.id))
            .where(PlatformProfile.platform_type_id.in_(item_ids))
            .group_by(PlatformProfile.platform_type_id)
        ).tuples()
    }
    return [
        PlatformTypeOut.model_validate(
            {
                **{
                    field: getattr(item, field)
                    for field in PlatformTypeOut.model_fields
                    if field not in {"available_actions", "deletion", "primary_task"}
                },
                "primary_task": "EDIT_CATEGORY",
                "deletion": {
                    "blockers": (
                        [
                            {
                                "type": "PLATFORM_PROFILE",
                                "count": profile_counts[item.id],
                            }
                        ]
                        if item.id in profile_counts
                        else []
                    )
                },
                "available_actions": [
                    "UPDATE",
                    *([] if item.id in profile_counts else ["DELETE"]),
                ],
            }
        )
        for item in items
    ]


def platform_type_out(db: Session, item: PlatformType) -> PlatformTypeOut:
    """投影单个平台类型的当前动作。"""
    return platform_types_out(db, [item])[0]


def update_platform_type(
    *,
    db: Session,
    platform_type_id: uuid.UUID,
    payload: PlatformTypeUpdate,
    actor: User,
    request_id: str,
) -> PlatformType:
    """以 revision 乐观锁更新平台类型。"""
    item = db.scalar(
        select(PlatformType).where(PlatformType.id == platform_type_id).with_for_update()
    )
    if item is None:
        raise not_found("平台类型")
    if item.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台类型已被其他请求修改", 409)
    item.name = payload.name.strip()
    item.slug = payload.slug
    item.revision += 1
    db.commit()
    return item


def delete_platform_type(
    *, db: Session, platform_type_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """仅删除未被具体平台引用的平台类型。"""
    item = db.scalar(
        select(PlatformType).where(PlatformType.id == platform_type_id).with_for_update()
    )
    if item is None:
        raise not_found("平台类型")
    profile_count = int(
        db.scalar(
            select(func.count())
            .select_from(PlatformProfile)
            .where(PlatformProfile.platform_type_id == item.id)
        )
        or 0
    )
    if profile_count:
        raise in_use(
            "PLATFORM_TYPE_IN_USE", "平台类型", [("PLATFORM_PROFILE", "具体平台", profile_count)]
        )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_type.deleted",
            target_type="PlatformType",
            target_id=item.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台类型已删除",
        ),
    )
    db.delete(item)
    db.commit()


def _platform_prompt_detail(db: Session, prompt: PlatformPrompt) -> PlatformPromptDetail:
    """投影 Prompt 当前正文和全部平台绑定。"""
    bound_platforms = list(
        db.scalars(
            select(PlatformProfile)
            .where(PlatformProfile.platform_prompt_id == prompt.id)
            .order_by(func.lower(PlatformProfile.name), PlatformProfile.id)
        )
    )
    return PlatformPromptDetail.model_validate(
        {
            "id": prompt.id,
            "name": prompt.name,
            "template_markdown": prompt.template_markdown,
            "revision": prompt.revision,
            "updated_by": prompt.updated_by,
            "created_at": prompt.created_at,
            "updated_at": prompt.updated_at,
            "bound_platform_count": len(bound_platforms),
            "available_actions": [
                "UPDATE",
                "DELETE",
            ],
            "bound_platforms": [
                {"id": profile.id, "name": profile.name, "slug": profile.slug}
                for profile in bound_platforms
            ],
        }
    )


def list_platform_prompts(db: Session) -> PlatformPromptList:
    """按名称稳定返回 Prompt 模板及实时绑定数量。"""
    rows = db.execute(
        select(PlatformPrompt, func.count(PlatformProfile.id))
        .outerjoin(PlatformProfile, PlatformProfile.platform_prompt_id == PlatformPrompt.id)
        .group_by(PlatformPrompt.id)
        .order_by(func.lower(PlatformPrompt.name), PlatformPrompt.id)
    ).all()
    return PlatformPromptList(
        items=[
            PlatformPromptListItem.model_validate(
                {
                    "id": prompt.id,
                    "name": prompt.name,
                    "revision": prompt.revision,
                    "updated_by": prompt.updated_by,
                    "updated_at": prompt.updated_at,
                    "bound_platform_count": int(bound_count),
                    "available_actions": [
                        "UPDATE",
                        "DELETE",
                    ],
                }
            )
            for prompt, bound_count in rows
        ]
    )


def get_platform_prompt(db: Session, platform_prompt_id: uuid.UUID) -> PlatformPromptDetail:
    """读取一份 Prompt 及其当前平台影响范围。"""
    prompt = db.get(PlatformPrompt, platform_prompt_id)
    if prompt is None:
        raise not_found("平台 Prompt")
    return _platform_prompt_detail(db, prompt)


def create_platform_prompt(
    *,
    db: Session,
    payload: PlatformPromptCreate,
    actor: User,
    request_id: str,
) -> PlatformPromptDetail:
    """创建一份未绑定的可复用 Prompt。"""
    name = payload.name.strip()
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "平台 Prompt 不能为空", 422)
    if db.scalar(select(PlatformPrompt.id).where(PlatformPrompt.name == name)) is not None:
        raise AppError("PLATFORM_PROMPT_NAME_EXISTS", "Prompt 名称已存在", 409)
    prompt = PlatformPrompt(name=name, template_markdown=markdown, updated_by=actor.id)
    db.add(prompt)
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        if db.scalar(select(PlatformPrompt.id).where(PlatformPrompt.name == name)) is not None:
            raise AppError("PLATFORM_PROMPT_NAME_EXISTS", "Prompt 名称已存在", 409) from error
        raise
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_prompt.created",
            target_type="PlatformPrompt",
            target_id=prompt.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台 Prompt 已创建",
            details={"facts": {"revision": prompt.revision}},
        ),
    )
    db.commit()
    return _platform_prompt_detail(db, prompt)


def update_platform_prompt(
    *,
    db: Session,
    platform_prompt_id: uuid.UUID,
    payload: PlatformPromptUpdate,
    actor: User,
    request_id: str,
) -> PlatformPromptDetail:
    """按 revision 更新共享 Prompt，并记录当前影响范围。"""
    prompt = db.scalar(
        select(PlatformPrompt)
        .where(PlatformPrompt.id == platform_prompt_id)
        .with_for_update()
    )
    if prompt is None:
        raise not_found("平台 Prompt")
    if prompt.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台 Prompt 已被其他请求修改", 409)
    name = payload.name.strip()
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "平台 Prompt 不能为空", 422)
    duplicate_id = db.scalar(
        select(PlatformPrompt.id).where(
            PlatformPrompt.name == name,
            PlatformPrompt.id != prompt.id,
        )
    )
    if duplicate_id is not None:
        raise AppError("PLATFORM_PROMPT_NAME_EXISTS", "Prompt 名称已存在", 409)
    previous_name = prompt.name
    previous_revision = prompt.revision
    bound_platform_ids = list(
        db.scalars(
            select(PlatformProfile.id)
            .where(PlatformProfile.platform_prompt_id == prompt.id)
            .order_by(PlatformProfile.id)
        )
    )
    prompt.name = name
    prompt.template_markdown = markdown
    prompt.updated_by = actor.id
    prompt.revision += 1
    try:
        db.flush()
    except IntegrityError as error:
        db.rollback()
        if (
            db.scalar(
                select(PlatformPrompt.id).where(
                    PlatformPrompt.name == name,
                    PlatformPrompt.id != platform_prompt_id,
                )
            )
            is not None
        ):
            raise AppError("PLATFORM_PROMPT_NAME_EXISTS", "Prompt 名称已存在", 409) from error
        raise
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_prompt.updated",
            target_type="PlatformPrompt",
            target_id=prompt.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台 Prompt 已更新",
            details={
                "changes": [
                    {"field": "name", "before": previous_name, "after": prompt.name},
                    {
                        "field": "revision",
                        "before": previous_revision,
                        "after": prompt.revision,
                    },
                ],
                "facts": {
                    "bound_platform_count": len(bound_platform_ids),
                    "bound_platform_ids": [str(item) for item in bound_platform_ids],
                },
            },
        ),
    )
    db.commit()
    return _platform_prompt_detail(db, prompt)


def put_content_humanization_prompt(
    *,
    db: Session,
    payload: ContentHumanizationPromptPut,
    actor: User,
    request_id: str,
) -> ContentHumanizationPrompt:
    """首次创建或按 revision 更新全局唯一自然化 Prompt。"""
    prompt = db.scalar(
        select(ContentHumanizationPrompt)
        .where(ContentHumanizationPrompt.id == HUMANIZATION_PROMPT_SINGLETON_ID)
        .with_for_update()
    )
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "自然化 Prompt 不能为空", 422)
    if prompt is None:
        if payload.expected_revision is not None:
            raise AppError("REVISION_CONFLICT", "自然化 Prompt 尚不存在", 409)
        prompt = ContentHumanizationPrompt(
            id=HUMANIZATION_PROMPT_SINGLETON_ID,
            template_markdown=markdown,
            updated_by=actor.id,
        )
        db.add(prompt)
    else:
        if payload.expected_revision != prompt.revision:
            raise AppError("REVISION_CONFLICT", "自然化 Prompt 已被其他请求修改", 409)
        prompt.template_markdown = markdown
        prompt.updated_by = actor.id
        prompt.revision += 1
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="content_humanization_prompt.saved",
            target_type="ContentHumanizationPrompt",
            target_id=uuid.UUID(int=HUMANIZATION_PROMPT_SINGLETON_ID),
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="自然化 Prompt 已保存",
            details={"facts": {"revision": prompt.revision}},
        ),
    )
    db.commit()
    return prompt


def delete_platform_prompt(
    *,
    db: Session,
    platform_prompt_id: uuid.UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> None:
    """仅删除调用方已读取的 Prompt revision，并追加脱敏审计。"""
    lock_platform_prompt_bindings(db)
    prompt = db.scalar(
        select(PlatformPrompt)
        .where(PlatformPrompt.id == platform_prompt_id)
        .with_for_update()
    )
    if prompt is None:
        raise not_found("平台 Prompt")
    if prompt.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "平台 Prompt 已被其他请求修改", 409)
    bound_platforms = list(
        db.scalars(
            select(PlatformProfile)
            .where(PlatformProfile.platform_prompt_id == prompt.id)
            .order_by(PlatformProfile.id)
            .with_for_update()
        )
    )
    for profile in bound_platforms:
        profile.platform_prompt_id = None
        profile.revision += 1
    deleted_revision = prompt.revision
    db.delete(prompt)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_prompt.deleted",
            target_type="PlatformPrompt",
            target_id=prompt.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台 Prompt 已删除",
        details={
            "facts": {
                "revision": deleted_revision,
                "unbound_platform_count": len(bound_platforms),
            }
        },
        ),
    )
    db.commit()


def update_platform_profile(
    *,
    db: Session,
    platform_profile_id: uuid.UUID,
    payload: PlatformProfileUpdate,
    actor: User,
    request_id: str,
) -> PlatformProfile:
    """锁定平台并校验类型存在后更新配置。"""
    lock_platform_prompt_bindings(db)
    profile = db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    )
    if profile is None:
        raise not_found("平台")
    if profile.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台已被其他请求修改", 409)
    if db.get(PlatformType, payload.platform_type_id) is None:
        raise not_found("平台类型")
    if payload.platform_prompt_id is not None:
        selected_prompt_id = db.scalar(
            select(PlatformPrompt.id)
            .where(PlatformPrompt.id == payload.platform_prompt_id)
            .with_for_update()
        )
        if selected_prompt_id is None:
            raise not_found("平台 Prompt")
    logo_changed = "logo" in payload.model_fields_set
    previous_logo_file_id = profile.logo_file_id
    logo_file_id = (
        lock_platform_logo_change(
            db,
            current_file_id=previous_logo_file_id,
            logo=payload.logo,
        )
        if logo_changed
        else previous_logo_file_id
    )
    profile.name = payload.name
    profile.allowed_domains = payload.allowed_domains
    profile.platform_type_id = payload.platform_type_id
    profile.platform_prompt_id = payload.platform_prompt_id
    profile.website_url = str(payload.website_url) if payload.website_url is not None else None
    if logo_changed:
        profile.logo_file_id = logo_file_id
        profile.logo_external_url = None
    profile.revision += 1
    db.flush()
    if logo_changed and previous_logo_file_id != logo_file_id:
        schedule_detached_platform_logo(db, previous_logo_file_id)
    db.commit()
    return profile


def delete_platform_profile(
    *, db: Session, platform_profile_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """删除已停用且没有活动业务的具体平台及配置账号。"""
    profile = db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    )
    if profile is None:
        raise not_found("平台")
    if profile.is_active:
        raise AppError("INVALID_STATE_TRANSITION", "请先停用平台再删除", 409)
    references = [
        (
            "CONTENT_TASK",
            "内容任务",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(ContentTask)
                    .where(
                        ContentTask.platform_profile_id == profile.id,
                        ContentTask.status == "OPEN",
                    )
                )
                or 0
            ),
        ),
        (
            "PUBLICATION_WORK",
            "进行中发布工作",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(PublicationWork)
                    .where(
                        PublicationWork.platform_profile_id == profile.id,
                        PublicationWork.status.in_(IN_FLIGHT_PUBLICATION_STATUSES),
                    )
                )
                or 0
            ),
        ),
    ]
    if any(count for _, _, count in references):
        raise in_use("PLATFORM_PROFILE_IN_USE", "平台", references)
    previous_logo_file_id = profile.logo_file_id
    account_count = int(
        db.scalar(
            select(func.count())
            .select_from(PlatformAccount)
            .where(PlatformAccount.platform_profile_id == profile.id)
        )
        or 0
    )
    lock_platform_logo_change(
        db,
        current_file_id=previous_logo_file_id,
        logo=None,
    )
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_profile.deleted",
            target_type="PlatformProfile",
            target_id=profile.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台已删除",
            details={"facts": {"platform_account_count": account_count}},
        ),
    )
    db.delete(profile)
    db.flush()
    schedule_detached_platform_logo(db, previous_logo_file_id)
    db.commit()
