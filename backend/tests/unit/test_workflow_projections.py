"""验证服务端主任务投影只依赖权威业务状态与批量关联。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile, PlatformType
from app.models.content import ContentTask, ContentVersion
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import PlatformAccount
from app.services.ai_configuration import ai_channel_stage, ai_model_stage
from app.services.generation import content_hash
from app.services.identity import users_out
from app.services.platform_configuration import platform_types_out
from app.services.product_facts import products_out
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
        return type("TupleResult", (), {"tuples": lambda self: rows})()

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


def test_product_primary_task_changes_with_workspace_and_pending_review() -> None:
    """相同产品状态下，工作区差异与待审核版本必须投影不同下一步。"""
    product = _product()
    approved = _fact(product)
    approved_session = _ScalarSequenceSession([[], [approved]])
    approved_out = products_out(cast(Session, approved_session), [product], can_delete=False)[0]
    assert approved_out.primary_task == "CREATE_CONTENT_TASK"
    assert approved_out.deletion is None

    product.facts_body_markdown = "已修改事实"
    edited_session = _ScalarSequenceSession([[], [approved]])
    edited_out = products_out(cast(Session, edited_session), [product], can_delete=False)[0]
    assert edited_out.primary_task == "SUBMIT_FACT_REVIEW"

    pending = _fact(product, status="PENDING_REVIEW")
    pending.body_markdown = product.facts_body_markdown
    pending.version = 2
    pending_session = _ScalarSequenceSession([[], [pending, approved]])
    pending_out = products_out(cast(Session, pending_session), [product], can_delete=False)[0]
    assert pending_out.primary_task == "REVIEW_FACT"


def test_seven_constrained_delete_projections_distinguish_empty_and_blocked() -> None:
    """七类对象都以同一 ``deletion`` 结构表达当前直接引用。"""
    product = _product()
    deletable_product = products_out(
        cast(Session, _ScalarSequenceSession([[], []])), [product], can_delete=True
    )[0]
    assert deletable_product.available_actions == ["UPDATE", "DELETE"]
    assert deletable_product.deletion.model_dump() == {"blockers": []}

    product_session = _ScalarSequenceSession(
        [[(product.id, "CONTENT_TASK", 2)], []]
    )
    product_out = products_out(
        cast(Session, product_session), [product], can_delete=True
    )[0]
    assert product_out.available_actions == ["UPDATE"]
    assert product_out.deletion.model_dump() == {
        "blockers": [{"type": "CONTENT_TASK", "count": 2}]
    }

    fact = _fact(product)
    fact_out = fact_versions_out(
        cast(Session, _ScalarSequenceSession([[(fact.id, "CONTENT_VERSION", 3)]])),
        [fact],
        can_delete=True,
    )[0]
    assert "DELETE" not in fact_out.available_actions
    assert fact_out.deletion.model_dump() == {
        "blockers": [{"type": "CONTENT_VERSION", "count": 3}]
    }

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
        [[], [], [], [(profile.id, 2)], [(profile.id, 3)], []]
    )
    profile_out = platform_profiles_out(
        cast(Session, profile_session), [profile], can_manage=True
    )[0]
    assert profile_out.deletion.model_dump() == {
        "blockers": [
            {"type": "CONTENT_TASK", "count": 3},
            {"type": "PLATFORM_ACCOUNT", "count": 2},
        ]
    }

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
                    [(task.id, "GEO_OPTIMIZATION_SOURCE", 2)],
                ]
            ),
        ),
        [task],
    )[0]
    assert task_out.deletion.model_dump() == {
        "blockers": [{"type": "GEO_OPTIMIZATION_SOURCE", "count": 2}]
    }

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

    disabled_out = users_out(
        cast(Session, UserProjectionSession()), [disabled], actor=actor
    )[0]
    assert disabled_out.deletion.model_dump() == {
        "blockers": [{"type": "USER_BUSINESS_HISTORY", "count": 5}]
    }
    assert "DELETE" not in disabled_out.available_actions


def test_product_deletion_projection_keeps_fixed_query_count_for_multiple_rows() -> None:
    """增加产品行数不能把删除引用投影退化成逐行查询。"""
    one = _ScalarSequenceSession([[], []])
    many = _ScalarSequenceSession([[], []])

    products_out(cast(Session, one), [_product()], can_delete=True)
    products_out(cast(Session, many), [_product(), _product()], can_delete=True)

    assert one.scalar_calls == many.scalar_calls == 2


def test_content_task_delete_locks_then_rechecks_geo_source_blocker() -> None:
    """删除任务必须锁定目标，并按命令时事实报告 GEO 来源引用。"""
    product = _product()
    fact = _fact(product)
    task = ContentTask(
        id=uuid.uuid4(),
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=uuid.uuid4(),
        status="CANCELLED",
        revision=0,
        created_by=uuid.uuid4(),
        created_at=datetime(2026, 8, 4, tzinfo=UTC),
    )

    class DeleteSession:
        def __init__(self) -> None:
            self.scalar_values = iter([task, 0, 2])
            self.scalar_statements: list[object] = []

        def scalar(self, statement: object) -> object:
            self.scalar_statements.append(statement)
            return next(self.scalar_values)

        def scalars(self, _statement: object) -> list[object]:
            return []

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
    assert error.value.code == "CONTENT_TASK_IN_USE"
    assert error.value.details == {
        "references": [{"type": "GEO_OPTIMIZATION_SOURCE", "count": 2}]
    }


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


def _content_projection(rows: int) -> tuple[list[str], int]:
    product = _product()
    fact = _fact(product)
    task = ContentTask(
        id=uuid.uuid4(),
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=uuid.uuid4(),
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
            source_job_id=None,
            based_on_id=None,
            version=version,
            source_type="HUMAN",
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
    session = _ScalarSequenceSession([[task], [fact], [product], [], []])
    projected = content_versions_out(cast(Session, session), contents)
    return [item.primary_task for item in projected], session.scalar_calls


def test_content_current_pointer_controls_primary_task_without_n_plus_one_queries() -> None:
    """同为草稿时只有当前版本可推进，增加行数不增加批量查询次数。"""
    one_tasks, one_queries = _content_projection(1)
    two_tasks, two_queries = _content_projection(2)

    assert one_tasks == ["EDIT_AND_SUBMIT_REVIEW"]
    assert two_tasks == ["EDIT_AND_SUBMIT_REVIEW", "VIEW_VERSION_HISTORY"]
    assert one_queries == two_queries == 5


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
    assert ai_channel_stage(
        is_enabled=is_enabled,
        api_key_configured=api_key_configured,
        model_count=model_count,
        passed_model_count=passed_model_count,
    ) == expected


def test_ai_model_stage_requires_channel_and_model_readiness() -> None:
    model = cast(Any, type("Model", (), {"test_status": "PASSED", "is_enabled": True})())
    assert ai_model_stage(model, channel_enabled=False) == ("CHANNEL_DISABLED", "ENABLE_CHANNEL")
    assert ai_model_stage(model, channel_enabled=True) == ("RUNNING", "VIEW_MODEL_RUNTIME")
