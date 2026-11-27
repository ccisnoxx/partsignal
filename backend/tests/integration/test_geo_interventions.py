"""Slice 4A：GEO 干预编排与归因层（0078_geo_interventions）真实 PG 17 集成测试。"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from alembic import command
from app.audit_types import AuditModule
from app.config import settings
from app.errors import AppError
from app.models.campaign import ContentCampaign
from app.models.geo_interventions import GeoIntervention
from app.models.identity import User
from app.schemas.common import DeletionBlockerType
from app.schemas.cost_accounting import OperatingCostEntryCreate
from app.schemas.geo_interventions import (
    GeoInterventionCancelRequest,
    GeoInterventionConcludeRequest,
    GeoInterventionCreate,
    GeoInterventionTargetMetrics,
    GeoInterventionUpdate,
)
from app.services.audit_logs import list_audit_logs
from app.services.content_campaigns import delete_content_campaign, get_content_campaign_detail
from app.services.cost_accounting import create_operating_cost_entry
from app.services.geo_interventions import (
    cancel_geo_intervention,
    conclude_geo_intervention,
    create_geo_intervention,
    get_geo_intervention_detail,
    list_geo_interventions,
    update_geo_intervention,
)
from app.services.identity import delete_user
from tests.integration.geo_retests_support import (
    plans_api as plans_api,
)
from tests.integration.geo_retests_support import (
    questions_api as questions_api,
)
from tests.integration.geo_retests_support import (
    questions_engine as questions_engine,
)
from tests.integration.geo_retests_support import (
    retest_case as retest_case,
)
from tests.integration.test_content_planning_layer import temporary_database

__all__ = ["plans_api", "questions_api", "questions_engine", "retest_case"]


@pytest.mark.integration
def test_0078_geo_interventions_lifecycle_and_guards(retest_case: Any) -> None:
    """验证 GeoIntervention 生命周期、CAS、非强因果口径、终态冻结与删除护栏。"""
    plans, opp_id, _batch_id, _retest_payload = retest_case
    factory = plans.api.factory
    with factory() as db:
        admin = db.scalar(select(User).where(User.account_type == "ADMIN").limit(1))
        assert admin is not None

        campaign = ContentCampaign(
            name="4A GEO 干预专项活动",
            description="提升国产降压芯片提及率与引用率",
            target_audience="硬件工程师",
            owner_id=admin.id,
            priority="HIGH",
            status="DRAFT",
            created_by=admin.id,
            updated_by=admin.id,
        )
        db.add(campaign)

        assignee = User(
            username="geo_interv_owner_4a",
            display_name="GEO 负责人",
            password_hash=admin.password_hash,
            account_type="ENGINEER",
            is_active=True,
            must_change_password=False,
        )
        inactive_user = User(
            username="geo_interv_inactive_4a",
            display_name="停用成员",
            password_hash=admin.password_hash,
            account_type="ENGINEER",
            is_active=False,
            must_change_password=False,
        )
        db.add_all([assignee, inactive_user])
        db.commit()

        # 1. 停用用户不能作为负责人
        with pytest.raises(AppError) as inactive_err:
            create_geo_intervention(
                db=db,
                payload=GeoInterventionCreate(
                    opportunity_id=opp_id,
                    campaign_id=campaign.id,
                    title="补充 TPS5430 国产替代选型专题",
                    hypothesis="补充带实测温升边界的选型问答以提升 AI 引用率",
                    planned_action_type="CONTENT_TASK",
                    assignee_id=inactive_user.id,
                ),
                actor=admin,
                request_id="req-4a-inactive",
            )
        assert inactive_err.value.code == "ASSIGNEE_INACTIVE"

        # 2. 创建干预并核验非强因果标识与 Campaign 删除阻断
        created = create_geo_intervention(
            db=db,
            payload=GeoInterventionCreate(
                opportunity_id=opp_id,
                campaign_id=campaign.id,
                title="补充 TPS5430 国产替代选型专题",
                hypothesis="在知乎与官网补充带实测温升边界的选型问答，预期提及率达 45%",
                planned_action_type="CONTENT_TASK",
                target_metrics=GeoInterventionTargetMetrics(
                    target_mention_rate=0.45, target_citation_rate=0.30
                ),
                assignee_id=assignee.id,
            ),
            actor=admin,
            request_id="req-4a-create",
        )
        assert created.status == "PLANNED"
        assert created.causal_claim == "NOT_ESTABLISHED"
        assert created.attribution.causal_claim == "NOT_ESTABLISHED"
        assert created.available_actions == ["UPDATE", "CONCLUDE", "CANCEL"]

        with pytest.raises(AppError) as camp_err:
            delete_content_campaign(
                db=db,
                campaign_id=campaign.id,
                expected_revision=campaign.revision,
                actor=admin,
                request_id="req-4a-del-camp",
            )
        assert camp_err.value.code == "CONTENT_CAMPAIGN_IN_USE"

        # 3. 更新为 ACTIVE + 校验 CAS 冲突
        updated = update_geo_intervention(
            db=db,
            intervention_id=created.id,
            payload=GeoInterventionUpdate(
                campaign_id=campaign.id,
                title="补充 TPS5430 国产替代选型专题（已启动）",
                hypothesis=created.hypothesis,
                planned_action_type="CONTENT_TASK",
                status="ACTIVE",
                target_metrics=created.target_metrics,
                assignee_id=assignee.id,
                intervened_at=datetime.now(UTC),
                expected_revision=created.revision,
            ),
            actor=admin,
            request_id="req-4a-update",
        )
        assert updated.status == "ACTIVE"
        assert updated.revision == 1

        with pytest.raises(AppError) as cas_err:
            update_geo_intervention(
                db=db,
                intervention_id=created.id,
                payload=GeoInterventionUpdate(
                    campaign_id=campaign.id,
                    title="过期修订更新",
                    hypothesis=created.hypothesis,
                    planned_action_type="CONTENT_TASK",
                    status="EVALUATING",
                    expected_revision=0,
                ),
                actor=admin,
                request_id="req-4a-cas",
            )
        assert cas_err.value.code == "REVISION_CONFLICT"

        # 4. 结案冻结（CONCLUDED）+ 触发器拒绝篡改和删除（55000）
        concluded = conclude_geo_intervention(
            db=db,
            intervention_id=created.id,
            payload=GeoInterventionConcludeRequest(
                outcome_verdict="PARTIAL_IMPROVEMENT",
                conclusion_note="复测窗口内提及率上升，但样本量尚需继续观察，不作因果宣称。",
                expected_revision=updated.revision,
            ),
            actor=admin,
            request_id="req-4a-conclude",
        )
        assert concluded.status == "CONCLUDED"
        assert concluded.outcome_verdict == "PARTIAL_IMPROVEMENT"
        assert concluded.available_actions == []

        with pytest.raises(DBAPIError) as upd_err:
            db.execute(
                text("UPDATE geo_interventions SET title = 'tamper' WHERE id = :id"),
                {"id": concluded.id},
            )
        assert getattr(upd_err.value.orig, "sqlstate", None) == "55000"
        db.rollback()

        with pytest.raises(DBAPIError) as del_err:
            db.execute(
                text("DELETE FROM geo_interventions WHERE id = :id"),
                {"id": concluded.id},
            )
        assert getattr(del_err.value.orig, "sqlstate", None) == "55000"
        db.rollback()

        # 5. 取消另一条 + 列表/详情查询
        second = create_geo_intervention(
            db=db,
            payload=GeoInterventionCreate(
                opportunity_id=opp_id,
                title="待取消干预草案",
                hypothesis="临时试验",
                planned_action_type="OTHER",
            ),
            actor=admin,
            request_id="req-4a-create-2",
        )
        cancelled = cancel_geo_intervention(
            db=db,
            intervention_id=second.id,
            payload=GeoInterventionCancelRequest(
                reason="策略调整，改由主活动统一执行",
                expected_revision=second.revision,
            ),
            actor=admin,
            request_id="req-4a-cancel-2",
        )
        assert cancelled.status == "CANCELLED"
        assert get_geo_intervention_detail(db, concluded.id).id == concluded.id
        listed = list_geo_interventions(
            db,
            campaign_id=campaign.id,
            opportunity_id=None,
            status=None,
            assignee_id=None,
            page=1,
            page_size=20,
        )
        assert listed.total == 1

        # 5b. DRAFT 活动因存在 GeoIntervention，详情读模型已移除 DELETE 并暴露 GEO_INTERVENTION 阻断
        camp_detail = get_content_campaign_detail(db, campaign.id)
        assert "DELETE" not in camp_detail.available_actions
        assert camp_detail.deletion is not None
        assert any(
            blocker.type == DeletionBlockerType.GEO_INTERVENTION
            for blocker in camp_detail.deletion.blockers
        )

        # 5c. ACTIVE 不可回退 PLANNED，且绑定运营费用后不可修改 campaign_id
        third = create_geo_intervention(
            db=db,
            payload=GeoInterventionCreate(
                opportunity_id=opp_id,
                campaign_id=campaign.id,
                title="验证状态回退与费用归属锁定",
                hypothesis="验证审查修复项",
                planned_action_type="CONTENT_TASK",
            ),
            actor=admin,
            request_id="req-4a-create-3",
        )
        third_active = update_geo_intervention(
            db=db,
            intervention_id=third.id,
            payload=GeoInterventionUpdate(
                campaign_id=campaign.id,
                title=third.title,
                hypothesis=third.hypothesis,
                planned_action_type="CONTENT_TASK",
                status="ACTIVE",
                expected_revision=third.revision,
            ),
            actor=admin,
            request_id="req-4a-activate-3",
        )
        with pytest.raises(AppError) as revert_err:
            update_geo_intervention(
                db=db,
                intervention_id=third.id,
                payload=GeoInterventionUpdate(
                    campaign_id=campaign.id,
                    title=third.title,
                    hypothesis=third.hypothesis,
                    planned_action_type="CONTENT_TASK",
                    status="PLANNED",
                    expected_revision=third_active.revision,
                ),
                actor=admin,
                request_id="req-4a-revert-3",
            )
        assert revert_err.value.code == "INVALID_STATE_TRANSITION"

        with pytest.raises(DBAPIError) as db_revert_err:
            db.execute(
                text("UPDATE geo_interventions SET status = 'PLANNED' WHERE id = :id"),
                {"id": third.id},
            )
        assert getattr(db_revert_err.value.orig, "sqlstate", None) == "55000"
        db.rollback()

        create_operating_cost_entry(
            db=db,
            payload=OperatingCostEntryCreate(
                geo_intervention_id=third.id,
                category="LABOR",
                amount=Decimal("100.00"),
                currency="CNY",
                incurred_on=date(2026, 11, 27),
            ),
            actor=admin,
            request_id="req-4a-cost-3",
        )
        with pytest.raises(AppError) as camp_lock_err:
            update_geo_intervention(
                db=db,
                intervention_id=third.id,
                payload=GeoInterventionUpdate(
                    campaign_id=None,
                    title=third.title,
                    hypothesis=third.hypothesis,
                    planned_action_type="CONTENT_TASK",
                    status="ACTIVE",
                    expected_revision=third_active.revision,
                ),
                actor=admin,
                request_id="req-4a-rebind-3",
            )
        assert camp_lock_err.value.code == "GEO_INTERVENTION_HAS_COST_ENTRIES"

        # 6. USER_IN_USE 保护 assignee
        assignee.is_active = False
        db.commit()
        with pytest.raises(AppError) as user_err:
            delete_user(
                db=db,
                user_id=assignee.id,
                expected_revision=assignee.revision,
                actor=admin,
                request_id="req-4a-del-assignee",
            )
        assert user_err.value.code == "USER_IN_USE"

        # 7. 审计投影验证（全部 4 个动作）
        audits = list_audit_logs(
            db=db,
            created_from=None,
            created_to=None,
            actor_id=None,
            business_module=AuditModule.GEO_OBSERVATION,
            action=None,
            target_type="GeoIntervention",
            target_id=None,
            outcome=None,
            request_id=None,
            keyword=None,
            page=1,
            page_size=20,
        )
        assert {item.action for item in audits.items} == {
            "geo_intervention.created",
            "geo_intervention.updated",
            "geo_intervention.concluded",
            "geo_intervention.cancelled",
        }


@pytest.mark.integration
def test_0078_downgrade_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    """0078_geo_interventions 降级必须以 SQLSTATE 55000 拒绝。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            monkeypatch.setenv("DATABASE_URL", database_url)
            monkeypatch.setattr(settings, "database_url", database_url)
            backend_dir = Path(__file__).resolve().parents[2]
            cfg = Config(str(backend_dir / "alembic.ini"))
            cfg.set_main_option("script_location", str(backend_dir / "alembic"))
            cfg.set_main_option("sqlalchemy.url", database_url)
            with pytest.raises(DBAPIError) as down_err:
                command.downgrade(cfg, "0077_public_page_health_checks")
            assert getattr(down_err.value.orig, "sqlstate", None) == "55000"
            with Session(engine) as db:
                assert db.scalar(select(GeoIntervention.id).limit(1)) is None
        finally:
            engine.dispose()
