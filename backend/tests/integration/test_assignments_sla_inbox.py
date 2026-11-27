"""Slice 2D PostgreSQL 集成测试：5 聚合分派/SLA、终态冻结触发器、流转交接与运营收件箱。"""

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
from app.models.content import ContentTask, ContentVersion
from app.models.geo_opportunities import GeoOpportunity
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion
from app.models.publication import (
    PlatformAccount,
    PublicationVerification,
    PublicationWork,
    PublishedArticle,
    PublishedContentIssue,
)
from app.schemas.configuration import IntentType
from app.schemas.content import ContentBriefInput, ContentTaskCreate
from app.schemas.work_assignment import WorkAssignmentUpdate
from app.services.content_planning import create_content_task
from app.services.identity import delete_user
from app.services.review import transition_content_version, transition_fact_version
from app.services.work_assignments import (
    get_work_assignment,
    list_assignable_users,
    update_work_assignment,
)
from app.services.workbench_inbox import get_workbench_inbox
from tests.integration.test_content_planning_layer import _seed_entities
from tests.integration.test_geo_opportunity_workbench import (
    PATH as GEO_OPPORTUNITY_PATH,
)
from tests.integration.test_geo_opportunity_workbench import (
    analysis_engine,
    answer_database,
    api,
    harness,
    opportunity,
    overview_api,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.test_publication_workflow import temporary_database

__all__ = [
    "analysis_engine",
    "answer_database",
    "api",
    "harness",
    "overview_api",
    "plan_database",
    "review_api",
    "run_database",
]


@pytest.mark.integration
def test_0074_assignments_sla_freeze_triggers_handoff_and_inbox(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证 0074 五类聚合分派/SLA、终态冻结、流转改派、8 分桶收件箱、USER_IN_USE 与降级拒止。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            env = _seed_entities(db, suffix="2d")
            admin: User = env["admin"]  # type: ignore[assignment]
            owner: User = env["owner"]  # type: ignore[assignment]
            product = env["product"]
            approved_fact = env["fact"]
            platform = env["platform"]
            topic = env["topic"]

            # 停用用户（不可被分派，用于校验 422）
            disabled_user = User(
                username="disabled_2d",
                display_name="停用成员",
                password_hash=admin.password_hash,
                account_type="ENGINEER",
                is_active=False,
                must_change_password=False,
            )
            db.add(disabled_user)
            db.flush()

            now = datetime.now(UTC)
            overdue_dt = now - timedelta(hours=3)
            today_later_dt = now + timedelta(minutes=20)

            # 创建待审核 FactVersion v2
            pending_fact = FactVersion(
                product_id=product.id,
                version=2,
                status="PENDING_REVIEW",
                body_markdown="# 待审事实 v2",
                classification="PUBLIC",
                change_summary="补充温度参数",
                created_by=admin.id,
            )
            db.add(pending_fact)
            # 令产品事实复核也到期，验证 needs_fix / overdue 收录 OVERDUE_FACT
            product.next_review_at = overdue_dt
            db.commit()

            # 1. 可分派成员列表只返回活跃 ADMIN/ENGINEER
            assignees = list_assignable_users(db)
            assignee_ids = {item.id for item in assignees.items}
            assert admin.id in assignee_ids and owner.id in assignee_ids
            assert disabled_user.id not in assignee_ids

            # 2. 停用用户不能作为受派人
            with pytest.raises(AppError) as disabled_err:
                update_work_assignment(
                    db=db,
                    target_type="FactVersion",
                    target_id=pending_fact.id,
                    payload=WorkAssignmentUpdate(
                        expected_revision=0,
                        assignee_id=disabled_user.id,
                    ),
                    actor=owner,
                    request_id="req-2d-disabled",
                )
            assert disabled_err.value.code == "VALIDATION_ERROR"

            # 3. FactVersion（PENDING_REVIEW）软归属分派 + no-op 不递增版本 + 审计不泄露阻塞文本
            fact_assigned = update_work_assignment(
                db=db,
                target_type="FactVersion",
                target_id=pending_fact.id,
                payload=WorkAssignmentUpdate(
                    expected_revision=0,
                    assignee_id=owner.id,
                    priority="HIGH",
                    due_at=overdue_dt,
                    blocked_reason="等待内部实验室复核报告",
                ),
                actor=owner,
                request_id="req-2d-fact-assign",
            )
            assert fact_assigned.revision == 1
            assert fact_assigned.editable is True
            assert fact_assigned.assignment.is_overdue is True
            assert fact_assigned.assignment.assignee is not None
            assert fact_assigned.assignment.assignee.id == owner.id

            # no-op 不递增 revision
            noop = update_work_assignment(
                db=db,
                target_type="FactVersion",
                target_id=pending_fact.id,
                payload=WorkAssignmentUpdate(
                    expected_revision=1,
                    assignee_id=owner.id,
                    priority="HIGH",
                    due_at=overdue_dt,
                    blocked_reason="等待内部实验室复核报告",
                ),
                actor=admin,
                request_id="req-2d-fact-noop",
            )
            assert noop.revision == 1

            # 确认低敏审计不包含 blocked_reason 自由文本
            audit = db.scalar(
                select(AuditLog).where(
                    AuditLog.action == "work_assignment.updated",
                    AuditLog.target_id == str(pending_fact.id),
                )
            )
            assert audit is not None
            assert audit.details["facts"]["has_blocked_reason"] is True
            assert "实验室" not in str(audit.details)

            # 4. ContentTask 分派 + submit-review / request-changes 同事务改派交接
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
                        content_angle="2D 分派测试",
                    ),
                ),
                actor=admin,
                request_id="req-2d-task-create",
                idempotency_key="task-key-2d-0001",
            )
            task_assigned = update_work_assignment(
                db=db,
                target_type="ContentTask",
                target_id=task.id,
                payload=WorkAssignmentUpdate(
                    expected_revision=task.revision,
                    assignee_id=admin.id,
                    priority="CRITICAL",
                    due_at=today_later_dt,
                    blocked_reason="待确认标题",
                ),
                actor=owner,
                request_id="req-2d-task-assign",
            )
            assert task_assigned.revision == 1

            cv = ContentVersion(
                task_id=task.id,
                fact_version_id=approved_fact.id,
                version=1,
                source_type="HUMAN",
                title="TPS5430 国产替代选型指南",
                summary="摘要",
                body_markdown="# 正文",
                tags=["DC-DC"],
                content_hash="b" * 64,
                status="DRAFT",
                change_summary="首稿",
                created_by=admin.id,
            )
            db.add(cv)
            db.flush()
            task_row = db.get(ContentTask, task.id)
            assert task_row is not None
            task_row.current_content_version_id = cv.id
            db.commit()

            # submit-review 顺手改派给 owner
            submitted = transition_content_version(
                db=db,
                content_version_id=cv.id,
                expected_revision=0,
                comment="请审核",
                actor=admin,
                request_id="req-2d-submit-handoff",
                action="submit-review",
                next_assignee_id=owner.id,
            )
            assert submitted.status == "PENDING_REVIEW"
            after_submit = get_work_assignment(
                db, target_type="ContentTask", target_id=task.id
            )
            assert after_submit.assignment.assignee is not None
            assert after_submit.assignment.assignee.id == owner.id
            assert after_submit.revision == 2

            # 5. PublicationWork + PublishedContentIssue + GeoOpportunity 分派
            task2 = create_content_task(
                db=db,
                payload=ContentTaskCreate(
                    product_id=product.id,
                    fact_version_id=approved_fact.id,
                    platform_profile_id=platform.id,
                    query_topic_id=topic.id,
                    brief=ContentBriefInput(
                        target_question=topic.canonical_question,
                        search_intent=IntentType.REPLACEMENT,
                        content_angle="2D 发布测试",
                    ),
                ),
                actor=admin,
                request_id="req-2d-task2-create",
                idempotency_key="task-key-2d-0002",
            )
            cv2 = ContentVersion(
                task_id=task2.id,
                fact_version_id=approved_fact.id,
                version=1,
                source_type="HUMAN",
                title="TPS5430 发布验证文章",
                summary="摘要",
                body_markdown="# 正文 2",
                tags=["DC-DC"],
                content_hash="c" * 64,
                status="APPROVED",
                change_summary="首稿",
                created_by=admin.id,
            )
            db.add(cv2)
            db.flush()
            task2_row = db.get(ContentTask, task2.id)
            assert task2_row is not None
            task2_row.current_content_version_id = cv2.id
            account = PlatformAccount(
                platform_profile_id=platform.id,
                label="知乎官方号",
                account_identifier="zhihu-2d",
            )
            db.add(account)
            db.flush()
            work = PublicationWork(
                idempotency_key="pub-work-2d-001",
                content_task_id=task2.id,
                content_version_id=cv2.id,
                platform_profile_id=platform.id,
                platform_profile_id_snapshot=platform.id,
                platform_profile_name_snapshot=platform.name,
                platform_account_id=account.id,
                platform_account_label_snapshot=account.label,
                account_identifier_snapshot=account.account_identifier,
                content_hash=cv2.content_hash,
                status="PREPARING",
                created_by=admin.id,
            )
            db.add(work)
            db.commit()

            work_assigned = update_work_assignment(
                db=db,
                target_type="PublicationWork",
                target_id=work.id,
                payload=WorkAssignmentUpdate(
                    expected_revision=0,
                    assignee_id=owner.id,
                    priority="HIGH",
                    due_at=today_later_dt,
                ),
                actor=admin,
                request_id="req-2d-work-assign",
            )
            assert work_assigned.revision == 1

            # 6. 验证运营收件箱 8 分桶聚合 + 时区校验（含畸形路径式时区 422）
            inbox_mine = get_workbench_inbox(
                db,
                actor=owner,
                bucket="assigned_to_me",
                timezone_name="Asia/Shanghai",
            )
            assert inbox_mine.bucket_counts.assigned_to_me >= 3
            assert inbox_mine.bucket_counts.pending_review >= 2
            assert inbox_mine.bucket_counts.awaiting_publication >= 1
            assert inbox_mine.bucket_counts.overdue >= 2
            assert inbox_mine.bucket_counts.needs_fix >= 1
            # 超时项排在最前
            assert inbox_mine.items[0].is_overdue is True

            for bad_tz in ("Invalid/Zone", "/UTC", "../UTC", "UTC/"):
                with pytest.raises(AppError) as tz_err:
                    get_workbench_inbox(db, actor=owner, timezone_name=bad_tz)
                assert tz_err.value.code == "VALIDATION_ERROR"

            # 7. 退回修改时同步交接回 admin，并验证终态触发器冻结
            rejected = transition_content_version(
                db=db,
                content_version_id=cv.id,
                expected_revision=submitted.revision,
                comment="请补充效率曲线说明",
                actor=owner,
                request_id="req-2d-reject-handoff",
                action="request-changes",
                next_assignee_id=admin.id,
            )
            assert rejected.status == "CHANGES_REQUESTED"
            after_reject = get_work_assignment(
                db, target_type="ContentTask", target_id=task.id
            )
            assert after_reject.assignment.assignee is not None
            assert after_reject.assignment.assignee.id == admin.id

            # 批准 FactVersion v2 后，DB 触发器与服务层均禁止修改其分派字段
            transition_fact_version(
                db=db,
                fact_version_id=pending_fact.id,
                expected_revision=fact_assigned.revision,
                comment="同意",
                actor=admin,
                request_id="req-2d-fact-approve",
                action="approve",
            )
            with pytest.raises(AppError) as frozen_fact_err:
                update_work_assignment(
                    db=db,
                    target_type="FactVersion",
                    target_id=pending_fact.id,
                    payload=WorkAssignmentUpdate(
                        expected_revision=fact_assigned.revision + 1,
                        assignee_id=admin.id,
                    ),
                    actor=admin,
                    request_id="req-2d-fact-frozen",
                )
            assert frozen_fact_err.value.code == "INVALID_STATE_TRANSITION"
            with pytest.raises(DBAPIError) as sql_fact_err:
                db.execute(
                    text("UPDATE fact_versions SET priority = 'LOW' WHERE id = :id"),
                    {"id": pending_fact.id},
                )
            assert getattr(sql_fact_err.value.orig, "sqlstate", None) == "55000"
            db.rollback()

            # 完成 PublicationWork -> PublishedArticle -> PublishedContentIssue 分派与 RESOLVED 冻结
            work_row = db.get(PublicationWork, work.id)
            assert work_row is not None
            work_row.actual_title = cv2.title
            work_row.final_url = "https://example.invalid/articles/2d"
            work_row.published_at = now
            work_row.status = "AWAITING_VERIFICATION"
            work_row.revision += 1
            db.flush()
            ver = PublicationVerification(
                publication_work_id=work_row.id,
                content_version_id=cv2.id,
                outcome="PASSED",
                actual_title_snapshot=cv2.title,
                final_url_snapshot="https://example.invalid/articles/2d",
                published_at_snapshot=now,
                comment="通过",
                actor_id=admin.id,
            )
            db.add(ver)
            db.flush()
            work_row.status = "COMPLETED"
            work_row.revision += 1
            task2_row = db.get(ContentTask, task2.id)
            assert task2_row is not None
            task2_row.status = "COMPLETED"
            task2_row.revision += 1
            db.add(PublishedArticle(id=work_row.id, verification_id=ver.id))
            db.flush()
            issue = PublishedContentIssue(
                published_article_id=work_row.id,
                kind="PAGE_UNAVAILABLE",
                description="外链 404",
                opened_by=admin.id,
            )
            db.add(issue)
            db.commit()

            # 已完成 ContentTask 与 PublicationWork 均由 DB 触发器冻结分派
            with pytest.raises(DBAPIError) as task_sql_err:
                db.execute(
                    text("UPDATE content_tasks SET priority = 'LOW' WHERE id = :id"),
                    {"id": task2.id},
                )
            assert getattr(task_sql_err.value.orig, "sqlstate", None) == "55000"
            db.rollback()

            with pytest.raises(DBAPIError) as work_sql_err:
                db.execute(
                    text(
                        "UPDATE publication_works SET priority = 'LOW', revision = revision + 1 "
                        "WHERE id = :id"
                    ),
                    {"id": work.id},
                )
            assert getattr(work_sql_err.value.orig, "sqlstate", None) == "55000"
            db.rollback()

            # PublishedContentIssue OPEN 可分派，RESOLVED 后冻结
            issue_assigned = update_work_assignment(
                db=db,
                target_type="PublishedContentIssue",
                target_id=issue.id,
                payload=WorkAssignmentUpdate(
                    expected_revision=0,
                    assignee_id=owner.id,
                    priority="CRITICAL",
                    due_at=today_later_dt,
                ),
                actor=admin,
                request_id="req-2d-issue-assign",
            )
            assert issue_assigned.revision == 1
            issue_row = db.get(PublishedContentIssue, issue.id)
            assert issue_row is not None
            issue_row.status = "RESOLVED"
            issue_row.resolved_by = admin.id
            issue_row.resolved_at = now
            issue_row.resolution_outcome = "RESTORED"
            issue_row.resolution_comment = "已恢复访问"
            issue_row.revision += 1
            db.commit()
            with pytest.raises(DBAPIError) as issue_sql_err:
                db.execute(
                    text(
                        "UPDATE published_content_issues "
                        "SET priority = 'LOW', revision = revision + 1 WHERE id = :id"
                    ),
                    {"id": issue.id},
                )
            assert getattr(issue_sql_err.value.orig, "sqlstate", None) == "55000"
            db.rollback()

            # 8. USER_IN_USE 护栏验证：仅作为 assignee_id 被引用时禁止物理删除
            assignee_only = User(
                username="assignee_only_2d",
                display_name="受派测试员",
                password_hash=admin.password_hash,
                account_type="ENGINEER",
                is_active=True,
                must_change_password=False,
            )
            db.add(assignee_only)
            db.commit()
            update_work_assignment(
                db=db,
                target_type="ContentTask",
                target_id=task.id,
                payload=WorkAssignmentUpdate(
                    expected_revision=after_reject.revision,
                    assignee_id=assignee_only.id,
                ),
                actor=admin,
                request_id="req-2d-assignee-guard",
            )
            assignee_only.is_active = False
            db.commit()
            with pytest.raises(AppError) as user_guard_err:
                delete_user(
                    db=db,
                    user_id=assignee_only.id,
                    expected_revision=assignee_only.revision,
                    actor=admin,
                    request_id="req-2d-user-del",
                )
            assert user_guard_err.value.code == "USER_IN_USE"

            # 8b. 保留已停用历史负责人更新 SLA 与 no-op 均允许，且 no-op 立即释放事务
            preserved = update_work_assignment(
                db=db,
                target_type="ContentTask",
                target_id=task.id,
                payload=WorkAssignmentUpdate(
                    expected_revision=after_reject.revision + 1,
                    assignee_id=assignee_only.id,
                    priority="HIGH",
                    blocked_reason="原负责人离职，先调整 SLA",
                ),
                actor=admin,
                request_id="req-2d-preserve-inactive",
            )
            assert preserved.revision == after_reject.revision + 2
            assert preserved.assignment.assignee is not None
            assert preserved.assignment.assignee.id == assignee_only.id

            preserved_noop = update_work_assignment(
                db=db,
                target_type="ContentTask",
                target_id=task.id,
                payload=WorkAssignmentUpdate(
                    expected_revision=preserved.revision,
                    assignee_id=assignee_only.id,
                    priority="HIGH",
                    blocked_reason="原负责人离职，先调整 SLA",
                ),
                actor=admin,
                request_id="req-2d-preserve-noop",
            )
            assert preserved_noop.revision == preserved.revision
            assert not db.in_transaction()

            # 9. 0074 downgrade 必须以 55000 拒绝
            monkeypatch.setenv("DATABASE_URL", database_url)
            monkeypatch.setattr(settings, "database_url", database_url)
            cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
            cfg.set_main_option("sqlalchemy.url", database_url)
            with pytest.raises(DBAPIError) as down_err:
                command.downgrade(cfg, "0073_content_task_batch_planning")
            assert getattr(down_err.value.orig, "sqlstate", None) == "55000"


@pytest.mark.integration
def test_0074_geo_opportunity_assignment_priority_freeze_and_dismiss_guard(api) -> None:
    """在真实规则引擎生成的 GeoOpportunity 上验证规则冻结 priority、收件箱收录与 DISMISSED 冻结。"""
    _, _, _, opp_id = opportunity(api)

    initial = api.engineer.get(f"/api/v1/work-assignments/GeoOpportunity/{opp_id}")
    assert initial.status_code == 200, initial.text
    initial_data = initial.json()
    assert initial_data["priority_mutable"] is False
    assert initial_data["editable"] is True
    revision = initial_data["revision"]

    # 尝试改写规则冻结优先级 -> 422
    bad_priority = api.engineer.patch(
        f"{GEO_OPPORTUNITY_PATH}/{opp_id}/assignment",
        json={
            "expected_revision": revision,
            "assignee_id": str(api.engineer_id),
            "priority": "LOW",
        },
    )
    assert bad_priority.status_code == 422
    assert bad_priority.json()["error"]["code"] == "VALIDATION_ERROR"

    # 更新负责人、SLA 与阻塞说明 -> 200
    due_at = (datetime.now(UTC) + timedelta(minutes=30)).isoformat()
    assigned = api.engineer.patch(
        f"{GEO_OPPORTUNITY_PATH}/{opp_id}/assignment",
        json={
            "expected_revision": revision,
            "assignee_id": str(api.engineer_id),
            "due_at": due_at,
            "blocked_reason": "等待复测排期确认",
        },
    )
    assert assigned.status_code == 200, assigned.text
    assigned_data = assigned.json()
    assert assigned_data["revision"] == revision + 1
    assert assigned_data["assignment"]["assignee"]["id"] == str(api.engineer_id)

    # 验证运营收件箱高优先级 GEO 机会分桶收录 + 畸形时区 HTTP 422
    inbox = api.engineer.get(
        "/api/v1/workbench/inbox",
        params={"bucket": "high_priority_geo_opportunities", "timezone": "Asia/Shanghai"},
    )
    assert inbox.status_code == 200, inbox.text
    assert any(item["resource_id"] == opp_id for item in inbox.json()["items"])

    bad_tz = api.engineer.get("/api/v1/workbench/inbox", params={"timezone": "/UTC"})
    assert bad_tz.status_code == 422
    assert bad_tz.json()["error"]["code"] == "VALIDATION_ERROR"

    # DISMISSED 终态冻结（HTTP 409 + PostgreSQL 触发器 55000）
    dismissed = api.admin.post(
        f"{GEO_OPPORTUNITY_PATH}/{opp_id}/dismiss",
        json={
            "expected_revision": assigned_data["revision"],
            "resolution_code": "DUPLICATE",
            "resolution_comment": "验证 0074 终态冻结",
        },
    )
    assert dismissed.status_code == 200, dismissed.text
    dismissed_rev = dismissed.json()["revision"]

    frozen_http = api.admin.patch(
        f"{GEO_OPPORTUNITY_PATH}/{opp_id}/assignment",
        json={"expected_revision": dismissed_rev, "assignee_id": None},
    )
    assert frozen_http.status_code == 409
    assert frozen_http.json()["error"]["code"] == "INVALID_STATE_TRANSITION"

    with api.harness.factory() as db:
        with pytest.raises(DBAPIError) as sql_err:
            db.execute(
                text(
                    "UPDATE geo_opportunities "
                    "SET blocked_reason = '绕过修改', revision = revision + 1 WHERE id = :id"
                ),
                {"id": uuid.UUID(opp_id)},
            )
        assert getattr(sql_err.value.orig, "sqlstate", None) == "23514"
        db.rollback()
        assert db.get(GeoOpportunity, uuid.UUID(opp_id)) is not None
