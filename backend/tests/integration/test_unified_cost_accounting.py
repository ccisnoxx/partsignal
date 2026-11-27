"""Slice 4B：统一成本核算、AI 冻结成本与运营费用台账（0079）PG 17 集成测试。"""

from __future__ import annotations

import hashlib
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
from app.models.ai_generation import AIChannel, AIModel, GenerationJob
from app.models.campaign import ContentCampaign
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformPromptVersion
from app.models.content_quality import ContentQualityCheckJob
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.schemas.configuration import IntentType
from app.schemas.content import ContentBriefInput, ContentTaskCreate, OriginalGenerationJobCreate
from app.schemas.content_quality import (
    SemanticQualityCheckCreate,
    SemanticQualityModelResult,
)
from app.schemas.cost_accounting import (
    AIModelPricingUpdate,
    OperatingCostEntryCreate,
    OperatingCostEntryVoidRequest,
)
from app.schemas.geo_files import GeneratedDraft
from app.schemas.geo_interventions import (
    GeoInterventionCancelRequest,
    GeoInterventionCreate,
)
from app.services import content_production as content_production_service
from app.services import generation as generation_service
from app.services.ai_provider import ChatCompletionResult
from app.services.audit_logs import get_audit_log, list_audit_logs
from app.services.content_campaigns import delete_content_campaign
from app.services.content_planning import create_content_task
from app.services.cost_accounting import (
    create_operating_cost_entry,
    get_ai_model_pricing,
    list_operating_cost_entries,
    update_ai_model_pricing,
    void_operating_cost_entry,
)
from app.services.geo_interventions import cancel_geo_intervention, create_geo_intervention
from app.services.identity import delete_user
from app.services.semantic_quality_checks import create_semantic_quality_check_job
from app.services.semantic_quality_worker import process_semantic_quality_check_job
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
from tests.integration.test_content_planning_layer import _seed_entities, temporary_database

__all__ = ["plans_api", "questions_api", "questions_engine", "retest_case"]


class _PricedSemanticEvaluator:
    def evaluate(
        self, snapshot: dict[str, Any]
    ) -> tuple[SemanticQualityModelResult, ChatCompletionResult | None]:
        return (
            SemanticQualityModelResult(findings=[], differentiation_suggestions=[]),
            ChatCompletionResult(
                content="{}",
                provider_request_id="req-sem-4b",
                duration_ms=42,
                prompt_tokens=500,
                completion_tokens=200,
                total_tokens=700,
            ),
        )


@pytest.mark.integration
def test_0079_unified_cost_accounting_end_to_end(
    retest_case: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    """验证模型定价、AI 冻结成本、运营费用台账生命周期、触发器防篡改、删除护栏与审计投影。"""
    plans, opp_id, _batch_id, _retest_payload = retest_case
    factory = plans.api.factory
    with factory() as db:
        admin = db.scalar(select(User).where(User.account_type == "ADMIN").limit(1))
        assert admin is not None
        now = datetime.now(UTC)

        engineer = User(
            username="cost_engineer_4b",
            display_name="费用测试工程师",
            password_hash=admin.password_hash,
            account_type="ENGINEER",
            is_active=True,
            must_change_password=False,
        )
        void_actor = User(
            username="cost_voider_4b",
            display_name="费用作废工程师",
            password_hash=admin.password_hash,
            account_type="ENGINEER",
            is_active=True,
            must_change_password=False,
        )
        db.add_all([engineer, void_actor])
        db.flush()

        # 1. 创建 AI 渠道与模型（PASSED + enabled）
        channel = AIChannel(
            name="Cost Test Channel 4B",
            description="用于 4B 成本冻结测试",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="OPENAI",
            base_url="https://api.example.com/v1",
            api_key_ciphertext="enc-dummy-key",
            api_key_updated_at=now,
            timeout_seconds=60,
            is_enabled=True,
            revision=1,
            created_by=admin.id,
        )
        db.add(channel)
        db.flush()

        model = AIModel(
            channel_id=channel.id,
            display_name="GPT Cost Test",
            model_id="gpt-cost-4b",
            request_parameters={},
            is_enabled=True,
            test_status="PASSED",
            last_tested_at=now,
            revision=2,
            created_by=admin.id,
        )
        db.add(model)
        db.commit()

        # 1a. 初始未定价
        initial_pricing = get_ai_model_pricing(db, model.id)
        assert initial_pricing.pricing_configured is False
        assert initial_pricing.price_currency is None
        assert initial_pricing.revision == 2

        # 1b. 非管理员更新定价被拒（403）
        with pytest.raises(AppError) as forbid_err:
            update_ai_model_pricing(
                db=db,
                model_id=model.id,
                payload=AIModelPricingUpdate(
                    input_price_per_1m_tokens=Decimal("2.0"),
                    output_price_per_1m_tokens=Decimal("8.0"),
                    price_currency="USD",
                    expected_revision=2,
                ),
                actor=engineer,
                request_id="req-4b-forbid",
            )
        assert forbid_err.value.status_code == 403

        # 1c. 管理员更新定价，不破坏 is_enabled / test_status
        priced = update_ai_model_pricing(
            db=db,
            model_id=model.id,
            payload=AIModelPricingUpdate(
                input_price_per_1m_tokens=Decimal("2.0"),
                output_price_per_1m_tokens=Decimal("8.0"),
                price_currency="USD",
                expected_revision=2,
            ),
            actor=admin,
            request_id="req-4b-price-set",
        )
        assert priced.pricing_configured is True
        assert priced.price_currency == "USD"
        assert priced.revision == 3
        db.refresh(model)
        assert model.is_enabled is True
        assert model.test_status == "PASSED"

        # 1d. 乐观锁冲突（409 REVISION_CONFLICT）
        with pytest.raises(AppError) as cas_err:
            update_ai_model_pricing(
                db=db,
                model_id=model.id,
                payload=AIModelPricingUpdate(expected_revision=2),
                actor=admin,
                request_id="req-4b-price-cas",
            )
        assert cas_err.value.code == "REVISION_CONFLICT"

        # 2. 冻结 AI 作业成本：GenerationJob + ContentQualityCheckJob
        seeded = _seed_entities(db, suffix="4b")
        product: Product = seeded["product"]  # type: ignore[assignment]
        fact: FactVersion = seeded["fact"]  # type: ignore[assignment]
        platform: PlatformProfile = seeded["platform"]  # type: ignore[assignment]
        topic: Any = seeded["topic"]
        prompt_md = "请严格根据已批准事实生成面向工程师的技术解析文章。"
        prompt = PlatformPrompt(
            name="Cost Test Prompt 4B",
            template_markdown=prompt_md,
            revision=1,
            updated_by=admin.id,
        )
        db.add(prompt)
        db.flush()
        prompt_ver = PlatformPromptVersion(
            prompt_id=prompt.id,
            version=1,
            status="PUBLISHED",
            template_markdown=prompt_md,
            template_sha256=hashlib.sha256(prompt_md.encode("utf-8")).hexdigest(),
            change_summary="初始发布",
            created_by=admin.id,
            published_by=admin.id,
            published_at=now,
        )
        db.add(prompt_ver)
        db.flush()
        platform.platform_prompt_id = prompt.id
        platform.platform_prompt_version_id = prompt_ver.id
        db.commit()

        task = create_content_task(
            db=db,
            payload=ContentTaskCreate(
                product_id=product.id,
                fact_version_id=fact.id,
                platform_profile_id=platform.id,
                query_topic_id=topic.id,
                brief=ContentBriefInput(
                    target_question="输入电压范围是多少？",
                    search_intent=IntentType.REPLACEMENT,
                    content_angle="参数边界说明",
                    must_answer_questions=["输入电压范围"],
                    required_fact_points=["输入 5.5-36V"],
                    forbidden_expressions=["免验证直接替换"],
                    cta="联系选型支持",
                    target_keywords=["DC-DC"],
                ),
            ),
            actor=admin,
            request_id="req-4b-task",
            idempotency_key="task-4b-0001",
        )

        monkeypatch.setattr(settings, "environment", "test")
        monkeypatch.setattr(settings, "content_generator", "openai-compatible")
        monkeypatch.setattr(generation_service, "SessionLocal", factory)
        monkeypatch.setattr(
            content_production_service,
            "dispatch_generation_job",
            lambda *_args, **_kwargs: None,
        )

        gen_job = content_production_service.create_generation_job(
            db=db,
            content_task_id=task.id,
            payload=OriginalGenerationJobCreate(
                ai_model_id=model.id,
                platform_prompt_id=prompt.id,
                platform_prompt_revision=prompt.revision,
                platform_prompt_version_id=prompt_ver.id,
            ),
            actor=admin,
            request_id="req-4b-gen-create",
            idempotency_key="gen-4b-priced-001",
        )

        def _fake_generate_for_job(
            _db: Session,
            _job: GenerationJob,
            _snapshot: dict[str, Any],
            _generator: Any,
        ) -> tuple[GeneratedDraft, ChatCompletionResult]:
            return (
                GeneratedDraft(
                    title="工业降压芯片电压范围与选型边界",
                    summary="基于已批准事实说明输入电压与电流边界。",
                    body_markdown="支持 5.5-36V 输入电压与最大 3A 连续输出电流。",
                    tags=["DC-DC"],
                ),
                ChatCompletionResult(
                    content="{}",
                    provider_request_id="req-gen-4b",
                    duration_ms=80,
                    prompt_tokens=1000,
                    completion_tokens=500,
                    total_tokens=1500,
                ),
            )

        monkeypatch.setattr(generation_service, "generate_for_job", _fake_generate_for_job)
        generation_service.process_generation_job(gen_job.id)

        db.expire_all()
        done_gen = db.get(GenerationJob, gen_job.id)
        assert done_gen is not None
        assert done_gen.status == "SUCCEEDED"
        # 1000 * 2.0 / 1e6 + 500 * 8.0 / 1e6 = 0.002 + 0.004 = 0.006000
        assert done_gen.cost_amount == Decimal("0.006000")
        assert done_gen.cost_currency == "USD"
        assert done_gen.content_version_id is not None

        # 2b. 语义质检作业冻结成本（有定价）
        sem_job = create_semantic_quality_check_job(
            db=db,
            content_version_id=done_gen.content_version_id,
            payload=SemanticQualityCheckCreate(ai_model_id=model.id),
            actor=admin,
            request_id="req-4b-sem-priced",
            idempotency_key="sem-4b-priced-001",
            dispatch=lambda _id: None,
        )
        process_semantic_quality_check_job(
            sem_job.id,
            evaluator=_PricedSemanticEvaluator(),
            session_factory=factory,
        )
        db.expire_all()
        done_sem = db.get(ContentQualityCheckJob, sem_job.id)
        assert done_sem is not None
        assert done_sem.status == "SUCCEEDED"
        # 500 * 2.0 / 1e6 + 200 * 8.0 / 1e6 = 0.001 + 0.0016 = 0.002600
        assert done_sem.cost_amount == Decimal("0.002600")
        assert done_sem.cost_currency == "USD"

        # 2c. 清空模型定价后：历史作业保持冻结不变，新作业记录 NULL（严禁假 0）
        cleared = update_ai_model_pricing(
            db=db,
            model_id=model.id,
            payload=AIModelPricingUpdate(expected_revision=priced.revision),
            actor=admin,
            request_id="req-4b-price-clear",
        )
        assert cleared.pricing_configured is False
        assert cleared.price_currency is None

        sem_unpriced = create_semantic_quality_check_job(
            db=db,
            content_version_id=done_gen.content_version_id,
            payload=SemanticQualityCheckCreate(ai_model_id=model.id),
            actor=admin,
            request_id="req-4b-sem-unpriced",
            idempotency_key="sem-4b-unpriced-001",
            dispatch=lambda _id: None,
        )
        process_semantic_quality_check_job(
            sem_unpriced.id,
            evaluator=_PricedSemanticEvaluator(),
            session_factory=factory,
        )
        db.expire_all()
        done_gen_after = db.get(GenerationJob, gen_job.id)
        done_sem_unpriced = db.get(ContentQualityCheckJob, sem_unpriced.id)
        assert done_gen_after is not None and done_gen_after.cost_amount == Decimal("0.006000")
        assert done_sem_unpriced is not None
        assert done_sem_unpriced.status == "SUCCEEDED"
        assert done_sem_unpriced.cost_amount is None
        assert done_sem_unpriced.cost_currency is None

        # 3. 运营费用台账：创建、自动继承 campaign_id、范围校验、作废与触发器防篡改
        campaign_a = ContentCampaign(
            name="4B 成本台账活动 A",
            description="活动 A",
            target_audience="硬件工程师",
            owner_id=admin.id,
            priority="HIGH",
            status="DRAFT",
            created_by=admin.id,
            updated_by=admin.id,
        )
        campaign_b = ContentCampaign(
            name="4B 成本台账活动 B",
            description="活动 B",
            target_audience="硬件工程师",
            owner_id=admin.id,
            priority="MEDIUM",
            status="ACTIVE",
            created_by=admin.id,
            updated_by=admin.id,
        )
        campaign_archived = ContentCampaign(
            name="4B 已归档活动",
            description="归档活动",
            target_audience="硬件工程师",
            owner_id=admin.id,
            priority="LOW",
            status="ARCHIVED",
            created_by=admin.id,
            updated_by=admin.id,
        )
        db.add_all([campaign_a, campaign_b, campaign_archived])
        db.commit()

        # 归档活动拒绝新费用登记
        with pytest.raises(AppError) as arch_err:
            create_operating_cost_entry(
                db=db,
                payload=OperatingCostEntryCreate(
                    campaign_id=campaign_archived.id,
                    category="LABOR",
                    amount=Decimal("200.00"),
                    currency="CNY",
                    incurred_on=date(2026, 11, 27),
                ),
                actor=engineer,
                request_id="req-4b-arch",
            )
        assert arch_err.value.code == "INVALID_STATE_TRANSITION"

        # 绑定 campaign_a 的纯费用记录 -> 阻断 campaign_a 删除与 engineer 删除
        entry_campaign_only = create_operating_cost_entry(
            db=db,
            payload=OperatingCostEntryCreate(
                campaign_id=campaign_a.id,
                category="EXTERNAL_PLACEMENT",
                amount=Decimal("1500.00"),
                currency="CNY",
                incurred_on=date(2026, 11, 26),
                note="电子发烧友专栏投放",
            ),
            actor=engineer,
            request_id="req-4b-cost-a",
        )
        assert entry_campaign_only.campaign_id == campaign_a.id
        assert entry_campaign_only.is_voided is False

        with pytest.raises(AppError) as del_camp_err:
            delete_content_campaign(
                db=db,
                campaign_id=campaign_a.id,
                expected_revision=campaign_a.revision,
                actor=admin,
                request_id="req-4b-del-camp",
            )
        assert del_camp_err.value.code == "CONTENT_CAMPAIGN_IN_USE"

        # 创建绑定 campaign_b 的 GEO 干预，仅传 geo_intervention_id 自动继承 campaign_b
        interv_b = create_geo_intervention(
            db=db,
            payload=GeoInterventionCreate(
                opportunity_id=opp_id,
                campaign_id=campaign_b.id,
                title="4B 归因干预",
                hypothesis="验证干预费用自动继承活动归属",
                planned_action_type="CONTENT_TASK",
            ),
            actor=admin,
            request_id="req-4b-interv-b",
        )
        entry_interv = create_operating_cost_entry(
            db=db,
            payload=OperatingCostEntryCreate(
                geo_intervention_id=interv_b.id,
                category="LABOR",
                amount=Decimal("450.50"),
                currency="CNY",
                incurred_on=date(2026, 11, 27),
                note="FAE 内容审校工时",
            ),
            actor=engineer,
            request_id="req-4b-cost-interv",
        )
        assert entry_interv.campaign_id == campaign_b.id
        assert entry_interv.geo_intervention_id == interv_b.id

        # 活动与干预归属不一致 -> 409 COST_SCOPE_MISMATCH
        with pytest.raises(AppError) as mismatch_err:
            create_operating_cost_entry(
                db=db,
                payload=OperatingCostEntryCreate(
                    campaign_id=campaign_a.id,
                    geo_intervention_id=interv_b.id,
                    category="OTHER",
                    amount=Decimal("100.00"),
                    currency="CNY",
                    incurred_on=date(2026, 11, 27),
                ),
                actor=engineer,
                request_id="req-4b-mismatch",
            )
        assert mismatch_err.value.code == "COST_SCOPE_MISMATCH"

        # 已取消干预拒绝新费用登记
        cancel_geo_intervention(
            db=db,
            intervention_id=interv_b.id,
            payload=GeoInterventionCancelRequest(
                expected_revision=interv_b.revision,
                reason="取消以验证费用门禁",
            ),
            actor=admin,
            request_id="req-4b-interv-cancel",
        )
        with pytest.raises(AppError) as cancelled_err:
            create_operating_cost_entry(
                db=db,
                payload=OperatingCostEntryCreate(
                    geo_intervention_id=interv_b.id,
                    category="OTHER",
                    amount=Decimal("50.00"),
                    currency="CNY",
                    incurred_on=date(2026, 11, 27),
                ),
                actor=engineer,
                request_id="req-4b-cancelled",
            )
        assert cancelled_err.value.code == "INVALID_STATE_TRANSITION"

        # 3b. 一次性作废 + 二次作废 409 + 列表过滤
        voided = void_operating_cost_entry(
            db=db,
            entry_id=entry_campaign_only.id,
            payload=OperatingCostEntryVoidRequest(reason="发票金额录入错误，需重录"),
            actor=void_actor,
            request_id="req-4b-void",
        )
        assert voided.is_voided is True
        assert voided.voided_by == void_actor.id
        assert voided.void_reason == "发票金额录入错误，需重录"

        with pytest.raises(AppError) as double_void_err:
            void_operating_cost_entry(
                db=db,
                entry_id=entry_campaign_only.id,
                payload=OperatingCostEntryVoidRequest(reason="重复作废"),
                actor=void_actor,
                request_id="req-4b-void-2",
            )
        assert double_void_err.value.code == "COST_ENTRY_ALREADY_VOIDED"

        active_page = list_operating_cost_entries(db, campaign_id=campaign_a.id)
        assert active_page.total == 0
        all_page = list_operating_cost_entries(db, campaign_id=campaign_a.id, include_voided=True)
        assert all_page.total == 1

        # 3c. 数据库触发器保护：禁止修改金额、禁止二次修改已作废记录、禁止物理 DELETE（55000）
        with pytest.raises(DBAPIError) as tamper_amt:
            db.execute(
                text("UPDATE operating_cost_entries SET amount = 1.00 WHERE id = :id"),
                {"id": entry_interv.id},
            )
        assert getattr(tamper_amt.value.orig, "sqlstate", None) == "55000"
        db.rollback()

        with pytest.raises(DBAPIError) as tamper_voided:
            db.execute(
                text("UPDATE operating_cost_entries SET void_reason = 'tamper' WHERE id = :id"),
                {"id": entry_campaign_only.id},
            )
        assert getattr(tamper_voided.value.orig, "sqlstate", None) == "55000"
        db.rollback()

        with pytest.raises(DBAPIError) as del_entry_err:
            db.execute(
                text("DELETE FROM operating_cost_entries WHERE id = :id"),
                {"id": entry_interv.id},
            )
        assert getattr(del_entry_err.value.orig, "sqlstate", None) == "55000"
        db.rollback()

        # 4. 停用用户后仍被删除阻断（created_by / voided_by -> USER_IN_USE）
        engineer.is_active = False
        void_actor.is_active = False
        db.commit()
        for target_user in (engineer, void_actor):
            with pytest.raises(AppError) as user_err:
                delete_user(
                    db=db,
                    user_id=target_user.id,
                    expected_revision=target_user.revision,
                    actor=admin,
                    request_id=f"req-4b-del-{target_user.username}",
                )
            assert user_err.value.code == "USER_IN_USE"

        # 5. 审计日志安全投影（列表 + 详情全量验证）
        cfg_logs = list_audit_logs(
            db=db,
            created_from=None,
            created_to=None,
            actor_id=None,
            business_module=AuditModule.CONFIGURATION,
            action="ai_model.pricing_updated",
            target_type=None,
            target_id=None,
            outcome=None,
            request_id=None,
            keyword=None,
            page=1,
            page_size=20,
        )
        assert len(cfg_logs.items) >= 2
        detail_cfg = get_audit_log(db, cfg_logs.items[0].id)
        assert detail_cfg.action == "ai_model.pricing_updated"

        plan_logs = list_audit_logs(
            db=db,
            created_from=None,
            created_to=None,
            actor_id=None,
            business_module=AuditModule.CONTENT_PLANNING,
            action=None,
            target_type="OperatingCostEntry",
            target_id=None,
            outcome=None,
            request_id=None,
            keyword=None,
            page=1,
            page_size=20,
        )
        plan_actions = {row.action for row in plan_logs.items}
        assert {"operating_cost_entry.created", "operating_cost_entry.voided"} <= plan_actions
        for row in plan_logs.items:
            detail = get_audit_log(db, row.id)
            assert detail.action in plan_actions


@pytest.mark.integration
def test_0079_unified_cost_accounting_downgrade_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证 0079_unified_cost_accounting 迁移严格执行仅前滚契约（downgrade 显式拒绝 55000）。"""
    with temporary_database() as temp_url:
        monkeypatch.setattr(settings, "database_url", temp_url)
        cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
        cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
        command.upgrade(cfg, "0079_unified_cost_accounting")

        engine = create_engine(temp_url, future=True)
        try:
            with engine.connect() as conn:
                rev = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
                assert rev == "0079_unified_cost_accounting"
        finally:
            engine.dispose()

        with pytest.raises(DBAPIError) as down_err:
            command.downgrade(cfg, "0078_geo_interventions")
        assert getattr(down_err.value.orig, "sqlstate", None) == "55000"
