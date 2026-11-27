"""Slice 3D：平台公开页面健康检查配置管理与到期批量巡检调度服务。"""

from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, sessionmaker

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.db import SessionLocal
from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile
from app.models.identity import User
from app.models.publication import (
    PublicationWork,
    PublishedArticle,
    PublishedArticleHealthCheck,
    PublishedContentIssue,
)
from app.schemas.common import AccountType
from app.schemas.page_health import (
    PlatformHealthCheckSettingsOut,
    PlatformHealthCheckSettingsUpdate,
    PublicPageHealthCheckBatchOut,
    PublishedArticleHealthCheckOut,
)
from app.services.current_actor import current_actor_command
from app.services.page_health_checks import (
    require_test_fetcher,
    run_due_article_health_check,
)
from app.services.page_health_fetcher import PageHealthFetcher


def get_platform_health_check_settings(
    db: Session, platform_profile_id: uuid.UUID
) -> PlatformHealthCheckSettingsOut:
    """只读返回平台公开页健康检查配置。"""
    profile = db.get(PlatformProfile, platform_profile_id)
    if profile is None:
        raise not_found("平台配置")
    return PlatformHealthCheckSettingsOut(
        platform_profile_id=profile.id,
        health_check_enabled=profile.health_check_enabled,
        health_check_interval_hours=profile.health_check_interval_hours,
        health_check_anomaly_threshold=profile.health_check_anomaly_threshold,
        revision=profile.revision,
    )


def update_platform_health_check_settings(
    *,
    db: Session,
    platform_profile_id: uuid.UUID,
    payload: PlatformHealthCheckSettingsUpdate,
    actor: User,
    request_id: str,
) -> PlatformHealthCheckSettingsOut:
    """管理员按平台更新公开页健康检查配置（实时身份校验 + CAS expected_revision + 审计）。"""
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as live_actor:
        profile = db.scalar(
            select(PlatformProfile)
            .where(PlatformProfile.id == platform_profile_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if profile is None:
            raise not_found("平台配置")
        if profile.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "平台配置已被其他请求修改", 409)

        profile.health_check_enabled = payload.health_check_enabled
        profile.health_check_interval_hours = payload.health_check_interval_hours
        profile.health_check_anomaly_threshold = payload.health_check_anomaly_threshold
        profile.revision += 1

        append_audit(
            db,
            AuditEntry(
                actor_id=live_actor.id,
                business_module=AuditModule.CONFIGURATION,
                action="platform_profile.health_check_settings_updated",
                target_type="PlatformProfile",
                target_id=profile.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="平台公开页面健康检查配置已更新",
                details={
                    "facts": {
                        "platform_profile_id": str(profile.id),
                        "health_check_enabled": profile.health_check_enabled,
                        "health_check_interval_hours": profile.health_check_interval_hours,
                        "health_check_anomaly_threshold": profile.health_check_anomaly_threshold,
                        "revision": profile.revision,
                    }
                },
            ),
        )
        db.commit()
    return PlatformHealthCheckSettingsOut(
        platform_profile_id=profile.id,
        health_check_enabled=profile.health_check_enabled,
        health_check_interval_hours=profile.health_check_interval_hours,
        health_check_anomaly_threshold=profile.health_check_anomaly_threshold,
        revision=profile.revision,
    )


def run_due_public_page_health_checks(
    db: Session,
    *,
    actor: User | None,
    request_id: str,
    limit: int = 20,
    fetcher: PageHealthFetcher | None = None,
) -> PublicPageHealthCheckBatchOut:
    """SQL 下推到期扫描与 LIMIT，逐篇带冷却复核执行公开页巡检并及时中止鉴权失效批次。"""
    require_test_fetcher(fetcher)
    if actor is not None:
        with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)):
            pass
        db.rollback()
    bounded_limit = max(1, min(limit, 50))

    latest_subq = (
        select(
            PublishedArticleHealthCheck.published_article_id.label("article_id"),
            func.max(PublishedArticleHealthCheck.checked_at).label("last_checked_at"),
        )
        .group_by(PublishedArticleHealthCheck.published_article_id)
        .subquery()
    )
    retired_exists = (
        select(PublishedContentIssue.id)
        .where(
            PublishedContentIssue.published_article_id == PublishedArticle.id,
            PublishedContentIssue.resolution_outcome == "RETIRED",
        )
        .exists()
    )
    due_cutoff = func.now() - func.make_interval(
        0, 0, 0, 0, PlatformProfile.health_check_interval_hours, 0, 0
    )
    due_ids = list(
        db.scalars(
            select(PublishedArticle.id)
            .join(PublicationWork, PublicationWork.id == PublishedArticle.id)
            .join(PlatformProfile, PlatformProfile.id == PublicationWork.platform_profile_id)
            .outerjoin(latest_subq, latest_subq.c.article_id == PublishedArticle.id)
            .where(
                PlatformProfile.is_active.is_(True),
                PlatformProfile.health_check_enabled.is_(True),
                PublicationWork.final_url.is_not(None),
                ~retired_exists,
                or_(
                    latest_subq.c.last_checked_at.is_(None),
                    latest_subq.c.last_checked_at <= due_cutoff,
                ),
            )
            .order_by(latest_subq.c.last_checked_at.asc().nulls_first(), PublishedArticle.id.asc())
            .limit(bounded_limit)
        )
    )
    db.rollback()

    items: list[PublishedArticleHealthCheckOut] = []
    for art_id in due_ids:
        try:
            checked = run_due_article_health_check(
                db,
                article_id=art_id,
                actor=actor,
                request_id=request_id,
                fetcher=fetcher,
            )
            if checked is not None:
                items.append(checked)
        except AppError as exc:
            db.rollback()
            if exc.status_code in {401, 403}:
                raise
            continue

    healthy_count = sum(1 for item in items if item.status == "HEALTHY")
    blocked_count = sum(1 for item in items if item.status == "FETCH_BLOCKED")
    anomaly_count = sum(1 for item in items if item.status == "CONFIRMED_ANOMALY")
    auto_issue_count = sum(1 for item in items if item.auto_opened_issue_id is not None)

    if actor is not None:
        with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as live_actor:
            append_audit(
                db,
                AuditEntry(
                    actor_id=live_actor.id,
                    business_module=AuditModule.PUBLICATION,
                    action="published_article_health_check.batch_run",
                    target_type="PublishedArticleHealthCheckBatch",
                    target_id=None,
                    request_id=request_id,
                    outcome=AuditOutcome.SUCCESS,
                    result_message="公开页面健康检查到期巡检已完成",
                    details={
                        "facts": {
                            "checked_count": len(items),
                            "auto_opened_issue_count": auto_issue_count,
                        }
                    },
                ),
            )
            db.commit()

    return PublicPageHealthCheckBatchOut(
        checked_count=len(items),
        healthy_count=healthy_count,
        fetch_blocked_count=blocked_count,
        confirmed_anomaly_count=anomaly_count,
        auto_opened_issue_count=auto_issue_count,
        items=items,
    )


def run_due_public_page_health_checks_scheduled(
    *,
    session_factory: sessionmaker[Session] | None = None,
    fetcher: PageHealthFetcher | None = None,
    limit: int = 20,
) -> int:
    """Celery Beat 周期调用入口：只扫描启用健康检查的平台并执行到期公开页巡检。"""
    factory = session_factory or SessionLocal
    with factory() as db:
        result = run_due_public_page_health_checks(
            db,
            actor=None,
            request_id=f"beat-page-health-{uuid.uuid4().hex[:12]}",
            limit=limit,
            fetcher=fetcher,
        )
        return result.checked_count
