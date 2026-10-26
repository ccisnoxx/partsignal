"""显式重试 HTTP 边界；事务、锁和 ORM 写入属于 Application Service。"""

from uuid import UUID

from fastapi import APIRouter, Request, Response

from app.deps import AdminUser, CsrfProtected, DbSession, EngineerUser
from app.errors import AppError, error_responses
from app.schemas.geo_reanalysis import GeoRunReanalysisAccepted, GeoRunReanalysisRequest
from app.schemas.geo_run_retry import GeoRunRetryCreated, GeoRunRetryRequest
from app.services.geo_reanalysis import reanalyze_run
from app.services.geo_run_retries import retry_collection_run

router = APIRouter(prefix="/api/v1/geo/observation-runs", tags=["geo-run-commands"])


@router.post(
    "/{run_id}/retry",
    status_code=201,
    response_model=GeoRunRetryCreated,
    operation_id="retryGeoObservationRun",
    responses=error_responses(401, 403, 404, 409, 422),
)
def retry_run(
    run_id: UUID,
    payload: GeoRunRetryRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoRunRetryCreated:
    return retry_collection_run(
        db, run_id=run_id, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.post(
    "/{run_id}/reanalyze",
    response_model=GeoRunReanalysisAccepted,
    operation_id="reanalyzeGeoObservationRun",
    responses=error_responses(401, 403, 404, 409, 422),
)
def reanalyze_run_http(
    run_id: UUID,
    payload: GeoRunReanalysisRequest,
    request: Request,
    user: AdminUser,
    _csrf: CsrfProtected,
    response: Response,
) -> GeoRunReanalysisAccepted:
    response.headers["Cache-Control"] = "no-store"
    try:
        analysis_id = reanalyze_run(
            run_id=run_id,
            expected_revision=payload.expected_revision,
            actor=user,
            reason=payload.reason,
            request_id=request.state.request_id,
        )
    except AppError:
        raise
    except Exception:
        failure = RuntimeError("重新分析请求失败，请按请求ID核对分析历史与运维事件")
    else:
        return GeoRunReanalysisAccepted(
            run_id=run_id, analysis_revision_id=analysis_id, request_id=request.state.request_id
        )
    # 离开except再抛出，避免既有ASGI异常路径把SQL参数/输入快照作为cause打印。
    raise failure
