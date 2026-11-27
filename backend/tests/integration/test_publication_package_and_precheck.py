"""Slice 3C：增强版发布包、发布前 8 项检查与发布结果合规门禁 PG 17 集成测试。"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile
from app.models.content import ContentVersion
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.models.publication import PlatformAccount, PublicationWork
from app.schemas.configuration import IntentType
from app.schemas.content import ContentBriefInput, ContentTaskCreate
from app.schemas.publication import (
    PublicationCloseReason,
    PublicationPreRegisterCheckRequest,
    PublicationResultUpdate,
    PublicationWorkCloseRequest,
)
from app.services.content_planning import create_content_task
from app.services.publication import close_publication_work, register_publication_result
from app.services.publication_package import (
    build_publication_package,
    evaluate_pre_register_check,
)
from tests.integration.test_content_planning_layer import _seed_entities, temporary_database


@pytest.mark.integration
def test_slice_3c_publication_package_and_pre_register_check() -> None:
    """验证增强发布包实时派生字段、发布前 8 项检查及登记结果时的禁用表达硬门禁。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                env = _seed_entities(db, suffix="3c")
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
                    change_summary="3C 事实",
                    content_restrictions="禁止承诺免测试直接替换",
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
                            target_question="工业 24V 降压芯片选型指南",
                            search_intent=IntentType.REPLACEMENT,
                            content_angle="工程选型",
                            forbidden_expressions=["终身质保"],
                            target_keywords=["工业电源", "降压芯片"],
                        ),
                    ),
                    actor=admin,
                    request_id="req-3c-task",
                    idempotency_key="task-3c-0001",
                )

                cv = ContentVersion(
                    task_id=task.id,
                    fact_version_id=fact.id,
                    version=1,
                    source_type="HUMAN",
                    title="工业 24V 降压芯片选型实战",
                    summary="围绕输入电压与输出电流边界展开选型核对。",
                    body_markdown=(
                        "## 核心参数核对\n\n"
                        "在工业 24V 电源系统中，参考[产品说明](https://example.invalid/doc)"
                        "核对 5.5V-36V 输入与 3A 输出余量，并按板级温升完成实验室验证。\n\n"
                        "![典型应用框图](https://example.invalid/app.png)\n"
                        "![](https://example.invalid/missing-alt.png)\n"
                    ),
                    tags=["工业电源", "降压芯片"],
                    content_hash="c" * 64,
                    status="APPROVED",
                    change_summary="批准版本",
                    created_by=admin.id,
                )
                db.add(cv)
                db.flush()
                task_row = db.get(type(task), task.id)
                assert task_row is not None
                task_row.current_content_version_id = cv.id

                account = PlatformAccount(
                    platform_profile_id=platform.id,
                    label="3C 官方号",
                    account_identifier="acct-3c",
                )
                db.add(account)
                db.flush()

                work = PublicationWork(
                    idempotency_key="pub-work-3c-0001",
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
                db.commit()

                # 1. 增强版发布包校验（纯实时派生）
                pkg = build_publication_package(db, cv.id)
                assert pkg.version == 1
                assert pkg.summary == cv.summary
                assert "工业电源" in pkg.recommended_topics
                assert len(pkg.links) == 1 and pkg.links[0].is_valid is True
                assert len(pkg.images) == 2 and pkg.images[1].missing_alt is True
                assert pkg.character_stats.heading_count == 1
                assert pkg.character_stats.paragraph_count >= 1
                checklist_by_code = {item.code: item.status for item in pkg.platform_checklist}
                assert checklist_by_code["FORBIDDEN_EXPRESSIONS_CLEAN"] == "PASS"
                assert checklist_by_code["IMAGES_ALT_COMPLETE"] == "WARNING"

                # 1b. P0-1 并发只读验证：REPEATABLE READ 快照下并发修改 ContentTask 不应触发 40001
                with Session(engine, expire_on_commit=False) as rr_db:
                    rr_db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
                    # 先建立快照
                    assert rr_db.get(ContentVersion, cv.id) is not None
                    with Session(engine, expire_on_commit=False) as writer_db:
                        writer_task = writer_db.get(type(task), task.id)
                        assert writer_task is not None
                        writer_task.revision += 1
                        writer_db.commit()
                    rr_pkg = build_publication_package(rr_db, cv.id)
                    assert rr_pkg.content_version_id == cv.id

                # 2. 发布前检查：错误域名 + 禁用标题 + 空备注 -> BLOCKING 且 can_register=False
                bad_check = evaluate_pre_register_check(
                    db,
                    work_id=work.id,
                    payload=PublicationPreRegisterCheckRequest(
                        actual_title="100% 替代且提供终身质保",
                        final_url="https://wrong-domain.invalid/post/1",
                        published_at=None,
                        comment="",
                    ),
                )
                assert bad_check.can_register is False
                bad_map = {item.code: item.status for item in bad_check.checks}
                assert bad_map["URL_DOMAIN_ALLOWED"] == "BLOCKING"
                assert bad_map["FORBIDDEN_EXPRESSIONS_CLEAN"] == "BLOCKING"
                assert bad_map["PUBLISH_META_COMPLETE"] == "BLOCKING"

                # 2b. P1-2：有发布时间但缺 comment 或非法端口 URL -> BLOCKING
                allowed_domain = platform.allowed_domains[0]
                bad_url_and_comment = evaluate_pre_register_check(
                    db,
                    work_id=work.id,
                    payload=PublicationPreRegisterCheckRequest(
                        actual_title=cv.title,
                        final_url=f"https://{allowed_domain}:99999/articles/3c",
                        published_at=datetime.now(UTC),
                        comment="   ",
                    ),
                )
                assert bad_url_and_comment.can_register is False
                bad2_map = {item.code: item.status for item in bad_url_and_comment.checks}
                assert bad2_map["URL_DOMAIN_ALLOWED"] == "BLOCKING"
                assert bad2_map["PUBLISH_META_COMPLETE"] == "BLOCKING"

                # 3. 合法输入 -> can_register=True
                ok_check = evaluate_pre_register_check(
                    db,
                    work_id=work.id,
                    payload=PublicationPreRegisterCheckRequest(
                        actual_title=cv.title,
                        final_url=f"https://{allowed_domain}/articles/3c",
                        published_at=datetime.now(UTC),
                        comment="已核对排版与配图",
                    ),
                )
                assert ok_check.can_register is True
                assert ok_check.blocking_count == 0

                # 4. register_publication_result 服务端强门禁：标题命中禁止表达必须 422 拒绝
                with pytest.raises(AppError) as title_err:
                    register_publication_result(
                        db=db,
                        work_id=work.id,
                        payload=PublicationResultUpdate(
                            expected_revision=work.revision,
                            actual_title="终身质保工业电源方案",
                            final_url=f"https://{allowed_domain}/articles/3c",  # type: ignore[arg-type]
                            published_at=datetime.now(UTC),
                            comment="测试禁用标题拦截",
                        ),
                        actor=admin,
                        request_id="req-3c-forbid-title",
                    )
                assert title_err.value.code == "FORBIDDEN_EXPRESSION_HIT"

                # 5. P1-2：终态发布工作禁止执行发布前检查（409 INVALID_STATE_TRANSITION）
                close_publication_work(
                    db=db,
                    work_id=work.id,
                    payload=PublicationWorkCloseRequest(
                        expected_revision=work.revision,
                        reason=PublicationCloseReason.BUSINESS_CANCELLED,
                        comment="测试终态工作关闭",
                    ),
                    actor=admin,
                    request_id="req-3c-close-work",
                )
                with pytest.raises(AppError) as closed_err:
                    evaluate_pre_register_check(
                        db,
                        work_id=work.id,
                        payload=PublicationPreRegisterCheckRequest(
                            actual_title=cv.title,
                            final_url=f"https://{allowed_domain}/articles/3c",
                            published_at=datetime.now(UTC),
                            comment="终态工作",
                        ),
                    )
                assert closed_err.value.code == "INVALID_STATE_TRANSITION"
        finally:
            engine.dispose()
