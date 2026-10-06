"""报告HTTP入口；资格、事务、流生命周期与审计归应用服务。"""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response

from app.deps import DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.geo_answer_insights import GeoAnswerInsightFilters
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_reports import GeoReportPreview
from app.services import geo_reports as service
from app.services.geo_plan_queries import read_snapshot

router = APIRouter(
    prefix="/api/v1/geo/reports", tags=["geo-reports"], dependencies=[Depends(read_snapshot)]
)


@router.get(
    "/preview",
    response_model=GeoReportPreview,
    operation_id="getGeoReportPreview",
    responses=error_responses(401, 403, 409, 422),
)
def preview(
    db: DbSession,
    user: EngineerUser,
    response: Response,
    filters: Annotated[GeoAnswerInsightFilters, Query()],
) -> GeoReportPreview:
    response.headers["Cache-Control"] = "no-store"
    return service.get_preview(db, filters)


@router.get(
    "/print",
    response_model=GeoReportPreview,
    operation_id="getGeoPrintReport",
    responses=error_responses(401, 403, 409, 422),
)
def print_report(
    request: Request,
    db: DbSession,
    user: EngineerUser,
    response: Response,
    filters: Annotated[GeoAnswerInsightFilters, Query()],
) -> GeoReportPreview:
    response.headers["Cache-Control"] = "no-store"
    return service.prepare_print(db, user, filters, request.state.request_id)


CSV_RESPONSES: dict[int | str, dict[str, Any]] = error_responses(401, 403, 409, 422, 501) | {
    200: {
        "description": "授权后开始流式导出，后续断流不代表客户端已收到全部数据",
        "content": {"text/csv": {"schema": {"type": "string"}}},
        "headers": {
            "Content-Disposition": {"schema": {"type": "string"}},
            "X-Report-As-Of": {"schema": {"type": "string"}},
        },
    }
}


@router.get(
    "/runs.csv",
    operation_id="exportGeoRunsCsv",
    response_class=Response,
    responses=CSV_RESPONSES,
)
def runs_csv(
    request: Request,
    db: DbSession,
    user: EngineerUser,
    filters: Annotated[GeoOverviewFilters, Query()],
) -> Response:
    return service.prepare_csv(db, user, filters, "runs", request.state.request_id)


@router.get(
    "/citations.csv",
    operation_id="exportGeoCitationsCsv",
    response_class=Response,
    responses=CSV_RESPONSES,
)
def citations_csv(
    request: Request,
    db: DbSession,
    user: EngineerUser,
    filters: Annotated[GeoOverviewFilters, Query()],
) -> Response:
    return service.prepare_csv(db, user, filters, "citations", request.state.request_id)


@router.get(
    "/claims.csv",
    operation_id="exportGeoClaimsCsv",
    response_class=Response,
    responses=CSV_RESPONSES,
)
def claims_csv(
    request: Request,
    db: DbSession,
    user: EngineerUser,
    filters: Annotated[GeoOverviewFilters, Query()],
) -> Response:
    return service.prepare_csv(db, user, filters, "claims", request.state.request_id)


@router.get(
    "/opportunities.csv",
    operation_id="exportGeoOpportunitiesCsv",
    response_class=Response,
    responses=CSV_RESPONSES,
)
def opportunities_csv(
    request: Request,
    db: DbSession,
    user: EngineerUser,
    filters: Annotated[GeoOverviewFilters, Query()],
) -> Response:
    return service.prepare_csv(db, user, filters, "opportunities", request.state.request_id)
