"""Slice 3B：双层内容质量检查、警告确认门禁、重复度分析与异步语义质检 PG 17 集成测试。"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.audit_types import AuditModule
from app.config import settings
from app.errors import AppError
from app.models.ai_generation import AIChannel, AIModel
from app.models.campaign import (
    ContentCampaign,
    ContentCampaignPlatform,
    ContentCampaignProduct,
    ContentCampaignTopic,
)
from app.models.content import ContentTask
from app.models.content_quality import ContentQualityCheckJob
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.schemas.configuration import IntentType
from app.schemas.content import (
    ContentBriefInput,
    ContentDraftUpdate,
    ContentRevisionCreate,
    ContentTaskCreate,
)
from app.schemas.content_quality import (
    SemanticQualityCheckCreate,
    SemanticQualityFinding,
    SemanticQualityModelResult,
)
from app.schemas.geo_files import GeneratedDraft
from app.services.ai_provider import ChatCompletionResult
from app.services.audit_logs import list_audit_logs
from app.services.content_duplication import analyze_content_duplication
from app.services.content_planning import create_content_task
from app.services.content_production import create_manual_content_version, update_content_draft
from app.services.content_quality import evaluate_content_quality
from app.services.identity import delete_user
from app.services.review import transition_content_version
from app.services.semantic_quality_checks import (
    create_semantic_quality_check_job,
    list_semantic_quality_check_jobs,
)
from app.services.semantic_quality_worker import process_semantic_quality_check_job
from tests.integration.test_content_planning_layer import _seed_entities, temporary_database


class _FakeSemanticEvaluator:
    def __init__(self) -> None:
        self.snapshots: list[dict[str, Any]] = []

    def evaluate(
        self, snapshot: dict[str, Any]
    ) -> tuple[SemanticQualityModelResult, ChatCompletionResult | None]:
        self.snapshots.append(snapshot)
        return (
            SemanticQualityModelResult(
                findings=[
                    SemanticQualityFinding(
                        code="SEMANTIC_ANGLE_OVERLAP",
                        severity="WARNING",
                        message="开篇段落与同活动其他平台结构偏近",
                        suggestion="改用 FAQ 问答列表突出选型边界",
                    )
                ],
                differentiation_suggestions=["增加应用电路保护注意事项小节"],
            ),
            ChatCompletionResult(
                content="{}",
                provider_request_id=None,
                duration_ms=210,
                prompt_tokens=120,
                completion_tokens=45,
                total_tokens=165,
            ),
        )


@pytest.mark.integration
def test_0076_quality_gate_duplication_semantic_checks_and_guards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证 0076 质量门禁分级、警告显式确认、重复度分析、异步语义检查与触发器/降级护栏。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        try:
            with Session(engine, expire_on_commit=False) as db:
                env = _seed_entities(db, suffix="3b")
                admin: User = env["admin"]  # type: ignore[assignment]
                product = env["product"]
                platform = env["platform"]
                topic = env["topic"]

                # 新增带内部溯源与公开禁用约束的已批准 PUBLIC FactVersion v2
                product.source_owner = "绝密内部负责人老李"
                typo_part = product.part_number[:-1] + (
                    "9" if product.part_number[-1] != "9" else "8"
                )
                approved_fact = FactVersion(
                    product_id=product.id,
                    version=2,
                    status="APPROVED",
                    body_markdown=(
                        "# TPS5430 公开事实\n\n支持 5.5V-36V 输入电压与 3A 连续输出电流。"
                    ),
                    classification="PUBLIC",
                    change_summary="Slice 3B 公开事实",
                    source_reference="INTERNAL-DOC-3B-001",
                    applicable_region="中国大陆工业市场",
                    content_restrictions="禁止承诺免测试直接替换",
                    approved_claims_summary=(
                        "适用于 12V-24V 工业降压电源，支持 5.5V-36V 与 3A 输出。"
                    ),
                    created_by=admin.id,
                    approved_by=admin.id,
                    approved_at=datetime.now(UTC),
                )
                db.add(approved_fact)
                campaign = ContentCampaign(
                    name="TPS5430 Q4 专项活动",
                    description="提升国产替代 GEO 引用率",
                    target_audience="电源研发工程师",
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
                db.add(
                    ContentCampaignPlatform(
                        campaign_id=campaign.id, platform_profile_id=platform.id
                    )
                )
                db.commit()

                task_a = create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=product.id,
                        fact_version_id=approved_fact.id,
                        platform_profile_id=platform.id,
                        campaign_id=campaign.id,
                        query_topic_id=topic.id,
                        brief=ContentBriefInput(
                            target_question="TPS5430 降压芯片选型要注意哪些电压和电流边界？",
                            search_intent=IntentType.REPLACEMENT,
                            content_angle="工程选型对比",
                            must_answer_questions=["输入电压和电流边界"],
                            required_fact_points=["5.5V-36V", "3A"],
                            forbidden_expressions=["终身质保"],
                            target_keywords=["TPS5430", "工业电源", "降压芯片"],
                            cta="联系原厂 FAE 获取完整评估板资料",
                        ),
                    ),
                    actor=admin,
                    request_id="req-3b-task-a",
                    idempotency_key="task-3b-a-0001",
                )
                task_b = create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=product.id,
                        fact_version_id=approved_fact.id,
                        platform_profile_id=platform.id,
                        campaign_id=campaign.id,
                        query_topic_id=topic.id,
                        brief=ContentBriefInput(
                            target_question="TPS5430 降压芯片选型要注意哪些电压和电流边界？",
                            search_intent=IntentType.REPLACEMENT,
                            content_angle="知乎实操问答",
                            must_answer_questions=["输入电压和电流边界"],
                            required_fact_points=["5.5V-36V", "3A"],
                            forbidden_expressions=["终身质保"],
                            target_keywords=["TPS5430", "工业电源", "降压芯片"],
                            cta="联系原厂 FAE 获取完整评估板资料",
                        ),
                    ),
                    actor=admin,
                    request_id="req-3b-task-b",
                    idempotency_key="task-3b-b-0001",
                )

                # 1. BLOCKING 规则：虚构工程数值(48V)、禁用表达(终身质保)、绝对化替代、型号拼写错误
                blocked_cv = create_manual_content_version(
                    db=db,
                    content_task_id=task_a.id,
                    payload=ContentRevisionCreate(
                        title="TPS5430 工业电源降压芯片选型解析",
                        summary="介绍 TPS5430 工业降压选型边界。",
                        body_markdown=(
                            "## 核心参数\n\n"
                            f"{typo_part} 支持 48V 输入并可 100% 替代进口型号，同时提供终身质保。"
                        ),
                        tags=["TPS5430"],
                        change_summary="首稿测试阻断规则",
                    ),
                    actor=admin,
                    request_id="req-3b-blocked",
                )
                codes = {item["code"]: item["severity"] for item in blocked_cv.quality_issues}
                assert codes["FORBIDDEN_EXPRESSION_HIT"] == "BLOCKING"
                assert codes["ABSOLUTE_REPLACEMENT_CLAIM"] == "BLOCKING"
                assert codes["PART_NUMBER_TYPO"] == "BLOCKING"
                assert codes["UNSUPPORTED_TECHNICAL_NUMBER"] == "BLOCKING"

                # BLOCKING 即使 acknowledge_warnings=True 也必须被拒绝
                with pytest.raises(AppError) as blk_err:
                    transition_content_version(
                        db=db,
                        content_version_id=blocked_cv.id,
                        expected_revision=blocked_cv.revision,
                        comment="",
                        actor=admin,
                        request_id="req-3b-submit-blk",
                        action="submit-review",
                        acknowledge_warnings=True,
                    )
                assert blk_err.value.code == "INVALID_STATE_TRANSITION"

                # 2. 修复 BLOCKING 但保留 WARNING（短标题+缺关键词），验证显式确认门禁
                warn_cv = update_content_draft(
                    db=db,
                    content_version_id=blocked_cv.id,
                    payload=ContentDraftUpdate(
                        expected_revision=blocked_cv.revision,
                        title="TPS5430",
                        summary="工业降压选型参考。",
                        body_markdown=(
                            "## 电压与电流边界\n\n"
                            "在工业 12V-24V 电源系统中，TPS5430 支持 5.5V-36V 输入电压与 3A "
                            "连续输出电流，工程师应根据实际电路负载与温升余量完成验证。"
                        ),
                        tags=["TPS5430"],
                    ),
                    actor=admin,
                    request_id="req-3b-warn",
                )
                warn_codes = {item["code"]: item["severity"] for item in warn_cv.quality_issues}
                assert all(sev != "BLOCKING" for sev in warn_codes.values())
                assert warn_codes["TITLE_LENGTH_OUT_OF_RANGE"] == "WARNING"
                assert warn_codes["CTA_MISSING"] == "INFORMATION"

                # 未确认警告 -> 409 QUALITY_WARNINGS_UNACKNOWLEDGED
                with pytest.raises(AppError) as warn_err:
                    transition_content_version(
                        db=db,
                        content_version_id=warn_cv.id,
                        expected_revision=warn_cv.revision,
                        comment="",
                        actor=admin,
                        request_id="req-3b-submit-noack",
                        action="submit-review",
                        acknowledge_warnings=False,
                    )
                assert warn_err.value.code == "QUALITY_WARNINGS_UNACKNOWLEDGED"

                # 显式确认警告 -> 提交成功
                submitted = transition_content_version(
                    db=db,
                    content_version_id=warn_cv.id,
                    expected_revision=warn_cv.revision,
                    comment="已核对短标题告警",
                    actor=admin,
                    request_id="req-3b-submit-ack",
                    action="submit-review",
                    acknowledge_warnings=True,
                )
                assert submitted.status == "PENDING_REVIEW"

                # 3. 同 Campaign 第二篇高度相似内容 -> 重复度分析与 NEAR_DUPLICATE_CONTENT
                similar_cv = create_manual_content_version(
                    db=db,
                    content_task_id=task_b.id,
                    payload=ContentRevisionCreate(
                        title="TPS5430 工业电源降压芯片选型解析",
                        summary="工业降压选型参考。",
                        body_markdown=(
                            "## 电压与电流边界\n\n"
                            "在工业 12V-24V 电源系统中，TPS5430 支持 5.5V-36V 输入电压与 3A "
                            "连续输出电流，工程师应根据实际电路负载与温升余量完成验证。"
                        ),
                        tags=["TPS5430"],
                        change_summary="同活动高相似稿件",
                    ),
                    actor=admin,
                    request_id="req-3b-similar",
                )
                sim_codes = {item["code"]: item["severity"] for item in similar_cv.quality_issues}
                assert sim_codes["NEAR_DUPLICATE_CONTENT"] == "WARNING"

                dup = analyze_content_duplication(db, content_version_id=similar_cv.id)
                assert dup.compared_campaign_count >= 1
                assert dup.same_campaign_max_similarity >= 0.55
                assert len(dup.similar_contents) >= 1
                assert len(dup.duplicate_paragraphs) >= 1
                assert len(dup.differentiation_suggestions) >= 1

                # 4. 自然化引入原稿与事实均不存在的新认证/百分比 -> BLOCKING HUMANIZATION_NEW_CLAIM
                task_b_row = db.get(ContentTask, task_b.id)
                assert task_b_row is not None
                humanized_issues = evaluate_content_quality(
                    db,
                    task_b_row,
                    GeneratedDraft(
                        title="TPS5430 工业电源降压芯片应用指南",
                        summary="自然化润色版本。",
                        body_markdown=(
                            "## 电压与电流边界\n\n"
                            "TPS5430 支持 5.5V-36V 与 3A 输出，转换效率可达 95%，"
                            "已通过 AEC-Q100 车规认证。"
                        ),
                        tags=["TPS5430"],
                    ),
                    source_content=similar_cv,
                    is_humanization=True,
                )
                assert any(
                    item["code"] == "HUMANIZATION_NEW_CLAIM" and item["severity"] == "BLOCKING"
                    for item in humanized_issues
                )

                # 5. Layer 2 异步语义检查：运行模式门禁、非 PUBLIC 兄弟隔离、幂等、Worker 与触发器
                internal_fact = FactVersion(
                    product_id=product.id,
                    version=3,
                    status="APPROVED",
                    body_markdown="# 内部机密事实\n\n支持 5.5V-36V 与 3A。",
                    classification="INTERNAL",
                    change_summary="内部事实",
                    created_by=admin.id,
                    approved_by=admin.id,
                    approved_at=datetime.now(UTC),
                )
                db.add(internal_fact)
                db.commit()
                internal_task = create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=product.id,
                        fact_version_id=internal_fact.id,
                        platform_profile_id=platform.id,
                        campaign_id=campaign.id,
                        query_topic_id=topic.id,
                        brief=ContentBriefInput(
                            target_question="内部未公开选型评估",
                            search_intent=IntentType.REPLACEMENT,
                            content_angle="内部评审",
                            must_answer_questions=["输入电压边界"],
                            required_fact_points=["5.5V-36V"],
                            forbidden_expressions=[],
                            target_keywords=["TPS5430"],
                            cta="内部流转",
                        ),
                    ),
                    actor=admin,
                    request_id="req-3b-internal-task",
                    idempotency_key="task-3b-internal-0001",
                )
                create_manual_content_version(
                    db=db,
                    content_task_id=internal_task.id,
                    payload=ContentRevisionCreate(
                        title="绝密内部未公开竞品价格对比表",
                        summary="工业降压选型参考。",
                        body_markdown=(
                            "## 电压与电流边界\n\n"
                            "在工业 12V-24V 电源系统中，TPS5430 支持 5.5V-36V 输入电压与 3A "
                            "连续输出电流，工程师应根据实际电路负载与温升余量完成验证。"
                        ),
                        tags=["TPS5430"],
                        change_summary="内部机密稿",
                    ),
                    actor=admin,
                    request_id="req-3b-internal-cv",
                )

                channel = AIChannel(
                    name="3B 语义质检渠道",
                    description="",
                    protocol_type="openai-compatible-chat-completions",
                    provider_brand="OPENAI",
                    base_url="https://api.example.invalid/v1",
                    api_key_ciphertext="enc-3b",
                    api_key_updated_at=datetime.now(UTC),
                    timeout_seconds=30,
                    is_enabled=True,
                    created_by=admin.id,
                )
                db.add(channel)
                db.flush()
                model = AIModel(
                    channel_id=channel.id,
                    display_name="3B Semantic Model",
                    model_id="gpt-4o-mini",
                    request_parameters={},
                    is_enabled=True,
                    test_status="PASSED",
                    created_by=admin.id,
                )
                db.add(model)
                db.commit()

                # P1-4：关闭生成模式时入口直接拒绝（AI_GENERATION_DISABLED）
                monkeypatch.setattr(settings, "content_generator", "deterministic")
                with pytest.raises(AppError) as disabled_err:
                    create_semantic_quality_check_job(
                        db=db,
                        content_version_id=similar_cv.id,
                        payload=SemanticQualityCheckCreate(ai_model_id=model.id),
                        actor=admin,
                        request_id="req-3b-sem-disabled",
                        idempotency_key="sem-3b-idem-disabled",
                    )
                assert disabled_err.value.code == "AI_GENERATION_DISABLED"

                monkeypatch.setattr(settings, "environment", "test")
                monkeypatch.setattr(settings, "content_generator", "openai-compatible")
                dispatched: list[Any] = []
                job_out = create_semantic_quality_check_job(
                    db=db,
                    content_version_id=similar_cv.id,
                    payload=SemanticQualityCheckCreate(ai_model_id=model.id),
                    actor=admin,
                    request_id="req-3b-sem-1",
                    idempotency_key="sem-3b-idem-0001",
                    dispatch=dispatched.append,
                )
                assert job_out.status == "PENDING"
                assert len(dispatched) == 1

                # 同幂等键回放复用作业且不二次投递
                replayed = create_semantic_quality_check_job(
                    db=db,
                    content_version_id=similar_cv.id,
                    payload=SemanticQualityCheckCreate(ai_model_id=model.id),
                    actor=admin,
                    request_id="req-3b-sem-replay",
                    idempotency_key="sem-3b-idem-0001",
                    dispatch=dispatched.append,
                )
                assert replayed.id == job_out.id
                assert len(dispatched) == 1

                # 活动期新幂等键返回 409 SEMANTIC_QUALITY_CHECK_ACTIVE
                with pytest.raises(AppError) as active_err:
                    create_semantic_quality_check_job(
                        db=db,
                        content_version_id=similar_cv.id,
                        payload=SemanticQualityCheckCreate(ai_model_id=model.id),
                        actor=admin,
                        request_id="req-3b-sem-active",
                        idempotency_key="sem-3b-idem-0002",
                        dispatch=dispatched.append,
                    )
                assert active_err.value.code == "SEMANTIC_QUALITY_CHECK_ACTIVE"

                # Worker 执行并验证外发快照不含内部溯源字段与 INTERNAL 兄弟标题
                evaluator = _FakeSemanticEvaluator()
                process_semantic_quality_check_job(
                    job_out.id,
                    evaluator=evaluator,
                    session_factory=session_factory,
                )
                assert len(evaluator.snapshots) == 1
                raw_snap = str(evaluator.snapshots[0])
                assert "绝密内部负责人老李" not in raw_snap
                assert "INTERNAL-DOC-3B-001" not in raw_snap
                assert "绝密内部未公开竞品价格对比表" not in raw_snap

                history = list_semantic_quality_check_jobs(db, similar_cv.id)
                assert len(history.items) == 1
                finished = history.items[0]
                assert finished.status == "SUCCEEDED"
                assert finished.total_tokens == 165
                assert len(finished.findings) == 1
                assert finished.findings[0].code == "SEMANTIC_ANGLE_OVERLAP"

                # 审计日志投影验证（严禁 AUDIT_PROJECTION_FAILED）
                audit_page = list_audit_logs(
                    db=db,
                    created_from=None,
                    created_to=None,
                    actor_id=None,
                    business_module=AuditModule.CONTENT_PRODUCTION,
                    action=None,
                    target_type=None,
                    target_id=None,
                    outcome=None,
                    request_id=None,
                    keyword=None,
                    page=1,
                    page_size=50,
                )
                assert "content_quality_check.requested" in {
                    row.action for row in audit_page.items
                }

                # 终态语义质检作业禁止篡改或直接 DELETE（55000）
                with pytest.raises(DBAPIError) as upd_err:
                    db.execute(
                        text(
                            "UPDATE content_quality_check_jobs "
                            "SET error_summary = 'tamper' WHERE id = :id"
                        ),
                        {"id": finished.id},
                    )
                assert getattr(upd_err.value.orig, "sqlstate", None) == "55000"
                db.rollback()

                with pytest.raises(DBAPIError) as del_err:
                    db.execute(
                        text("DELETE FROM content_quality_check_jobs WHERE id = :id"),
                        {"id": finished.id},
                    )
                assert getattr(del_err.value.orig, "sqlstate", None) == "55000"
                db.rollback()

                # 6. USER_IN_USE 护栏：仅作为 ContentQualityCheckJob.created_by 时禁止物理删除
                checker = User(
                    username="semantic_checker_3b",
                    display_name="质检员",
                    password_hash=admin.password_hash,
                    account_type="ENGINEER",
                    is_active=True,
                    must_change_password=False,
                )
                db.add(checker)
                db.commit()
                create_semantic_quality_check_job(
                    db=db,
                    content_version_id=similar_cv.id,
                    payload=SemanticQualityCheckCreate(ai_model_id=model.id),
                    actor=checker,
                    request_id="req-3b-sem-checker",
                    idempotency_key="sem-3b-idem-checker",
                    dispatch=lambda _jid: None,
                )
                checker.is_active = False
                db.commit()
                with pytest.raises(AppError) as user_err:
                    delete_user(
                        db=db,
                        user_id=checker.id,
                        expected_revision=checker.revision,
                        actor=admin,
                        request_id="req-3b-del-checker",
                    )
                assert user_err.value.code == "USER_IN_USE"

                # 6b. P0-2 验证：终态语义质检作业不阻断删除 AIModel（FK ON DELETE SET NULL 豁免）
                temp_model = AIModel(
                    channel_id=channel.id,
                    display_name="3B Disposable Model",
                    model_id="gpt-4o-mini-temp",
                    request_parameters={},
                    is_enabled=True,
                    test_status="PASSED",
                    created_by=admin.id,
                )
                db.add(temp_model)
                db.commit()
                temp_job = create_semantic_quality_check_job(
                    db=db,
                    content_version_id=warn_cv.id,
                    payload=SemanticQualityCheckCreate(ai_model_id=temp_model.id),
                    actor=admin,
                    request_id="req-3b-temp-model-job",
                    idempotency_key="sem-3b-idem-temp-model",
                    dispatch=lambda _jid: None,
                )
                process_semantic_quality_check_job(
                    temp_job.id,
                    evaluator=evaluator,
                    session_factory=session_factory,
                )
                db.delete(temp_model)
                db.commit()
                reloaded_temp_job = db.get(ContentQualityCheckJob, temp_job.id)
                assert reloaded_temp_job is not None
                assert reloaded_temp_job.ai_model_id is None

                # 7. 0076 downgrade 必须以 55000 拒绝
                monkeypatch.setenv("DATABASE_URL", database_url)
                monkeypatch.setattr(settings, "database_url", database_url)
                backend_dir = Path(__file__).resolve().parents[2]
                cfg = Config(str(backend_dir / "alembic.ini"))
                cfg.set_main_option("script_location", str(backend_dir / "alembic"))
                cfg.set_main_option("sqlalchemy.url", database_url)
                with pytest.raises(DBAPIError) as down_err:
                    command.downgrade(cfg, "0075_prompt_versioning_v4")
                assert getattr(down_err.value.orig, "sqlstate", None) == "55000"
                assert db.scalar(select(ContentQualityCheckJob.id).limit(1)) is not None
        finally:
            engine.dispose()
