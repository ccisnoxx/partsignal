"""Opportunity HTTP边界；事务和状态规则由应用服务拥有。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Query, Request, Response

from app.deps import AdminUser, CsrfProtected, DbSession, EngineerUser
from app.errors import AppError, error_responses
from app.schemas.geo_opportunities import GeoOpportunityActionType
from app.schemas.geo_opportunity_actions import (
    GeoOpportunityContentTaskRequest,
    GeoOpportunityFactRevisionRequest,
    GeoOpportunityPublicationRepairRequest,
)
from app.schemas.geo_opportunity_evaluation import (
    GeoOpportunityEvaluationReceipt,
    GeoOpportunityEvaluationRequest,
)
from app.schemas.geo_opportunity_workbench import (
    GeoOpportunityActionResult,
    GeoOpportunityDetail,
    GeoOpportunityDismissRequest,
    GeoOpportunityFilters,
    GeoOpportunityListItem,
    GeoOpportunityListPage,
    GeoOpportunityRevisionRequest,
    GeoOpportunitySourceFilters,
)
from app.services import (
    geo_opportunity_actions,
    geo_opportunity_commands,
    geo_opportunity_evaluation,
    geo_opportunity_queries,
)
from app.services.geo_catalog_queries import read_snapshot

router = APIRouter(prefix="/api/v1/geo/opportunities", tags=["geo-opportunities"])

ActionKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=8, max_length=128, pattern=r"^[\x21-\x7E]+$")
]


@router.post(
    "/evaluate",
    response_model=GeoOpportunityEvaluationReceipt,
    operation_id="evaluateGeoOpportunities",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def evaluate_opportunities(
    payload: GeoOpportunityEvaluationRequest,
    request: Request,
    response: Response,
    db: DbSession,
    actor: AdminUser,
    _csrf: CsrfProtected,
    idempotency_key: ActionKey,
) -> GeoOpportunityEvaluationReceipt:
    response.headers["Cache-Control"] = "no-store"
    try:
        return geo_opportunity_evaluation.run_evaluation(
            db, payload, actor=actor, request_id=request.state.request_id,
            idempotency_key=idempotency_key,
        )
    except AppError:
        raise
    except Exception:
        failure = RuntimeError("GEO机会评估失败，请按请求ID和OPPORTUNITY运维事件排障")
    # 已安装的Starlette会将__context__提升为__cause__；须退出except再抛出安全异常。
    # 未知失败仍走既有500边界，原数据库/验证异常不交给ASGI日志序列化。
    raise failure


@router.get(
    "",
    response_model=GeoOpportunityListPage,
    operation_id="listGeoOpportunities",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_opportunities(
    db: DbSession, actor: EngineerUser, filters: Annotated[GeoOpportunityFilters, Query()]
) -> GeoOpportunityListPage:
    return geo_opportunity_queries.list_opportunities(db, filters, actor=actor)


@router.get(
    "/{opportunity_id}",
    response_model=GeoOpportunityDetail,
    operation_id="getGeoOpportunity",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def get_opportunity(
    opportunity_id: UUID,
    db: DbSession,
    actor: EngineerUser,
    response: Response,
    filters: Annotated[GeoOpportunitySourceFilters, Query()],
) -> GeoOpportunityDetail:
    response.headers["Cache-Control"] = "no-store"
    return geo_opportunity_queries.get_opportunity(db, opportunity_id, filters, actor=actor)


@router.post(
    "/{opportunity_id}/acknowledge",
    response_model=GeoOpportunityListItem,
    operation_id="acknowledgeGeoOpportunity",
    responses=error_responses(401, 403, 404, 409, 422),
)
def acknowledge_opportunity(
    opportunity_id: UUID,
    payload: GeoOpportunityRevisionRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoOpportunityListItem:
    return geo_opportunity_commands.acknowledge(
        db, opportunity_id, payload, actor=actor, request_id=request.state.request_id
    )


@router.post(
    "/{opportunity_id}/dismiss",
    response_model=GeoOpportunityListItem,
    operation_id="dismissGeoOpportunity",
    responses=error_responses(401, 403, 404, 409, 422),
)
def dismiss_opportunity(
    opportunity_id: UUID,
    payload: GeoOpportunityDismissRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoOpportunityListItem:
    return geo_opportunity_commands.dismiss(
        db, opportunity_id, payload, actor=actor, request_id=request.state.request_id
    )


@router.post(
    "/{opportunity_id}/actions/fact-revision",
    response_model=GeoOpportunityActionResult,
    operation_id="startFactRevisionFromGeoOpportunity",
    responses=error_responses(401, 403, 404, 409, 422),
)
def start_fact_revision(
    opportunity_id: UUID,
    payload: GeoOpportunityFactRevisionRequest,
    request: Request,
    response: Response,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: ActionKey,
) -> GeoOpportunityActionResult:
    response.headers["Cache-Control"] = "no-store"
    return geo_opportunity_actions.link_action(
        db,
        opportunity_id,
        payload,
        kind=GeoOpportunityActionType.FACT_REVISION,
        actor=actor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )


@router.post(
    "/{opportunity_id}/actions/content-task",
    response_model=GeoOpportunityActionResult,
    operation_id="createContentTaskFromGeoOpportunity",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_content_task(
    opportunity_id: UUID,
    payload: GeoOpportunityContentTaskRequest,
    request: Request,
    response: Response,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: ActionKey,
) -> GeoOpportunityActionResult:
    response.headers["Cache-Control"] = "no-store"
    return geo_opportunity_actions.link_action(
        db,
        opportunity_id,
        payload,
        kind=GeoOpportunityActionType.CONTENT_TASK,
        actor=actor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )


@router.post(
    "/{opportunity_id}/actions/publication-repair",
    response_model=GeoOpportunityActionResult,
    operation_id="createPublicationRepairFromGeoOpportunity",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_publication_repair(
    opportunity_id: UUID,
    payload: GeoOpportunityPublicationRepairRequest,
    request: Request,
    response: Response,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: ActionKey,
) -> GeoOpportunityActionResult:
    response.headers["Cache-Control"] = "no-store"
    return geo_opportunity_actions.link_action(
        db,
        opportunity_id,
        payload,
        kind=GeoOpportunityActionType.PUBLICATION_REPAIR,
        actor=actor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )
