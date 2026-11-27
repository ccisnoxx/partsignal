"""Slice 3D：公开页面健康检查、三档分类自动建单、不可变触发器与降级拒止 PG 17 集成测试。"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

from alembic import command
from app.audit_types import AuditModule
from app.config import settings
from app.errors import AppError
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask, ContentVersion
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.models.publication import (
    PlatformAccount,
    PublishedArticle,
    PublishedArticleHealthCheck,
    PublishedContentIssue,
)
from app.schemas.configuration import IntentType
from app.schemas.content import ContentBriefInput, ContentTaskCreate
from app.schemas.page_health import PlatformHealthCheckSettingsUpdate
from app.schemas.publication import (
    PublicationResultUpdate,
    PublicationVerificationCreate,
    PublicationVerificationOutcome,
    PublicationWorkCreate,
    PublishedArticlePermanentDeleteRequest,
    PublishedContentIssueResolution,
    PublishedContentIssueResolveRequest,
)
from app.services.audit_logs import list_audit_logs
from app.services.content_planning import create_content_task
from app.services.identity import delete_user
from app.services.page_health_checks import (
    list_published_article_health_checks,
    run_published_article_health_check,
)
from app.services.page_health_fetcher import PageFetchResult
from app.services.page_health_scheduler import (
    get_platform_health_check_settings,
    run_due_public_page_health_checks,
    run_due_public_page_health_checks_scheduled,
    update_platform_health_check_settings,
)
from app.services.publication import (
    create_publication_work,
    permanently_delete_published_article,
    register_publication_result,
    resolve_published_content_issue,
    verify_publication_work,
)
from tests.integration.test_content_planning_layer import (
    _seed_entities,
    temporary_database,
)


class _QueuedFetcher:
    def __init__(self, responses: list[PageFetchResult]) -> None:
        self._responses = list(responses)
        self.calls: list[str] = []

    def fetch(self, url: str) -> PageFetchResult:
        self.calls.append(url)
        return self._responses.pop(0)


@pytest.mark.integration
def test_0077_public_page_health_checks_lifecycle_and_guards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证 0077 平台配置、三档分类、FETCH_BLOCKED 零建单、连续异常建单、级联删除与 55000 护栏。"""
    monkeypatch.setattr(settings, "environment", "test")
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        try:
            with Session(engine, expire_on_commit=False) as db:
                env = _seed_entities(db, suffix="3d")
                admin: User = env["admin"]  # type: ignore[assignment]
                product = env["product"]
                platform: PlatformProfile = env["platform"]  # type: ignore[assignment]
                topic = env["topic"]

                fact = FactVersion(
                    product_id=product.id,
                    version=2,
                    status="APPROVED",
                    body_markdown="# 公开事实\n\n支持 5.5V-36V 输入与 3A 输出。",
                    classification="PUBLIC",
                    change_summary="3D 事实",
                    created_by=admin.id,
                    approved_by=admin.id,
                    approved_at=datetime.now(UTC),
                )
                db.add(fact)
                db.commit()

                task = create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=product.id,
                        fact_version_id=fact.id,
                        platform_profile_id=platform.id,
                        query_topic_id=topic.id,
                        brief=ContentBriefInput(
                            target_question="TPS5430 公开页面健康巡检验证",
                            search_intent=IntentType.REPLACEMENT,
                            content_angle="工程验证",
                        ),
                    ),
                    actor=admin,
                    request_id="req-3d-task",
                    idempotency_key="task-3d-0001",
                )
                body_md = (
                    "## 核心边界\n\n"
                    "在工业 24V 电源设计中，TPS5430 支持 5.5V-36V 输入电压与 3A 连续输出电流，"
                    "工程师需按板级温升、电感饱和电流与输出纹波完成实测验证后再投入量产。"
                )
                cv = ContentVersion(
                    task_id=task.id,
                    fact_version_id=fact.id,
                    version=1,
                    source_type="HUMAN",
                    title="TPS5430 工业电源公开页健康巡检范文",
                    summary="工业 24V 电源选型核对要点。",
                    body_markdown=body_md,
                    tags=["TPS5430"],
                    content_hash="d" * 64,
                    status="APPROVED",
                    change_summary="批准版本",
                    created_by=admin.id,
                )
                db.add(cv)
                db.flush()
                task_row = db.get(ContentTask, task.id)
                assert task_row is not None
                task_row.current_content_version_id = cv.id

                account = PlatformAccount(
                    platform_profile_id=platform.id,
                    label="3D 官方号",
                    account_identifier="acct-3d",
                )
                db.add(account)
                db.commit()

                allowed_domain = platform.allowed_domains[0]
                article_url = f"https://{allowed_domain}/articles/tps5430-3d"
                now = datetime.now(UTC)
                created_work = create_publication_work(
                    db=db,
                    payload=PublicationWorkCreate(
                        content_version_id=cv.id,
                        platform_account_id=account.id,
                    ),
                    actor=admin,
                    request_id="req-3d-work-create",
                    idempotency_key="pub-work-3d-0001",
                )
                registered_work = register_publication_result(
                    db=db,
                    work_id=created_work.id,
                    payload=PublicationResultUpdate(
                        expected_revision=created_work.revision,
                        actual_title=cv.title,
                        final_url=article_url,  # type: ignore[arg-type]
                        published_at=now,
                        comment="3D 测试登记发布结果",
                    ),
                    actor=admin,
                    request_id="req-3d-work-reg",
                )
                verified_work = verify_publication_work(
                    db=db,
                    work_id=registered_work.id,
                    payload=PublicationVerificationCreate(
                        expected_revision=registered_work.revision,
                        outcome=PublicationVerificationOutcome.PASSED,
                        content_matches=True,
                        comment="3D 首次核验通过",
                    ),
                    actor=admin,
                    request_id="req-3d-work-verify",
                )
                article = db.get(PublishedArticle, verified_work.id)
                assert article is not None
                work = verified_work

                # 1. 平台配置默认关闭，管理员开启并校验 CAS 乐观锁冲突
                initial_cfg = get_platform_health_check_settings(db, platform.id)
                assert initial_cfg.health_check_enabled is False
                assert initial_cfg.health_check_interval_hours == 24
                assert initial_cfg.health_check_anomaly_threshold == 2

                updated_cfg = update_platform_health_check_settings(
                    db=db,
                    platform_profile_id=platform.id,
                    payload=PlatformHealthCheckSettingsUpdate(
                        health_check_enabled=True,
                        health_check_interval_hours=12,
                        health_check_anomaly_threshold=2,
                        expected_revision=initial_cfg.revision,
                    ),
                    actor=admin,
                    request_id="req-3d-cfg-1",
                )
                assert updated_cfg.health_check_enabled is True
                assert updated_cfg.health_check_interval_hours == 12
                assert updated_cfg.revision == initial_cfg.revision + 1

                with pytest.raises(AppError) as cas_err:
                    update_platform_health_check_settings(
                        db=db,
                        platform_profile_id=platform.id,
                        payload=PlatformHealthCheckSettingsUpdate(
                            health_check_enabled=False,
                            health_check_interval_hours=24,
                            health_check_anomaly_threshold=2,
                            expected_revision=initial_cfg.revision,
                        ),
                        actor=admin,
                        request_id="req-3d-cfg-stale",
                    )
                assert cas_err.value.code == "REVISION_CONFLICT"

                # 2. 连续 3 次 FETCH_BLOCKED（403/429/WAF）绝不自动开 PublishedContentIssue
                blocked_fetcher = _QueuedFetcher(
                    [
                        PageFetchResult(checked_url=article_url, http_status=403),
                        PageFetchResult(checked_url=article_url, http_status=429),
                        PageFetchResult(
                            checked_url=article_url, http_status=200, waf_or_login_blocked=True
                        ),
                    ]
                )
                for idx in range(3):
                    res = run_published_article_health_check(
                        db,
                        article_id=article.id,
                        actor=admin,
                        request_id=f"req-3d-blk-{idx}",
                        fetcher=blocked_fetcher,
                    )
                    assert res.status == "FETCH_BLOCKED"
                    assert res.auto_opened_issue_id is None
                assert (
                    db.scalar(
                        select(PublishedContentIssue.id).where(
                            PublishedContentIssue.published_article_id == article.id
                        )
                    )
                    is None
                )

                # 3. 连续 2 次 CONFIRMED_ANOMALY（阈值=2）：第 1 次不开单，第 2 次自动开单，
                # 第 3 次不重复开单
                anomaly_fetcher = _QueuedFetcher(
                    [
                        PageFetchResult(checked_url=article_url, http_status=404),
                        PageFetchResult(checked_url=article_url, http_status=410),
                        PageFetchResult(checked_url=article_url, http_status=404),
                    ]
                )
                a1 = run_published_article_health_check(
                    db,
                    article_id=article.id,
                    actor=admin,
                    request_id="req-3d-anom-1",
                    fetcher=anomaly_fetcher,
                )
                assert a1.status == "CONFIRMED_ANOMALY"
                assert a1.auto_opened_issue_id is None

                a2 = run_published_article_health_check(
                    db,
                    article_id=article.id,
                    actor=admin,
                    request_id="req-3d-anom-2",
                    fetcher=anomaly_fetcher,
                )
                assert a2.status == "CONFIRMED_ANOMALY"
                assert a2.auto_opened_issue_id is not None
                opened_issue = db.get(PublishedContentIssue, a2.auto_opened_issue_id)
                assert opened_issue is not None
                assert opened_issue.status == "OPEN"
                assert opened_issue.kind == "PAGE_UNAVAILABLE"

                a3 = run_published_article_health_check(
                    db,
                    article_id=article.id,
                    actor=admin,
                    request_id="req-3d-anom-3",
                    fetcher=anomaly_fetcher,
                )
                assert a3.status == "CONFIRMED_ANOMALY"
                assert a3.auto_opened_issue_id is None

                history = list_published_article_health_checks(db, article_id=article.id)
                assert history.consecutive_confirmed_anomalies == 3
                assert history.latest_status == "CONFIRMED_ANOMALY"
                assert len(history.items) == 6

                # P2-3：limit=1 不得截断 consecutive_confirmed_anomalies
                history_limited = list_published_article_health_checks(
                    db, article_id=article.id, limit=1
                )
                assert len(history_limited.items) == 1
                assert history_limited.consecutive_confirmed_anomalies == 3

                # P1-4：RESTORED 恢复后连续异常计数清零，恢复后首次异常不得越过阈值开单
                resolve_published_content_issue(
                    db=db,
                    issue_id=opened_issue.id,
                    payload=PublishedContentIssueResolveRequest(
                        expected_revision=opened_issue.revision,
                        outcome=PublishedContentIssueResolution.RESTORED,
                        comment="已联系平台恢复公开文章访问",
                    ),
                    actor=admin,
                    request_id="req-3d-issue-restored",
                )
                post_restore_hist = list_published_article_health_checks(db, article_id=article.id)
                assert post_restore_hist.consecutive_confirmed_anomalies == 0
                after_restore_1 = run_published_article_health_check(
                    db,
                    article_id=article.id,
                    actor=admin,
                    request_id="req-3d-post-restore-anom-1",
                    fetcher=_QueuedFetcher(
                        [PageFetchResult(checked_url=article_url, http_status=404)]
                    ),
                )
                assert after_restore_1.status == "CONFIRMED_ANOMALY"
                assert after_restore_1.auto_opened_issue_id is None
                assert (
                    list_published_article_health_checks(
                        db, article_id=article.id
                    ).consecutive_confirmed_anomalies
                    == 1
                )

                # 4. 审计日志安全投影验证（CONFIGURATION + PUBLICATION）
                cfg_audits = list_audit_logs(
                    db=db,
                    created_from=None,
                    created_to=None,
                    actor_id=None,
                    business_module=AuditModule.CONFIGURATION,
                    action="platform_profile.health_check_settings_updated",
                    target_type=None,
                    target_id=None,
                    outcome=None,
                    request_id=None,
                    keyword=None,
                    page=1,
                    page_size=20,
                )
                assert len(cfg_audits.items) == 1
                pub_audits = list_audit_logs(
                    db=db,
                    created_from=None,
                    created_to=None,
                    actor_id=None,
                    business_module=AuditModule.PUBLICATION,
                    action="published_article_health_check.run",
                    target_type=None,
                    target_id=None,
                    outcome=None,
                    request_id=None,
                    keyword=None,
                    page=1,
                    page_size=20,
                )
                assert len(pub_audits.items) >= 6

                # 5. 数据库触发器不可变护栏：直接 UPDATE / DELETE 必须报 SQLSTATE 55000
                with pytest.raises(DBAPIError) as upd_err:
                    db.execute(
                        text(
                            "UPDATE published_article_health_checks "
                            "SET status = 'HEALTHY' WHERE id = :id"
                        ),
                        {"id": a2.id},
                    )
                assert getattr(upd_err.value.orig, "sqlstate", None) == "55000"
                db.rollback()

                with pytest.raises(DBAPIError) as del_err:
                    db.execute(
                        text("DELETE FROM published_article_health_checks WHERE id = :id"),
                        {"id": a2.id},
                    )
                assert getattr(del_err.value.orig, "sqlstate", None) == "55000"
                db.rollback()

                # 6. USER_IN_USE：仅作为 PublishedArticleHealthCheck.triggered_by 时禁止物理删除用户
                checker = User(
                    username="health_checker_3d",
                    display_name="巡检专员",
                    password_hash=admin.password_hash,
                    account_type="ENGINEER",
                    is_active=True,
                    must_change_password=False,
                )
                db.add(checker)
                db.commit()
                run_published_article_health_check(
                    db,
                    article_id=article.id,
                    actor=checker,
                    request_id="req-3d-checker",
                    fetcher=_QueuedFetcher(
                        [
                            PageFetchResult(
                                checked_url=article_url,
                                final_url=article_url,
                                http_status=200,
                                page_title=cv.title,
                                body_text=body_md,
                            )
                        ]
                    ),
                )
                checker.is_active = False
                db.commit()
                with pytest.raises(AppError) as user_err:
                    delete_user(
                        db=db,
                        user_id=checker.id,
                        expected_revision=checker.revision,
                        actor=admin,
                        request_id="req-3d-del-checker",
                    )
                assert user_err.value.code == "USER_IN_USE"

                # 7. 到期巡检调度器验证（刚检查过 -> 0 篇到期；关闭后手动巡检亦不重复触发）
                batch_empty = run_due_public_page_health_checks(
                    db,
                    actor=admin,
                    request_id="req-3d-due-0",
                    fetcher=_QueuedFetcher([]),
                )
                assert batch_empty.checked_count == 0
                assert (
                    run_due_public_page_health_checks_scheduled(
                        session_factory=session_factory, fetcher=_QueuedFetcher([])
                    )
                    == 0
                )

                # 8. 受控永久删除发布成果可正常级联清理健康检查历史与自动打开的问题
                permanently_delete_published_article(
                    db=db,
                    article_id=article.id,
                    payload=PublishedArticlePermanentDeleteRequest(
                        expected_revision=work.revision,
                        confirmation_text="永久删除",
                    ),
                    actor=admin,
                    request_id="req-3d-perm-del",
                )
                assert (
                    db.scalar(
                        select(PublishedArticleHealthCheck.id).where(
                            PublishedArticleHealthCheck.published_article_id == article.id
                        )
                    )
                    is None
                )

                # 9. 0077 downgrade 必须以 55000 拒绝
                monkeypatch.setenv("DATABASE_URL", database_url)
                monkeypatch.setattr(settings, "database_url", database_url)
                backend_dir = Path(__file__).resolve().parents[2]
                cfg = Config(str(backend_dir / "alembic.ini"))
                cfg.set_main_option("script_location", str(backend_dir / "alembic"))
                cfg.set_main_option("sqlalchemy.url", database_url)
                with pytest.raises(DBAPIError) as down_err:
                    command.downgrade(cfg, "0076_quality_gate_duplication")
                assert getattr(down_err.value.orig, "sqlstate", None) == "55000"
        finally:
            engine.dispose()
