"""Slice 4B：AI 模型定价与运营费用台账 HTTP 路由。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.deps import AdminUser, CsrfProtected, DbSession, EngineerUser
from app.errors import error_responses
from app.schemas.cost_accounting import (
    AIModelPricingOut,
    AIModelPricingUpdate,
    OperatingCostCategory,
    OperatingCostEntryCreate,
    OperatingCostEntryListPage,
    OperatingCostEntryOut,
    OperatingCostEntryVoidRequest,
)
from app.services.cost_accounting import (
    create_operating_cost_entry,
    get_ai_model_pricing,
    list_operating_cost_entries,
    update_ai_model_pricing,
    void_operating_cost_entry,
)

router = APIRouter(prefix="/api/v1", tags=["cost-accounting"])


def _repeatable_read_snapshot(db: DbSession) -> None:
    """在认证查询开启事务之前配置单次 REPEATABLE READ 读取快照。"""
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


@router.get(
    "/ai-models/{model_id}/pricing",
    response_model=AIModelPricingOut,
    operation_id="getAIModelPricing",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 404, 422),
)
def get_ai_model_pricing_endpoint(
    model_id: uuid.UUID,
    db: DbSession,
    _admin: AdminUser,
) -> AIModelPricingOut:
    return get_ai_model_pricing(db, model_id)


@router.patch(
    "/ai-models/{model_id}/pricing",
    response_model=AIModelPricingOut,
    operation_id="updateAIModelPricing",
    responses=error_responses(401, 403, 404, 409, 422),
)
def update_ai_model_pricing_endpoint(
    model_id: uuid.UUID,
    payload: AIModelPricingUpdate,
    request: Request,
    db: DbSession,
    actor: AdminUser,
    _csrf: CsrfProtected,
) -> AIModelPricingOut:
    return update_ai_model_pricing(
        db=db,
        model_id=model_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.get(
    "/cost-entries",
    response_model=OperatingCostEntryListPage,
    operation_id="listOperatingCostEntries",
    dependencies=[Depends(_repeatable_read_snapshot)],
    responses=error_responses(401, 403, 422),
)
def list_operating_cost_entries_endpoint(
    db: DbSession,
    _user: EngineerUser,
    campaign_id: Annotated[uuid.UUID | None, Query()] = None,
    geo_intervention_id: Annotated[uuid.UUID | None, Query()] = None,
    category: Annotated[OperatingCostCategory | None, Query()] = None,
    include_voided: Annotated[bool, Query()] = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> OperatingCostEntryListPage:
    return list_operating_cost_entries(
        db,
        campaign_id=campaign_id,
        geo_intervention_id=geo_intervention_id,
        category=category,
        include_voided=include_voided,
        page=page,
        page_size=page_size,
    )


@router.post(
    "/cost-entries",
    response_model=OperatingCostEntryOut,
    status_code=status.HTTP_201_CREATED,
    operation_id="createOperatingCostEntry",
    responses=error_responses(401, 403, 404, 409, 422),
)
def create_operating_cost_entry_endpoint(
    payload: OperatingCostEntryCreate,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> OperatingCostEntryOut:
    return create_operating_cost_entry(
        db=db,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )


@router.post(
    "/cost-entries/{entry_id}/void",
    response_model=OperatingCostEntryOut,
    operation_id="voidOperatingCostEntry",
    responses=error_responses(401, 403, 404, 409, 422),
)
def void_operating_cost_entry_endpoint(
    entry_id: uuid.UUID,
    payload: OperatingCostEntryVoidRequest,
    request: Request,
    db: DbSession,
    actor: EngineerUser,
    _csrf: CsrfProtected,
) -> OperatingCostEntryOut:
    return void_operating_cost_entry(
        db=db,
        entry_id=entry_id,
        payload=payload,
        actor=actor,
        request_id=request.state.request_id,
    )
