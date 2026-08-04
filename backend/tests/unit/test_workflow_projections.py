"""验证服务端主任务投影只依赖权威业务状态与批量关联。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from sqlalchemy.orm import Session

from app.models.content import ContentTask, ContentVersion
from app.models.product_facts import FactVersion, Product
from app.services.ai_configuration import ai_channel_stage, ai_model_stage
from app.services.generation import content_hash
from app.services.product_facts import products_out
from app.services.projections import content_versions_out


class _ScalarSequenceSession:
    """按调用顺序返回批量查询结果，并记录查询次数。"""

    def __init__(self, rows: list[list[object]]) -> None:
        self.rows = iter(rows)
        self.scalar_calls = 0

    def scalars(self, _statement: object) -> list[object]:
        self.scalar_calls += 1
        return next(self.rows)

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
