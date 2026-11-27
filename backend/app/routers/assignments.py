"""Slice 2D：5 类主聚合统一软归属任务分派与 SLA 读写接口。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request

from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.work_assignment import (
    WorkAssignmentDetail,
    WorkAssignmentTargetType,
    WorkAssignmentUpdate,
)
from app.services.work_assignments import (
    get_work_assignment as get_work_assignment_query,
)
from app.services.work_assignments import (
    update_work_assignment as update_work_assignment_command,
)

router = APIRouter(prefix="/api/v1", tags=["assignments"])


def _assignment_read_snapshot(db: DbSession) -> None:
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


@router.get(
    "/work-assignments/{target_type}/{target_id}",
    response_model=WorkAssignmentDetail,
    operation_id="getWorkAssignment",
    dependencies=[Depends(_assignment_read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_work_assignment(
    target_type: WorkAssignmentTargetType,
    target_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> WorkAssignmentDetail:
    """读取指定业务聚合的当前责任人与 SLA 状态。"""
    return get_work_assignment_query(db, target_type=target_type, target_id=target_id)


@router.patch(
    "/fact-versions/{fact_version_id}/assignment",
    response_model=WorkAssignmentDetail,
    operation_id="updateFactVersionAssignment",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_fact_version_assignment(
    fact_version_id: uuid.UUID,
    payload: WorkAssignmentUpdate,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> WorkAssignmentDetail:
    """更新待审核产品事实版本的责任人与 SLA。"""
    return update_work_assignment_command(
        db=db,
        target_type="FactVersion",
        target_id=fact_version_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.patch(
    "/content-tasks/{content_task_id}/assignment",
    response_model=WorkAssignmentDetail,
    operation_id="updateContentTaskAssignment",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_content_task_assignment(
    content_task_id: uuid.UUID,
    payload: WorkAssignmentUpdate,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> WorkAssignmentDetail:
    """更新未归档开放内容任务的责任人与 SLA。"""
    return update_work_assignment_command(
        db=db,
        target_type="ContentTask",
        target_id=content_task_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.patch(
    "/publication-works/{publication_work_id}/assignment",
    response_model=WorkAssignmentDetail,
    operation_id="updatePublicationWorkAssignment",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_publication_work_assignment(
    publication_work_id: uuid.UUID,
    payload: WorkAssignmentUpdate,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> WorkAssignmentDetail:
    """更新非终态发布工作的责任人与 SLA。"""
    return update_work_assignment_command(
        db=db,
        target_type="PublicationWork",
        target_id=publication_work_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.patch(
    "/published-content-issues/{issue_id}/assignment",
    response_model=WorkAssignmentDetail,
    operation_id="updatePublishedContentIssueAssignment",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_published_content_issue_assignment(
    issue_id: uuid.UUID,
    payload: WorkAssignmentUpdate,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> WorkAssignmentDetail:
    """更新开放发布后内容问题的责任人与 SLA。"""
    return update_work_assignment_command(
        db=db,
        target_type="PublishedContentIssue",
        target_id=issue_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.patch(
    "/geo/opportunities/{opportunity_id}/assignment",
    response_model=WorkAssignmentDetail,
    operation_id="updateGeoOpportunityAssignment",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_geo_opportunity_assignment(
    opportunity_id: uuid.UUID,
    payload: WorkAssignmentUpdate,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> WorkAssignmentDetail:
    """更新开放 GEO 机会的责任人与 SLA（优先级受触发规则冻结）。"""
    return update_work_assignment_command(
        db=db,
        target_type="GeoOpportunity",
        target_id=opportunity_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )
