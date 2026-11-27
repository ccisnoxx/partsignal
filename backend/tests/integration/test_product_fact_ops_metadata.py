"""Slice 2A：产品事实运营元数据、不可变触发器、延期复核与用户删除护栏的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.errors import AppError
from app.models.ai_generation import AIChannel, AIModel
from app.models.configuration import PlatformProfile, PlatformPrompt
from app.models.content import ContentTask
from app.models.identity import AuditLog, User
from app.models.product_facts import Product
from app.schemas.product_facts import (
    Confidentiality,
    FactReviewSubmissionRequest,
    ProductFactsConfirmReviewRequest,
    ProductFactsDraftUpdate,
    ProductFactsFreshness,
    ProductWorkflowStage,
)
from app.services.content_production import build_generation_input
from app.services.identity import delete_user
from app.services.product_facts import (
    confirm_product_facts_review,
    product_facts_draft_out,
    product_out,
    replace_product_facts,
    submit_fact_review,
)
from app.services.review import transition_fact_version
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


@pytest.mark.integration
def test_0071_ops_metadata_freeze_trigger_confirm_review_and_user_guard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证 0071 迁移、FactVersion 冻结守卫、轻量复核延期、USER_IN_USE 与 AI 外发隔离。"""
    with temporary_database() as db_url:
        engine = create_engine(db_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                graph = _seed_graph(db)
                actor = graph["user"]
                product = graph["product"]
                profile = graph["profile"]
                task = graph["task"]
                assert isinstance(actor, User)
                assert isinstance(product, Product)
                assert isinstance(profile, PlatformProfile)
                assert isinstance(task, ContentTask)

                # 1. 保存 7 项运营元数据（含已过期 next_review_at）
                verified_at = datetime(2026, 10, 1, 8, 0, tzinfo=UTC)
                overdue_at = datetime.now(UTC) - timedelta(days=2)
                draft = replace_product_facts(
                    db=db,
                    product_id=product.id,
                    payload=ProductFactsDraftUpdate(
                        expected_revision=product.facts_revision,
                        body_markdown="## 核心产品事实\n输入电压 4.5V-36V，连续电流 3A。",
                        classification=Confidentiality.PUBLIC,
                        source_owner="  王工（FAE） ",
                        source_reference="  INTERNAL-DS-2026-007  ",
                        verified_at=verified_at,
                        next_review_at=overdue_at,
                        applicable_region=" 中国大陆 ",
                        content_restrictions=" 禁止宣称 100% 管脚直接替代 ",
                        approved_claims_summary=" 适用于 12V/24V 工业降压电源 ",
                    ),
                    actor=actor,
                    request_id="req-2a-save",
                )
                assert draft.source_owner == "王工（FAE）"
                assert draft.source_reference == "INTERNAL-DS-2026-007"
                assert draft.applicable_region == "中国大陆"
                assert draft.content_restrictions == "禁止宣称 100% 管脚直接替代"
                assert draft.approved_claims_summary == "适用于 12V/24V 工业降压电源"
                assert draft.facts_freshness == ProductFactsFreshness.OVERDUE

                # 2. 提交审核并批准：5 项约束元数据不可变冻结至 FactVersion
                submitted = submit_fact_review(
                    db=db,
                    product_id=product.id,
                    payload=FactReviewSubmissionRequest(
                        expected_revision=draft.revision,
                        change_summary="冻结 2026Q4 运营元数据与事实正文",
                    ),
                    actor=actor,
                    request_id="req-2a-submit",
                )
                assert submitted.source_reference == "INTERNAL-DS-2026-007"
                assert submitted.verified_at == verified_at
                assert submitted.applicable_region == "中国大陆"
                assert submitted.content_restrictions == "禁止宣称 100% 管脚直接替代"
                assert submitted.approved_claims_summary == "适用于 12V/24V 工业降压电源"

                # 存在 PENDING_REVIEW 时不能执行无变更复核延期
                with pytest.raises(AppError) as pending_err:
                    confirm_product_facts_review(
                        db=db,
                        product_id=product.id,
                        payload=ProductFactsConfirmReviewRequest(
                            expected_revision=draft.revision,
                            next_review_at=datetime.now(UTC) + timedelta(days=90),
                        ),
                        actor=actor,
                        request_id="req-2a-confirm-pending",
                    )
                assert pending_err.value.code == "FACT_REVIEW_PENDING"

                # 批准新版本
                approved_out = transition_fact_version(
                    db=db,
                    fact_version_id=submitted.id,
                    action="approve",
                    expected_revision=submitted.revision,
                    comment="审核通过",
                    actor=actor,
                    request_id="req-2a-approve",
                )
                assert approved_out.source_reference == "INTERNAL-DS-2026-007"
                assert approved_out.content_restrictions == "禁止宣称 100% 管脚直接替代"

                # 3. 验证数据库触发器禁止原地修改 FactVersion 全部 5 项冻结元数据
                for column, value in (
                    ("source_reference", "TAMPERED"),
                    ("verified_at", datetime(2026, 10, 2, 0, 0, tzinfo=UTC)),
                    ("applicable_region", "海外"),
                    ("content_restrictions", "放宽限制"),
                    ("approved_claims_summary", "篡改结论"),
                ):
                    with pytest.raises(DBAPIError) as trigger_err:
                        db.execute(
                            text(
                                f"UPDATE fact_versions SET {column} = :val WHERE id = :id"
                            ),
                            {"val": value, "id": submitted.id},
                        )
                    assert getattr(trigger_err.value.orig, "sqlstate", None) == "55000"
                    db.rollback()

                # 4. 轻量无变更延期复核：拒绝过去时间，合法未来时间成功且保持 FACT_APPROVED
                with pytest.raises(AppError) as past_err:
                    confirm_product_facts_review(
                        db=db,
                        product_id=product.id,
                        payload=ProductFactsConfirmReviewRequest(
                            expected_revision=draft.revision,
                            next_review_at=datetime.now(UTC) - timedelta(minutes=1),
                        ),
                        actor=actor,
                        request_id="req-2a-confirm-past",
                    )
                assert past_err.value.code == "VALIDATION_ERROR"

                reviewer = User(
                    id=uuid.uuid4(),
                    username="fact_reviewer_2a",
                    display_name="复核工程师",
                    password_hash="hashed",
                    account_type="ENGINEER",
                    is_active=True,
                )
                db.add(reviewer)
                db.commit()

                next_due = datetime.now(UTC) + timedelta(days=90)
                confirmed = confirm_product_facts_review(
                    db=db,
                    product_id=product.id,
                    payload=ProductFactsConfirmReviewRequest(
                        expected_revision=draft.revision,
                        next_review_at=next_due,
                    ),
                    actor=reviewer,
                    request_id="req-2a-confirm-ok",
                )
                assert confirmed.revision == draft.revision + 1
                assert confirmed.facts_freshness == ProductFactsFreshness.FRESH
                assert confirmed.last_reviewed_by == reviewer.id
                assert confirmed.last_reviewed_at is not None
                assert confirmed.product.workflow_stage == ProductWorkflowStage.FACT_APPROVED

                # 产品投影同步反映 FRESH 与 source_owner
                refreshed_product = db.get(Product, product.id)
                assert refreshed_product is not None
                projected = product_out(db, refreshed_product, can_delete=False)
                assert projected.facts_freshness == ProductFactsFreshness.FRESH
                assert projected.source_owner == "王工（FAE）"
                assert projected.workflow_stage == ProductWorkflowStage.FACT_APPROVED

                # 低敏审计记录存在且不泄露自由文本
                audit = db.scalar(
                    select(AuditLog).where(
                        AuditLog.action == "product_facts.review_confirmed",
                        AuditLog.target_id == str(product.id),
                    )
                )
                assert audit is not None
                assert "INTERNAL-DS-2026-007" not in str(audit.details)
                assert "王工" not in str(audit.details)

                # 5. Product.last_reviewed_by 纳入 USER_IN_USE 停用用户删除护栏
                reviewer.is_active = False
                db.commit()
                with pytest.raises(AppError) as in_use_err:
                    delete_user(
                        db=db,
                        user_id=reviewer.id,
                        expected_revision=reviewer.revision,
                        actor=actor,
                        request_id="req-2a-delete-reviewer",
                    )
                assert in_use_err.value.code == "USER_IN_USE"

                # 6. 验证 AI 生成输入快照绝不泄露 source_owner 或 source_reference
                prompt = PlatformPrompt(
                    name=f"2a-prompt-{uuid.uuid4().hex[:8]}",
                    template_markdown="你是电子元器件技术作者。",
                    updated_by=actor.id,
                )
                channel = AIChannel(
                    name="2A Test Channel",
                    description="测试渠道",
                    protocol_type="openai-compatible-chat-completions",
                    provider_brand="CUSTOM",
                    base_url="https://api.example.com/v1",
                    api_key_ciphertext="enc:dummy",
                    api_key_updated_at=datetime.now(UTC),
                    timeout_seconds=60,
                    is_enabled=True,
                    created_by=actor.id,
                )
                db.add_all([prompt, channel])
                db.flush()
                profile.platform_prompt_id = prompt.id
                model = AIModel(
                    channel_id=channel.id,
                    display_name="Test Model",
                    model_id="test-model-v1",
                    request_parameters={},
                    is_enabled=True,
                    test_status="PASSED",
                    created_by=actor.id,
                )
                db.add(model)
                new_task = ContentTask(
                    product_id=product.id,
                    fact_version_id=submitted.id,
                    platform_profile_id=profile.id,
                    platform_profile_name_snapshot=profile.name,
                    platform_website_url_snapshot=profile.website_url,
                    created_by=actor.id,
                )
                db.add(new_task)
                db.commit()

                snapshot = build_generation_input(
                    db=db,
                    task=new_task,
                    model=model,
                    platform_prompt_id=prompt.id,
                    platform_prompt_revision=prompt.revision,
                )
                snapshot_text = str(snapshot)
                assert "INTERNAL-DS-2026-007" not in snapshot_text
                assert "王工（FAE）" not in snapshot_text
                assert "source_owner" not in snapshot_text
                assert "source_reference" not in snapshot_text

                # 7. 验证含已批准事实的活跃产品投影 CONFIRM_REVIEW
                fresh_draft = product_facts_draft_out(db, refreshed_product)
                assert "CONFIRM_REVIEW" in fresh_draft.available_actions

            # 8. 0071 downgrade 固定以 55000 拒绝销毁历史
            monkeypatch.setenv("DATABASE_URL", db_url)
            monkeypatch.setattr(settings, "database_url", db_url)
            backend_dir = Path(__file__).resolve().parents[2]
            alembic_cfg = Config(str(backend_dir / "alembic.ini"))
            alembic_cfg.set_main_option("script_location", str(backend_dir / "alembic"))
            alembic_cfg.set_main_option("sqlalchemy.url", db_url)
            with pytest.raises(DBAPIError) as downgrade_err:
                command.downgrade(alembic_cfg, "0070_geo_citation_observation")
            assert getattr(downgrade_err.value.orig, "sqlstate", None) == "55000"
        finally:
            engine.dispose()
