"""内容任务创建选项、资格与幂等边界的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import TypedDict

import pytest
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.errors import AppError
from app.models.configuration import PlatformProfile, PlatformType
from app.models.content import ContentTask
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.routers.planning import _content_task_read_snapshot
from app.schemas.content import ContentTaskCreate
from app.services.content_planning import create_content_task
from app.services.content_task_queries import get_content_task_creation_options
from tests.integration.test_publication_workflow import temporary_database


class CreationGraph(TypedDict):
    user: User
    product: Product
    fact: FactVersion
    platform: PlatformProfile


def _seed_creation_graph(
    db: Session,
    *,
    suffix: str,
    fact_status: str = "APPROVED",
    fact_body: str = "## 参数\n\n工作电压 3.3 V。",
) -> CreationGraph:
    user = User(
        username=f"content-create-{suffix}",
        display_name="内容创建测试用户",
        password_hash="not-used",
        account_type="ENGINEER",
    )
    product = Product(
        part_number=f"PS-{suffix}",
        normalized_part_number=f"ps-{suffix}",
        brand="PartSignal",
        normalized_brand=f"partsignal-{suffix}",
        category="MCU",
    )
    platform_type = PlatformType(
        name=f"技术社区-{suffix}", slug=f"community-{suffix}", created_by=user.id
    )
    db.add_all([user, product])
    db.flush()
    platform_type.created_by = user.id
    db.add(platform_type)
    db.flush()
    fact = FactVersion(
        product_id=product.id,
        version=1,
        status=fact_status,
        body_markdown=fact_body,
        classification="PUBLIC",
        change_summary="初始批准事实",
        created_by=user.id,
        approved_by=user.id,
    )
    platform = PlatformProfile(
        name=f"工程师社区-{suffix}",
        slug=f"engineer-{suffix}",
        allowed_domains=[f"{suffix}.example.invalid"],
        platform_type_id=platform_type.id,
    )
    db.add_all([fact, platform])
    db.commit()
    return {"user": user, "product": product, "fact": fact, "platform": platform}


def _statement_count(engine: Engine) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        with Session(engine) as db:
            get_content_task_creation_options(db=db, requested_product_id=None)
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_creation_options_are_filtered_sorted_and_constant_query_count() -> None:
    """读模型只暴露当前合格选项，不随产品数增加 SQL。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            _content_task_read_snapshot(db)
            assert db.scalar(text("SHOW transaction_isolation")) == "repeatable read"
            empty_options = get_content_task_creation_options(
                db=db, requested_product_id=None
            )
            assert empty_options.products == []
            assert empty_options.platforms == []

            first = _seed_creation_graph(db, suffix="b")
            initial_count = _statement_count(engine)
            _seed_creation_graph(db, suffix="a")
            inactive = _seed_creation_graph(db, suffix="inactive")
            empty = _seed_creation_graph(db, suffix="empty", fact_body="   ")
            inactive["product"].status = "RETIRED"
            inactive["platform"].is_active = False
            db.commit()

            options = get_content_task_creation_options(
                db=db, requested_product_id=first["product"].id
            )
            assert [item.part_number for item in options.products] == ["PS-a", "PS-b"]
            assert [item.version for item in options.products[0].approved_fact_versions] == [1]
            assert [item.name for item in options.platforms] == [
                "工程师社区-a",
                "工程师社区-b",
                "工程师社区-empty",
            ]
            assert options.requested_product is not None
            assert options.requested_product.eligibility == "ELIGIBLE"
            assert _statement_count(engine) == initial_count == 2

            inactive_requested = get_content_task_creation_options(
                db=db, requested_product_id=inactive["product"].id
            ).requested_product
            empty_requested = get_content_task_creation_options(
                db=db, requested_product_id=empty["product"].id
            ).requested_product
            missing_requested = get_content_task_creation_options(
                db=db, requested_product_id=uuid.uuid4()
            ).requested_product
            assert inactive_requested is not None
            assert empty_requested is not None
            assert missing_requested is not None
            assert inactive_requested.eligibility == "PRODUCT_INACTIVE"
            assert empty_requested.eligibility == "NO_APPROVED_FACTS"
            assert missing_requested.eligibility == "NOT_FOUND"

        engine.dispose()


@pytest.mark.integration
def test_create_content_task_revalidates_qualification_and_idempotency() -> None:
    """POST 在事务内重新校验三个关联，并冻结幂等语义。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_creation_graph(db, suffix="primary")
            other = _seed_creation_graph(db, suffix="other")
            retired_fact = _seed_creation_graph(
                db, suffix="retired-fact", fact_status="RETIRED"
            )
            blank_fact = _seed_creation_graph(db, suffix="blank-fact", fact_body="   ")
            retired_product = _seed_creation_graph(db, suffix="retired-product")
            retired_product["product"].status = "RETIRED"
            db.commit()
            actor = graph["user"]
            payload = ContentTaskCreate(
                product_id=graph["product"].id,
                fact_version_id=graph["fact"].id,
                platform_profile_id=graph["platform"].id,
            )
            options = get_content_task_creation_options(
                db=db, requested_product_id=graph["product"].id
            )
            assert graph["platform"].id in {item.id for item in options.platforms}
            key = f"content-create-{uuid.uuid4()}"
            first = create_content_task(
                db=db,
                payload=payload,
                actor=actor,
                request_id="test-request",
                idempotency_key=key,
            )
            replay = create_content_task(
                db=db,
                payload=payload,
                actor=actor,
                request_id="test-request",
                idempotency_key=key,
            )
            assert replay.id == first.id
            assert db.scalar(select(func.count()).select_from(ContentTask)) == 1

            with pytest.raises(AppError, match="幂等键") as conflict:
                create_content_task(
                    db=db,
                    payload=payload.model_copy(
                        update={"platform_profile_id": other["platform"].id}
                    ),
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=key,
                )
            assert conflict.value.code == "IDEMPOTENCY_CONFLICT"

            cases = [
                (
                    payload.model_copy(update={"fact_version_id": other["fact"].id}),
                    "VALIDATION_ERROR",
                ),
                (
                    payload.model_copy(update={"platform_profile_id": uuid.uuid4()}),
                    "NOT_FOUND",
                ),
            ]
            for invalid_payload, expected_code in cases:
                with pytest.raises(AppError) as error:
                    create_content_task(
                        db=db,
                        payload=invalid_payload,
                        actor=actor,
                        request_id="test-request",
                        idempotency_key=f"content-create-{uuid.uuid4()}",
                    )
                assert error.value.code == expected_code

            graph["platform"].is_active = False
            db.commit()
            with pytest.raises(AppError) as platform_error:
                create_content_task(
                    db=db,
                    payload=payload,
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=f"content-create-{uuid.uuid4()}",
                )
            assert platform_error.value.code == "PLATFORM_DISABLED"

            graph["platform"].is_active = True
            db.commit()
            with pytest.raises(AppError) as fact_error:
                create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=retired_fact["product"].id,
                        fact_version_id=retired_fact["fact"].id,
                        platform_profile_id=graph["platform"].id,
                    ),
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=f"content-create-{uuid.uuid4()}",
                )
            assert fact_error.value.code == "FACT_NOT_APPROVED"

            with pytest.raises(AppError) as blank_fact_error:
                create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=blank_fact["product"].id,
                        fact_version_id=blank_fact["fact"].id,
                        platform_profile_id=graph["platform"].id,
                    ),
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=f"content-create-{uuid.uuid4()}",
                )
            assert blank_fact_error.value.code == "FACT_NOT_APPROVED"

            with pytest.raises(AppError) as product_error:
                create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=retired_product["product"].id,
                        fact_version_id=retired_product["fact"].id,
                        platform_profile_id=graph["platform"].id,
                    ),
                    actor=actor,
                    request_id="test-request",
                    idempotency_key=f"content-create-{uuid.uuid4()}",
                )
            assert product_error.value.code == "FACT_NOT_APPROVED"

        engine.dispose()


@pytest.mark.integration
def test_concurrent_idempotent_submissions_create_one_task() -> None:
    """并发的同键同载荷必须返回同一任务。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        session_factory = sessionmaker(bind=engine, expire_on_commit=False)
        with session_factory() as db:
            graph = _seed_creation_graph(db, suffix="concurrent")
            product_id = graph["product"].id
            fact_id = graph["fact"].id
            platform_id = graph["platform"].id
            actor_id = graph["user"].id
        key = f"content-create-{uuid.uuid4()}"
        barrier = Barrier(2)

        def submit() -> uuid.UUID:
            with session_factory() as db:
                actor = db.get(User, actor_id)
                assert actor is not None
                barrier.wait()
                task = create_content_task(
                    db=db,
                    payload=ContentTaskCreate(
                        product_id=product_id,
                        fact_version_id=fact_id,
                        platform_profile_id=platform_id,
                    ),
                    actor=actor,
                    request_id="concurrent-test",
                    idempotency_key=key,
                )
                return task.id

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(submit) for _ in range(2)]
            task_ids = [future.result() for future in futures]
        assert task_ids[0] == task_ids[1]
        with session_factory() as db:
            assert db.scalar(select(func.count()).select_from(ContentTask)) == 1
        engine.dispose()
