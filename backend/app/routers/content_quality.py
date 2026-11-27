"""Slice 3B：内容重复度分析与 Layer 2 异步 AI 语义质量检查 API 路由。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, status

from app.deps import CsrfProtected, CurrentUser, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.content_quality import (
    ContentDuplicationAnalysisOut,
    SemanticQualityCheckCreate,
    SemanticQualityCheckJobList,
    SemanticQualityCheckJobOut,
)
from app.services.content_duplication import analyze_content_duplication
from app.services.semantic_quality_checks import (
    create_semantic_quality_check_job,
    list_semantic_quality_check_jobs,
)

router = APIRouter(prefix="/api/v1", tags=["production", "review"])


def _repeatable_read_snapshot(db: DbSession) -> None:
    """在认证查询开启事务之前配置单次 REPEATABLE READ 读取快照。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


@router.get(
    "/content-versions/{content_version_id}/duplication-analysis",
    response_model=ContentDuplicationAnalysisOut,
    operation_id="getContentVersionDuplicationAnalysis",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_content_version_duplication_analysis_route(
    content_version_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> ContentDuplicationAnalysisOut:
    """在单次只读快照下分析同活动/同产品内容相似度、重复段落与差异化建议。"""
    return analyze_content_duplication(db, content_version_id=content_version_id)


@router.get(
    "/content-versions/{content_version_id}/semantic-quality-checks",
    response_model=SemanticQualityCheckJobList,
    operation_id="listContentVersionSemanticQualityChecks",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def list_content_version_semantic_quality_checks_route(
    content_version_id: uuid.UUID,
    db: DbSession,
    _user: CurrentUser,
) -> SemanticQualityCheckJobList:
    """读取目标内容版本的 Layer 2 异步 AI 语义质量检查历史与可用模型。"""
    return list_semantic_quality_check_jobs(db, content_version_id)


@router.post(
    "/content-versions/{content_version_id}/semantic-quality-checks",
    response_model=SemanticQualityCheckJobOut,
    status_code=status.HTTP_202_ACCEPTED,
    operation_id="createContentVersionSemanticQualityCheck",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_content_version_semantic_quality_check_route(
    content_version_id: uuid.UUID,
    payload: SemanticQualityCheckCreate,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
    idempotency_key: Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)],
) -> SemanticQualityCheckJobOut:
    """发起可选的 Layer 2 异步 AI 语义质量检查（仅允许 PUBLIC 产品事实外发）。"""
    return create_semantic_quality_check_job(
        db=db,
        content_version_id=content_version_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
        idempotency_key=idempotency_key,
    )
