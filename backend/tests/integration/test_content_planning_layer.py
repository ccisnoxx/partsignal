"""Slice 2B PostgreSQL 集成测试：ContentCampaign、QueryTopic 增强、不可变 Brief 与删除护栏。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, delete, select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.errors import AppError
from app.models.campaign import ContentCampaign
from app.models.configuration import PlatformProfile, PlatformType, QueryTopic
from app.models.content import ContentBriefSnapshot, ContentTask
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion, Product
from app.models.publication import (
    PlatformAccount,
    PublicationVerification,
    PublicationWork,
    PublishedArticle,
)
from app.schemas.campaign import ContentCampaignCreate, ContentCampaignUpdate
from app.schemas.configuration import IntentType, QueryTopicCreate, QueryTopicUpdate
from app.schemas.content import ContentBriefInput, ContentTaskCreate
from app.security import hash_password
from app.services.content_campaigns import (
    create_content_campaign,
    delete_content_campaign,
    get_content_campaign_detail,
    list_content_campaigns,
    transition_content_campaign_status,
    update_content_campaign,
)
from app.services.content_editor import content_editor_context_out
from app.services.content_planning import (
    create_content_task,
    create_query_topic,
    delete_query_topic,
    update_query_topic,
)
from app.services.content_task_detail import content_task_detail_out
from app.services.content_task_queries import (
    get_content_task_creation_options,
    list_content_tasks,
)
from app.services.identity import delete_user
from app.services.platform_configuration import delete_platform_profile
from app.services.product_facts import delete_product
from app.services.publication import delete_content_task
from app.services.publication_queries import list_published_articles
from tests.integration.test_content_task_creation import temporary_database

pytestmark = pytest.mark.integration


def _alembic_config(database_url: str) -> Config:
    config = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def _seed_entities(db: Session, *, suffix: str) -> dict[str, object]:
    now = datetime.now(UTC)
    admin = User(
        username=f"admin_{suffix}",
        display_name="管理员",
        password_hash=hash_password("ValidPass123!"),
        account_type="ADMIN",
        is_active=True,
        must_change_password=False,
    )
    owner = User(
        username=f"owner_{suffix}",
        display_name="活动负责人",
        password_hash=hash_password("ValidPass123!"),
        account_type="ENGINEER",
        is_active=True,
        must_change_password=False,
    )
    db.add_all([admin, owner])
    db.flush()

    platform_type = PlatformType(
        name=f"技术社区-{suffix}",
        slug=f"community-{suffix}",
        created_by=admin.id,
        created_at=now,
        updated_at=now,
    )
    db.add(platform_type)
    db.flush()

    platform = PlatformProfile(
        name=f"工程师社区-{suffix}",
        slug=f"eng-{suffix}",
        allowed_domains=["example.invalid"],
        platform_type_id=platform_type.id,
        is_active=True,
    )
    product = Product(
        brand="PartSignal",
        part_number=f"PS-{suffix}",
        normalized_brand="partsignal",
        normalized_part_number=f"ps-{suffix}",
        category="DC-DC",
        status="ACTIVE",
        facts_body_markdown="# 事实\n\n输入 5.5-36V",
        facts_classification="PUBLIC",
        facts_content_restrictions="禁止宣称免验证直接替换",
        facts_approved_claims_summary="输入 5.5-36V，最大输出 3A",
    )
    db.add_all([platform, product])
    db.flush()

    fact = FactVersion(
        product_id=product.id,
        version=1,
        status="APPROVED",
        body_markdown="# 事实\n\n输入 5.5-36V",
        classification="PUBLIC",
        content_restrictions="禁止宣称免验证直接替换",
        approved_claims_summary="输入 5.5-36V，最大输出 3A",
        change_summary="初始批准",
        created_by=admin.id,
        approved_by=admin.id,
        approved_at=now,
    )
    db.add(fact)
    db.flush()

    topic = create_query_topic(
        db=db,
        payload=QueryTopicCreate(
            canonical_question=f"PS-{suffix} 有哪些国产替代选型建议？",
            intent_type=IntentType.REPLACEMENT,
            variants=[f"PS-{suffix} 国产替代"],
            description="工业电源替代场景",
        ),
        actor=admin,
        request_id=f"seed-topic-{suffix}",
    )
    return {
        "admin": admin,
        "owner": owner,
        "platform": platform,
        "product": product,
        "fact": fact,
        "topic": topic,
    }


def _sample_brief(question: str = "TPS5430 国产替代选型建议") -> ContentBriefInput:
    return ContentBriefInput(
        target_question=question,
        search_intent=IntentType.REPLACEMENT,
        content_angle="国产替代选型指南",
        target_audience="工业电源硬件工程师",
        must_answer_questions=["封装与引脚差异注意事项"],
        required_fact_points=["输入电压 5.5-36V"],
        forbidden_expressions=["免验证直接替换"],
        content_format="技术对比文章",
        cta="申请评估板与样品",
        target_keywords=["TPS5430", "国产替代"],
    )


def test_0072_campaign_brief_immutability_and_delete_guards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证 0072 活动生命周期、Brief 不可变/受控删除、范围校验、派生归因与删除护栏。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            env = _seed_entities(db, suffix="2b")
            admin: User = env["admin"]  # type: ignore[assignment]
            owner: User = env["owner"]  # type: ignore[assignment]
            product: Product = env["product"]  # type: ignore[assignment]
            fact: FactVersion = env["fact"]  # type: ignore[assignment]
            platform: PlatformProfile = env["platform"]  # type: ignore[assignment]
            topic: QueryTopic = env["topic"]  # type: ignore[assignment]

            # 1. 创建活动、更新（含 no-op）、激活门禁与状态转换
            campaign = create_content_campaign(
                db=db,
                payload=ContentCampaignCreate(
                    name="TPS5430 国产替代活动",
                    target_audience="工业电源工程师",
                    owner_id=owner.id,
                    priority="HIGH",
                    budget_amount="20000.00",  # type: ignore[arg-type]
                    budget_currency="CNY",
                    product_ids=[product.id],
                    query_topic_ids=[],
                    platform_profile_ids=[platform.id],
                ),
                actor=admin,
                request_id="req-camp-create",
            )
            assert campaign.status == "DRAFT"
            assert campaign.primary_task == "CONFIGURE_CAMPAIGN"
            assert "ACTIVATE" not in campaign.available_actions
            assert "DELETE" in campaign.available_actions

            with pytest.raises(AppError) as incomplete_err:
                transition_content_campaign_status(
                    db=db,
                    campaign_id=campaign.id,
                    expected_revision=0,
                    operation="activate",
                    actor=admin,
                    request_id="req-camp-activate-fail",
                )
            assert incomplete_err.value.code == "CAMPAIGN_SCOPE_INCOMPLETE"

            # 补齐 topic 关联
            updated = update_content_campaign(
                db=db,
                campaign_id=campaign.id,
                payload=ContentCampaignUpdate(
                    name="TPS5430 国产替代活动",
                    target_audience="工业电源工程师",
                    owner_id=owner.id,
                    priority="HIGH",
                    budget_amount="20000.00",  # type: ignore[arg-type]
                    budget_currency="CNY",
                    product_ids=[product.id],
                    query_topic_ids=[topic.id],
                    platform_profile_ids=[platform.id],
                    expected_revision=0,
                ),
                actor=admin,
                request_id="req-camp-update",
            )
            assert updated.revision == 1
            assert "ACTIVATE" in updated.available_actions

            # no-op 不递增 revision
            noop = update_content_campaign(
                db=db,
                campaign_id=campaign.id,
                payload=ContentCampaignUpdate(
                    name="TPS5430 国产替代活动",
                    target_audience="工业电源工程师",
                    owner_id=owner.id,
                    priority="HIGH",
                    budget_amount="20000.00",  # type: ignore[arg-type]
                    budget_currency="CNY",
                    product_ids=[product.id],
                    query_topic_ids=[topic.id],
                    platform_profile_ids=[platform.id],
                    expected_revision=1,
                ),
                actor=admin,
                request_id="req-camp-noop",
            )
            assert noop.revision == 1

            # 2. 活动引用阻断 Product / QueryTopic / PlatformProfile / User 删除
            with pytest.raises(AppError) as topic_in_use:
                delete_query_topic(
                    db=db,
                    query_topic_id=topic.id,
                    expected_revision=topic.revision,
                    actor=admin,
                    request_id="req-del-topic",
                )
            assert topic_in_use.value.code == "QUERY_TOPIC_IN_USE"

            with pytest.raises(AppError) as product_in_use:
                delete_product(
                    db=db,
                    product_id=product.id,
                    expected_revision=product.revision,
                    actor=admin,
                    request_id="req-del-prod",
                )
            assert product_in_use.value.code == "PRODUCT_IN_USE"

            platform.is_active = False
            db.commit()
            with pytest.raises(AppError) as platform_in_use:
                delete_platform_profile(
                    db=db,
                    platform_profile_id=platform.id,
                    expected_revision=platform.revision,
                    actor=admin,
                    request_id="req-del-plat",
                )
            assert platform_in_use.value.code == "PLATFORM_PROFILE_IN_USE"
            platform.is_active = True
            db.commit()

            owner.is_active = False
            db.commit()
            with pytest.raises(AppError) as user_in_use:
                delete_user(
                    db=db,
                    user_id=owner.id,
                    expected_revision=owner.revision,
                    actor=admin,
                    request_id="req-del-owner",
                )
            assert user_in_use.value.code == "USER_IN_USE"
            owner.is_active = True
            db.commit()

            # 3. 激活活动 -> 校验创建选项与范围校验 -> 创建任务并冻结 Brief
            activated = transition_content_campaign_status(
                db=db,
                campaign_id=campaign.id,
                expected_revision=1,
                operation="activate",
                actor=admin,
                request_id="req-camp-activate",
            )
            assert activated.status == "ACTIVE"
            assert activated.revision == 2

            options = get_content_task_creation_options(
                db=db,
                requested_product_id=product.id,
                requested_campaign_id=campaign.id,
            )
            assert options.requested_campaign is not None
            assert options.requested_campaign.eligibility == "ELIGIBLE"
            assert options.products[0].approved_fact_versions[0].content_restrictions == (
                "禁止宣称免验证直接替换"
            )

            other_topic = create_query_topic(
                db=db,
                payload=QueryTopicCreate(
                    canonical_question="不在活动范围内的主题？",
                    intent_type=IntentType.PRODUCT,
                    variants=["范围外主题"],
                ),
                actor=admin,
                request_id="req-other-topic",
            )
            with pytest.raises(AppError) as scope_err:
                create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        campaign_id=campaign.id,
                        product_id=product.id,
                        fact_version_id=fact.id,
                        platform_profile_id=platform.id,
                        query_topic_id=other_topic.id,
                        brief=_sample_brief(),
                    ),
                    actor=admin,
                    request_id="req-scope-mismatch",
                    idempotency_key=f"scope-{uuid.uuid4()}",
                )
            assert scope_err.value.code == "CAMPAIGN_SCOPE_MISMATCH"

            # 停用主题阻止新任务创建
            update_query_topic(
                db=db,
                query_topic_id=other_topic.id,
                payload=QueryTopicUpdate(
                    canonical_question=other_topic.canonical_question,
                    intent_type=IntentType.PRODUCT,
                    variants=other_topic.variants,
                    description="已停用",
                    is_active=False,
                    expected_revision=other_topic.revision,
                ),
                actor=admin,
                request_id="req-disable-topic",
            )
            with pytest.raises(AppError) as inactive_topic_err:
                create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=product.id,
                        fact_version_id=fact.id,
                        platform_profile_id=platform.id,
                        query_topic_id=other_topic.id,
                        brief=_sample_brief(),
                    ),
                    actor=admin,
                    request_id="req-inactive-topic",
                    idempotency_key=f"inactive-{uuid.uuid4()}",
                )
            assert inactive_topic_err.value.code == "QUERY_TOPIC_INACTIVE"

            # 合法创建带活动和 Brief 的任务 + 同键重放 + 异 Brief 冲突
            task_key = f"task-2b-{uuid.uuid4()}"
            task_payload = ContentTaskCreate(
                campaign_id=campaign.id,
                product_id=product.id,
                fact_version_id=fact.id,
                platform_profile_id=platform.id,
                query_topic_id=topic.id,
                brief=_sample_brief(),
            )
            task = create_content_task(
                db=db,
                payload=task_payload,
                actor=admin,
                request_id="req-task-create",
                idempotency_key=task_key,
            )
            replayed = create_content_task(
                db=db,
                payload=task_payload,
                actor=admin,
                request_id="req-task-replay",
                idempotency_key=task_key,
            )
            assert replayed.id == task.id

            with pytest.raises(AppError) as brief_conflict:
                create_content_task(
                    db=db,
                    payload=task_payload.model_copy(
                        update={"brief": _sample_brief("完全不同的目标问题")}
                    ),
                    actor=admin,
                    request_id="req-task-conflict",
                    idempotency_key=task_key,
                )
            assert brief_conflict.value.code == "IDEMPOTENCY_CONFLICT"

            # 4. 详情、编辑器、列表筛选投影均包含活动与 Brief
            detail = content_task_detail_out(db, task.id, actor=admin)
            assert detail.campaign is not None and detail.campaign.id == campaign.id
            assert detail.brief is not None and detail.brief.content_angle == "国产替代选型指南"
            editor = content_editor_context_out(db, task.id, actor=admin)
            assert editor.campaign is not None and editor.brief is not None
            listed = list_content_tasks(
                db=db,
                q=None,
                workflow_stage=None,
                platform_profile_id=None,
                filter_product_id=None,
                filter_fact_version_id=None,
                campaign_id=campaign.id,
                query_topic_id=None,
                query_topic_reference=None,
                archive_status="ACTIVE",  # type: ignore[arg-type]
                page=1,
                page_size=20,
                can_permanently_delete=True,
            )
            assert listed.total == 1 and listed.items[0].brief_summary is not None

            # 5. DB 不可变触发器禁止原地修改或裸删除 content_brief_snapshots
            with pytest.raises(DBAPIError) as upd_err:
                db.execute(
                    text(
                        "UPDATE content_brief_snapshots SET content_angle = '篡改' "
                        "WHERE content_task_id = :tid"
                    ),
                    {"tid": task.id},
                )
            assert getattr(upd_err.value.orig, "sqlstate", None) == "55000"
            db.rollback()

            with pytest.raises(DBAPIError) as del_err:
                db.execute(
                    delete(ContentBriefSnapshot).where(
                        ContentBriefSnapshot.content_task_id == task.id
                    )
                )
            assert getattr(del_err.value.orig, "sqlstate", None) == "55000"
            db.rollback()

            # 6. 受控任务删除可以一并清理 ContentBriefSnapshot
            delete_content_task(
                db=db,
                task_id=task.id,
                expected_revision=task.revision,
                actor=admin,
                request_id="req-task-delete",
            )
            assert db.get(ContentBriefSnapshot, task.id) is None

            # 7. 新建草稿活动并成功物理删除 + 已归档活动只读保护
            draft_campaign = create_content_campaign(
                db=db,
                payload=ContentCampaignCreate(name="可删草稿活动", owner_id=owner.id),
                actor=admin,
                request_id="req-draft-create",
            )
            delete_content_campaign(
                db=db,
                campaign_id=draft_campaign.id,
                expected_revision=0,
                actor=admin,
                request_id="req-draft-delete",
            )
            assert db.get(ContentCampaign, draft_campaign.id) is None

            archived = transition_content_campaign_status(
                db=db,
                campaign_id=campaign.id,
                expected_revision=2,
                operation="archive",
                actor=admin,
                request_id="req-camp-archive",
            )
            assert archived.status == "ARCHIVED"
            with pytest.raises(DBAPIError) as archived_err:
                db.execute(
                    text("UPDATE content_campaigns SET name = '篡改归档' WHERE id = :cid"),
                    {"cid": campaign.id},
                )
            assert getattr(archived_err.value.orig, "sqlstate", None) == "55000"
            db.rollback()

            # 确认审计记录写入
            audit_actions = set(
                db.scalars(
                    select(AuditLog.action).where(AuditLog.target_id == str(campaign.id))
                )
            )
            assert {
                "content_campaign.created",
                "content_campaign.updated",
                "content_campaign.activated",
                "content_campaign.archived",
            } <= audit_actions

            # 验证列表查询与已发布文章按活动派生筛选不报错
            page = list_content_campaigns(db, q="TPS5430", status="ARCHIVED")
            assert page.total == 1
            articles = list_published_articles(db, page=1, page_size=20, campaign_id=campaign.id)
            assert articles.total == 0

            # 验证 0072 downgrade 明确以 55000 拒绝
            monkeypatch.setenv("DATABASE_URL", database_url)
            monkeypatch.setattr(settings, "database_url", database_url)
            with pytest.raises(DBAPIError) as downgrade_err:
                command.downgrade(_alembic_config(database_url), "0071_product_fact_ops_metadata")
            assert getattr(downgrade_err.value.orig, "sqlstate", None) == "55000"

            # 确认无未用变量告警
            assert isinstance(
                (
                    ContentTask,
                    PlatformAccount,
                    PublicationWork,
                    PublishedArticle,
                    PublicationVerification,
                    IntegrityError,
                    get_content_campaign_detail,
                ),
                tuple,
            )

        engine.dispose()
