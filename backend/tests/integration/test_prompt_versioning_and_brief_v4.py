"""Slice 3A PostgreSQL 集成测试：Prompt 不可变版本化、绑定/回滚、v4 Brief 注入与版本效果统计。"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.errors import AppError
from app.models.ai_generation import AIChannel, AIModel, GenerationJob
from app.models.configuration import PlatformProfile, PlatformPrompt, PlatformPromptVersion
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import GeoObservation, GeoObservationCitation, GeoObservationPublication
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.models.publication import (
    PlatformAccount,
    PublicationVerification,
    PublicationWork,
    PublishedArticle,
)
from app.schemas.configuration import IntentType, PlatformPromptCreate
from app.schemas.content import ContentBriefInput, ContentTaskCreate
from app.schemas.prompt_versioning import (
    PlatformPromptVersionBindCommand,
    PlatformPromptVersionCreate,
    PlatformPromptVersionDraftUpdate,
)
from app.services.content_planning import create_content_task
from app.services.content_production import build_generation_input
from app.services.identity import delete_user
from app.services.platform_configuration import (
    create_platform_prompt,
    delete_platform_prompt,
)
from app.services.prompt_version_queries import (
    get_platform_prompt_binding,
    list_platform_prompt_versions,
)
from app.services.prompt_versioning import (
    bind_platform_prompt_version,
    create_platform_prompt_version,
    transition_platform_prompt_version,
    update_platform_prompt_version_draft,
)
from app.services.review import transition_content_version
from tests.integration.test_content_planning_layer import _seed_entities
from tests.integration.test_publication_workflow import temporary_database


@pytest.mark.integration
def test_0075_prompt_versioning_rollback_brief_v4_metrics_and_guards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证 0075 不可变版本触发器、绑定/回滚、Brief v4、按版本指标、USER_IN_USE 与降级拒止。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                env = _seed_entities(db, suffix="3a")
                admin: User = env["admin"]  # type: ignore[assignment]
                product = env["product"]
                approved_fact = env["fact"]
                platform: PlatformProfile = env["platform"]  # type: ignore[assignment]
                topic = env["topic"]

                # 新增带内部溯源与公开约束的已批准 FactVersion v2（遵守 Slice 2A 不可变守卫）
                product.source_owner = "内部研发张工"
                approved_fact = FactVersion(
                    product_id=product.id,
                    version=2,
                    status="APPROVED",
                    body_markdown="# TPS5430 公开参数\n\n支持 5.5V-36V 宽输入，连续输出 3A。",
                    classification="PUBLIC",
                    change_summary="补充公开约束元数据",
                    source_reference="INTERNAL-REF-3A",
                    applicable_region="华东工业市场",
                    content_restrictions="禁止承诺免测试直接替换",
                    approved_claims_summary="支持 5.5V-36V 宽输入",
                    created_by=admin.id,
                    approved_by=admin.id,
                    approved_at=datetime.now(UTC),
                )
                db.add(approved_fact)
                db.commit()

                # 1. 创建 Prompt 主模板自动生成不可变 v1 已发布版本
                created_prompt = create_platform_prompt(
                    db=db,
                    payload=PlatformPromptCreate(
                        name="知乎 GEO 专栏 Prompt",
                        template_markdown="你是电子元器件专栏编辑（v1 风格）。",
                    ),
                    actor=admin,
                    request_id="req-3a-create-prompt",
                )
                versions_v1 = list_platform_prompt_versions(db, created_prompt.id)
                assert len(versions_v1.items) == 1
                v1 = versions_v1.items[0]
                assert v1.version == 1
                assert v1.status == "PUBLISHED"

                # 2. 创建 v2 草稿 -> 禁止再建第二个草稿 -> 编辑草稿 -> 发布冻结
                v2_draft = create_platform_prompt_version(
                    db=db,
                    platform_prompt_id=created_prompt.id,
                    payload=PlatformPromptVersionCreate(
                        template_markdown="你是电子元器件专栏编辑（v2 草稿）。",
                        change_summary="强化参数对比结构",
                        publish_immediately=False,
                    ),
                    actor=admin,
                    request_id="req-3a-v2-draft",
                )
                assert v2_draft.version == 2 and v2_draft.status == "DRAFT"

                with pytest.raises(AppError) as dup_draft_err:
                    create_platform_prompt_version(
                        db=db,
                        platform_prompt_id=created_prompt.id,
                        payload=PlatformPromptVersionCreate(
                            template_markdown="第二个草稿",
                            publish_immediately=False,
                        ),
                        actor=admin,
                        request_id="req-3a-v2-dup",
                    )
                assert dup_draft_err.value.code == "PROMPT_DRAFT_ALREADY_EXISTS"

                v2_edited = update_platform_prompt_version_draft(
                    db=db,
                    version_id=v2_draft.id,
                    payload=PlatformPromptVersionDraftUpdate(
                        expected_revision=v2_draft.revision,
                        template_markdown="你是电子元器件专栏编辑（v2 正式结构化风格）。",
                        change_summary="补充问答小节要求",
                    ),
                    actor=admin,
                    request_id="req-3a-v2-edit",
                )
                assert v2_edited.revision == 1

                v2_pub = transition_platform_prompt_version(
                    db=db,
                    version_id=v2_draft.id,
                    expected_revision=v2_edited.revision,
                    action="publish",
                    actor=admin,
                    request_id="req-3a-v2-pub",
                )
                assert v2_pub.status == "PUBLISHED"

                # 3. 验证 PG 触发器禁止原地修改已发布 Prompt 版本正文与禁止直接 DELETE
                with pytest.raises(DBAPIError) as immut_err:
                    db.execute(
                        text(
                            "UPDATE platform_prompt_versions "
                            "SET template_markdown = '篡改正文', revision = revision + 1 "
                            "WHERE id = :id"
                        ),
                        {"id": v2_pub.id},
                    )
                assert getattr(immut_err.value.orig, "sqlstate", None) == "55000"
                db.rollback()

                with pytest.raises(DBAPIError) as del_err:
                    db.execute(
                        text("DELETE FROM platform_prompt_versions WHERE id = :id"),
                        {"id": v2_pub.id},
                    )
                assert getattr(del_err.value.orig, "sqlstate", None) == "55000"
                db.rollback()

                # 4. 平台显式绑定 v2 -> 已绑定版本禁止归档 -> 一键回滚至 v1 -> 归档 v2 成功
                binding_before = get_platform_prompt_binding(db, platform.id)
                bound_v2 = bind_platform_prompt_version(
                    db=db,
                    platform_profile_id=platform.id,
                    payload=PlatformPromptVersionBindCommand(
                        expected_revision=binding_before.platform_revision,
                        platform_prompt_version_id=v2_pub.id,
                    ),
                    actor=admin,
                    request_id="req-3a-bind-v2",
                )
                assert bound_v2.bound_version is not None
                assert bound_v2.bound_version.id == v2_pub.id

                with pytest.raises(AppError) as bound_arch_err:
                    transition_platform_prompt_version(
                        db=db,
                        version_id=v2_pub.id,
                        expected_revision=v2_pub.revision,
                        action="archive",
                        actor=admin,
                        request_id="req-3a-arch-bound",
                    )
                assert bound_arch_err.value.code == "PROMPT_VERSION_BOUND"

                # 回滚至 v1
                rolled_back = bind_platform_prompt_version(
                    db=db,
                    platform_profile_id=platform.id,
                    payload=PlatformPromptVersionBindCommand(
                        expected_revision=bound_v2.platform_revision,
                        platform_prompt_version_id=v1.id,
                    ),
                    actor=admin,
                    request_id="req-3a-rollback-v1",
                )
                assert rolled_back.bound_version is not None
                assert rolled_back.bound_version.id == v1.id

                v2_archived = transition_platform_prompt_version(
                    db=db,
                    version_id=v2_pub.id,
                    expected_revision=v2_pub.revision,
                    action="archive",
                    actor=admin,
                    request_id="req-3a-arch-v2",
                )
                assert v2_archived.status == "ARCHIVED"

                # 禁止归档最后一个已发布版本（解绑/无绑定都不允许把模板置空为无 PUBLISHED）
                extra_prompt = create_platform_prompt(
                    db=db,
                    payload=PlatformPromptCreate(
                        name="单版本归档保护 Prompt",
                        template_markdown="# 唯一发布版",
                    ),
                    actor=admin,
                    request_id="req-3a-single-prompt",
                )
                extra_versions = list_platform_prompt_versions(db, extra_prompt.id)
                assert len(extra_versions.items) == 1
                with pytest.raises(AppError) as last_pub_err:
                    transition_platform_prompt_version(
                        db=db,
                        version_id=extra_versions.items[0].id,
                        expected_revision=extra_versions.items[0].revision,
                        action="archive",
                        actor=admin,
                        request_id="req-3a-arch-last",
                    )
                assert last_pub_err.value.code == "LAST_PUBLISHED_PROMPT_VERSION"

                # 已归档版本不可绑定（服务层 409）
                with pytest.raises(AppError) as bind_arch_err:
                    bind_platform_prompt_version(
                        db=db,
                        platform_profile_id=platform.id,
                        payload=PlatformPromptVersionBindCommand(
                            expected_revision=rolled_back.platform_revision,
                            platform_prompt_version_id=v2_pub.id,
                        ),
                        actor=admin,
                        request_id="req-3a-bind-archived",
                    )
                assert bind_arch_err.value.code == "INVALID_STATE_TRANSITION"

                # 4b. 验证新增审计动作可被 audit_logs 正常投影（避免 AUDIT_PROJECTION_FAILED）
                from app.audit_types import AuditModule
                from app.services.audit_logs import list_audit_logs

                audit_page = list_audit_logs(
                    db=db,
                    created_from=None,
                    created_to=None,
                    actor_id=None,
                    business_module=AuditModule.CONFIGURATION,
                    action=None,
                    target_type=None,
                    target_id=None,
                    outcome=None,
                    request_id=None,
                    keyword=None,
                    page=1,
                    page_size=50,
                )
                recorded_actions = {row.action for row in audit_page.items}
                assert "platform_prompt_version.published" in recorded_actions
                assert "platform_prompt_version.archived" in recorded_actions
                assert "platform_profile.prompt_version_bound" in recorded_actions

                # 5. Brief 注入 AI（v4）使用回滚后的 v1 正文，且严禁泄露内部溯源字段
                channel = AIChannel(
                    name="3A 测试渠道",
                    description="",
                    protocol_type="openai-compatible-chat-completions",
                    provider_brand="OPENAI",
                    base_url="https://api.example.invalid/v1",
                    api_key_ciphertext="enc-3a",
                    api_key_updated_at=datetime.now(UTC),
                    timeout_seconds=30,
                    is_enabled=True,
                    created_by=admin.id,
                )
                db.add(channel)
                db.flush()
                model = AIModel(
                    channel_id=channel.id,
                    display_name="3A Model",
                    model_id="gpt-4o-mini",
                    request_parameters={},
                    is_enabled=True,
                    test_status="PASSED",
                    created_by=admin.id,
                )
                db.add(model)
                db.commit()

                task = create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=product.id,
                        fact_version_id=approved_fact.id,
                        platform_profile_id=platform.id,
                        query_topic_id=topic.id,
                        brief=ContentBriefInput(
                            target_question=topic.canonical_question,
                            search_intent=IntentType.REPLACEMENT,
                            content_angle="3A 实测对比",
                            must_answer_questions=["输入电压范围？"],
                            required_fact_points=["5.5V-36V"],
                            forbidden_expressions=["无条件替代"],
                            target_keywords=["TPS5430"],
                        ),
                    ),
                    actor=admin,
                    request_id="req-3a-task",
                    idempotency_key="task-3a-brief-v4-001",
                )
                prompt_row = db.get(PlatformPrompt, created_prompt.id)
                assert prompt_row is not None
                task_row = db.get(ContentTask, task.id)
                assert task_row is not None
                # 校验 P1-1：携带过期绑定版本 ID（v2）时必须报 409 PLATFORM_PROMPT_CHANGED
                with pytest.raises(AppError) as stale_ver_err:
                    build_generation_input(
                        db=db,
                        task=task_row,
                        model=model,
                        platform_prompt_id=prompt_row.id,
                        platform_prompt_revision=prompt_row.revision,
                        platform_prompt_version_id=v2_pub.id,
                    )
                assert stale_ver_err.value.code == "PLATFORM_PROMPT_CHANGED"

                snapshot = build_generation_input(
                    db=db,
                    task=task_row,
                    model=model,
                    platform_prompt_id=prompt_row.id,
                    platform_prompt_revision=prompt_row.revision,
                    platform_prompt_version_id=v1.id,
                )
                assert snapshot["contract_version"] == "content-markdown-v4"
                assert snapshot["platform_prompt"]["version_id"] == str(v1.id)
                assert snapshot["platform_prompt"]["version"] == 1
                assert "v1 风格" in snapshot["system_message"]
                assert "3A 实测对比" in snapshot["user_message"]
                assert "华东工业市场" in snapshot["user_message"]
                assert "禁止承诺免测试直接替换" in snapshot["user_message"]
                assert "内部研发张工" not in str(snapshot)
                assert "INTERNAL-REF-3A" not in str(snapshot)

                # 6. 验证按版本效果统计（首审通过率、人工修订数、已发布数与 GEO 指标）与删除保护
                job = GenerationJob(
                    content_task_id=task.id,
                    idempotency_key="gen-job-3a-0001",
                    job_type="GENERATE",
                    status="SUCCEEDED",
                    input_snapshot=snapshot,
                    ai_channel_id=channel.id,
                    ai_model_id=model.id,
                    platform_prompt_version_id=v1.id,
                    adapter_name="openai-compatible-chat-completions",
                    prompt_template_version="content-markdown-v4",
                    prompt_hash="a" * 64,
                    created_by=admin.id,
                )
                db.add(job)
                db.flush()
                cv = ContentVersion(
                    task_id=task.id,
                    fact_version_id=approved_fact.id,
                    source_job_id=job.id,
                    version=1,
                    source_type="AI",
                    title="TPS5430 国产选型",
                    summary="摘要",
                    body_markdown="# 正文",
                    tags=["DC-DC"],
                    content_hash="f" * 64,
                    status="PENDING_REVIEW",
                    change_summary="AI 生成",
                    created_by=admin.id,
                )
                db.add(cv)
                db.flush()
                job.content_version_id = cv.id
                task_row.current_content_version_id = cv.id
                db.commit()

                transition_content_version(
                    db=db,
                    content_version_id=cv.id,
                    expected_revision=0,
                    comment="首审通过",
                    actor=admin,
                    request_id="req-3a-approve",
                    action="approve",
                )
                now = datetime.now(UTC)
                account = PlatformAccount(
                    platform_profile_id=platform.id,
                    label="3A 官方号",
                    account_identifier="acct-3a",
                )
                db.add(account)
                db.flush()
                work = PublicationWork(
                    idempotency_key="pub-work-3a-001",
                    content_task_id=task.id,
                    content_version_id=cv.id,
                    platform_profile_id=platform.id,
                    platform_profile_id_snapshot=platform.id,
                    platform_profile_name_snapshot=platform.name,
                    platform_account_id=account.id,
                    platform_account_label_snapshot=account.label,
                    account_identifier_snapshot=account.account_identifier,
                    content_hash=cv.content_hash,
                    status="PREPARING",
                    created_by=admin.id,
                )
                db.add(work)
                db.flush()
                work.actual_title = cv.title
                work.final_url = "https://example.invalid/3a"
                work.published_at = now
                work.status = "AWAITING_VERIFICATION"
                work.revision += 1
                db.flush()
                ver = PublicationVerification(
                    publication_work_id=work.id,
                    content_version_id=cv.id,
                    outcome="PASSED",
                    actual_title_snapshot=cv.title,
                    final_url_snapshot="https://example.invalid/3a",
                    published_at_snapshot=now,
                    comment="通过",
                    actor_id=admin.id,
                )
                db.add(ver)
                db.flush()
                work.status = "COMPLETED"
                work.revision += 1
                task_row.status = "COMPLETED"
                task_row.revision += 1
                db.add(PublishedArticle(id=work.id, verification_id=ver.id))
                db.flush()
                obs = GeoObservation(
                    observation_kind="MANUAL_ARTICLE_SEARCH",
                    query_topic_id=topic.id,
                    product_id=product.id,
                    search_platform="DeepSeek",
                    search_query="TPS5430 国产替代",
                    tested_at=now,
                    notes="测试",
                    tested_by=admin.id,
                )
                db.add(obs)
                db.flush()
                db.add(
                    GeoObservationPublication(
                        observation_id=obs.id,
                        published_article_id=work.id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    )
                )
                db.add(
                    GeoObservationCitation(
                        observation_id=obs.id,
                        url="https://example.invalid/3a",
                        source_type="OWN_ARTICLE",
                        published_article_id=work.id,
                    )
                )
                db.commit()

                metrics_list = list_platform_prompt_versions(db, created_prompt.id)
                v1_metrics = next(item for item in metrics_list.items if item.id == v1.id).metrics
                assert v1_metrics.generation_job_count == 1
                assert v1_metrics.succeeded_job_count == 1
                assert v1_metrics.first_pass_approval_rate == 1.0
                assert v1_metrics.avg_human_revisions == 0.0
                assert v1_metrics.published_article_count == 1
                assert v1_metrics.geo_observation_count == 1
                assert v1_metrics.geo_mention_rate == 1.0
                assert v1_metrics.geo_citation_rate == 1.0

                # 已被生成作业引用的 Prompt 禁止删除
                prompt_row = db.get(PlatformPrompt, created_prompt.id)
                assert prompt_row is not None
                with pytest.raises(AppError) as in_use_err:
                    delete_platform_prompt(
                        db=db,
                        platform_prompt_id=created_prompt.id,
                        expected_revision=prompt_row.revision,
                        actor=admin,
                        request_id="req-3a-del-used",
                    )
                assert in_use_err.value.code == "PLATFORM_PROMPT_IN_USE"

                # 7. USER_IN_USE 护栏验证：仅作为 PromptVersion.created_by 时禁止物理删除
                prompt_author = User(
                    username="prompt_author_3a",
                    display_name="模板作者",
                    password_hash=admin.password_hash,
                    account_type="ADMIN",
                    is_active=True,
                    must_change_password=False,
                )
                db.add(prompt_author)
                db.commit()
                create_platform_prompt_version(
                    db=db,
                    platform_prompt_id=created_prompt.id,
                    payload=PlatformPromptVersionCreate(
                        template_markdown="第三版草稿",
                        publish_immediately=False,
                    ),
                    actor=prompt_author,
                    request_id="req-3a-author-v3",
                )
                prompt_author.is_active = False
                db.commit()
                with pytest.raises(AppError) as user_err:
                    delete_user(
                        db=db,
                        user_id=prompt_author.id,
                        expected_revision=prompt_author.revision,
                        actor=admin,
                        request_id="req-3a-del-author",
                    )
                assert user_err.value.code == "USER_IN_USE"

                # 8. 0075 downgrade 必须以 55000 拒绝
                monkeypatch.setenv("DATABASE_URL", database_url)
                monkeypatch.setattr(settings, "database_url", database_url)
                backend_dir = Path(__file__).resolve().parents[2]
                cfg = Config(str(backend_dir / "alembic.ini"))
                cfg.set_main_option("script_location", str(backend_dir / "alembic"))
                cfg.set_main_option("sqlalchemy.url", database_url)
                with pytest.raises(DBAPIError) as down_err:
                    command.downgrade(cfg, "0074_assignments_sla_inbox")
                assert getattr(down_err.value.orig, "sqlstate", None) == "55000"
                assert db.scalar(select(PlatformPromptVersion.id).limit(1)) is not None
        finally:
            engine.dispose()
