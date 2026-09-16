"""Frontend V2 GEO 更正上下文与追加命令的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from hashlib import sha256
from threading import Event
from time import monotonic
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.ai_generation import GenerationJob
from app.models.configuration import PlatformProfile
from app.models.content import (
    ContentReviewRecord,
    ContentTask,
    ContentTaskGeoSource,
    ContentVersion,
)
from app.models.geo_files import (
    FileRecord,
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationCitation,
    GeoObservationPublication,
)
from app.models.identity import AuditLog, User
from app.models.product_facts import FactReviewRecord, FactVersion, Product
from app.models.publication import (
    PlatformAccount,
    PublicationAttachment,
    PublicationVerification,
    PublicationWork,
    PublicationWorkEvent,
    PublishedArticle,
    PublishedContentIssue,
)
from app.schemas.geo_files import GeoArticleResultCreate, GeoObservationCreate
from app.security import hash_token
from app.services import geo_observation as geo_service
from app.services.geo_observation import (
    create_geo_observation,
    get_geo_observation_correction_context,
)
from tests.integration.test_geo_observation_detail import _evidence, _statement_count
from tests.integration.test_publication_workflow import (
    _complete_publication,
    _seed_graph,
    temporary_database,
)


def _complete_publication_for_product(
    db: Session,
    graph: dict[str, object],
    *,
    suffix: str,
) -> PublicationWork:
    """为同一产品建立一条独立内容主线并完成发布。"""
    actor = graph["user"]
    product = graph["product"]
    fact = graph["fact"]
    profile = graph["profile"]
    account = graph["account"]
    assert isinstance(actor, User)
    assert isinstance(product, Product)
    assert isinstance(fact, FactVersion)
    assert isinstance(profile, PlatformProfile)
    assert isinstance(account, PlatformAccount)
    task = ContentTask(
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=profile.id,
        platform_profile_name_snapshot=profile.name,
        platform_website_url_snapshot=profile.website_url,
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
    content = ContentVersion(
        task_id=task.id,
        fact_version_id=fact.id,
        version=1,
        source_type="HUMAN",
        title=f"GEO 更正测试文章 {suffix}",
        summary="冻结事实摘要",
        body_markdown="# GEO 更正测试\n\n独立发布主线。",
        tags=["GEO"],
        content_hash=sha256(suffix.encode()).hexdigest(),
        status="APPROVED",
        quality_issues=[],
        change_summary="GEO 更正集成测试",
        created_by=actor.id,
    )
    db.add(content)
    db.flush()
    task.current_content_version_id = content.id
    db.commit()
    return _complete_publication(
        db,
        {**graph, "task": task, "content": content},
        suffix=suffix,
    )


@pytest.mark.integration
def test_geo_correction_context_and_append_preserve_authoritative_chain() -> None:
    """上下文裁决尾节点与候选，POST 只追加新事实和新证据。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="c" * 64)
            actor = graph["user"]
            product = graph["product"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            assert isinstance(product, Product)
            actor.account_type = "ADMIN"

            retained = _complete_publication(db, graph, suffix="geo-correction-retained")
            removed = _complete_publication_for_product(
                db,
                graph,
                suffix="geo-correction-removed",
            )
            original_evidence = _evidence(
                db,
                actor,
                name="geo-correction-original",
                category="OPERATION_SCREENSHOT",
            )
            original = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=None,
                product_id=product.id,
                search_platform="Perplexity",
                search_query="追加式更正测试",
                tested_at=datetime(2026, 8, 10, 8, tzinfo=UTC),
                notes="不可变原始记录",
                tested_by=actor.id,
            )
            constraint_definition = db.scalar(
                text(
                    """
                    SELECT pg_get_constraintdef(oid)
                    FROM pg_constraint
                    WHERE conrelid = 'geo_observations'::regclass
                      AND conname = 'ck_geo_observations_kind_fields'
                    """
                )
            )
            assert isinstance(constraint_definition, str)
            # 0022 的 NOT VALID 约束保留迁移前空 Topic；测试临时复现该历史行。
            db.execute(
                text("ALTER TABLE geo_observations DROP CONSTRAINT ck_geo_observations_kind_fields")
            )
            db.add(original)
            db.flush()
            db.add_all(
                [
                    GeoObservationAttachment(
                        observation_id=original.id,
                        file_id=original_evidence.id,
                    ),
                    GeoObservationPublication(
                        observation_id=original.id,
                        published_article_id=retained.id,
                        discovered=True,
                        mentioned=False,
                        accuracy="PARTIAL",
                    ),
                    GeoObservationPublication(
                        observation_id=original.id,
                        published_article_id=removed.id,
                        discovered=False,
                        mentioned=False,
                        accuracy="UNJUDGEABLE",
                    ),
                    PublishedContentIssue(
                        published_article_id=removed.id,
                        kind="CONTENT_CHANGED",
                        description="文章已退出当前 GEO 候选",
                        status="OPEN",
                        opened_by=actor.id,
                    ),
                ]
            )
            db.commit()
            db.execute(
                text(
                    "ALTER TABLE geo_observations "
                    "ADD CONSTRAINT ck_geo_observations_kind_fields "
                    f"{constraint_definition}"
                )
            )
            db.commit()

            added = _complete_publication_for_product(
                db,
                graph,
                suffix="geo-correction-added",
            )
            context = get_geo_observation_correction_context(db, original.id, actor=actor)
            assert context.detail.selected_observation_id == original.id
            assert context.detail.chain_tail_id == original.id
            assert [item.id for item in context.query_topic_options] == [topic.id]
            results = {
                item.published_article_id: item for item in context.correction_article_results
            }
            assert set(results) == {retained.id, added.id}
            assert (
                results[retained.id].discovered,
                results[retained.id].mentioned,
                results[retained.id].accuracy,
            ) == (True, False, "PARTIAL")
            assert (
                results[added.id].discovered,
                results[added.id].mentioned,
                results[added.id].accuracy,
            ) == (None, None, None)
            assert {
                item.published_article_id
                for item in context.detail.correction_history[0].observation.article_results
            } == {retained.id, removed.id}

            unauthorized = SimpleNamespace(id=actor.id, account_type="VIEWER")
            with pytest.raises(AppError, match="没有执行此操作") as forbidden:
                get_geo_observation_correction_context(
                    db,
                    original.id,
                    actor=unauthorized,  # type: ignore[arg-type]
                )
            assert forbidden.value.status_code == 403

            new_evidence = _evidence(
                db,
                actor,
                name="geo-correction-new",
                category="OPERATION_SCREENSHOT",
            )
            payload = GeoObservationCreate(
                product_id=product.id,
                query_topic_id=topic.id,
                search_platform="Perplexity",
                search_query="追加式更正测试",
                tested_at=datetime(2026, 8, 12, 8, tzinfo=UTC),
                article_results=[
                    GeoArticleResultCreate(
                        published_article_id=retained.id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    ),
                    GeoArticleResultCreate(
                        published_article_id=added.id,
                        discovered=False,
                        mentioned=False,
                        accuracy=None,
                    ),
                ],
                attachment_file_ids=[new_evidence.id],
                notes="本次更正原因",
                supersedes_id=context.detail.chain_tail_id,
            )
            correction = create_geo_observation(
                db=db,
                payload=payload,
                actor=actor,
                request_id="geo-correction-success",
            )

            persisted_original = db.get(GeoObservation, original.id)
            assert persisted_original is not None
            assert persisted_original.notes == "不可变原始记录"
            assert correction.supersedes_id == original.id
            assert db.scalars(
                select(GeoObservationAttachment.file_id).where(
                    GeoObservationAttachment.observation_id == correction.id
                )
            ).all() == [new_evidence.id]
            latest = get_geo_observation_correction_context(db, original.id, actor=actor)
            assert latest.detail.chain_tail_id == correction.id
            assert latest.query_topic_options == []
            assert latest.detail.correction_history[0].evidence[0].file.id == original_evidence.id
            assert latest.detail.correction_history[1].evidence[0].file.id == new_evidence.id

            with pytest.raises(AppError, match="已被纠正") as non_tail:
                create_geo_observation(
                    db=db,
                    payload=payload,
                    actor=actor,
                    request_id="geo-correction-non-tail",
                )
            assert (
                non_tail.value.status_code,
                non_tail.value.code,
                non_tail.value.message,
                non_tail.value.details,
            ) == (
                409,
                "GEO_OBSERVATION_HAS_SUCCESSOR",
                "该 GEO 观测已被纠正",
                {},
            )

            duplicate_evidence = payload.model_copy(
                update={
                    "supersedes_id": correction.id,
                    "attachment_file_ids": [original_evidence.id],
                }
            )
            with pytest.raises(AppError, match="不能重复关联") as reused:
                create_geo_observation(
                    db=db,
                    payload=duplicate_evidence,
                    actor=actor,
                    request_id="geo-correction-reused-evidence",
                )
            assert reused.value.status_code == 422

            changed_platform = payload.model_copy(
                update={
                    "supersedes_id": correction.id,
                    "attachment_file_ids": [],
                    "search_platform": "Google",
                }
            )
            with pytest.raises(AppError, match="不能改变") as frozen:
                create_geo_observation(
                    db=db,
                    payload=changed_platform,
                    actor=actor,
                    request_id="geo-correction-frozen-field",
                )
            assert frozen.value.status_code == 422

            _complete_publication_for_product(
                db,
                graph,
                suffix="geo-correction-stale",
            )
            stale_candidates = payload.model_copy(
                update={
                    "supersedes_id": correction.id,
                    "attachment_file_ids": [],
                }
            )
            with pytest.raises(AppError, match="文章集合已变化") as stale:
                create_geo_observation(
                    db=db,
                    payload=stale_candidates,
                    actor=actor,
                    request_id="geo-correction-stale-candidates",
                )
            assert stale.value.code == "GEO_PUBLICATIONS_CHANGED"
            assert db.scalar(select(func.count(GeoObservation.id))) == 2


@pytest.mark.integration
def test_geo_correction_context_rejects_legacy_observation() -> None:
    """旧模型详情即使完整，也不能进入追加式更正工作台。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="b" * 64)
            actor = graph["user"]
            product = graph["product"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            publication = _complete_publication(db, graph, suffix="geo-correction-legacy")
            legacy = GeoObservation(
                observation_kind="LEGACY_MODEL_RESULT",
                query_topic_id=topic.id,
                product_id=product.id,
                actual_prompt="旧模型问题",
                model_name="ChatGPT",
                model_version="legacy",
                tested_at=datetime(2026, 8, 9, 8, tzinfo=UTC),
                web_search_enabled=True,
                answer_summary="旧模型回答",
                mentioned=True,
                recommendation="RECOMMENDED",
                accuracy="ACCURATE",
                notes="",
                tested_by=actor.id,
            )
            db.add(legacy)
            db.flush()
            db.add(
                GeoObservationPublication(
                    observation_id=legacy.id,
                    published_article_id=publication.id,
                    discovered=None,
                    mentioned=None,
                    accuracy=None,
                )
            )
            db.commit()

            with pytest.raises(AppError, match="旧模型 GEO 观测不能追加更正") as error:
                get_geo_observation_correction_context(db, legacy.id, actor=actor)
            assert error.value.code == "INVALID_STATE_TRANSITION"
            assert error.value.status_code == 409


@pytest.mark.integration
def test_geo_correction_context_query_count_is_independent_of_chain_length() -> None:
    """更正上下文沿用批量详情投影，不按历史节点追加查询。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="e" * 64)
            actor = graph["user"]
            product = graph["product"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            actor.account_type = "ADMIN"
            publication = _complete_publication(db, graph, suffix="geo-correction-count")

            chain: list[GeoObservation] = []
            for index in range(5):
                observation = GeoObservation(
                    observation_kind="MANUAL_ARTICLE_SEARCH",
                    query_topic_id=topic.id,
                    product_id=product.id,
                    search_platform="Perplexity",
                    search_query="固定更正上下文查询次数",
                    tested_at=datetime(2026, 8, 8 + index, 8, tzinfo=UTC),
                    notes="",
                    supersedes_id=chain[-1].id if chain else None,
                    tested_by=actor.id,
                )
                db.add(observation)
                db.flush()
                chain.append(observation)
                db.add(
                    GeoObservationPublication(
                        observation_id=observation.id,
                        published_article_id=publication.id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    )
                )
                db.flush()
                if index == 0:
                    one_node_count = _statement_count(
                        engine,
                        lambda: get_geo_observation_correction_context(
                            db,
                            chain[0].id,
                            actor=actor,
                        ),
                    )
            db.commit()

            five_node_count = _statement_count(
                engine,
                lambda: get_geo_observation_correction_context(
                    db,
                    chain[0].id,
                    actor=actor,
                ),
            )
            assert one_node_count == five_node_count


def _seed_successor_case(
    db: Session,
    *,
    suffix: str,
    content_hash: str,
) -> dict[str, object]:
    """用 current-head 全部约束创建合法 predecessor、候选和两份独立证据。"""
    graph = _seed_graph(db, content_hash=content_hash)
    actor = graph["user"]
    product = graph["product"]
    topic = graph["topic"]
    assert isinstance(actor, User)
    assert isinstance(product, Product)
    actor.account_type = "ADMIN"
    publication = _complete_publication(db, graph, suffix=suffix)
    predecessor = GeoObservation(
        observation_kind="MANUAL_ARTICLE_SEARCH",
        query_topic_id=topic.id,
        product_id=product.id,
        search_platform="Perplexity",
        search_query=f"{suffix} successor test",
        tested_at=datetime(2026, 9, 15, 8, tzinfo=UTC),
        notes="不可变 predecessor",
        tested_by=actor.id,
    )
    db.add(predecessor)
    db.flush()
    db.add(
        GeoObservationPublication(
            observation_id=predecessor.id,
            published_article_id=publication.id,
            discovered=False,
            mentioned=False,
            accuracy="UNJUDGEABLE",
        )
    )
    winner_evidence = _evidence(
        db,
        actor,
        name=f"w-{suffix}",
        category="OPERATION_SCREENSHOT",
    )
    loser_evidence = _evidence(
        db,
        actor,
        name=f"l-{suffix}",
        category="OPERATION_SCREENSHOT",
    )
    db.commit()
    payload = GeoObservationCreate(
        product_id=product.id,
        query_topic_id=topic.id,
        search_platform="Perplexity",
        search_query=f"{suffix} successor test",
        tested_at=datetime(2026, 9, 16, 8, tzinfo=UTC),
        article_results=[
            GeoArticleResultCreate(
                published_article_id=publication.id,
                discovered=True,
                mentioned=True,
                accuracy="ACCURATE",
            )
        ],
        attachment_file_ids=[winner_evidence.id],
        notes="winner correction",
        supersedes_id=predecessor.id,
    )
    return {
        "actor_id": actor.id,
        "predecessor_id": predecessor.id,
        "publication_id": publication.id,
        "winner_evidence_id": winner_evidence.id,
        "loser_evidence_id": loser_evidence.id,
        "payload": payload,
    }


def _successor_snapshot(db: Session) -> dict[str, object]:
    """冻结 GEO、内容、发布、文件与审计全行，证明 loser 没有部分副作用。"""
    models = (
        ContentTask,
        ContentTaskGeoSource,
        ContentVersion,
        ContentReviewRecord,
        GenerationJob,
        FactReviewRecord,
        PublicationWork,
        PublicationWorkEvent,
        PublicationVerification,
        PublicationAttachment,
        PublishedArticle,
        PublishedContentIssue,
        FileRecord,
        GeoObservation,
        GeoObservationPublication,
        GeoObservationAttachment,
        GeoObservationCitation,
        AuditLog,
    )
    return {
        model.__tablename__: sorted(
            (dict(row) for row in db.execute(select(model.__table__)).mappings()),
            key=repr,
        )
        for model in models
    }


def _assert_successor_conflict(error: AppError) -> None:
    assert (error.status_code, error.code, error.message, error.details) == (
        409,
        "GEO_OBSERVATION_HAS_SUCCESSOR",
        "该 GEO 观测已被纠正",
        {},
    )


def _hide_successor_precheck(patch: pytest.MonkeyPatch, db: Session) -> list[str]:
    """只隐藏一次 successor precheck，保留其他读取和全部数据库防线。"""
    real_scalar = db.scalar
    hits: list[str] = []

    def scalar(statement: object, *args: object, **kwargs: object) -> object:
        sql = str(statement)
        if (
            not hits
            and "SELECT geo_observations.id" in sql
            and "geo_observations.supersedes_id =" in sql
        ):
            hits.append("successor")
            return None
        return real_scalar(statement, *args, **kwargs)

    patch.setattr(db, "scalar", scalar)
    return hits


@pytest.mark.integration
def test_geo_successor_current_head_catalog_and_real_duplicate_diagnostics() -> None:
    """partial unique catalog 与真实 INSERT 共同证明 exact mapper 的唯一目标。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                case = _seed_successor_case(
                    db,
                    suffix="geo-successor-catalog",
                    content_hash="1" * 64,
                )
                catalog = (
                    db.execute(
                        text("""
                    SELECT ns.nspname AS schema_name, tbl.relname AS table_name,
                           idx.relname AS index_name, am.amname AS access_method,
                           i.indisunique, i.indimmediate, i.indisvalid, i.indisready,
                           i.indnkeyatts, i.indnatts, i.indexprs IS NULL AS no_expressions,
                           pg_get_indexdef(i.indexrelid) AS definition,
                           pg_get_expr(i.indpred, i.indrelid) AS predicate,
                           ARRAY(
                               SELECT a.attname
                               FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, ord)
                               JOIN pg_attribute a
                                 ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                               WHERE k.ord <= i.indnkeyatts
                               ORDER BY k.ord
                           ) AS key_columns,
                           ARRAY(
                               SELECT k.attnum
                               FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum, ord)
                               WHERE k.ord <= i.indnkeyatts
                               ORDER BY k.ord
                           ) AS key_attnums,
                           c.conname
                    FROM pg_index i
                    JOIN pg_class idx ON idx.oid = i.indexrelid
                    JOIN pg_class tbl ON tbl.oid = i.indrelid
                    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
                    JOIN pg_am am ON am.oid = idx.relam
                    LEFT JOIN pg_constraint c ON c.conindid = i.indexrelid
                    WHERE ns.nspname = 'public'
                      AND tbl.relname = 'geo_observations'
                      AND idx.relname = 'uq_geo_observations_supersedes_once'
                """),
                    )
                    .mappings()
                    .one()
                )
                assert catalog["schema_name"] == "public"
                assert catalog["table_name"] == "geo_observations"
                assert catalog["index_name"] == "uq_geo_observations_supersedes_once"
                assert catalog["access_method"] == "btree"
                assert all(
                    catalog[field]
                    for field in (
                        "indisunique",
                        "indimmediate",
                        "indisvalid",
                        "indisready",
                        "no_expressions",
                    )
                )
                assert (catalog["indnkeyatts"], catalog["indnatts"]) == (1, 1)
                assert catalog["key_columns"] == ["supersedes_id"]
                assert all(attnum > 0 for attnum in catalog["key_attnums"])
                assert catalog["predicate"] == "(supersedes_id IS NOT NULL)"
                assert "UNIQUE INDEX uq_geo_observations_supersedes_once" in catalog["definition"]
                assert catalog["conname"] is None

                payload = case["payload"]
                assert isinstance(payload, GeoObservationCreate)
                actor = db.get(User, case["actor_id"])
                assert actor is not None
                winner = create_geo_observation(
                    db=db,
                    payload=payload,
                    actor=actor,
                    request_id="geo-successor-catalog-winner",
                )
                baseline = _successor_snapshot(db)
                duplicate = GeoObservation(
                    observation_kind="MANUAL_ARTICLE_SEARCH",
                    query_topic_id=payload.query_topic_id,
                    product_id=payload.product_id,
                    search_platform=payload.search_platform,
                    search_query=payload.search_query,
                    tested_at=payload.tested_at,
                    notes="真实 duplicate",
                    supersedes_id=payload.supersedes_id,
                    tested_by=actor.id,
                )
                db.add(duplicate)
                with pytest.raises(IntegrityError) as captured:
                    db.flush()
                assert (captured.value.orig.sqlstate, captured.value.orig.diag.constraint_name) == (
                    "23505",
                    "uq_geo_observations_supersedes_once",
                )
                assert geo_service._is_geo_observation_successor_integrity_error(captured.value)
                db.rollback()
                assert db.scalar(text("SELECT 1")) == 1
                assert _successor_snapshot(db) == baseline
                assert db.get(GeoObservation, winner.id) is not None
        finally:
            engine.dispose()


@pytest.mark.parametrize(
    ("sqlstate", "constraint_name"),
    [
        ("23505", "pk_geo_observations"),
        ("23505", "uq_geo_observations_supersedes_once_suffix"),
        ("23505", " UQ_GEO_OBSERVATIONS_SUPERSEDES_ONCE"),
        ("23505", b"uq_geo_observations_supersedes_once"),
        ("23505", ["uq_geo_observations_supersedes_once"]),
        ("23505", None),
        (None, "uq_geo_observations_supersedes_once"),
        ("23503", "uq_geo_observations_supersedes_once"),
        ("23514", "uq_geo_observations_supersedes_once"),
        ("23502", "uq_geo_observations_supersedes_once"),
        ("55000", "uq_geo_observations_supersedes_once"),
    ],
)
def test_geo_successor_integrity_classifier_fails_closed(
    sqlstate: object,
    constraint_name: object,
) -> None:
    class DiagnosticsOnly:
        constraint_name = "uq_geo_observations_supersedes_once"

        def __init__(self) -> None:
            self.sqlstate = sqlstate
            self.diag = (
                SimpleNamespace(constraint_name=constraint_name)
                if constraint_name is not None
                else None
            )

        def __str__(self) -> str:
            raise AssertionError("classifier 不得读取 driver message")

    error = IntegrityError(
        "uq_geo_observations_supersedes_once",
        {},
        DiagnosticsOnly(),
    )
    assert not geo_service._is_geo_observation_successor_integrity_error(error)


@pytest.mark.integration
@pytest.mark.parametrize("boundary", ["relations", "commit"])
def test_geo_successor_exact_diagnostics_outside_root_flush_remain_unknown(
    monkeypatch: pytest.MonkeyPatch,
    boundary: str,
) -> None:
    """relation 与 commit 即使命中同名 diagnostics，也不属于 successor mapper。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                case = _seed_successor_case(
                    db,
                    suffix=f"geo-successor-late-{boundary}",
                    content_hash=("2" if boundary == "relations" else "3") * 64,
                )
                payload = case["payload"]
                assert isinstance(payload, GeoObservationCreate)
                actor = db.get(User, case["actor_id"])
                assert actor is not None
                baseline = _successor_snapshot(db)
                error = IntegrityError(
                    "INSERT",
                    {},
                    SimpleNamespace(
                        sqlstate="23505",
                        diag=SimpleNamespace(constraint_name="uq_geo_observations_supersedes_once"),
                    ),
                )

                def fail(*_args: object, **_kwargs: object) -> None:
                    raise error

                with monkeypatch.context() as patch:
                    patch.setattr(db, "add_all" if boundary == "relations" else "commit", fail)
                    with pytest.raises(IntegrityError) as raised:
                        create_geo_observation(
                            db=db,
                            payload=payload,
                            actor=actor,
                            request_id=f"geo-successor-late-{boundary}",
                        )
                    assert raised.value is error
                db.rollback()
                assert _successor_snapshot(db) == baseline
        finally:
            engine.dispose()


@pytest.mark.integration
@pytest.mark.parametrize("bypass", [False, True], ids=["production-lock", "unique-race"])
def test_geo_successor_concurrency_has_one_winner_and_exact_owner(
    monkeypatch: pytest.MonkeyPatch,
    bypass: bool,
) -> None:
    """分别证明生产锁串行化与 test-only 真实 partial unique 仲裁。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        held = Event()
        release = Event()
        loser_ready = Event()
        loser_insert_sent = Event()
        pids: dict[str, int] = {}
        matched: dict[str, set[str]] = {"winner": set(), "loser": set()}
        precheck_hits: dict[str, int] = {"winner": 0, "loser": 0}
        diagnostics: list[tuple[str, str]] = []
        try:
            with Session(engine, expire_on_commit=False) as seed:
                case = _seed_successor_case(
                    seed,
                    suffix=f"geo-successor-race-{bypass}",
                    content_hash=("4" if bypass else "5") * 64,
                )
                payload = case["payload"]
                assert isinstance(payload, GeoObservationCreate)
                loser_payload = payload.model_copy(
                    update={
                        "attachment_file_ids": [case["loser_evidence_id"]],
                        "notes": "loser correction",
                    }
                )
                baseline = _successor_snapshot(seed)

            real_classifier = geo_service._is_geo_observation_successor_integrity_error

            def classify(error: IntegrityError) -> bool:
                diagnostics.append((error.orig.sqlstate, error.orig.diag.constraint_name))
                return real_classifier(error)

            monkeypatch.setattr(
                geo_service,
                "_is_geo_observation_successor_integrity_error",
                classify,
            )

            def request(first: bool) -> object:
                label = "winner" if first else "loser"
                selected_payload = payload if first else loser_payload
                with (
                    Session(engine, expire_on_commit=False) as db,
                    pytest.MonkeyPatch.context() as patch,
                ):
                    connection = db.connection()
                    db.execute(text("SET LOCAL statement_timeout = '12s'"))
                    pid = db.scalar(text("SELECT pg_backend_pid()"))
                    assert isinstance(pid, int)
                    pids[label] = pid
                    actor = db.get(User, case["actor_id"])
                    assert actor is not None
                    real_scalar = db.scalar

                    def scalar(statement: object, *args: object, **kwargs: object) -> object:
                        sql = str(statement)
                        if (
                            bypass
                            and "SELECT geo_observations.id" in sql
                            and "geo_observations.supersedes_id =" in sql
                        ):
                            precheck_hits[label] += 1
                            return None
                        return real_scalar(statement, *args, **kwargs)

                    patch.setattr(db, "scalar", scalar)

                    def before(
                        _conn: object,
                        _cursor: object,
                        statement: str,
                        parameters: object,
                        _context: object,
                        _many: bool,
                    ) -> tuple[str, object]:
                        if bypass and "FOR UPDATE" in statement:
                            owner = None
                            if "FROM products" in statement and "WHERE products.id =" in statement:
                                owner = "product"
                            elif (
                                "FROM published_articles" in statement
                                and "FOR UPDATE OF published_articles" in statement
                            ):
                                owner = "articles"
                            elif (
                                "FROM geo_observations" in statement
                                and "WHERE geo_observations.id =" in statement
                                and "geo_observations.supersedes_id" in statement
                            ):
                                owner = "previous"
                            if owner is not None:
                                matched[label].add(owner)
                                statement = statement.rsplit(" FOR UPDATE", 1)[0]
                        if not first and statement.startswith("INSERT INTO geo_observations "):
                            loser_insert_sent.set()
                        return statement, parameters

                    def after(
                        _conn: object,
                        _cursor: object,
                        statement: str,
                        _parameters: object,
                        _context: object,
                        _many: bool,
                    ) -> None:
                        if first and statement.startswith("INSERT INTO geo_observations "):
                            held.set()
                            if not release.wait(10):
                                raise TimeoutError("等待释放 GEO successor winner 超时")

                    event.listen(connection, "before_cursor_execute", before, retval=True)
                    event.listen(connection, "after_cursor_execute", after)
                    try:
                        if not first:
                            loser_ready.set()
                        try:
                            return create_geo_observation(
                                db=db,
                                payload=selected_payload,
                                actor=actor,
                                request_id=f"geo-successor-{label}",
                            )
                        except AppError as error:
                            _assert_successor_conflict(error)
                            assert db.is_active
                            assert db.get(User, case["actor_id"]) is not None
                            assert (
                                db.scalar(
                                    select(func.count())
                                    .select_from(GeoObservation)
                                    .where(GeoObservation.supersedes_id == case["predecessor_id"])
                                )
                                == 1
                            )
                            return error
                    finally:
                        event.remove(connection, "before_cursor_execute", before)
                        event.remove(connection, "after_cursor_execute", after)

            with ThreadPoolExecutor(max_workers=2) as executor:
                winner_future = executor.submit(request, True)
                loser_future = None
                try:
                    assert held.wait(10)
                    loser_future = executor.submit(request, False)
                    assert loser_ready.wait(10)
                    deadline = monotonic() + 8
                    observed = None
                    with engine.connect().execution_options(
                        isolation_level="AUTOCOMMIT"
                    ) as monitor:
                        while monotonic() < deadline:
                            observed = (
                                monitor.execute(
                                    text("""
                                SELECT a.query, a.wait_event_type, a.wait_event,
                                       pg_blocking_pids(a.pid) AS blockers,
                                       EXISTS (
                                           SELECT 1 FROM pg_locks l
                                           WHERE l.pid = a.pid
                                             AND l.locktype = 'transactionid'
                                             AND NOT l.granted
                                       ) AS waiting_transactionid
                                FROM pg_stat_activity a WHERE a.pid = :pid
                            """),
                                    {"pid": pids["loser"]},
                                )
                                .mappings()
                                .one()
                            )
                            if (
                                observed["wait_event_type"] == "Lock"
                                and pids["winner"] in observed["blockers"]
                            ):
                                break
                        else:
                            pytest.fail("未观察到 GEO successor 的指定 PostgreSQL blocker")
                    assert observed is not None
                    if bypass:
                        assert observed["query"].startswith("INSERT INTO geo_observations ")
                        assert observed["wait_event"] == "transactionid"
                        assert observed["waiting_transactionid"]
                        assert loser_insert_sent.is_set()
                    else:
                        assert "FROM products" in observed["query"]
                        assert "FOR UPDATE" in observed["query"]
                        assert not loser_insert_sent.is_set()
                    assert diagnostics == []
                finally:
                    release.set()
                winner = winner_future.result(timeout=15)
                assert loser_future is not None
                loser = loser_future.result(timeout=15)
                assert isinstance(winner, GeoObservation)
                assert isinstance(loser, AppError)

            assert pids["winner"] != pids["loser"]
            if bypass:
                assert matched == {
                    "winner": {"product", "articles", "previous"},
                    "loser": {"product", "articles", "previous"},
                }
                assert precheck_hits == {"winner": 1, "loser": 1}
                assert diagnostics == [("23505", "uq_geo_observations_supersedes_once")]
            else:
                assert matched == {"winner": set(), "loser": set()}
                assert precheck_hits == {"winner": 0, "loser": 0}
                assert diagnostics == []

            with Session(engine, expire_on_commit=False) as verify:
                after = _successor_snapshot(verify)
                for table, rows in baseline.items():
                    if table not in {
                        "geo_observations",
                        "geo_observation_publications",
                        "geo_observation_attachments",
                    }:
                        assert after[table] == rows
                before_observations = {
                    row["id"]: row for row in baseline["geo_observations"]
                }
                after_observations = {
                    row["id"]: row for row in after["geo_observations"]
                }
                assert set(after_observations) == {*before_observations, winner.id}
                assert all(
                    after_observations[observation_id] == row
                    for observation_id, row in before_observations.items()
                )
                assert {
                    key: after_observations[winner.id][key]
                    for key in (
                        "observation_kind",
                        "query_topic_id",
                        "product_id",
                        "search_platform",
                        "search_query",
                        "tested_at",
                        "notes",
                        "supersedes_id",
                        "tested_by",
                    )
                } == {
                    "observation_kind": "MANUAL_ARTICLE_SEARCH",
                    "query_topic_id": payload.query_topic_id,
                    "product_id": payload.product_id,
                    "search_platform": payload.search_platform,
                    "search_query": payload.search_query,
                    "tested_at": payload.tested_at,
                    "notes": payload.notes,
                    "supersedes_id": case["predecessor_id"],
                    "tested_by": case["actor_id"],
                }
                before_publications = {
                    (row["observation_id"], row["published_article_id"]): row
                    for row in baseline["geo_observation_publications"]
                }
                after_publications = {
                    (row["observation_id"], row["published_article_id"]): row
                    for row in after["geo_observation_publications"]
                }
                winner_publication_key = (winner.id, case["publication_id"])
                assert set(after_publications) == {
                    *before_publications,
                    winner_publication_key,
                }
                assert all(
                    after_publications[key] == row
                    for key, row in before_publications.items()
                )
                assert {
                    key: after_publications[winner_publication_key][key]
                    for key in ("discovered", "mentioned", "accuracy")
                } == {
                    "discovered": True,
                    "mentioned": True,
                    "accuracy": "ACCURATE",
                }
                before_attachments = {
                    (row["observation_id"], row["file_id"]): row
                    for row in baseline["geo_observation_attachments"]
                }
                after_attachments = {
                    (row["observation_id"], row["file_id"]): row
                    for row in after["geo_observation_attachments"]
                }
                winner_attachment_key = (winner.id, case["winner_evidence_id"])
                assert set(after_attachments) == {
                    *before_attachments,
                    winner_attachment_key,
                }
                assert all(
                    after_attachments[key] == row
                    for key, row in before_attachments.items()
                )
                successors = verify.scalars(
                    select(GeoObservation).where(
                        GeoObservation.supersedes_id == case["predecessor_id"]
                    )
                ).all()
                assert [item.id for item in successors] == [winner.id]
                assert verify.get(GeoObservation, case["predecessor_id"]) is not None
                assert verify.scalars(
                    select(GeoObservationPublication.published_article_id).where(
                        GeoObservationPublication.observation_id == winner.id
                    )
                ).all() == [case["publication_id"]]
                assert verify.scalars(
                    select(GeoObservationAttachment.file_id).where(
                        GeoObservationAttachment.observation_id == winner.id
                    )
                ).all() == [case["winner_evidence_id"]]
                assert (
                    verify.scalar(
                        select(func.count())
                        .select_from(GeoObservationAttachment)
                        .where(GeoObservationAttachment.file_id == case["loser_evidence_id"])
                    )
                    == 0
                )
        finally:
            release.set()
            engine.dispose()


@pytest.mark.integration
def test_geo_successor_direct_reuse_and_http_contracts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """known/unknown 事务 owner、HTTP 四元组、request ID 与 500 no-leak 一并对账。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        original_overrides = dict(app.dependency_overrides)
        try:
            with Session(engine, expire_on_commit=False) as db:
                exact = _seed_successor_case(
                    db,
                    suffix="geo-successor-http-exact",
                    content_hash="6" * 64,
                )
                unknown = _seed_successor_case(
                    db,
                    suffix="geo-successor-http-unknown",
                    content_hash="7" * 64,
                )
                exact_payload = exact["payload"]
                unknown_payload = unknown["payload"]
                assert isinstance(exact_payload, GeoObservationCreate)
                assert isinstance(unknown_payload, GeoObservationCreate)
                actor = db.get(User, exact["actor_id"])
                assert actor is not None
                winner = create_geo_observation(
                    db=db,
                    payload=exact_payload,
                    actor=actor,
                    request_id="geo-successor-direct-winner",
                )
                winner_id = winner.id
                known_before = _successor_snapshot(db)

                with monkeypatch.context() as patch:
                    hits = _hide_successor_precheck(patch, db)
                    with pytest.raises(AppError) as known:
                        create_geo_observation(
                            db=db,
                            payload=exact_payload,
                            actor=actor,
                            request_id="geo-successor-direct-exact",
                        )
                    _assert_successor_conflict(known.value)
                    assert hits == ["successor"]
                assert db.is_active
                assert _successor_snapshot(db) == known_before
                assert db.get(GeoObservation, exact["predecessor_id"]) is not None
                assert db.get(GeoObservation, winner_id) is not None
                healthy = create_geo_observation(
                    db=db,
                    payload=exact_payload.model_copy(
                        update={
                            "supersedes_id": None,
                            "attachment_file_ids": [],
                            "search_query": "known rollback 后健康命令",
                        }
                    ),
                    actor=actor,
                    request_id="geo-successor-known-reuse",
                )
                assert healthy.id is not None

                unknown_actor = SimpleNamespace(id=uuid.uuid4(), account_type="ADMIN")
                raw_errors: list[IntegrityError] = []
                unknown_before = _successor_snapshot(db)

                def capture_error(context: object) -> None:
                    error = context.sqlalchemy_exception  # type: ignore[attr-defined]
                    if isinstance(error, IntegrityError):
                        raw_errors.append(error)

                event.listen(engine, "handle_error", capture_error)
                try:
                    with pytest.raises(IntegrityError) as raw:
                        create_geo_observation(
                            db=db,
                            payload=unknown_payload,
                            actor=unknown_actor,  # type: ignore[arg-type]
                            request_id="geo-successor-direct-unknown",
                        )
                    assert raw_errors and raw.value is raw_errors[-1]
                    assert raw.value.orig.sqlstate == "23503"
                    assert raw.value.orig.diag.constraint_name == (
                        "fk_geo_observations_tested_by_users"
                    )
                    db.rollback()
                    assert db.scalar(text("SELECT 1")) == 1
                    with Session(engine, expire_on_commit=False) as verify:
                        assert _successor_snapshot(verify) == unknown_before
                    assert db.get(GeoObservation, unknown["predecessor_id"]) is not None
                    unknown_owner = db.get(User, unknown["actor_id"])
                    assert unknown_owner is not None
                    recovered = create_geo_observation(
                        db=db,
                        payload=unknown_payload.model_copy(
                            update={
                                "supersedes_id": None,
                                "attachment_file_ids": [],
                                "search_query": "unknown caller rollback 后健康命令",
                            }
                        ),
                        actor=unknown_owner,
                        request_id="geo-successor-unknown-reuse",
                    )
                    assert recovered.id is not None
                finally:
                    event.remove(engine, "handle_error", capture_error)

            mode = "precheck"
            csrf = "geo-successor-csrf-token-with-more-than-32-characters"
            auth = SimpleNamespace(
                user=SimpleNamespace(id=exact["actor_id"], account_type="ADMIN"),
                csrf_hash=hash_token(csrf),
            )
            http_errors: list[IntegrityError] = []

            def database_session() -> Iterator[Session]:
                db = Session(engine, expire_on_commit=False)
                try:
                    with pytest.MonkeyPatch.context() as patch:
                        if mode == "exact":
                            hits = _hide_successor_precheck(patch, db)
                        yield db
                        if mode == "exact":
                            assert hits == ["successor"]
                except Exception as error:
                    if isinstance(error, AppError) and mode == "exact":
                        assert db.is_active
                        assert db.scalar(text("SELECT 1")) == 1
                        assert db.get(GeoObservation, winner_id) is not None
                    db.rollback()
                    raise
                finally:
                    db.close()

            def capture_http_error(context: object) -> None:
                error = context.sqlalchemy_exception  # type: ignore[attr-defined]
                if isinstance(error, IntegrityError):
                    http_errors.append(error)

            app.dependency_overrides[get_db] = database_session
            app.dependency_overrides[get_current_session] = lambda: auth
            event.listen(engine, "handle_error", capture_http_error)
            try:
                for current_mode in ("precheck", "exact", "unknown"):
                    mode = current_mode
                    payload = exact_payload
                    if mode == "unknown":
                        payload = unknown_payload
                        auth = SimpleNamespace(
                            user=SimpleNamespace(id=uuid.uuid4(), account_type="ADMIN"),
                            csrf_hash=hash_token(csrf),
                        )
                    else:
                        auth = SimpleNamespace(
                            user=SimpleNamespace(id=exact["actor_id"], account_type="ADMIN"),
                            csrf_hash=hash_token(csrf),
                        )
                    request_id = f"geo-successor-http-{mode}"
                    with Session(engine, expire_on_commit=False) as verify:
                        http_before = _successor_snapshot(verify)
                    response = TestClient(
                        app,
                        raise_server_exceptions=mode != "unknown",
                    ).post(
                        "/api/v1/geo-observations",
                        json=payload.model_dump(mode="json"),
                        headers={
                            "X-CSRF-Token": csrf,
                            "X-Request-ID": request_id,
                        },
                    )
                    if mode != "unknown":
                        assert response.status_code == 409, response.text
                        assert response.headers["X-Request-ID"] == request_id
                        assert response.json() == {
                            "error": {
                                "code": "GEO_OBSERVATION_HAS_SUCCESSOR",
                                "message": "该 GEO 观测已被纠正",
                                "details": {},
                                "request_id": request_id,
                            }
                        }
                    else:
                        assert response.status_code == 500
                        for secret in (
                            "INSERT INTO",
                            "geo_observations",
                            "uq_",
                            "fk_",
                            "constraint",
                            "psycopg",
                            "ForeignKeyViolation",
                            "Traceback",
                        ):
                            assert secret.lower() not in response.text.lower()
                    with Session(engine, expire_on_commit=False) as verify:
                        assert _successor_snapshot(verify) == http_before
                assert [error.orig.sqlstate for error in http_errors] == ["23505", "23503"]
                assert http_errors[0].orig.diag.constraint_name == (
                    "uq_geo_observations_supersedes_once"
                )
            finally:
                event.remove(engine, "handle_error", capture_http_error)
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(original_overrides)
            engine.dispose()
