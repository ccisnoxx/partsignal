"""Slice 2C PostgreSQL 集成测试：批量规划预览、原子提交、幂等回执与删除护栏。"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, delete, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from alembic import command
from app.config import settings
from app.errors import AppError
from app.models.content import ContentBriefSnapshot, ContentTask, ContentTaskBatchRequest
from app.models.identity import AuditLog, User
from app.models.publication import (
    PlatformAccount,
    PublicationVerification,
    PublicationWork,
    PublishedArticle,
)
from app.schemas.campaign import ContentCampaignCreate
from app.schemas.configuration import IntentType
from app.schemas.content import ContentBriefInput
from app.schemas.content_batch import (
    ContentTaskBatchCellInput,
    ContentTaskBatchCreateRequest,
    ContentTaskBatchPreviewRequest,
)
from app.services.content_batch_planning import (
    create_content_task_batch,
    preview_content_task_batch,
)
from app.services.content_campaigns import create_content_campaign, delete_content_campaign
from app.services.identity import delete_user
from tests.integration.test_content_planning_layer import _seed_entities
from tests.integration.test_publication_workflow import temporary_database


def _brief(question: str, angle: str) -> ContentBriefInput:
    return ContentBriefInput(
        target_question=question,
        search_intent=IntentType.REPLACEMENT,
        content_angle=angle,
        target_audience="电源硬件工程师",
        forbidden_expressions=["免验证直接替换"],
    )


@pytest.mark.integration
def test_0073_batch_preview_atomic_commit_idempotency_and_guards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证 0073 预览分流、整批回滚、告警确认、原子提交、幂等重放/冲突、不可变回执及删除护栏。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            env = _seed_entities(db, suffix="2c1")
            env2 = _seed_entities(db, suffix="2c2")
            admin: User = env["admin"]  # type: ignore[assignment]
            owner: User = env["owner"]  # type: ignore[assignment]
            product = env["product"]
            fact = env["fact"]
            platform = env["platform"]
            topic = env["topic"]
            other_platform = env2["platform"]

            # 设置事实过期触发 FACT_OVERDUE，平台未绑定 Prompt 触发 PLATFORM_MISSING_PROMPT
            product.next_review_at = datetime.now(UTC) - timedelta(days=2)
            db.commit()

            campaign = create_content_campaign(
                db=db,
                payload=ContentCampaignCreate(
                    name="2C 批量规划活动",
                    owner_id=owner.id,
                    priority="HIGH",
                    product_ids=[product.id],
                    query_topic_ids=[topic.id],
                    platform_profile_ids=[platform.id],
                ),
                actor=admin,
                request_id="req-2c-camp",
            )

            # 1. 预览：校验 DUPLICATE_IN_BATCH / CAMPAIGN_SCOPE_MISMATCH 阻断与软告警
            bad_preview = preview_content_task_batch(
                db=db,
                payload=ContentTaskBatchPreviewRequest(
                    campaign_id=campaign.id,
                    cells=[
                        ContentTaskBatchCellInput(
                            product_id=product.id,
                            query_topic_id=topic.id,
                            platform_profile_id=platform.id,
                            brief=_brief(topic.canonical_question, "选型指南"),
                        ),
                        ContentTaskBatchCellInput(
                            product_id=product.id,
                            query_topic_id=topic.id,
                            platform_profile_id=platform.id,
                            brief=_brief(topic.canonical_question, "  选型指南  "),
                        ),
                        ContentTaskBatchCellInput(
                            product_id=product.id,
                            query_topic_id=topic.id,
                            platform_profile_id=other_platform.id,
                            brief=_brief(topic.canonical_question, "参数对比"),
                        ),
                    ],
                ),
            )
            assert bad_preview.total_cells == 3
            assert bad_preview.blocker_cell_count == 2
            assert bad_preview.warning_cell_count == 1
            assert bad_preview.can_commit is False
            assert bad_preview.cells[0].status == "WARNING"
            assert {w.code for w in bad_preview.cells[0].warnings} >= {
                "FACT_OVERDUE",
                "PLATFORM_MISSING_PROMPT",
            }
            assert bad_preview.cells[0].resolved_fact_version_id == fact.id
            assert any(b.code == "DUPLICATE_IN_BATCH" for b in bad_preview.cells[1].blockers)
            assert any(b.code == "CAMPAIGN_SCOPE_MISMATCH" for b in bad_preview.cells[2].blockers)

            # 2. 硬阻断整批回滚：不能产生任何任务或回执
            with pytest.raises(AppError) as blocked_err:
                create_content_task_batch(
                    db=db,
                    payload=ContentTaskBatchCreateRequest(
                        campaign_id=campaign.id,
                        cells=[
                            ContentTaskBatchCellInput(
                                product_id=product.id,
                                query_topic_id=topic.id,
                                platform_profile_id=platform.id,
                                brief=_brief(topic.canonical_question, "选型指南"),
                            ),
                            ContentTaskBatchCellInput(
                                product_id=product.id,
                                query_topic_id=topic.id,
                                platform_profile_id=other_platform.id,
                                brief=_brief(topic.canonical_question, "参数对比"),
                            ),
                        ],
                        acknowledge_warnings=True,
                    ),
                    actor=admin,
                    request_id="req-2c-blocked",
                    idempotency_key="batch-key-blocked-001",
                )
            assert blocked_err.value.code == "BATCH_PLANNING_BLOCKED"
            existing_task = db.scalar(
                select(ContentTask).where(ContentTask.campaign_id == campaign.id)
            )
            assert existing_task is None
            assert db.scalar(select(ContentTaskBatchRequest)) is None

            # 3. 存在软告警但未确认：整批回滚 BATCH_WARNINGS_UNACKNOWLEDGED
            two_angle_cells = [
                ContentTaskBatchCellInput(
                    product_id=product.id,
                    query_topic_id=topic.id,
                    platform_profile_id=platform.id,
                    brief=_brief(topic.canonical_question, "选型指南"),
                ),
                ContentTaskBatchCellInput(
                    product_id=product.id,
                    query_topic_id=topic.id,
                    platform_profile_id=platform.id,
                    brief=_brief(topic.canonical_question, "应用排障"),
                ),
            ]
            with pytest.raises(AppError) as warn_err:
                create_content_task_batch(
                    db=db,
                    payload=ContentTaskBatchCreateRequest(
                        campaign_id=campaign.id,
                        cells=two_angle_cells,
                        acknowledge_warnings=False,
                    ),
                    actor=admin,
                    request_id="req-2c-unack",
                    idempotency_key="batch-key-commit-001",
                )
            assert warn_err.value.code == "BATCH_WARNINGS_UNACKNOWLEDGED"
            assert db.scalar(select(ContentTaskBatchRequest)) is None

            # 4. 确认告警后原子创建（不同角度在同产品/主题/平台并存）+ 不可变 Brief + 审计
            created = create_content_task_batch(
                db=db,
                payload=ContentTaskBatchCreateRequest(
                    campaign_id=campaign.id,
                    cells=two_angle_cells,
                    acknowledge_warnings=True,
                ),
                actor=admin,
                request_id="req-2c-commit",
                idempotency_key="batch-key-commit-001",
            )
            assert created.replayed is False
            assert created.created_count == 2
            assert len(created.tasks) == 2
            for task_out in created.tasks:
                snap = db.get(ContentBriefSnapshot, task_out.id)
                assert snap is not None
                assert snap.query_topic_id == topic.id

            audit = db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "content_task.batch_created",
                    AuditLog.target_id == str(created.batch_request_id),
                )
            )
            assert audit is not None
            assert audit.details["facts"]["created_count"] == 2
            assert audit.details["facts"]["acknowledged_warnings"] is True

            # 5. 同键同载荷幂等重放 -> replayed=True；同键异载荷 -> 409 IDEMPOTENCY_CONFLICT
            replayed = create_content_task_batch(
                db=db,
                payload=ContentTaskBatchCreateRequest(
                    campaign_id=campaign.id,
                    cells=two_angle_cells,
                    acknowledge_warnings=True,
                ),
                actor=admin,
                request_id="req-2c-replay",
                idempotency_key="batch-key-commit-001",
            )
            assert replayed.replayed is True
            assert replayed.batch_request_id == created.batch_request_id
            assert [t.id for t in replayed.tasks] == [t.id for t in created.tasks]

            with pytest.raises(AppError) as conflict_err:
                create_content_task_batch(
                    db=db,
                    payload=ContentTaskBatchCreateRequest(
                        campaign_id=campaign.id,
                        cells=[two_angle_cells[0]],
                        acknowledge_warnings=True,
                    ),
                    actor=admin,
                    request_id="req-2c-conflict",
                    idempotency_key="batch-key-commit-001",
                )
            assert conflict_err.value.code == "IDEMPOTENCY_CONFLICT"

            # 6. 再次预览同三元组新角度：检测到 EXISTING_ACTIVE_TASK 软告警
            #    并验证近期已核验发布文章触发 RECENT_PUBLISHED_ARTICLE 软告警
            now = datetime.now(UTC)
            account = PlatformAccount(
                platform_profile_id=platform.id,
                label="测试发布号",
                account_identifier="acct-2c",
            )
            db.add(account)
            db.flush()
            from app.models.content import ContentVersion

            cv = ContentVersion(
                task_id=created.tasks[0].id,
                fact_version_id=fact.id,
                version=1,
                source_type="MANUAL",
                title="TPS5430 国产替代指南",
                summary="摘要",
                body_markdown="# 正文",
                tags=["DC-DC"],
                content_hash="a" * 64,
                status="APPROVED",
                change_summary="首稿",
                created_by=admin.id,
            )
            db.add(cv)
            db.flush()
            task0 = db.get(ContentTask, created.tasks[0].id)
            assert task0 is not None
            task0.current_content_version_id = cv.id
            db.flush()
            work = PublicationWork(
                idempotency_key="pub-work-2c-001",
                content_task_id=created.tasks[0].id,
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
            work.final_url = "https://example.invalid/articles/2c"
            work.published_at = now
            work.status = "AWAITING_VERIFICATION"
            work.revision += 1
            db.flush()
            ver = PublicationVerification(
                publication_work_id=work.id,
                content_version_id=cv.id,
                outcome="PASSED",
                actual_title_snapshot=cv.title,
                final_url_snapshot="https://example.invalid/articles/2c",
                published_at_snapshot=now,
                comment="核验通过",
                actor_id=admin.id,
            )
            db.add(ver)
            db.flush()
            work.status = "COMPLETED"
            work.revision += 1
            task0.status = "COMPLETED"
            task0.revision += 1
            db.add(PublishedArticle(id=work.id, verification_id=ver.id))
            db.commit()

            third_preview = preview_content_task_batch(
                db=db,
                payload=ContentTaskBatchPreviewRequest(
                    campaign_id=campaign.id,
                    cells=[
                        ContentTaskBatchCellInput(
                            product_id=product.id,
                            query_topic_id=topic.id,
                            platform_profile_id=platform.id,
                            brief=_brief(topic.canonical_question, "热设计注意事项"),
                        )
                    ],
                ),
            )
            warning_codes = {w.code for w in third_preview.cells[0].warnings}
            assert "EXISTING_ACTIVE_TASK" in warning_codes
            assert "RECENT_PUBLISHED_ARTICLE" in warning_codes

            # 7. 数据库触发器保护 content_task_batch_requests 禁止 UPDATE / DELETE
            with pytest.raises(DBAPIError) as upd_err:
                db.execute(
                    text(
                        "UPDATE content_task_batch_requests SET campaign_id = NULL WHERE id = :id"
                    ),
                    {"id": created.batch_request_id},
                )
            assert getattr(upd_err.value.orig, "sqlstate", None) == "55000"
            db.rollback()

            with pytest.raises(DBAPIError) as del_err:
                db.execute(
                    delete(ContentTaskBatchRequest).where(
                        ContentTaskBatchRequest.id == created.batch_request_id
                    )
                )
            assert getattr(del_err.value.orig, "sqlstate", None) == "55000"
            db.rollback()

            # 8. 草稿活动受任务/批量回执阻断，用户删除受 USER_IN_USE 阻断
            with pytest.raises(AppError) as camp_del_err:
                delete_content_campaign(
                    db=db,
                    campaign_id=campaign.id,
                    expected_revision=campaign.revision,
                    actor=admin,
                    request_id="req-2c-camp-del",
                )
            assert camp_del_err.value.code == "CONTENT_CAMPAIGN_IN_USE"

            # 用单独停用账号验证仅持有 batch receipt 也触发 USER_IN_USE
            batch_only_user = User(
                username="batch_only_2c",
                display_name="批量操作员",
                password_hash=admin.password_hash,
                account_type="ENGINEER",
                is_active=False,
                must_change_password=False,
            )
            db.add(batch_only_user)
            db.flush()
            db.add(
                ContentTaskBatchRequest(
                    created_by=batch_only_user.id,
                    request_key_sha256="1" * 64,
                    request_sha256="2" * 64,
                    campaign_id=None,
                    task_ids=[created.tasks[0].id],
                )
            )
            db.commit()
            with pytest.raises(AppError) as user_del_err:
                delete_user(
                    db=db,
                    user_id=batch_only_user.id,
                    expected_revision=batch_only_user.revision,
                    actor=admin,
                    request_id="req-2c-user-del",
                )
            assert user_del_err.value.code == "USER_IN_USE"

            # 9. 0073 downgrade 必须以 55000 拒绝
            monkeypatch.setenv("DATABASE_URL", database_url)
            monkeypatch.setattr(settings, "database_url", database_url)
            cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
            cfg.set_main_option("sqlalchemy.url", database_url)
            with pytest.raises(DBAPIError) as down_err:
                command.downgrade(cfg, "0072_content_planning_layer")
            assert getattr(down_err.value.orig, "sqlstate", None) == "55000"
