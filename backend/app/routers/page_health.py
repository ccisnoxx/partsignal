"""Slice 3D：公开页面健康检查平台配置与执行 HTTP 接口。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request

from app.deps import AdminUser, CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.page_health import (
    PlatformHealthCheckSettingsOut,
    PlatformHealthCheckSettingsUpdate,
    PublicPageHealthCheckBatchOut,
    PublicPageHealthCheckRunDueRequest,
    PublishedArticleHealthCheckList,
    PublishedArticleHealthCheckOut,
)
from app.services.page_health_checks import (
    list_published_article_health_checks,
    run_published_article_health_check,
)
from app.services.page_health_scheduler import (
    get_platform_health_check_settings,
    run_due_public_page_health_checks,
    update_platform_health_check_settings,
)

router = APIRouter(prefix="/api/v1", tags=["page-health"])


def _repeatable_read_snapshot(db: DbSession) -> None:
    """在认证查询开启事务之前配置单次 REPEATABLE READ 读取快照。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


@router.get(
    "/platform-profiles/{platform_profile_id}/health-check-settings",
    response_model=PlatformHealthCheckSettingsOut,
    operation_id="getPlatformHealthCheckSettings",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_platform_health_check_settings_endpoint(
    platform_profile_id: uuid.UUID,
    db: DbSession,
    _user: EngineerUser,
) -> PlatformHealthCheckSettingsOut:
    return get_platform_health_check_settings(db, platform_profile_id)


@router.patch(
    "/platform-profiles/{platform_profile_id}/health-check-settings",
    response_model=PlatformHealthCheckSettingsOut,
    operation_id="updatePlatformHealthCheckSettings",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_platform_health_check_settings_endpoint(
    platform_profile_id: uuid.UUID,
    payload: PlatformHealthCheckSettingsUpdate,
    request: Request,
    db: DbSession,
    actor: AdminUser,
    _csrf: CsrfProtected,
) -> PlatformHealthCheckSettingsOut:
    return update_platform_health_check_settings(
        db=db,
        platform_profile_id=platform_profile_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.get(
    "/published-articles/{article_id}/health-checks",
    response_model=PublishedArticleHealthCheckList,
    operation_id="listPublishedArticleHealthChecks",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def list_published_article_health_checks_endpoint(
    article_id: uuid.UUID,
    db: DbSession,
    _user: EngineerUser,
    limit: int = Query(default=30, ge=1, le=100),
) -> PublishedArticleHealthCheckList:
    return list_published_article_health_checks(db, article_id=article_id, limit=limit)


@router.post(
    "/published-articles/{article_id}/health-checks",
    response_model=PublishedArticleHealthCheckOut,
    operation_id="runPublishedArticleHealthCheck",
    responses=error_responses(401, 403, 404, 409, 422),
)
def run_published_article_health_check_endpoint(
    article_id: uuid.UUID,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> PublishedArticleHealthCheckOut:
    return run_published_article_health_check(
        db,
        article_id=article_id,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.post(
    "/published-articles/health-checks/run-due",
    response_model=PublicPageHealthCheckBatchOut,
    operation_id="runDuePublicPageHealthChecks",
    responses=error_responses(401, 403, 422),
)
def run_due_public_page_health_checks_endpoint(
    payload: PublicPageHealthCheckRunDueRequest,
    request: Request,
    db: DbSession,
    actor: AdminUser,
    _csrf: CsrfProtected,
) -> PublicPageHealthCheckBatchOut:
    return run_due_public_page_health_checks(
        db,
        actor=actor,
        request_id=request.state.request_id,
        limit=payload.limit,
    )
