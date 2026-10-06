"""真实 PostgreSQL 的草稿预览一致读/当前列/无写边界。"""

from collections.abc import Iterator
from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.orm import Session

from app.collectors.registry import CollectorRegistry, collector_registry
from app.models.configuration import QueryTopic
from app.models.geo_catalog import GeoSubject
from app.models.geo_prompt_variants import GeoPromptVariant
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanCreate
from app.services.geo_plans import preview_plan
from tests.integration.test_geo_profile_eligibility import CONFIGURATION, ProfileRows
from tests.integration.test_geo_profile_eligibility import rows as rows  # 共用真实模型/渠道 fixture
from tests.integration.test_migrations import run_alembic, temporary_database
from tests.unit.test_geo_collector_registry import registration

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def eligibility_engine() -> Iterator[Engine]:
    with temporary_database("partsignal_geo207") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "head")
        engine = create_engine(
            url.replace("postgresql://", "postgresql+psycopg://", 1),
            isolation_level="REPEATABLE READ",
        )
        try:
            yield engine
        finally:
            engine.dispose()


@dataclass
class MatrixRows:
    rows: ProfileRows
    subject: GeoSubject
    prompts: list[GeoPromptVariant]
    configuration: GeoMonitoringPlanCreate


@pytest.fixture
def matrix(rows: ProfileRows) -> MatrixRows:
    db = rows.db
    subject = GeoSubject(
        subject_type="OWN_BRAND",
        canonical_name="虚构预览品牌",
        normalized_name="虚构预览品牌",
        display_name="虚构预览品牌",
        created_by=rows.profile.created_by,
    )
    topic = QueryTopic(
        canonical_question="虚构预览主题", intent_type="REPLACEMENT", variants=[], revision=0
    )
    db.add_all([subject, topic])
    db.flush()
    prompts = [
        GeoPromptVariant(
            query_topic_id=topic.id,
            prompt_text=f"虚构预览问题{i}",
            mention_mode="UNBRANDED",
            language_code="zh-hans",
            region_code="CN",
            priority="CORE",
            created_by=rows.profile.created_by,
        )
        for i in range(10)
    ]
    db.add_all(prompts)
    db.flush()
    configuration = GeoMonitoringPlanCreate(
        name="虚构预览计划",
        subjects=[{"subject_id": subject.id, "role": "PRIMARY"}],
        prompt_variant_ids=[p.id for p in prompts],
        collection_profile_ids=[rows.profile.id],
    )
    return MatrixRows(rows, subject, prompts, configuration)


def preview(matrix: MatrixRows):
    return preview_plan(
        matrix.rows.db,
        matrix.configuration,
        runtime_configuration=CONFIGURATION,
        registry=CollectorRegistry(
            [
                collector_registry.resolve("manual"),
                registration(model_protocol="openai-compatible-chat-completions"),
            ]
        ),
    )


def test_current_column_facts_ignore_dirty_orm_and_preview_never_writes(matrix: MatrixRows) -> None:
    db = matrix.rows.db
    matrix.subject.is_active = False
    matrix.prompts[0].is_active = False
    matrix.rows.profile.is_active = False
    matrix.rows.channel.is_enabled = False
    statements = []

    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(db.bind, "before_cursor_execute", capture)
    try:
        result = preview(matrix)
    finally:
        event.remove(db.bind, "before_cursor_execute", capture)
    assert not result.blockers and result.run_count == 30 and result.api_run_count == 30
    assert len(statements) == 3 and all(s.lstrip().startswith("SELECT") for s in statements)
    assert len(db.dirty) == 4 and db.in_transaction()
    assert not any("FOR UPDATE" in s or "ai_channel_headers" in s for s in statements)
    assert not any("request_parameters" in s or "base_url" in s for s in statements)
    assert "fictional-ciphertext-marker" not in result.model_dump_json()
    assert "虚构预览问题" not in result.model_dump_json()
    assert db.scalar(text("SELECT count(*) FROM geo_monitoring_plans")) == 0
    assert db.scalar(text("SELECT count(*) FROM audit_logs")) == 0


def test_real_disabled_rows_and_missing_selection_are_located_without_filtering(
    matrix: MatrixRows,
) -> None:
    db = matrix.rows.db
    db.execute(
        text("UPDATE geo_subjects SET is_active=false WHERE id=:id"), {"id": matrix.subject.id}
    )
    prompt_id = matrix.prompts[0].id
    db.execute(
        text("UPDATE geo_prompt_variants SET is_active=false,revision=revision+1 WHERE id=:id"),
        {"id": prompt_id},
    )
    result = preview(matrix)
    assert result.run_count == 30
    assert {(b.code, b.resource_id) for b in result.blockers} >= {
        ("SUBJECT_DISABLED", matrix.subject.id),
        ("PROMPT_DISABLED", prompt_id),
    }
    missing = [uuid4() for _ in range(3)]
    raw = matrix.configuration.model_dump()
    raw.update(
        subjects=[{"subject_id": missing[0], "role": "PRIMARY"}],
        prompt_variant_ids=[missing[1]],
        collection_profile_ids=[missing[2]],
    )
    matrix.configuration = GeoMonitoringPlanCreate.model_validate(raw)
    result = preview(matrix)
    assert result.run_count == result.unresolved_run_count == 3
    assert {b.code for b in result.blockers} == {
        "SUBJECT_NOT_FOUND",
        "PROMPT_NOT_FOUND",
        "PROFILE_NOT_FOUND",
    }
    assert result.estimated_cost.value is None and result.estimated_cost.unknown_run_count == 3


def test_read_committed_caller_is_rejected_without_changing_its_transaction(
    matrix: MatrixRows,
) -> None:
    engine = matrix.rows.db.get_bind().execution_options(isolation_level="READ COMMITTED")
    with Session(engine) as db:
        with pytest.raises(ValueError, match="一致快照"):
            preview_plan(db, matrix.configuration)
        assert db.in_transaction()


def test_repeatable_read_preview_keeps_one_snapshot_then_sees_current_disable(
    matrix: MatrixRows,
) -> None:
    db = matrix.rows.db
    configuration = matrix.configuration
    profile_id: UUID = matrix.rows.profile.id
    db.commit()
    assert not preview(matrix).blockers
    engine = db.get_bind()
    with engine.begin() as writer:
        writer.execute(
            text(
                "UPDATE geo_collection_profiles SET is_active=false,revision=revision+1 "
                "WHERE id=:id"
            ),
            {"id": profile_id},
        )
    # 同一RR事务看到同一旧快照，预览不提交调用方事务。
    assert not preview(matrix).blockers
    db.rollback()
    result = preview_plan(
        db,
        configuration,
        runtime_configuration=CONFIGURATION,
        registry=CollectorRegistry(
            [registration(model_protocol="openai-compatible-chat-completions")]
        ),
    )
    assert any(
        b.code == "PROFILE_DISABLED" and b.resource_id == profile_id for b in result.blockers
    )


def test_default_registry_rejects_automatic_profile_in_preview(matrix: MatrixRows) -> None:
    result = preview_plan(matrix.rows.db, matrix.configuration, runtime_configuration=CONFIGURATION)
    assert result.run_count == 30 and result.estimated_cost.value is None
    assert {b.code for b in result.blockers} == {"ADAPTER_UNKNOWN"}
