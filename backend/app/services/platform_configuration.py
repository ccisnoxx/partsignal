"""平台类型、Prompt 与平台配置的事务命令。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import exists, func, or_, select
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
from app.models.publication import PlatformAccount
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
    PlatformPromptPut,
    PlatformReferenceSummary,
    PlatformTypeCreate,
    PlatformTypeUpdate,
)
from app.services.file_records import platform_logo_storage_values
from app.services.projections import platform_profile_out, platform_profiles_out

HUMANIZATION_PROMPT_SINGLETON_ID = 1


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
    prompt_exists = exists().where(PlatformPrompt.platform_profile_id == PlatformProfile.id)
    conditions = _platform_search_conditions(q)
    if platform_type_id is not None:
        conditions.append(PlatformProfile.platform_type_id == platform_type_id)
    if profile_status is not None:
        conditions.append(
            PlatformProfile.is_active.is_(profile_status == PlatformProfileStatus.ENABLED)
        )
    if configuration_status is not None:
        conditions.append(
            prompt_exists
            if configuration_status == PlatformConfigurationStatus.COMPLETE
            else ~prompt_exists
        )
    return (
        select(PlatformProfile)
        .outerjoin(PlatformType, PlatformType.id == PlatformProfile.platform_type_id)
        .where(*conditions)
        .order_by(func.lower(PlatformProfile.name), PlatformProfile.id)
    )


def _platform_summary(db: Session) -> PlatformProfileSummary:
    """实时统计全部获权平台，结果不受管理列表筛选影响。"""
    prompt_exists = exists().where(PlatformPrompt.platform_profile_id == PlatformProfile.id)
    totals = db.execute(
        select(
            func.count(PlatformProfile.id),
            func.count(PlatformProfile.id).filter(PlatformProfile.is_active.is_(True)),
            func.count(PlatformProfile.id).filter(~prompt_exists),
            func.count(PlatformProfile.id).filter(prompt_exists),
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
        items=platform_profiles_out(db, profiles),
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
    items = platform_profiles_out(db, profiles)
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
                "CONFIGURED" if item.prompt_configured else "MISSING",
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
    profile_projection = platform_profile_out(db, profile)
    enabled = int(account_enabled)
    total = int(account_total)
    return PlatformProfileDetail(
        profile=profile_projection,
        prompt_updated_at=profile_projection.prompt_updated_at,
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
    """创建平台类型并在同一事务追加审计。"""
    item = PlatformType(name=payload.name.strip(), slug=payload.slug, created_by=actor.id)
    db.add(item)
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_type.created",
            target_type="PlatformType",
            target_id=item.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台类型已创建",
        ),
    )
    db.commit()
    return item


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
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_type.updated",
            target_type="PlatformType",
            target_id=item.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台类型已更新",
            details={"facts": {"revision": item.revision}},
        ),
    )
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


def put_platform_prompt(
    *,
    db: Session,
    platform_profile_id: uuid.UUID,
    payload: PlatformPromptPut,
    actor: User,
    request_id: str,
) -> PlatformPrompt:
    """创建或按 revision 更新平台 Prompt。"""
    if db.get(PlatformProfile, platform_profile_id) is None:
        raise not_found("平台")
    prompt = db.scalar(
        select(PlatformPrompt)
        .where(PlatformPrompt.platform_profile_id == platform_profile_id)
        .with_for_update()
    )
    previous_revision = prompt.revision if prompt is not None else None
    markdown = payload.template_markdown.strip()
    if not markdown:
        raise AppError("VALIDATION_ERROR", "平台 Prompt 不能为空", 422)
    if prompt is None:
        if payload.expected_revision is not None:
            raise AppError("REVISION_CONFLICT", "平台 Prompt 尚不存在", 409)
        prompt = PlatformPrompt(
            platform_profile_id=platform_profile_id,
            template_markdown=markdown,
            updated_by=actor.id,
        )
        db.add(prompt)
    else:
        if payload.expected_revision != prompt.revision:
            raise AppError("REVISION_CONFLICT", "平台 Prompt 已被其他请求修改", 409)
        prompt.template_markdown = markdown
        prompt.updated_by = actor.id
        prompt.revision += 1
    db.flush()
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_prompt.saved",
            target_type="PlatformProfile",
            target_id=platform_profile_id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台 Prompt 已保存",
            details={
                "changes": [
                    {
                        "field": "is_configured",
                        "before": previous_revision is not None,
                        "after": True,
                    },
                    *(
                        [
                            {
                                "field": "revision",
                                "before": previous_revision,
                                "after": prompt.revision,
                            }
                        ]
                        if previous_revision is not None
                        else []
                    ),
                ],
                "facts": {"revision": prompt.revision},
            },
        ),
    )
    db.commit()
    return prompt


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
    platform_profile_id: uuid.UUID,
    expected_revision: int,
    actor: User,
    request_id: str,
) -> None:
    """仅删除调用方已读取的 Prompt revision，并追加脱敏审计。"""
    prompt = db.scalar(
        select(PlatformPrompt)
        .where(PlatformPrompt.platform_profile_id == platform_profile_id)
        .with_for_update()
    )
    if prompt is None:
        raise not_found("平台 Prompt")
    if prompt.revision != expected_revision:
        raise AppError("REVISION_CONFLICT", "平台 Prompt 已被其他请求修改", 409)
    deleted_revision = prompt.revision
    db.delete(prompt)
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_prompt.deleted",
            target_type="PlatformProfile",
            target_id=platform_profile_id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台 Prompt 已删除",
            details={
                "changes": [{"field": "is_configured", "before": True, "after": False}],
                "facts": {"revision": deleted_revision},
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
    profile = db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    )
    if profile is None:
        raise not_found("平台")
    if profile.revision != payload.expected_revision:
        raise AppError("REVISION_CONFLICT", "平台已被其他请求修改", 409)
    if db.get(PlatformType, payload.platform_type_id) is None:
        raise not_found("平台类型")
    previous_platform_type_id = profile.platform_type_id
    previous_allowed_domain_count = len(profile.allowed_domains)
    previous_website_configured = profile.website_url is not None
    previous_logo_configured = (
        profile.logo_file_id is not None or profile.logo_external_url is not None
    )
    logo_file_id, logo_external_url = platform_logo_storage_values(db, payload.logo)
    profile.name = payload.name
    profile.allowed_domains = payload.allowed_domains
    profile.platform_type_id = payload.platform_type_id
    profile.website_url = str(payload.website_url) if payload.website_url is not None else None
    profile.logo_file_id = logo_file_id
    profile.logo_external_url = logo_external_url
    profile.revision += 1
    append_audit(
        db,
        AuditEntry(
            actor_id=actor.id,
            business_module=AuditModule.CONFIGURATION,
            action="platform_profile.updated",
            target_type="PlatformProfile",
            target_id=profile.id,
            request_id=request_id,
            outcome=AuditOutcome.SUCCESS,
            result_message="平台配置已更新",
            details={
                "changes": [
                    {
                        "field": "platform_type_id",
                        "before": (
                            str(previous_platform_type_id)
                            if previous_platform_type_id is not None
                            else None
                        ),
                        "after": str(profile.platform_type_id),
                    },
                    {
                        "field": "allowed_domain_count",
                        "before": previous_allowed_domain_count,
                        "after": len(profile.allowed_domains),
                    },
                    {
                        "field": "website_configured",
                        "before": previous_website_configured,
                        "after": profile.website_url is not None,
                    },
                    {
                        "field": "logo_configured",
                        "before": previous_logo_configured,
                        "after": (
                            profile.logo_file_id is not None
                            or profile.logo_external_url is not None
                        ),
                    },
                ],
                "facts": {"revision": profile.revision},
            },
        ),
    )
    db.commit()
    return profile


def delete_platform_profile(
    *, db: Session, platform_profile_id: uuid.UUID, actor: User, request_id: str
) -> None:
    """仅删除没有任务和账号直接引用的具体平台。"""
    profile = db.scalar(
        select(PlatformProfile).where(PlatformProfile.id == platform_profile_id).with_for_update()
    )
    if profile is None:
        raise not_found("平台")
    references = [
        (
            "CONTENT_TASK",
            "内容任务",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(ContentTask)
                    .where(ContentTask.platform_profile_id == profile.id)
                )
                or 0
            ),
        ),
        (
            "PLATFORM_ACCOUNT",
            "平台账号",
            int(
                db.scalar(
                    select(func.count())
                    .select_from(PlatformAccount)
                    .where(PlatformAccount.platform_profile_id == profile.id)
                )
                or 0
            ),
        ),
    ]
    if any(count for _, _, count in references):
        raise in_use("PLATFORM_PROFILE_IN_USE", "平台", references)
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
        ),
    )
    db.delete(profile)
    db.commit()
