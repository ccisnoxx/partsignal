"""内容活动策划（ContentCampaign）HTTP 接口。"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, status
from pydantic import BeforeValidator

from app.deps import CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.campaign import (
    ContentCampaignCreate,
    ContentCampaignDetail,
    ContentCampaignListPage,
    ContentCampaignOptions,
    ContentCampaignStatus,
    ContentCampaignUpdate,
    WorkPriority,
)
from app.schemas.common import RevisionRequest
from app.services.content_campaigns import (
    create_content_campaign as create_content_campaign_command,
)
from app.services.content_campaigns import (
    delete_content_campaign as delete_content_campaign_command,
)
from app.services.content_campaigns import (
    get_content_campaign_detail as get_content_campaign_detail_query,
)
from app.services.content_campaigns import (
    get_content_campaign_options as get_content_campaign_options_query,
)
from app.services.content_campaigns import (
    list_content_campaigns as list_content_campaigns_query,
)
from app.services.content_campaigns import read_campaign_snapshot
from app.services.content_campaigns import (
    transition_content_campaign_status as transition_campaign_command,
)
from app.services.content_campaigns import (
    update_content_campaign as update_content_campaign_command,
)

router = APIRouter(prefix="/api/v1/content-campaigns", tags=["planning"])


@router.get(
    "",
    response_model=ContentCampaignListPage,
    operation_id="listContentCampaigns",
    dependencies=[Depends(read_campaign_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_content_campaigns(
    db: DbSession,
    _user: EngineerUser,
    q: Annotated[str | None, Query(max_length=200)] = None,
    campaign_status: Annotated[ContentCampaignStatus | None, Query(alias="status")] = None,
    priority: WorkPriority | None = None,
    owner_id: uuid.UUID | None = None,
    product_id: uuid.UUID | None = None,
    query_topic_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int), Query()] = 20,
) -> ContentCampaignListPage:
    return list_content_campaigns_query(
        db,
        q=q,
        status=campaign_status,
        priority=priority,
        owner_id=owner_id,
        product_id=product_id,
        query_topic_id=query_topic_id,
        page=page,
        page_size=page_size,
    )


@router.get(
    "/options",
    response_model=ContentCampaignOptions,
    operation_id="getContentCampaignOptions",
    dependencies=[Depends(read_campaign_snapshot)],
    responses=error_responses(401, 403, 422),
)
def get_content_campaign_options(
    db: DbSession,
    _editor: EngineerUser,
) -> ContentCampaignOptions:
    return get_content_campaign_options_query(db)


@router.post(
    "",
    response_model=ContentCampaignDetail,
    status_code=status.HTTP_201_CREATED,
    operation_id="createContentCampaign",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_content_campaign(
    payload: ContentCampaignCreate,
    request: Request,
    db: DbSession,
    editor: EngineerUser,
    _csrf: CsrfProtected,
) -> ContentCampaignDetail:
    return create_content_campaign_command(
        db=db,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )


@router.get(
    "/{campaign_id}",
    response_model=ContentCampaignDetail,
    operation_id="getContentCampaign",
    dependencies=[Depends(read_campaign_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_content_campaign(
    campaign_id: uuid.UUID,
    db: DbSession,
    _user: EngineerUser,
) -> ContentCampaignDetail:
    return get_content_campaign_detail_query(db, campaign_id)


@router.patch(
    "/{campaign_id}",
    response_model=ContentCampaignDetail,
    operation_id="updateContentCampaign",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_content_campaign(
    campaign_id: uuid.UUID,
    payload: ContentCampaignUpdate,
    request: Request,
    db: DbSession,
    editor: EngineerUser,
    _csrf: CsrfProtected,
) -> ContentCampaignDetail:
    return update_content_campaign_command(
        db=db,
        campaign_id=campaign_id,
        payload=payload,
        actor=editor,
        request_id=request.state.request_id,
    )


@router.post(
    "/{campaign_id}/activate",
    response_model=ContentCampaignDetail,
    operation_id="activateContentCampaign",
    responses=error_responses(401, 403, 404, 409, 422),
)
def activate_content_campaign(
    campaign_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    editor: EngineerUser,
    _csrf: CsrfProtected,
) -> ContentCampaignDetail:
    return transition_campaign_command(
        db=db,
        campaign_id=campaign_id,
        expected_revision=payload.expected_revision,
        operation="activate",
        actor=editor,
        request_id=request.state.request_id,
    )


@router.post(
    "/{campaign_id}/pause",
    response_model=ContentCampaignDetail,
    operation_id="pauseContentCampaign",
    responses=error_responses(401, 403, 404, 409, 422),
)
def pause_content_campaign(
    campaign_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    editor: EngineerUser,
    _csrf: CsrfProtected,
) -> ContentCampaignDetail:
    return transition_campaign_command(
        db=db,
        campaign_id=campaign_id,
        expected_revision=payload.expected_revision,
        operation="pause",
        actor=editor,
        request_id=request.state.request_id,
    )


@router.post(
    "/{campaign_id}/resume",
    response_model=ContentCampaignDetail,
    operation_id="resumeContentCampaign",
    responses=error_responses(401, 403, 404, 409, 422),
)
def resume_content_campaign(
    campaign_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    editor: EngineerUser,
    _csrf: CsrfProtected,
) -> ContentCampaignDetail:
    return transition_campaign_command(
        db=db,
        campaign_id=campaign_id,
        expected_revision=payload.expected_revision,
        operation="resume",
        actor=editor,
        request_id=request.state.request_id,
    )


@router.post(
    "/{campaign_id}/complete",
    response_model=ContentCampaignDetail,
    operation_id="completeContentCampaign",
    responses=error_responses(401, 403, 404, 409, 422),
)
def complete_content_campaign(
    campaign_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    editor: EngineerUser,
    _csrf: CsrfProtected,
) -> ContentCampaignDetail:
    return transition_campaign_command(
        db=db,
        campaign_id=campaign_id,
        expected_revision=payload.expected_revision,
        operation="complete",
        actor=editor,
        request_id=request.state.request_id,
    )


@router.post(
    "/{campaign_id}/archive",
    response_model=ContentCampaignDetail,
    operation_id="archiveContentCampaign",
    responses=error_responses(401, 403, 404, 409, 422),
)
def archive_content_campaign(
    campaign_id: uuid.UUID,
    payload: RevisionRequest,
    request: Request,
    db: DbSession,
    editor: EngineerUser,
    _csrf: CsrfProtected,
) -> ContentCampaignDetail:
    return transition_campaign_command(
        db=db,
        campaign_id=campaign_id,
        expected_revision=payload.expected_revision,
        operation="archive",
        actor=editor,
        request_id=request.state.request_id,
    )


@router.delete(
    "/{campaign_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    operation_id="deleteContentCampaign",
    responses=error_responses(401, 403, 404, 409, 422),
)
def delete_content_campaign(
    campaign_id: uuid.UUID,
    expected_revision: Annotated[int, Query(ge=0)],
    request: Request,
    db: DbSession,
    editor: EngineerUser,
    _csrf: CsrfProtected,
) -> None:
    delete_content_campaign_command(
        db=db,
        campaign_id=campaign_id,
        expected_revision=expected_revision,
        actor=editor,
        request_id=request.state.request_id,
    )
