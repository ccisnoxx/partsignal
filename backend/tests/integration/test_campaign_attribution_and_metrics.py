"""Slice 4C：Campaign 归因看板、多币种统一成本与全局经营指标/衰退预警 PG 17 集成测试。"""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import select

from app.models.ai_generation import AIChannel, AIModel, GenerationJob
from app.models.campaign import (
    ContentCampaign,
    ContentCampaignPlatform,
    ContentCampaignProduct,
    ContentCampaignTopic,
)
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformPromptVersion
from app.models.content import ContentReviewRecord, ContentTask, ContentVersion
from app.models.content_quality import ContentQualityCheckJob
from app.models.geo_opportunities import GeoOpportunity
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import (
    PlatformAccount,
    PublishedArticleHealthCheck,
    PublishedContentIssue,
)
from app.schemas.configuration import IntentType
from app.schemas.content import ContentBriefInput, ContentTaskCreate
from app.schemas.cost_accounting import OperatingCostEntryCreate, OperatingCostEntryVoidRequest
from app.schemas.geo_interventions import GeoInterventionCreate
from app.schemas.publication import (
    PublicationResultUpdate,
    PublicationVerificationCreate,
    PublicationVerificationOutcome,
    PublicationWorkCreate,
)
from app.services.content_planning import create_content_task
from app.services.cost_accounting import create_operating_cost_entry, void_operating_cost_entry
from app.services.geo_interventions import create_geo_intervention
from app.services.operations_dashboard import (
    get_campaign_attribution_dashboard,
    get_workbench_operations_metrics,
)
from app.services.publication import (
    create_publication_work,
    register_publication_result,
    verify_publication_work,
)
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
from tests.integration.test_content_planning_layer import _seed_entities

__all__ = ["plans_api", "questions_api", "questions_engine", "retest_case"]


@pytest.mark.integration
def test_4c_campaign_attribution_and_workbench_operations_metrics(retest_case: Any) -> None:
    """验证生产漏斗、页面健康、多币种分离汇总、缺失定价率、单位经济学与衰退预警。"""
    plans, opp_id, _batch_id, _retest_payload = retest_case
    factory = plans.api.factory
    with factory() as db:
        admin = db.scalar(select(User).where(User.account_type == "ADMIN").limit(1))
        assert admin is not None
        now = datetime.now(UTC)

        seeded = _seed_entities(db, suffix="4c")
        product: Product = seeded["product"]  # type: ignore[assignment]
        fact: FactVersion = seeded["fact"]  # type: ignore[assignment]
        platform: PlatformProfile = seeded["platform"]  # type: ignore[assignment]
        topic: Any = seeded["topic"]

        # 将产品事实设为已逾期，用于触发 OVERDUE_FACT 预警与 overdue_fact_product_count
        product.next_review_at = now - timedelta(days=3)

        prompt_md = "面向电子工程师撰写选型参考。"
        prompt = PlatformPrompt(
            name="Ops Dashboard Prompt 4C",
            template_markdown=prompt_md,
            revision=1,
            updated_by=admin.id,
        )
        db.add(prompt)
        db.flush()
        pver = PlatformPromptVersion(
            prompt_id=prompt.id,
            version=1,
            status="PUBLISHED",
            template_markdown=prompt_md,
            template_sha256=hashlib.sha256(prompt_md.encode("utf-8")).hexdigest(),
            change_summary="4C 初始发布",
            created_by=admin.id,
            published_by=admin.id,
            published_at=now,
        )
        db.add(pver)
        db.flush()
        platform.platform_prompt_id = prompt.id
        platform.platform_prompt_version_id = pver.id

        campaign = ContentCampaign(
            name="4C 归因与经营看板专项活动",
            description="验证全链路生产、发布健康与多币种成本汇总",
            target_audience="硬件研发工程师",
            owner_id=admin.id,
            priority="HIGH",
            status="ACTIVE",
            created_by=admin.id,
            updated_by=admin.id,
        )
        db.add(campaign)
        db.flush()
        db.add(ContentCampaignProduct(campaign_id=campaign.id, product_id=product.id))
        db.add(ContentCampaignTopic(campaign_id=campaign.id, query_topic_id=topic.id))
        db.add(ContentCampaignPlatform(campaign_id=campaign.id, platform_profile_id=platform.id))
        db.commit()

        task = create_content_task(
            db=db,
            payload=ContentTaskCreate(
                product_id=product.id,
                fact_version_id=fact.id,
                platform_profile_id=platform.id,
                campaign_id=campaign.id,
                query_topic_id=topic.id,
                brief=ContentBriefInput(
                    target_question="PS-4c 电压范围与选型边界是什么？",
                    search_intent=IntentType.REPLACEMENT,
                    content_angle="选型边界",
                    must_answer_questions=["输入电压范围"],
                    required_fact_points=["5.5-36V"],
                    forbidden_expressions=["免验证直接替换"],
                    cta="联系 FAE",
                    target_keywords=["PS-4c"],
                ),
            ),
            actor=admin,
            request_id="req-4c-task",
            idempotency_key="task-4c-0001",
        )

        # 内容版本（含 NEAR_DUPLICATE_CONTENT 标记）+ 一次审核通过记录
        draft_at = now - timedelta(hours=6)
        approve_at = now - timedelta(hours=4)
        publish_at = now - timedelta(hours=2)

        cv = ContentVersion(
            task_id=task.id,
            fact_version_id=fact.id,
            version=1,
            source_type="MANUAL",
            title="PS-4c 工业电源输入电压边界说明",
            summary="说明 5.5-36V 边界",
            body_markdown="支持 5.5-36V 输入，最高输出 3A。",
            tags=["PS-4c"],
            content_hash="c" * 64,
            status="APPROVED",
            quality_issues=[
                {
                    "code": "NEAR_DUPLICATE_CONTENT",
                    "severity": "WARNING",
                    "message": "与同活动稿件相似度偏高",
                }
            ],
            change_summary="首稿",
            created_by=admin.id,
            created_at=draft_at,
        )
        db.add(cv)
        db.flush()
        task_row = db.get(ContentTask, task.id)
        assert task_row is not None
        task_row.current_content_version_id = cv.id
        db.add(
            ContentReviewRecord(
                content_version_id=cv.id,
                action="approve",
                comment="首轮通过",
                actor_id=admin.id,
                created_at=approve_at,
            )
        )
        account = PlatformAccount(
            platform_profile_id=platform.id,
            label="4C 官方号",
            account_identifier="acct-4c",
        )
        db.add(account)
        db.commit()

        # 发布工作 -> 核验通过 -> 公开文章 -> 最新页面健康检查 CONFIRMED_ANOMALY + 开放问题
        article_url = f"https://{platform.allowed_domains[0]}/articles/ps-4c"
        created_work = create_publication_work(
            db=db,
            payload=PublicationWorkCreate(
                content_version_id=cv.id,
                platform_account_id=account.id,
            ),
            actor=admin,
            request_id="req-4c-pub-create",
            idempotency_key="pub-4c-001",
        )
        registered_work = register_publication_result(
            db=db,
            work_id=created_work.id,
            payload=PublicationResultUpdate(
                expected_revision=created_work.revision,
                actual_title=cv.title,
                final_url=article_url,  # type: ignore[arg-type]
                published_at=publish_at,
                comment="4C 发布结果登记",
            ),
            actor=admin,
            request_id="req-4c-pub-reg",
        )
        verified_work = verify_publication_work(
            db=db,
            work_id=registered_work.id,
            payload=PublicationVerificationCreate(
                expected_revision=registered_work.revision,
                outcome=PublicationVerificationOutcome.PASSED,
                content_matches=True,
                comment="4C 首次核验通过",
            ),
            actor=admin,
            request_id="req-4c-pub-verify",
        )
        article_id = verified_work.id

        db.add(
            PublishedArticleHealthCheck(
                published_article_id=article_id,
                checked_url=article_url,
                final_url=article_url,
                status="CONFIRMED_ANOMALY",
                http_status=404,
                redirect_count=0,
                redirected=False,
                has_noindex=False,
                anomaly_reasons=["HTTP_404"],
                triggered_by=admin.id,
                checked_at=now - timedelta(minutes=15),
            )
        )
        db.add(
            PublishedContentIssue(
                published_article_id=article_id,
                kind="PAGE_UNAVAILABLE",
                description="文章公开页返回 404",
                status="OPEN",
                opened_by=admin.id,
                opened_at=now - timedelta(minutes=10),
            )
        )

        # AI 成本：1 条已定价 USD 生成作业 + 1 条未定价语义质检作业（验证 missing_price_rate=0.5）
        channel = AIChannel(
            name="4C Cost Channel",
            description="4C 看板成本渠道",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="OPENAI",
            base_url="https://api.example.invalid/v1",
            api_key_ciphertext="enc-4c",
            api_key_updated_at=now,
            timeout_seconds=60,
            is_enabled=True,
            created_by=admin.id,
        )
        db.add(channel)
        db.flush()
        model = AIModel(
            channel_id=channel.id,
            display_name="4C Model",
            model_id="gpt-4c",
            request_parameters={},
            is_enabled=True,
            test_status="PASSED",
            created_by=admin.id,
        )
        db.add(model)
        db.flush()

        db.add(
            GenerationJob(
                content_task_id=task.id,
                idempotency_key="gen-4c-usd-1",
                job_type="GENERATE",
                status="SUCCEEDED",
                input_snapshot={},
                ai_channel_id=channel.id,
                ai_model_id=model.id,
                adapter_name="openai-compatible",
                prompt_template_version="v4",
                prompt_hash="d" * 64,
                cost_amount=Decimal("0.012500"),
                cost_currency="USD",
                created_by=admin.id,
                finished_at=now,
            )
        )
        db.add(
            ContentQualityCheckJob(
                content_version_id=cv.id,
                content_task_id=task.id,
                idempotency_key="sem-4c-unpriced-1",
                status="SUCCEEDED",
                ai_channel_id=channel.id,
                ai_model_id=model.id,
                adapter_name="openai-compatible",
                input_snapshot={},
                findings=[],
                differentiation_suggestions=[],
                cost_amount=None,
                cost_currency=None,
                created_by=admin.id,
                finished_at=now,
            )
        )
        db.commit()

        # 运营费用台账：1 条有效 CNY + 1 条已作废 CNY（不得计入汇总）
        create_operating_cost_entry(
            db=db,
            payload=OperatingCostEntryCreate(
                campaign_id=campaign.id,
                category="LABOR",
                amount=Decimal("600.00"),
                currency="CNY",
                incurred_on=date.today(),
                note="FAE 审校",
            ),
            actor=admin,
            request_id="req-4c-cost-1",
        )
        voidable = create_operating_cost_entry(
            db=db,
            payload=OperatingCostEntryCreate(
                campaign_id=campaign.id,
                category="EXTERNAL_PLACEMENT",
                amount=Decimal("999.00"),
                currency="CNY",
                incurred_on=date.today(),
                note="误录待作废",
            ),
            actor=admin,
            request_id="req-4c-cost-2",
        )
        void_operating_cost_entry(
            db=db,
            entry_id=voidable.id,
            payload=OperatingCostEntryVoidRequest(reason="录入重复，已作废"),
            actor=admin,
            request_id="req-4c-cost-void",
        )

        # 未来日期费用（不应计入当前窗口汇总）
        create_operating_cost_entry(
            db=db,
            payload=OperatingCostEntryCreate(
                campaign_id=campaign.id,
                category="OTHER",
                amount=Decimal("777.00"),
                currency="CNY",
                incurred_on=date.today() + timedelta(days=10),
                note="下月预排费用",
            ),
            actor=admin,
            request_id="req-4c-cost-future",
        )

        # 关联 1 条 GEO 干预，并确保 opp 的 rule_code 可触发衰减预警
        create_geo_intervention(
            db=db,
            payload=GeoInterventionCreate(
                opportunity_id=opp_id,
                campaign_id=campaign.id,
                title="4C 关联干预",
                hypothesis="验证看板干预计数",
                planned_action_type="CONTENT_TASK",
            ),
            actor=admin,
            request_id="req-4c-interv",
        )
        opp_row = db.get(GeoOpportunity, opp_id)
        assert opp_row is not None

        # 1. 核验 Campaign 归因看板
        dash = get_campaign_attribution_dashboard(db, campaign.id, window_days=30)
        assert dash.causal_claim == "NOT_ESTABLISHED"
        assert dash.production.task_count == 1
        assert dash.production.approved_task_count == 1
        assert dash.production.published_article_count == 1
        assert dash.production.first_pass_review_rate == 1.0
        assert dash.production.avg_draft_to_approval_hours == 2.0
        assert dash.production.avg_approval_to_publish_hours == 2.0
        assert dash.production.avg_publish_to_verify_hours is not None
        assert dash.production.avg_publish_to_verify_hours >= 1.9
        assert dash.production.near_duplicate_version_count == 1
        assert dash.production.overdue_fact_product_count == 1

        assert dash.publishing_health.published_article_count == 1
        assert dash.publishing_health.confirmed_anomaly_articles == 1
        assert dash.publishing_health.open_issues == 1

        assert dash.geo_attribution.causal_claim == "NOT_ESTABLISHED"
        assert dash.geo_attribution.linked_intervention_count == 1
        assert dash.geo_attribution.concluded_intervention_count == 0

        # 多币种严禁混加：CNY 与 USD 严格分列，作废记录不计入，未定价率准确为 0.5
        assert dash.cost_coverage.total_ai_jobs == 2
        assert dash.cost_coverage.priced_ai_jobs == 1
        assert dash.cost_coverage.unpriced_ai_jobs == 1
        assert dash.cost_coverage.missing_price_rate == 0.5
        by_curr = {row.currency: row for row in dash.costs_by_currency}
        assert set(by_curr.keys()) == {"CNY", "USD"}
        assert by_curr["CNY"].labor_cost == Decimal("600.00")
        assert by_curr["CNY"].external_placement_cost == Decimal("0")
        assert by_curr["CNY"].total_cost == Decimal("600.00")
        assert by_curr["USD"].ai_generation_cost == Decimal("0.012500")
        assert by_curr["USD"].total_cost == Decimal("0.012500")

        unit_by_curr = {row.currency: row for row in dash.unit_economics_by_currency}
        assert unit_by_curr["CNY"].cost_per_approved_content == Decimal("600.000000")
        assert unit_by_curr["CNY"].cost_per_published_article == Decimal("600.000000")
        assert unit_by_curr["CNY"].cost_per_geo_sample is None  # 无 GEO 样本时严格为 None

        # 2. 核验全局经营指标与衰退预警
        ops = get_workbench_operations_metrics(db, window_days=30)
        assert ops.causal_claim == "NOT_ESTABLISHED"
        assert ops.active_campaign_count >= 1
        assert ops.production.overdue_fact_product_count >= 1
        assert ops.publishing_health.confirmed_anomaly_articles >= 1
        alert_kinds = {item.kind for item in ops.decay_alerts}
        assert "OVERDUE_FACT" in alert_kinds
        assert "UNHEALTHY_PAGE" in alert_kinds
        unhealthy_alert = next(item for item in ops.decay_alerts if item.kind == "UNHEALTHY_PAGE")
        assert unhealthy_alert.navigation_path == f"/publishing/articles/{article_id}"
        if opp_row.status in {"OPEN", "ACKNOWLEDGED"} and opp_row.rule_code in {
            "VISIBILITY_DROP",
            "OWN_CITATION_LOST",
        }:
            assert alert_kinds & {"GEO_VISIBILITY_DROP", "GEO_CITATION_LOST"}
        for alert in ops.decay_alerts:
            assert alert.navigation_path.startswith("/")
