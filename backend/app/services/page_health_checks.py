"""Slice 3D：公开页面健康检查三档分类与单篇检查执行/历史查询服务。"""

from __future__ import annotations

import uuid
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.errors import AppError, not_found
from app.models.configuration import PlatformProfile
from app.models.content import ContentVersion
from app.models.identity import User
from app.models.publication import (
    PublicationWork,
    PublishedArticle,
    PublishedArticleHealthCheck,
    PublishedContentIssue,
)
from app.schemas.common import AccountType
from app.schemas.page_health import (
    PublishedArticleHealthCheckList,
    PublishedArticleHealthCheckOut,
)
from app.services.current_actor import current_actor_command
from app.services.page_health_classifier import (
    HealthClassification,
    classify_public_page_health,
)
from app.services.page_health_fetcher import (
    PageHealthFetcher,
    PublicPageHttpFetcher,
)
from app.services.publication_queries import render_markdown

__all__ = [
    "HealthClassification",
    "classify_public_page_health",
    "count_consecutive_confirmed_anomalies",
    "health_check_out",
    "list_published_article_health_checks",
    "require_test_fetcher",
    "run_due_article_health_check",
    "run_published_article_health_check",
]


def require_test_fetcher(fetcher: PageHealthFetcher | None) -> None:
    if fetcher is not None and settings.environment != "test":
        raise AppError("TEST_ONLY_DEPENDENCY", "仅测试环境允许注入公开页抓取替身", 500)


def health_check_out(row: PublishedArticleHealthCheck) -> PublishedArticleHealthCheckOut:
    return PublishedArticleHealthCheckOut(
        id=row.id,
        published_article_id=row.published_article_id,
        checked_url=row.checked_url,
        final_url=row.final_url,
        status=row.status,
        http_status=row.http_status,
        redirect_count=row.redirect_count,
        redirected=row.redirected,
        page_title=row.page_title,
        title_matches=row.title_matches,
        body_similarity=row.body_similarity,
        has_noindex=row.has_noindex,
        canonical_url=row.canonical_url,
        canonical_matches=row.canonical_matches,
        anomaly_reasons=list(row.anomaly_reasons),
        fetch_error_code=row.fetch_error_code,
        auto_opened_issue_id=row.auto_opened_issue_id,
        triggered_by=row.triggered_by,
        checked_at=row.checked_at,
    )


def count_consecutive_confirmed_anomalies(db: Session, article_id: uuid.UUID) -> int:
    """精确统计最近一次 RESTORED 恢复与非异常检查之后的连续异常次数（不受分页截断）。"""
    last_restored_at = db.scalar(
        select(func.max(PublishedContentIssue.resolved_at)).where(
            PublishedContentIssue.published_article_id == article_id,
            PublishedContentIssue.status == "RESOLVED",
            PublishedContentIssue.resolution_outcome == "RESTORED",
        )
    )

    non_anomaly_stmt = select(
        PublishedArticleHealthCheck.checked_at, PublishedArticleHealthCheck.id
    ).where(
        PublishedArticleHealthCheck.published_article_id == article_id,
        PublishedArticleHealthCheck.status != "CONFIRMED_ANOMALY",
    )
    if last_restored_at is not None:
        non_anomaly_stmt = non_anomaly_stmt.where(
            PublishedArticleHealthCheck.checked_at > last_restored_at
        )
    last_break = db.execute(
        non_anomaly_stmt.order_by(
            PublishedArticleHealthCheck.checked_at.desc(),
            PublishedArticleHealthCheck.id.desc(),
        ).limit(1)
    ).first()

    count_stmt = (
        select(func.count())
        .select_from(PublishedArticleHealthCheck)
        .where(
            PublishedArticleHealthCheck.published_article_id == article_id,
            PublishedArticleHealthCheck.status == "CONFIRMED_ANOMALY",
        )
    )
    if last_restored_at is not None:
        count_stmt = count_stmt.where(PublishedArticleHealthCheck.checked_at > last_restored_at)
    if last_break is not None:
        break_at, break_id = last_break
        count_stmt = count_stmt.where(
            or_(
                PublishedArticleHealthCheck.checked_at > break_at,
                and_(
                    PublishedArticleHealthCheck.checked_at == break_at,
                    PublishedArticleHealthCheck.id > break_id,
                ),
            )
        )
    return int(db.scalar(count_stmt) or 0)


def _is_one_open_issue_error(error: IntegrityError) -> bool:
    original = error.orig
    return (
        getattr(original, "sqlstate", None) == "23505"
        and getattr(getattr(original, "diag", None), "constraint_name", None)
        == "uq_published_content_issues_one_open"
    )


def _article_due_for_interval(db: Session, article_id: uuid.UUID, interval_hours: int) -> bool:
    last_checked = db.scalar(
        select(func.max(PublishedArticleHealthCheck.checked_at)).where(
            PublishedArticleHealthCheck.published_article_id == article_id
        )
    )
    if last_checked is None:
        return True
    return last_checked <= datetime.now(UTC) - timedelta(hours=interval_hours)


def _execute_article_health_check(
    db: Session,
    *,
    article_id: uuid.UUID,
    actor: User | None,
    request_id: str,
    fetcher: PageHealthFetcher | None,
    allowed_actor_types: tuple[AccountType, ...],
    enforce_due_interval: bool,
) -> PublishedArticleHealthCheckOut | None:
    """内部单篇执行实现：外呼前释放事务，写阶段按 User -> PublishedArticle 锁序落盘。"""
    require_test_fetcher(fetcher)

    # 阶段 1：短只读校验身份、冷却期与目标 URL，外呼前立即释放事务与连接
    if actor is not None:
        with current_actor_command(db, actor, allowed=allowed_actor_types):
            pass
        db.rollback()

    article = db.get(PublishedArticle, article_id)
    if article is None:
        raise not_found("发布成果")
    work = db.get(PublicationWork, article.id)
    if work is None or not work.final_url:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布成果缺少公开访问地址", 409)
    content = db.get(ContentVersion, work.content_version_id)
    if content is None:
        raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布成果关联的批准内容不存在", 409)
    profile = (
        db.get(PlatformProfile, work.platform_profile_id)
        if work.platform_profile_id is not None
        else None
    )
    if enforce_due_interval:
        if profile is None or not profile.is_active or not profile.health_check_enabled:
            db.rollback()
            return None
        if not _article_due_for_interval(db, article.id, profile.health_check_interval_hours):
            db.rollback()
            return None

    checked_url = work.final_url
    expected_title = work.actual_title or content.title
    _, expected_body_text = render_markdown(content.body_markdown)
    allowed_domains = list(profile.allowed_domains) if profile is not None else []
    db.rollback()

    # 阶段 2：无数据库锁与事务的公开只读 HTTP 抓取
    active_fetcher = fetcher or PublicPageHttpFetcher()
    fetch_result = active_fetcher.fetch(checked_url)
    classification = classify_public_page_health(
        fetch_result,
        expected_title=expected_title,
        expected_body_text=expected_body_text,
        allowed_domains=allowed_domains,
    )

    # 阶段 3：短写事务先校验实时操作者身份，再锁定 PublishedArticle 原子写入历史与自动建单
    actor_ctx = (
        current_actor_command(db, actor, allowed=allowed_actor_types)
        if actor is not None
        else nullcontext(None)
    )
    with actor_ctx as live_actor:
        locked_article = db.scalar(
            select(PublishedArticle)
            .where(PublishedArticle.id == article_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if locked_article is None:
            raise not_found("发布成果")
        locked_work = db.get(PublicationWork, locked_article.id)
        if locked_work is None:
            raise AppError("PUBLICATION_CONTEXT_INCOMPLETE", "发布成果关联的发布工作不存在", 409)
        locked_profile = (
            db.get(PlatformProfile, locked_work.platform_profile_id)
            if locked_work.platform_profile_id is not None
            else None
        )
        # 周期/批量巡检写前在行锁内二次复核冷却间隔，阻断并发重叠批次重复落盘放大异常计数
        if enforce_due_interval and (
            locked_profile is None
            or not locked_profile.is_active
            or not locked_profile.health_check_enabled
            or not _article_due_for_interval(
                db, locked_article.id, locked_profile.health_check_interval_hours
            )
        ):
            db.rollback()
            return None

        threshold = (
            locked_profile.health_check_anomaly_threshold if locked_profile is not None else 2
        )

        auto_opened_issue_id: uuid.UUID | None = None
        if classification.status == "CONFIRMED_ANOMALY":
            prior_consecutive = count_consecutive_confirmed_anomalies(db, locked_article.id)
            if prior_consecutive + 1 >= threshold:
                existing_issues = list(
                    db.scalars(
                        select(PublishedContentIssue).where(
                            PublishedContentIssue.published_article_id == locked_article.id
                        )
                    )
                )
                has_open_or_retired = any(
                    issue.status == "OPEN" or issue.resolution_outcome == "RETIRED"
                    for issue in existing_issues
                )
                if not has_open_or_retired:
                    unavailable_codes = {"HTTP_GONE_OR_NOT_FOUND", "META_OR_HEADER_NOINDEX"}
                    kind = (
                        "PAGE_UNAVAILABLE"
                        if any(r in unavailable_codes for r in classification.anomaly_reasons)
                        else "CONTENT_CHANGED"
                    )
                    reason_text = "、".join(classification.anomaly_reasons)
                    issue = PublishedContentIssue(
                        published_article_id=locked_article.id,
                        kind=kind,
                        description=(
                            f"公开页面健康检查连续 {threshold} 次确认异常（{reason_text}），"
                            "系统自动登记发布后内容问题。"
                        ),
                        status="OPEN",
                        opened_by=(
                            live_actor.id if live_actor is not None else locked_work.created_by
                        ),
                    )
                    try:
                        with db.begin_nested():
                            db.add(issue)
                            db.flush()
                        auto_opened_issue_id = issue.id
                    except IntegrityError as exc:
                        if not _is_one_open_issue_error(exc):
                            raise

        row = PublishedArticleHealthCheck(
            published_article_id=locked_article.id,
            checked_url=checked_url,
            final_url=fetch_result.final_url,
            status=classification.status,
            http_status=fetch_result.http_status,
            redirect_count=fetch_result.redirect_count,
            redirected=fetch_result.redirected,
            page_title=fetch_result.page_title,
            title_matches=classification.title_matches,
            body_similarity=classification.body_similarity,
            has_noindex=fetch_result.has_noindex,
            canonical_url=fetch_result.canonical_url,
            canonical_matches=classification.canonical_matches,
            anomaly_reasons=classification.anomaly_reasons,
            fetch_error_code=classification.fetch_error_code,
            auto_opened_issue_id=auto_opened_issue_id,
            triggered_by=live_actor.id if live_actor is not None else None,
        )
        db.add(row)
        db.flush()

        if live_actor is not None:
            append_audit(
                db,
                AuditEntry(
                    actor_id=live_actor.id,
                    business_module=AuditModule.PUBLICATION,
                    action="published_article_health_check.run",
                    target_type="PublishedArticle",
                    target_id=locked_article.id,
                    request_id=request_id,
                    outcome=AuditOutcome.SUCCESS,
                    result_message="公开页面健康检查已执行",
                    details={
                        "facts": {
                            "publication_id": str(locked_article.id),
                            "status": classification.status,
                            "auto_opened_issue_count": 1 if auto_opened_issue_id is not None else 0,
                        }
                    },
                ),
            )
        db.commit()
    return health_check_out(row)


def run_published_article_health_check(
    db: Session,
    *,
    article_id: uuid.UUID,
    actor: User | None,
    request_id: str,
    fetcher: PageHealthFetcher | None = None,
) -> PublishedArticleHealthCheckOut:
    """手动执行单篇公开页面健康检查（不受周期冷却限制）。"""
    result = _execute_article_health_check(
        db,
        article_id=article_id,
        actor=actor,
        request_id=request_id,
        fetcher=fetcher,
        allowed_actor_types=(AccountType.ADMIN, AccountType.ENGINEER),
        enforce_due_interval=False,
    )
    assert result is not None
    return result


def run_due_article_health_check(
    db: Session,
    *,
    article_id: uuid.UUID,
    actor: User | None,
    request_id: str,
    fetcher: PageHealthFetcher | None = None,
) -> PublishedArticleHealthCheckOut | None:
    """到期巡检专用单篇入口：强校验 ADMIN 与行锁内冷却间隔，并发重复自动跳过。"""
    return _execute_article_health_check(
        db,
        article_id=article_id,
        actor=actor,
        request_id=request_id,
        fetcher=fetcher,
        allowed_actor_types=(AccountType.ADMIN,),
        enforce_due_interval=True,
    )


def list_published_article_health_checks(
    db: Session, *, article_id: uuid.UUID, limit: int = 30
) -> PublishedArticleHealthCheckList:
    """只读返回发布成果的公开页面健康检查历史与精确连续异常计数（不受 limit 截断）。"""
    article = db.get(PublishedArticle, article_id)
    if article is None:
        raise not_found("发布成果")
    work = db.get(PublicationWork, article.id)
    profile = (
        db.get(PlatformProfile, work.platform_profile_id)
        if work is not None and work.platform_profile_id is not None
        else None
    )
    rows = list(
        db.scalars(
            select(PublishedArticleHealthCheck)
            .where(PublishedArticleHealthCheck.published_article_id == article.id)
            .order_by(
                PublishedArticleHealthCheck.checked_at.desc(),
                PublishedArticleHealthCheck.id.desc(),
            )
            .limit(max(1, min(limit, 100)))
        )
    )
    consecutive = count_consecutive_confirmed_anomalies(db, article.id)
    return PublishedArticleHealthCheckList(
        published_article_id=article.id,
        platform_health_check_enabled=(
            bool(profile.health_check_enabled) if profile is not None else False
        ),
        anomaly_threshold=profile.health_check_anomaly_threshold if profile is not None else 2,
        consecutive_confirmed_anomalies=consecutive,
        latest_status=rows[0].status if rows else None,
        items=[health_check_out(row) for row in rows],
    )
