"""人工录入 HTTP 边界；不拥有事务、行锁或持久化写入。"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request

from app.deps import CsrfProtected, DbSession, EngineerUser, ReaderUser
from app.errors import AppError, error_responses
from app.schemas.geo_daily_checklist import (
    GeoCitationPublicationLinkOut,
    GeoManualFailOut,
    GeoManualFailRequest,
    GeoManualPreviewOut,
    GeoManualPreviewRequest,
)
from app.schemas.geo_manual_cancellation import (
    GeoManualRunCancellationOut,
    GeoManualRunCancelRequest,
)
from app.schemas.geo_manual_collection import (
    GeoManualDraftOut,
    GeoManualDraftSave,
    GeoManualEntryContext,
    GeoManualObservationSubmit,
    GeoManualObservationSubmitted,
)
from app.services import geo_citation_matching as citation_links
from app.services import geo_manual_collection as service
from app.services import geo_manual_preview as preview_service
from app.services.geo_manual_cancellation import cancel_manual_run
from app.services.geo_plan_queries import read_snapshot

router = APIRouter(prefix="/api/v1/geo/observation-runs", tags=["geo-manual-collection"])


@router.get(
    "/{run_id}/manual-entry",
    response_model=GeoManualEntryContext,
    operation_id="getGeoManualEntryContext",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404, 409, 422),
)
def manual_entry(run_id: UUID, db: DbSession, user: EngineerUser) -> GeoManualEntryContext:
    return service.manual_entry_context(db, run_id=run_id, actor=user)


@router.put(
    "/{run_id}/manual-draft",
    response_model=GeoManualDraftOut,
    operation_id="saveGeoManualDraft",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def save_manual_draft(
    run_id: UUID,
    payload: GeoManualDraftSave,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoManualDraftOut:
    return service.save_manual_draft(
        db, run_id=run_id, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.post(
    "/{run_id}/manual-submit",
    status_code=201,
    response_model=GeoManualObservationSubmitted,
    operation_id="submitGeoManualObservation",
    responses=error_responses(401, 403, 404, 409, 422, 503),
)
def submit_manual_observation(
    run_id: UUID,
    payload: GeoManualObservationSubmit,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[
        str,
        Header(alias="Idempotency-Key", min_length=1, max_length=160, pattern=r"^[\x21-\x7E]+$"),
    ],
) -> GeoManualObservationSubmitted:
    return service.submit_manual_observation(
        db,
        run_id=run_id,
        payload=payload,
        actor=user,
        idempotency_key=idempotency_key,
        request_id=request.state.request_id,
    )


@router.post(
    "/{run_id}/manual-cancel",
    response_model=GeoManualRunCancellationOut,
    operation_id="cancelGeoManualObservationRun",
    responses=error_responses(401, 403, 404, 409, 422),
)
def cancel_manual_observation(
    run_id: UUID,
    payload: GeoManualRunCancelRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoManualRunCancellationOut:
    try:
        return cancel_manual_run(
            db, run_id=run_id, payload=payload, actor=user, request_id=request.state.request_id
        )
    except AppError:
        raise
    except Exception:
        failure = RuntimeError("人工取消失败，请按请求ID重读运行详情核对")
    raise failure


@router.post(
    "/{run_id}/manual-preview",
    response_model=GeoManualPreviewOut,
    operation_id="previewGeoManualObservation",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def manual_preview(
    run_id: UUID,
    payload: GeoManualPreviewRequest,
    db: DbSession,
    _user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoManualPreviewOut:
    """只读规则预判：别名命中、推荐初判、URL 抽取与文章发布候选匹配。"""
    return preview_service.preview_manual_observation(db, run_id=run_id, payload=payload)


@router.post(
    "/{run_id}/manual-fail",
    response_model=GeoManualFailOut,
    operation_id="failGeoManualObservationRun",
    responses=error_responses(401, 403, 404, 409, 422),
)
def manual_fail(
    run_id: UUID,
    payload: GeoManualFailRequest,
    request: Request,
    db: DbSession,
    user: EngineerUser,
    _csrf: CsrfProtected,
) -> GeoManualFailOut:
    """标记人工采集异常失败，绝不伪装为未命中。"""
    return preview_service.fail_manual_run(
        db, run_id=run_id, payload=payload, actor=user, request_id=request.state.request_id
    )


@router.get(
    "/{run_id}/citation-links",
    response_model=list[GeoCitationPublicationLinkOut],
    operation_id="listGeoRunCitationLinks",
    dependencies=[Depends(read_snapshot)],
    responses=error_responses(401, 403, 404),
)
def list_run_citation_links_route(
    run_id: UUID,
    db: DbSession,
    _user: ReaderUser,
) -> list[GeoCitationPublicationLinkOut]:
    """只读返回单次运行的回答引用到文章发布台账的分级归因列表。"""
    return citation_links.list_run_citation_links(db, run_id)
