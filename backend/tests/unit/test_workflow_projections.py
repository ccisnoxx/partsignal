"""验证服务端主任务投影只依赖权威业务状态与批量关联。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile, PlatformType, QueryTopic
from app.models.content import ContentTask, ContentVersion
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import PlatformAccount
from app.schemas.product_facts import (
    ProductFactStatus,
    ProductOut,
    ProductSort,
    ProductWorkflowStage,
)
from app.services.ai_configuration import ai_channel_stage, ai_model_stage
from app.services.content_planning import query_topics_out
from app.services.generation import content_hash
from app.services.identity import users_out
from app.services.platform_configuration import platform_types_out
from app.services.product_facts import list_products, product_out, products_out
from app.services.projections import (
    content_tasks_out,
    content_versions_out,
    fact_versions_out,
    platform_accounts_out,
    platform_profiles_out,
)
from app.services.publication import delete_content_task
from app.services.publication_queries import list_publication_works


class _ScalarSequenceSession:
    """按调用顺序返回批量查询结果，并记录查询次数。"""

    def __init__(self, rows: list[list[object]]) -> None:
        self.rows = iter(rows)
        self.scalar_calls = 0

    def scalars(self, _statement: object) -> list[object]:
        self.scalar_calls += 1
        return next(self.rows)

    def execute(self, _statement: object) -> Any:
        """为聚合投影返回支持 ``tuples`` 的最小结果。"""
        self.scalar_calls += 1
        rows = next(self.rows)
        return type(
            "TupleResult",
            (),
            {
                "tuples": lambda self: rows,
                "__iter__": lambda self: iter(rows),
            },
        )()

    def get(self, _model: type[object], _identity: object) -> None:
        return None


def _product(*, body: str = "批准事实") -> Product:
    now = datetime(2026, 8, 4, tzinfo=UTC)
    return Product(
        id=uuid.uuid4(),
        part_number="PS-001",
        normalized_part_number="ps001",
        brand="PartSignal",
        normalized_brand="partsignal",
        category="MCU",
        status="ACTIVE",
        revision=0,
        facts_revision=1,
        facts_body_markdown=body,
        facts_classification="PUBLIC",
        created_at=now,
        updated_at=now,
    )


def _fact(product: Product, *, status: str = "APPROVED") -> FactVersion:
    return FactVersion(
        id=uuid.uuid4(),
        product_id=product.id,
        version=1,
        status=status,
        body_markdown="批准事实",
        classification="PUBLIC",
        change_summary="审核快照",
        revision=0,
        created_by=uuid.uuid4(),
        created_at=datetime(2026, 8, 4, tzinfo=UTC),
    )


def _query_topic() -> QueryTopic:
    return QueryTopic(
        id=uuid.uuid4(),
        canonical_question="如何选择测试器件？",
        intent_type="PRODUCT",
        variants=["测试器件选型"],
        revision=0,
        created_at=datetime(2026, 8, 4, tzinfo=UTC),
    )


def test_product_primary_task_changes_with_workspace_and_pending_review() -> None:
    """相同产品状态下，工作区差异与待审核版本必须投影不同下一步。"""
    product = _product()
    approved = _fact(product)
    reviewed_at = datetime(2026, 8, 5, tzinfo=UTC)
    approved_session = _ScalarSequenceSession([[], [approved], [(product.id, reviewed_at)]])
    approved_out = products_out(cast(Session, approved_session), [product], can_delete=False)[0]
    assert approved_out.primary_task == "CREATE_CONTENT_TASK"
    assert approved_out.fact_status == "APPROVED"
    assert approved_out.current_fact is not None
    assert approved_out.current_fact.model_dump(mode="json") == {
        "version": 1,
        "status": "APPROVED",
    }
    assert approved_out.updated_at == reviewed_at
    assert approved_out.deletion is None

    product.facts_body_markdown = "已修改事实"
    edited_session = _ScalarSequenceSession([[], [approved], []])
    edited_out = products_out(cast(Session, edited_session), [product], can_delete=False)[0]
    assert edited_out.primary_task == "SUBMIT_FACT_REVIEW"
    assert edited_out.fact_status == "APPROVED"
    assert edited_out.current_fact is not None
    assert edited_out.current_fact.version == 1

    pending = _fact(product, status="PENDING_REVIEW")
    pending.body_markdown = product.facts_body_markdown
    pending.version = 2
    pending_session = _ScalarSequenceSession([[], [pending, approved], []])
    pending_out = products_out(cast(Session, pending_session), [product], can_delete=False)[0]
    assert pending_out.primary_task == "REVIEW_FACT"
    assert pending_out.fact_status == "PENDING_REVIEW"
    assert pending_out.current_fact is not None
    assert pending_out.current_fact.version == 2

    detail_session = _ScalarSequenceSession([[], [approved], []])
    detail = product_out(cast(Session, detail_session), product, can_delete=False)
    assert type(detail) is ProductOut
    assert "current_fact" not in detail.model_dump()


def test_product_fact_summary_covers_empty_changes_requested_and_retired() -> None:
    """事实显示状态必须覆盖无版本、待修订和已停用快照。"""
    empty = _product(body="")
    empty_out = products_out(
        cast(Session, _ScalarSequenceSession([[], [], []])), [empty], can_delete=False
    )[0]
    assert empty_out.workflow_stage == "FACTS_EMPTY"
    assert empty_out.fact_status == "NOT_ENTERED"
    assert empty_out.current_fact is None

    changes = _product()
    changes_fact = _fact(changes, status="CHANGES_REQUESTED")
    changes_out = products_out(
        cast(Session, _ScalarSequenceSession([[], [changes_fact], []])),
        [changes],
        can_delete=False,
    )[0]
    assert changes_out.workflow_stage == "FACT_CHANGES_REQUESTED"
    assert changes_out.primary_task == "REVISE_FACT"
    assert changes_out.fact_status == "CHANGES_REQUESTED"

    retired = _product()
    retired.status = "RETIRED"
    retired_fact = _fact(retired, status="RETIRED")
    retired_out = products_out(
        cast(Session, _ScalarSequenceSession([[], [retired_fact], []])),
        [retired],
        can_delete=False,
    )[0]
    assert retired_out.workflow_stage == "RETIRED"
    assert retired_out.primary_task == "VIEW_FACT_HISTORY"
    assert retired_out.fact_status == "RETIRED"


def test_product_list_filters_before_pagination_and_uses_stable_model_sort() -> None:
    """派生事实筛选必须先于分页，型号排序以产品 ID 稳定打破并列。"""
    first = _product(body="")
    first.part_number = "PS-EMPTY"
    second = _product()
    second.part_number = "PS-SAME"
    third = _product()
    third.part_number = "PS-SAME"
    approved_second = _fact(second)
    approved_third = _fact(third)
    session = _ScalarSequenceSession(
        [
            [third, first, second],
            [],
            [approved_third, approved_second],
            [],
        ]
    )

    result = list_products(
        db=cast(Session, session),
        can_delete=False,
        page=1,
        page_size=1,
        search=None,
        sort=ProductSort.MODEL_ASC,
        fact_status=ProductFactStatus.APPROVED,
        workflow_stage=ProductWorkflowStage.FACT_APPROVED,
    )

    assert result.total == 2
    assert len(result.items) == 1
    assert result.items[0].id == min(second.id, third.id, key=str)


def test_seven_constrained_delete_projections_distinguish_empty_and_blocked() -> None:
    """七类对象都以同一 ``deletion`` 结构表达当前直接引用。"""
    product = _product()
    deletable_product = products_out(
        cast(Session, _ScalarSequenceSession([[], [], []])), [product], can_delete=True
    )[0]
    assert deletable_product.available_actions == ["UPDATE", "DELETE"]
    assert deletable_product.deletion.model_dump() == {"blockers": []}

    product_session = _ScalarSequenceSession([[(product.id, "CONTENT_TASK", 2)], [], []])
    product_out = products_out(cast(Session, product_session), [product], can_delete=True)[0]
    assert product_out.available_actions == ["UPDATE"]
    assert product_out.deletion.model_dump() == {"blockers": [{"type": "CONTENT_TASK", "count": 2}]}

    fact = _fact(product)
    fact_out = fact_versions_out(
        cast(Session, _ScalarSequenceSession([[(fact.id, "CONTENT_VERSION", 3)]])),
        [fact],
        can_delete=True,
    )[0]
    assert "DELETE" not in fact_out.available_actions
    assert fact_out.deletion.model_dump() == {"blockers": [{"type": "CONTENT_VERSION", "count": 3}]}

    now = datetime(2026, 8, 4, tzinfo=UTC)
    platform_type = PlatformType(
        id=uuid.uuid4(),
        name="内容平台",
        slug="content-platform",
        revision=0,
        created_by=uuid.uuid4(),
        created_at=now,
        updated_at=now,
    )
    type_out = platform_types_out(
        cast(Session, _ScalarSequenceSession([[(platform_type.id, 2)]])),
        [platform_type],
    )[0]
    assert type_out.deletion.blockers[0].type == "PLATFORM_PROFILE"
    assert "DELETE" not in type_out.available_actions

    profile = PlatformProfile(
        id=uuid.uuid4(),
        name="工程师社区",
        slug="engineer-community",
        allowed_domains=["community.example.invalid"],
        platform_type_id=None,
        website_url=None,
        logo_file_id=None,
        logo_external_url=None,
        platform_prompt_id=None,
        revision=0,
        is_active=True,
    )
    profile_session = _ScalarSequenceSession(
        [[], [], [], [(profile.id, 2)], [(profile.id, 3)], [], []]
    )
    profile_out = platform_profiles_out(cast(Session, profile_session), [profile], can_manage=True)[
        0
    ]
    assert profile_out.deletion.model_dump() == {"blockers": [{"type": "CONTENT_TASK", "count": 3}]}

    account = PlatformAccount(
        id=uuid.uuid4(),
        platform_profile_id=profile.id,
        label="主账号",
        account_identifier="operator",
        is_active=True,
        revision=0,
    )
    account_out = platform_accounts_out(
        cast(Session, _ScalarSequenceSession([[(account.id, 4)], [profile]])),
        [account],
        can_delete=True,
    )[0]
    assert account_out.deletion.model_dump() == {
        "blockers": [{"type": "PUBLICATION_WORK", "count": 4}]
    }

    task = ContentTask(
        id=uuid.uuid4(),
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=profile.id,
        platform_profile_name_snapshot=profile.name,
        platform_website_url_snapshot=None,
        status="CANCELLED",
        revision=0,
        created_by=uuid.uuid4(),
        created_at=now,
    )
    task_out = content_tasks_out(
        cast(
            Session,
            _ScalarSequenceSession(
                [
                    [product],
                    [fact],
                    [profile],
                    [],
                    [],
                    [],
                    [],
                    [],
                    [],
                ]
            ),
        ),
        [task],
    )[0]
    assert task_out.deletion.model_dump() == {"blockers": []}
    assert "DELETE" in task_out.available_actions

    actor = User(
        id=uuid.uuid4(),
        username="admin",
        display_name="管理员",
        account_type="ADMIN",
        is_active=True,
        must_change_password=False,
        revision=0,
        created_at=now,
    )
    disabled = User(
        id=uuid.uuid4(),
        username="disabled",
        display_name="停用用户",
        account_type="ENGINEER",
        is_active=False,
        must_change_password=False,
        revision=0,
        created_at=now,
    )

    class UserProjectionSession:
        def scalar(self, _statement: object) -> int:
            return 1

        def execute(self, _statement: object) -> Any:
            return type(
                "TupleResult",
                (),
                {"tuples": lambda self: [(disabled.id, 5)]},
            )()

    disabled_out = users_out(cast(Session, UserProjectionSession()), [disabled], actor=actor)[0]
    assert disabled_out.deletion.model_dump() == {
        "blockers": [{"type": "USER_BUSINESS_HISTORY", "count": 5}]
    }
    assert "DELETE" not in disabled_out.available_actions


def test_product_deletion_projection_keeps_fixed_query_count_for_multiple_rows() -> None:
    """增加产品行数不能把删除引用投影退化成逐行查询。"""
    one = _ScalarSequenceSession([[], [], []])
    many = _ScalarSequenceSession([[], [], []])

    products_out(cast(Session, one), [_product()], can_delete=True)
    products_out(cast(Session, many), [_product(), _product()], can_delete=True)

    assert one.scalar_calls == many.scalar_calls == 3


def test_query_topic_deletion_projection_respects_admin_and_all_direct_references() -> None:
    """问题删除资格只向管理员投影，并逐类返回全部直接引用。"""
    topic = _query_topic()
    deletable = query_topics_out(
        cast(Session, _ScalarSequenceSession([[]])), [topic], can_delete=True
    )[0]
    assert deletable.available_actions == ["UPDATE", "DELETE"]
    assert deletable.deletion.model_dump() == {"blockers": []}

    blocked = query_topics_out(
        cast(
            Session,
            _ScalarSequenceSession(
                [
                    [
                        (topic.id, "CONTENT_TASK", 2),
                        (topic.id, "GEO_OPTIMIZATION_SOURCE", 3),
                        (topic.id, "GEO_OBSERVATION", 4),
                    ]
                ]
            ),
        ),
        [topic],
        can_delete=True,
    )[0]
    assert blocked.available_actions == ["UPDATE"]
    assert blocked.deletion.model_dump() == {
        "blockers": [
            {"type": "CONTENT_TASK", "count": 2},
            {"type": "GEO_OPTIMIZATION_SOURCE", "count": 3},
            {"type": "GEO_OBSERVATION", "count": 4},
        ]
    }

    engineer_session = _ScalarSequenceSession([])
    engineer = query_topics_out(cast(Session, engineer_session), [topic], can_delete=False)[0]
    assert engineer.available_actions == ["UPDATE"]
    assert engineer.deletion is None
    assert engineer_session.scalar_calls == 0


def test_query_topic_deletion_projection_keeps_fixed_query_count_for_multiple_rows() -> None:
    """问题数量增加时，三类引用仍由一次批量查询投影。"""
    one = _ScalarSequenceSession([[]])
    many = _ScalarSequenceSession([[]])

    query_topics_out(cast(Session, one), [_query_topic()], can_delete=True)
    query_topics_out(cast(Session, many), [_query_topic(), _query_topic()], can_delete=True)

    assert one.scalar_calls == many.scalar_calls == 1


def test_completed_content_task_delete_requires_archive_before_scope_query() -> None:
    """已完成任务不能绕过归档直接进入聚合删除。"""
    product = _product()
    fact = _fact(product)
    task = ContentTask(
        id=uuid.uuid4(),
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=uuid.uuid4(),
        platform_profile_name_snapshot="历史平台",
        platform_website_url_snapshot=None,
        status="COMPLETED",
        revision=0,
        created_by=uuid.uuid4(),
        created_at=datetime(2026, 8, 4, tzinfo=UTC),
    )

    class DeleteSession:
        def __init__(self) -> None:
            self.scalar_values = iter([task])
            self.scalar_statements: list[object] = []

        def scalar(self, statement: object) -> object:
            self.scalar_statements.append(statement)
            return next(self.scalar_values)

    session = DeleteSession()
    actor = User(id=uuid.uuid4(), account_type="ADMIN")

    with pytest.raises(AppError) as error:
        delete_content_task(
            db=cast(Session, session),
            task_id=task.id,
            actor=actor,
            request_id="delete-task-test",
        )

    assert "FOR UPDATE" in str(session.scalar_statements[0])
    assert error.value.code == "CONTENT_TASK_REQUIRES_ARCHIVE"


def test_publication_reference_filter_includes_terminal_history() -> None:
    """引用模式不附加待办状态门禁，默认工作台仍只查询非终态。"""

    class QueryCaptureSession:
        def __init__(self) -> None:
            self.statements: list[object] = []

        def scalar(self, statement: object) -> int:
            self.statements.append(statement)
            return 0

        def execute(self, statement: object) -> Any:
            self.statements.append(statement)
            return type("Rows", (), {"all": lambda self: []})()

    account_id = uuid.uuid4()
    reference_session = QueryCaptureSession()
    list_publication_works(
        cast(Session, reference_session),
        page=1,
        page_size=20,
        status_filter=None,
        platform_account_id=account_id,
    )
    reference_sql = str(reference_session.statements[1])
    assert "publication_works.platform_account_id" in reference_sql
    assert "publication_works.status IN" not in reference_sql

    default_session = QueryCaptureSession()
    list_publication_works(
        cast(Session, default_session),
        page=1,
        page_size=20,
        status_filter=None,
    )
    assert "publication_works.status IN" in str(default_session.statements[1])


def _content_projection(
    rows: int, *, source_type: str = "HUMAN"
) -> tuple[list[tuple[str, list[str]]], int]:
    product = _product()
    fact = _fact(product)
    task = ContentTask(
        id=uuid.uuid4(),
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=uuid.uuid4(),
        platform_profile_name_snapshot="内容平台",
        platform_website_url_snapshot=None,
        status="OPEN",
        revision=0,
        created_by=uuid.uuid4(),
        created_at=datetime(2026, 8, 4, tzinfo=UTC),
    )
    contents: list[ContentVersion] = []
    for version in range(1, rows + 1):
        body = f"正文 {version}"
        content = ContentVersion(
            id=uuid.uuid4(),
            task_id=task.id,
            fact_version_id=fact.id,
            source_job_id=uuid.uuid4() if source_type == "AI" else None,
            based_on_id=None,
            version=version,
            source_type=source_type,
            title="标题",
            summary="摘要",
            body_markdown=body,
            tags=["测试"],
            content_hash=content_hash("标题", "摘要", body, ["测试"]),
            status="DRAFT",
            revision=0,
            quality_issues=[],
            change_summary="人工版本",
            created_by=task.created_by,
            created_at=datetime(2026, 8, 4, tzinfo=UTC),
        )
        contents.append(content)
    task.current_content_version_id = contents[0].id
    delete_references = [
        [],
        [(contents[0].id, rows - 1)] if rows > 1 else [],
        [],
        [],
        [],
        [],
        [],
    ]
    session = _ScalarSequenceSession([[task], [fact], [product], [], [], *delete_references])
    projected = content_versions_out(cast(Session, session), contents)
    return [(item.primary_task, item.available_actions) for item in projected], session.scalar_calls


def test_content_current_pointer_controls_primary_task_without_n_plus_one_queries() -> None:
    """同为草稿时只有当前版本可推进，增加行数不增加批量查询次数。"""
    one_tasks, one_queries = _content_projection(1)
    two_tasks, two_queries = _content_projection(2)

    assert one_tasks == [("EDIT_AND_SUBMIT_REVIEW", ["SUBMIT_REVIEW", "SAVE", "DELETE"])]
    assert two_tasks == [
        ("EDIT_AND_SUBMIT_REVIEW", ["SUBMIT_REVIEW", "SAVE"]),
        ("VIEW_VERSION_HISTORY", ["DELETE"]),
    ]
    assert one_queries == two_queries == 12


def test_ai_draft_keeps_revision_and_abandon_actions_without_delete() -> None:
    """AI 草稿保留可追溯修订与放弃动作，不能进入人工草稿删除窗口。"""
    tasks, _queries = _content_projection(1, source_type="AI")

    assert tasks == [("EDIT_AND_SUBMIT_REVIEW", ["CREATE_REVISION", "SUBMIT_REVIEW", "ABANDON"])]


@pytest.mark.parametrize(
    ("is_enabled", "api_key_configured", "model_count", "passed_model_count", "expected"),
    [
        (False, False, 0, 0, ("INCOMPLETE", "COMPLETE_CONFIGURATION")),
        (False, True, 1, 0, ("UNVERIFIED", "TEST_MODEL")),
        (False, True, 1, 1, ("READY_TO_ENABLE", "ENABLE_CHANNEL")),
        (True, True, 1, 1, ("RUNNING", "VIEW_RUNTIME")),
    ],
)
def test_ai_channel_stage_is_exhaustive(
    is_enabled: bool,
    api_key_configured: bool,
    model_count: int,
    passed_model_count: int,
    expected: tuple[str, str],
) -> None:
    assert (
        ai_channel_stage(
            is_enabled=is_enabled,
            api_key_configured=api_key_configured,
            model_count=model_count,
            passed_model_count=passed_model_count,
        )
        == expected
    )


def test_ai_model_stage_requires_channel_and_model_readiness() -> None:
    model = cast(Any, type("Model", (), {"test_status": "PASSED", "is_enabled": True})())
    assert ai_model_stage(model, channel_enabled=False) == ("CHANNEL_DISABLED", "ENABLE_CHANNEL")
    assert ai_model_stage(model, channel_enabled=True) == ("RUNNING", "VIEW_MODEL_RUNTIME")
