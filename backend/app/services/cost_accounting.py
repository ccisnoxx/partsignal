"""Slice 4B：AI 模型定价、AI 作业冻结成本计算与运营费用台账服务。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.ai_generation import AIModel
from app.models.campaign import ContentCampaign
from app.models.cost_accounting import OperatingCostEntry
from app.models.geo_interventions import GeoIntervention
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.cost_accounting import (
    AIModelPricingOut,
    AIModelPricingUpdate,
    OperatingCostCategory,
    OperatingCostEntryCreate,
    OperatingCostEntryListPage,
    OperatingCostEntryOut,
    OperatingCostEntryVoidRequest,
)
from app.services.ai_configuration import lock_model_configuration
from app.services.current_actor import current_actor_command

ONE_MILLION = Decimal("1000000")
COST_QUANT = Decimal("0.000001")
MAX_FROZEN_COST_AMOUNT = Decimal("99999999.999999")


def compute_frozen_ai_cost(
    model: AIModel | None,
    *,
    prompt_tokens: int | None,
    completion_tokens: int | None,
) -> tuple[Decimal | None, str | None]:
    """按作业完成时 AIModel 定价计算冻结成本；未定价或缺少 Token 统计时返回 (None, None)。"""
    if model is None:
        return None, None
    input_price = model.input_price_per_1m_tokens
    output_price = model.output_price_per_1m_tokens
    currency = model.price_currency
    if input_price is None or output_price is None or currency is None:
        return None, None
    if (
        prompt_tokens is None
        or completion_tokens is None
        or prompt_tokens < 0
        or completion_tokens < 0
    ):
        return None, None
    raw_cost = (
        Decimal(prompt_tokens) * input_price + Decimal(completion_tokens) * output_price
    ) / ONE_MILLION
    quantized = raw_cost.quantize(COST_QUANT, rounding=ROUND_HALF_UP)
    if quantized > MAX_FROZEN_COST_AMOUNT:
        return None, None
    return quantized, currency


def _project_model_pricing(model: AIModel) -> AIModelPricingOut:
    return AIModelPricingOut(
        model_id=model.id,
        channel_id=model.channel_id,
        display_name=model.display_name,
        provider_model_id=model.model_id,
        input_price_per_1m_tokens=model.input_price_per_1m_tokens,
        output_price_per_1m_tokens=model.output_price_per_1m_tokens,
        price_currency=model.price_currency,
        pricing_configured=model.price_currency is not None,
        revision=model.revision,
        updated_at=model.updated_at,
    )


def get_ai_model_pricing(db: Session, model_id: uuid.UUID) -> AIModelPricingOut:
    """读取 AI 模型定价配置（在 REPEATABLE READ 快照中执行）。"""
    model = db.get(AIModel, model_id)
    if model is None:
        raise not_found("AI 模型")
    return _project_model_pricing(model)


def update_ai_model_pricing(
    *,
    db: Session,
    model_id: uuid.UUID,
    payload: AIModelPricingUpdate,
    actor: User,
    request_id: str,
) -> AIModelPricingOut:
    """管理员更新或清空 AI 模型定价配置（不改变模型连通性测试状态和启用状态）。"""
    with current_actor_command(db, actor, allowed={AccountType.ADMIN}) as live_actor:
        model, channel = lock_model_configuration(db, model_id)
        if model.revision != payload.expected_revision:
            raise AppError("REVISION_CONFLICT", "AI 模型已被其他请求修改", 409)
        model.input_price_per_1m_tokens = payload.input_price_per_1m_tokens
        model.output_price_per_1m_tokens = payload.output_price_per_1m_tokens
        model.price_currency = payload.price_currency
        model.revision += 1
        model.updated_at = datetime.now(UTC)
        append_audit(
            db,
            AuditEntry(
                actor_id=live_actor.id,
                business_module=AuditModule.CONFIGURATION,
                action="ai_model.pricing_updated",
                target_type="AIModel",
                target_id=model.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message=(
                    "AI 模型定价已更新" if model.price_currency is not None else "AI 模型定价已清空"
                ),
                details={
                    "facts": {
                        "channel_id": str(channel.id),
                        "price_currency": model.price_currency,
                        "pricing_configured": model.price_currency is not None,
                        "revision": model.revision,
                    }
                },
            ),
        )
        db.commit()
        db.refresh(model)
        return _project_model_pricing(model)


def _project_cost_entries(
    db: Session, entries: list[OperatingCostEntry]
) -> list[OperatingCostEntryOut]:
    if not entries:
        return []
    campaign_ids = {entry.campaign_id for entry in entries if entry.campaign_id is not None}
    intervention_ids = {
        entry.geo_intervention_id for entry in entries if entry.geo_intervention_id is not None
    }
    user_ids = {entry.created_by for entry in entries} | {
        entry.voided_by for entry in entries if entry.voided_by is not None
    }

    campaign_names = (
        {
            row_id: name
            for row_id, name in db.execute(
                select(ContentCampaign.id, ContentCampaign.name).where(
                    ContentCampaign.id.in_(campaign_ids)
                )
            ).tuples()
        }
        if campaign_ids
        else {}
    )
    intervention_titles = (
        {
            row_id: title
            for row_id, title in db.execute(
                select(GeoIntervention.id, GeoIntervention.title).where(
                    GeoIntervention.id.in_(intervention_ids)
                )
            ).tuples()
        }
        if intervention_ids
        else {}
    )
    user_names = (
        {
            row_id: display_name
            for row_id, display_name in db.execute(
                select(User.id, User.display_name).where(User.id.in_(user_ids))
            ).tuples()
        }
        if user_ids
        else {}
    )

    return [
        OperatingCostEntryOut(
            id=entry.id,
            campaign_id=entry.campaign_id,
            campaign_name=campaign_names.get(entry.campaign_id) if entry.campaign_id else None,
            geo_intervention_id=entry.geo_intervention_id,
            geo_intervention_title=(
                intervention_titles.get(entry.geo_intervention_id)
                if entry.geo_intervention_id
                else None
            ),
            category=entry.category,
            amount=entry.amount,
            currency=entry.currency,
            incurred_on=entry.incurred_on,
            note=entry.note,
            is_voided=entry.voided_at is not None,
            voided_at=entry.voided_at,
            voided_by=entry.voided_by,
            voided_by_name=user_names.get(entry.voided_by) if entry.voided_by else None,
            void_reason=entry.void_reason,
            created_by=entry.created_by,
            created_by_name=user_names.get(entry.created_by),
            created_at=entry.created_at,
        )
        for entry in entries
    ]


def list_operating_cost_entries(
    db: Session,
    *,
    campaign_id: uuid.UUID | None = None,
    geo_intervention_id: uuid.UUID | None = None,
    category: OperatingCostCategory | None = None,
    include_voided: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> OperatingCostEntryListPage:
    """分页查询运营费用台账。"""
    conditions = []
    if campaign_id is not None:
        conditions.append(OperatingCostEntry.campaign_id == campaign_id)
    if geo_intervention_id is not None:
        conditions.append(OperatingCostEntry.geo_intervention_id == geo_intervention_id)
    if category is not None:
        conditions.append(OperatingCostEntry.category == category)
    if not include_voided:
        conditions.append(OperatingCostEntry.voided_at.is_(None))

    total = int(
        db.scalar(select(func.count()).select_from(OperatingCostEntry).where(*conditions)) or 0
    )
    rows = list(
        db.scalars(
            select(OperatingCostEntry)
            .where(*conditions)
            .order_by(
                OperatingCostEntry.incurred_on.desc(),
                OperatingCostEntry.created_at.desc(),
                OperatingCostEntry.id.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    )
    return OperatingCostEntryListPage(
        items=_project_cost_entries(db, rows),
        total=total,
        page=page,
        page_size=page_size,
    )


def _lock_cost_entry_owners(
    db: Session,
    *,
    requested_campaign_id: uuid.UUID | None,
    requested_intervention_id: uuid.UUID | None,
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """按固定锁序（ContentCampaign -> GeoIntervention）锁定并校验费用归属对象。"""
    resolved_campaign_id = requested_campaign_id
    if resolved_campaign_id is None and requested_intervention_id is not None:
        resolved_campaign_id = db.scalar(
            select(GeoIntervention.campaign_id).where(
                GeoIntervention.id == requested_intervention_id
            )
        )

    if resolved_campaign_id is not None:
        campaign = db.scalar(
            select(ContentCampaign)
            .where(ContentCampaign.id == resolved_campaign_id)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        )
        if campaign is None:
            raise not_found("内容活动")
        if campaign.status == "ARCHIVED":
            raise AppError("INVALID_STATE_TRANSITION", "已归档内容活动不能登记新运营费用", 409)

    if requested_intervention_id is not None:
        intervention = db.scalar(
            select(GeoIntervention)
            .where(GeoIntervention.id == requested_intervention_id)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        )
        if intervention is None:
            raise not_found("GEO 干预")
        if intervention.status == "CANCELLED":
            raise AppError("INVALID_STATE_TRANSITION", "已取消的 GEO 干预不能登记新运营费用", 409)
        if requested_campaign_id is not None:
            if intervention.campaign_id != requested_campaign_id:
                raise AppError(
                    "COST_SCOPE_MISMATCH",
                    "费用所属内容活动与所选 GEO 干预的归属活动不一致",
                    409,
                )
        elif intervention.campaign_id != resolved_campaign_id:
            # 并发期间干预关联的活动变更时，显式拒绝以保持固定锁序与归属一致。
            raise AppError("REVISION_CONFLICT", "关联 GEO 干预的活动归属已变更，请重试", 409)

    return resolved_campaign_id, requested_intervention_id


def create_operating_cost_entry(
    *,
    db: Session,
    payload: OperatingCostEntryCreate,
    actor: User,
    request_id: str,
) -> OperatingCostEntryOut:
    """登记一条追加式运营费用台账记录。"""
    with current_actor_command(
        db, actor, allowed={AccountType.ADMIN, AccountType.ENGINEER}
    ) as live_actor:
        resolved_campaign_id, resolved_intervention_id = _lock_cost_entry_owners(
            db,
            requested_campaign_id=payload.campaign_id,
            requested_intervention_id=payload.geo_intervention_id,
        )
        entry = OperatingCostEntry(
            campaign_id=resolved_campaign_id,
            geo_intervention_id=resolved_intervention_id,
            category=payload.category,
            amount=payload.amount,
            currency=payload.currency,
            incurred_on=payload.incurred_on,
            note=payload.note,
            created_by=live_actor.id,
        )
        db.add(entry)
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=live_actor.id,
                business_module=AuditModule.CONTENT_PLANNING,
                action="operating_cost_entry.created",
                target_type="OperatingCostEntry",
                target_id=entry.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已登记运营费用台账记录",
                details={
                    "facts": {
                        "campaign_id": str(entry.campaign_id) if entry.campaign_id else None,
                        "geo_intervention_id": (
                            str(entry.geo_intervention_id) if entry.geo_intervention_id else None
                        ),
                        "category": entry.category,
                        "currency": entry.currency,
                    }
                },
            ),
        )
        db.commit()
        db.refresh(entry)
        return _project_cost_entries(db, [entry])[0]


def void_operating_cost_entry(
    *,
    db: Session,
    entry_id: uuid.UUID,
    payload: OperatingCostEntryVoidRequest,
    actor: User,
    request_id: str,
) -> OperatingCostEntryOut:
    """一次性作废运营费用台账记录（不可逆，不可修改金额与归属）。"""
    with current_actor_command(
        db, actor, allowed={AccountType.ADMIN, AccountType.ENGINEER}
    ) as live_actor:
        entry = db.scalar(
            select(OperatingCostEntry)
            .where(OperatingCostEntry.id == entry_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if entry is None:
            raise not_found("运营费用台账记录")
        if entry.voided_at is not None:
            raise AppError(
                "COST_ENTRY_ALREADY_VOIDED",
                "该运营费用台账记录已作废，不能重复作废",
                409,
            )
        entry.voided_at = datetime.now(UTC)
        entry.voided_by = live_actor.id
        entry.void_reason = payload.reason
        db.flush()
        append_audit(
            db,
            AuditEntry(
                actor_id=live_actor.id,
                business_module=AuditModule.CONTENT_PLANNING,
                action="operating_cost_entry.voided",
                target_type="OperatingCostEntry",
                target_id=entry.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已作废运营费用台账记录",
                details={
                    "facts": {
                        "campaign_id": str(entry.campaign_id) if entry.campaign_id else None,
                        "geo_intervention_id": (
                            str(entry.geo_intervention_id) if entry.geo_intervention_id else None
                        ),
                        "category": entry.category,
                        "currency": entry.currency,
                        "reason": entry.void_reason,
                    }
                },
            ),
        )
        db.commit()
        db.refresh(entry)
        return _project_cost_entries(db, [entry])[0]
