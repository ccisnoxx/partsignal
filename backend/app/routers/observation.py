"""追加式 GEO 观测、可复算指标和工作台摘要接口。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, status
from sqlalchemy import func, select

from app.deps import (
    CsrfProtected,
    CurrentUser,
    DbSession,
    assert_account_types,
)
from app.errors import AppError, not_found
from app.models.content import ContentVersion
from app.models.geo_files import GeoObservation
from app.models.product_facts import FactVersion, Product
from app.models.publication import PublicationWork
from app.schemas.common import AccountType
from app.schemas.content import ContentTaskOut
from app.schemas.geo_files import (
    DashboardSummary,
    GeoAccuracy,
    GeoInsights,
    GeoMetrics,
    GeoObservationCreate,
    GeoObservationKind,
    GeoObservationList,
    GeoObservationOut,
    GeoObservationSortOrder,
    GeoOptimizationContentTaskCreate,
    GeoPublicationCandidateList,
    LegacyRecommendation,
)
from app.services.geo_observation import (
    GeoInsightFilters,
    GeoObservationFilters,
    create_geo_optimization_content_task,
    geo_publication_candidates,
)
from app.services.geo_observation import (
    create_geo_observation as create_geo_observation_command,
)
from app.services.geo_observation import (
    delete_geo_observation as delete_geo_observation_command,
)
from app.services.geo_observation import (
    get_geo_insights as get_geo_insights_service,
)
from app.services.geo_observation import (
    get_geo_metrics as get_geo_metrics_service,
)
from app.services.geo_observation import (
    get_geo_observation as get_geo_observation_service,
)
from app.services.geo_observation import (
    list_geo_observations as list_geo_observations_service,
)
from app.services.projections import content_task_out
from app.services.publication_queries import NONTERMINAL_WORK_STATUSES, open_issue_count

router = APIRouter(prefix="/api/v1", tags=["observation"])


def geo_observation_filters(
    date_from: date | None = None,
    date_to: date | None = None,
    observation_kind: GeoObservationKind | None = None,
    product_id: uuid.UUID | None = None,
    search: Annotated[str | None, Query(max_length=500)] = None,
    query_topic_id: uuid.UUID | None = None,
    model_name: Annotated[str | None, Query(max_length=160)] = None,
    search_platform: Annotated[str | None, Query(max_length=160)] = None,
    publication_search: Annotated[str | None, Query(max_length=500)] = None,
    discovered: bool | None = None,
    mentioned: bool | None = None,
    recommendation: LegacyRecommendation | None = None,
    has_citation: bool | None = None,
    accuracy: GeoAccuracy | None = None,
    recorder_search: Annotated[str | None, Query(max_length=200)] = None,
    only_mine: bool = False,
    include_history: bool = False,
) -> GeoObservationFilters:
    """校验并归一化列表与指标共享的查询参数。"""
    if date_from is not None and date_to is not None and date_from > date_to:
        raise AppError("VALIDATION_ERROR", "开始日期不能晚于结束日期", 422)
    text_filters = {
        "搜索词": search,
        "模型名称": model_name,
        "搜索平台": search_platform,
        "关联发布内容": publication_search,
        "记录人": recorder_search,
    }
    if blank_label := next(
        (label for label, value in text_filters.items() if value is not None and not value.strip()),
        None,
    ):
        raise AppError("VALIDATION_ERROR", f"{blank_label}不能为空", 422)
    return GeoObservationFilters(
        date_from=date_from,
        date_to=date_to,
        observation_kind=observation_kind,
        product_id=product_id,
        search=search.strip() if search is not None else None,
        query_topic_id=query_topic_id,
        model_name=model_name.strip() if model_name is not None else None,
        search_platform=search_platform.strip() if search_platform is not None else None,
        publication_search=(publication_search.strip() if publication_search is not None else None),
        discovered=discovered,
        mentioned=mentioned,
        recommendation=recommendation,
        has_citation=has_citation,
        accuracy=accuracy,
        recorder_search=recorder_search.strip() if recorder_search is not None else None,
        only_mine=only_mine,
        include_history=include_history,
    )


def geo_insight_filters(
    date_from: date | None = None,
    date_to: date | None = None,
    product_id: uuid.UUID | None = None,
    content_platform_id: uuid.UUID | None = None,
    geo_platform: Annotated[str | None, Query(max_length=160)] = None,
    published_article_id: uuid.UUID | None = None,
    query_topic_id: uuid.UUID | None = None,
) -> GeoInsightFilters:
    """校验洞察页面全部区块共用的精确筛选。"""
    if date_from is not None and date_to is not None and date_from > date_to:
        raise AppError("VALIDATION_ERROR", "开始日期不能晚于结束日期", 422)
    if geo_platform is not None and not geo_platform.strip():
        raise AppError("VALIDATION_ERROR", "GEO 平台不能为空", 422)
    return GeoInsightFilters(
        date_from=date_from,
        date_to=date_to,
        product_id=product_id,
        content_platform_id=content_platform_id,
        geo_platform=geo_platform.strip() if geo_platform is not None else None,
        published_article_id=published_article_id,
        query_topic_id=query_topic_id,
    )


@router.get(
    "/geo-observations", response_model=GeoObservationList, operation_id="listGeoObservations"
)
def list_geo_observations(
    db: DbSession,
    user: CurrentUser,
    filters: Annotated[GeoObservationFilters, Depends(geo_observation_filters)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    sort_order: GeoObservationSortOrder = "DESC",
) -> GeoObservationList:
    """按共享筛选分页返回观测记录。"""
    return list_geo_observations_service(
        db,
        filters=filters,
        actor=user,
        page=page,
        page_size=page_size,
        sort_order=sort_order,
    )


@router.get(
    "/geo-observations/{observation_id}",
    response_model=GeoObservationOut,
    operation_id="getGeoObservation",
)
def get_geo_observation(
    observation_id: uuid.UUID, db: DbSession, user: CurrentUser
) -> GeoObservationOut:
    """返回一条观测详情，纠正历史也可以直接读取。"""
    return get_geo_observation_service(db, observation_id, actor=user)


@router.delete(
    "/geo-observations/{observation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteGeoObservation",
)
def delete_geo_observation(
    observation_id: uuid.UUID,
    request: Request,
    db: DbSession,
    admin: CurrentUser,
    _csrf: CsrfProtected,
) -> None:
    """仅由管理员处置完整的人工 GEO 更正链。"""
    assert_account_types(admin, (AccountType.ADMIN,))
    delete_geo_observation_command(
        db=db,
        observation_id=observation_id,
        actor=admin,
        request_id=request.state.request_id,
    )


@router.get(
    "/geo-observation-publications",
    response_model=GeoPublicationCandidateList,
    operation_id="listGeoObservationPublications",
)
def list_geo_observation_publications(
    product_id: uuid.UUID, db: DbSession, _user: CurrentUser
) -> GeoPublicationCandidateList:
    """返回产品当前全部可由人工搜索核对的公开文章。"""
    if db.get(Product, product_id) is None:
        raise not_found("产品")
    return GeoPublicationCandidateList(items=geo_publication_candidates(db, product_id))


@router.post(
    "/geo-observations",
    response_model=GeoObservationOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createGeoObservation",
)
def create_geo_observation(
    payload: GeoObservationCreate,
    request: Request,
    db: DbSession,
    analyst: CurrentUser,
    _csrf: CsrfProtected,
) -> GeoObservationOut:
    assert_account_types(analyst, (AccountType.ADMIN, AccountType.ENGINEER))
    observation = create_geo_observation_command(
        db=db, payload=payload, actor=analyst, request_id=request.state.request_id
    )
    return get_geo_observation_service(db, observation.id, actor=analyst)


@router.get("/geo-metrics", response_model=GeoMetrics, operation_id="getGeoMetrics")
def get_geo_metrics(
    db: DbSession,
    user: CurrentUser,
    filters: Annotated[GeoObservationFilters, Depends(geo_observation_filters)],
) -> GeoMetrics:
    """从与列表相同的观测集合实时计算指标。"""
    return get_geo_metrics_service(db, filters=filters, actor=user)


@router.get("/geo-insights", response_model=GeoInsights, operation_id="getGeoInsights")
def get_geo_insights(
    db: DbSession,
    _user: CurrentUser,
    filters: Annotated[GeoInsightFilters, Depends(geo_insight_filters)],
) -> GeoInsights:
    """返回同一筛选口径下的全部人工 GEO 洞察。"""
    return get_geo_insights_service(db, filters=filters)


@router.post(
    "/geo-insights/optimization-content-tasks",
    response_model=ContentTaskOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createGeoOptimizationContentTask",
)
def create_geo_optimization_task(
    payload: GeoOptimizationContentTaskCreate,
    request: Request,
    db: DbSession,
    analyst: CurrentUser,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", min_length=8, max_length=128)
    ],
) -> ContentTaskOut:
    assert_account_types(analyst, (AccountType.ADMIN, AccountType.ENGINEER))
    task = create_geo_optimization_content_task(
        db=db,
        payload=payload,
        actor=analyst,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )
    return content_task_out(db, task)


@router.get(
    "/dashboard/summary", response_model=DashboardSummary, operation_id="getDashboardSummary"
)
def get_dashboard_summary(db: DbSession, _user: CurrentUser) -> DashboardSummary:
    since = datetime.now(UTC) - timedelta(days=30)
    return DashboardSummary(
        pending_fact_reviews=int(
            db.scalar(
                select(func.count())
                .select_from(FactVersion)
                .where(FactVersion.status == "PENDING_REVIEW")
            )
            or 0
        ),
        pending_content_reviews=int(
            db.scalar(
                select(func.count())
                .select_from(ContentVersion)
                .where(ContentVersion.status == "PENDING_REVIEW")
            )
            or 0
        ),
        pending_publications=int(
            db.scalar(
                select(func.count())
                .select_from(PublicationWork)
                .where(PublicationWork.status.in_(NONTERMINAL_WORK_STATUSES))
            )
            or 0
        ),
        open_publication_issues=open_issue_count(db),
        recent_accuracy_errors=int(
            db.scalar(
                select(func.count())
                .select_from(GeoObservation)
                .where(
                    GeoObservation.observation_kind == "LEGACY_MODEL_RESULT",
                    GeoObservation.tested_at >= since,
                    GeoObservation.accuracy.in_(["PARTIAL", "INCORRECT"]),
                )
            )
            or 0
        ),
    )
