"""内容任务列表读模型的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.content import ContentTask, ContentVersion
from app.models.product_facts import Product
from app.schemas.content import ContentTaskArchiveStatus
from app.services.content_task_queries import list_content_tasks
from tests.integration.test_publication_workflow import _seed_graph, temporary_database


def _statement_count(engine: Engine, *, product_id: uuid.UUID | None) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            list_content_tasks(
                db=db,
                q=None,
                workflow_stage=None,
                platform_profile_id=None,
                filter_product_id=product_id,
                filter_fact_version_id=None,
                archive_status=ContentTaskArchiveStatus.ACTIVE,
                page=1,
                page_size=10,
                can_permanently_delete=False,
            )
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_content_task_list_is_server_filtered_paged_and_pointer_authoritative() -> None:
    """列表按权威阶段稳定分页，摘要不从最大版本号猜测主线。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            first = _seed_graph(db, content_hash="1" * 64)
            second = _seed_graph(db, content_hash="2" * 64)
            first_task = first["task"]
            second_task = second["task"]
            first_product = first["product"]
            first_content = first["content"]
            assert isinstance(first_task, ContentTask)
            assert isinstance(second_task, ContentTask)
            assert isinstance(first_product, Product)
            assert isinstance(first_content, ContentVersion)

            historical = ContentVersion(
                task_id=first_task.id,
                fact_version_id=first_task.fact_version_id,
                version=99,
                source_type="HUMAN",
                title="非当前历史版本",
                summary="不得进入列表当前内容摘要",
                body_markdown="# 历史",
                tags=[],
                content_hash="9" * 64,
                status="DRAFT",
                quality_issues=[],
                change_summary="测试非当前版本",
                created_by=first_task.created_by,
            )
            db.add(historical)
            extra_tasks = [
                ContentTask(
                    product_id=second_task.product_id,
                    fact_version_id=second_task.fact_version_id,
                    platform_profile_id=second_task.platform_profile_id,
                    platform_profile_name_snapshot=second_task.platform_profile_name_snapshot,
                    platform_website_url_snapshot=second_task.platform_website_url_snapshot,
                    created_by=second_task.created_by,
                )
                for _ in range(9)
            ]
            db.add_all(extra_tasks)
            base_time = datetime.now(UTC) + timedelta(days=1)
            first_task.updated_at = base_time + timedelta(minutes=1)
            second_task.updated_at = base_time
            extra_tasks[0].updated_at = base_time - timedelta(minutes=1)
            extra_tasks[1].updated_at = base_time - timedelta(minutes=1)
            db.commit()

            page = list_content_tasks(
                db=db,
                q=first_product.part_number,
                workflow_stage="APPROVED",
                platform_profile_id=first_task.platform_profile_id,
                filter_product_id=None,
                filter_fact_version_id=None,
                archive_status=ContentTaskArchiveStatus.ACTIVE,
                page=1,
                page_size=10,
                can_permanently_delete=False,
            )
            assert page.total == 1
            assert page.items[0].id == first_task.id
            assert page.items[0].identifier == f"CT-{str(first_task.id)[:8].upper()}"
            assert page.items[0].workflow_stage == "APPROVED"
            assert page.items[0].primary_task == "START_PUBLICATION"
            assert page.items[0].current_content is not None
            assert page.items[0].current_content.id == first_content.id
            assert page.items[0].current_content.version == 1
            assert page.items[0].updated_at == first_task.updated_at

            ordered = list_content_tasks(
                db=db,
                q=None,
                workflow_stage=None,
                platform_profile_id=None,
                filter_product_id=None,
                filter_fact_version_id=None,
                archive_status=ContentTaskArchiveStatus.ACTIVE,
                page=1,
                page_size=10,
                can_permanently_delete=False,
            )
            assert ordered.total == 11
            assert [item.id for item in ordered.items[:2]] == [first_task.id, second_task.id]
            assert [item.id for item in ordered.items] == [
                item.id
                for item in sorted(
                    ordered.items,
                    key=lambda item: (item.updated_at, item.id),
                    reverse=True,
                )
            ]
            second_page = list_content_tasks(
                db=db,
                q=None,
                workflow_stage=None,
                platform_profile_id=None,
                filter_product_id=None,
                filter_fact_version_id=None,
                archive_status=ContentTaskArchiveStatus.ACTIVE,
                page=2,
                page_size=10,
                can_permanently_delete=False,
            )
            assert second_page.total == 11
            assert len(second_page.items) == 1
            legacy = list_content_tasks(
                db=db,
                q=None,
                workflow_stage=None,
                platform_profile_id=None,
                filter_product_id=None,
                filter_fact_version_id=None,
                archive_status=ContentTaskArchiveStatus.ACTIVE,
                page=None,
                page_size=None,
                can_permanently_delete=False,
            )
            assert legacy.page == 1
            assert legacy.page_size == legacy.total == len(legacy.items) == 11
            with pytest.raises(AppError) as pagination_error:
                list_content_tasks(
                    db=db,
                    q=None,
                    workflow_stage=None,
                    platform_profile_id=None,
                    filter_product_id=None,
                    filter_fact_version_id=None,
                    archive_status=ContentTaskArchiveStatus.ACTIVE,
                    page=1,
                    page_size=None,
                    can_permanently_delete=False,
                )
            assert pagination_error.value.code == "VALIDATION_ERROR"
            assert _statement_count(engine, product_id=first_product.id) == _statement_count(
                engine, product_id=None
            )

            first_task.archived_at = datetime.now(UTC)
            db.commit()
            archived = list_content_tasks(
                db=db,
                q=None,
                workflow_stage=None,
                platform_profile_id=None,
                filter_product_id=None,
                filter_fact_version_id=None,
                archive_status=ContentTaskArchiveStatus.ARCHIVED,
                page=1,
                page_size=10,
                can_permanently_delete=False,
            )
            assert [item.id for item in archived.items] == [first_task.id]
