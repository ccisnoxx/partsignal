"""Frontend V2 GEO 观测详情的 PostgreSQL 集成测试。"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SAWarning
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.geo_files import (
    FileRecord,
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationCitation,
    GeoObservationPublication,
)
from app.models.identity import User
from app.schemas.geo_files import LegacyGeoObservationOut
from app.services import geo_observation as geo_service
from app.services.geo_observation import get_geo_observation_detail
from tests.integration.test_publication_workflow import (
    _complete_publication,
    _geo_context_catalog,
    _geo_context_snapshot,
    _seed_geo_context_chain,
    _seed_graph,
    temporary_database,
)


def _evidence(db: Session, actor: User, *, name: str, category: str) -> FileRecord:
    file = FileRecord(
        category=category,
        original_filename=f"{name}.png",
        object_key=f"geo-detail/{uuid.uuid4()}/{name}.png",
        content_type="image/png",
        size=256,
        sha256=name[0] * 64,
        access_level="INTERNAL",
        status="VERIFIED",
        uploader_id=actor.id,
        upload_expires_at=datetime.now(UTC) + timedelta(hours=1),
        verified_at=datetime.now(UTC),
    )
    db.add(file)
    db.flush()
    return file


def _statement_count(engine: Engine, callback: object) -> int:
    count = 0

    def record_statement(*_args: object) -> None:
        nonlocal count
        count += 1

    event.listen(engine, "before_cursor_execute", record_statement)
    try:
        callback()
    finally:
        event.remove(engine, "before_cursor_execute", record_statement)
    return count


@pytest.mark.integration
def test_geo_observation_detail_projects_legacy_and_complete_manual_chain() -> None:
    """详情一次返回两类事实、root→tail 历史、直接证据和 actor 动作。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="d" * 64)
            actor = graph["user"]
            product = graph["product"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            actor.account_type = "ADMIN"
            publication = _complete_publication(db, graph, suffix="geo-detail")

            chain: list[GeoObservation] = []
            for index in range(3):
                observation = GeoObservation(
                    observation_kind="MANUAL_ARTICLE_SEARCH",
                    query_topic_id=topic.id,
                    product_id=product.id,
                    search_platform="Perplexity",
                    search_query="完整搜索词",
                    tested_at=datetime(2026, 8, 10 + index, 8, tzinfo=UTC),
                    notes=f"第 {index + 1} 次记录",
                    supersedes_id=chain[-1].id if chain else None,
                    tested_by=actor.id,
                )
                db.add(observation)
                db.flush()
                chain.append(observation)
                evidence = _evidence(
                    db,
                    actor,
                    name=f"{chr(97 + index)}-manual",
                    category="OPERATION_SCREENSHOT",
                )
                db.add_all(
                    [
                        GeoObservationAttachment(
                            observation_id=observation.id,
                            file_id=evidence.id,
                        ),
                        GeoObservationPublication(
                            observation_id=observation.id,
                            published_article_id=publication.id,
                            discovered=index == 2,
                            mentioned=index == 2,
                            accuracy="PARTIAL" if index < 2 else "ACCURATE",
                        ),
                    ]
                )

            legacy = GeoObservation(
                observation_kind="LEGACY_MODEL_RESULT",
                query_topic_id=topic.id,
                product_id=product.id,
                actual_prompt="旧模型完整问题",
                model_name="ChatGPT",
                model_version="legacy",
                tested_at=datetime(2026, 8, 9, 8, tzinfo=UTC),
                web_search_enabled=True,
                answer_summary="完整回答摘要",
                mentioned=True,
                recommendation="RECOMMENDED",
                accuracy="ACCURATE",
                notes="旧模型备注",
                tested_by=actor.id,
            )
            db.add(legacy)
            db.flush()
            legacy_file = _evidence(db, actor, name="z-legacy", category="EVIDENCE")
            db.add_all(
                [
                    GeoObservationAttachment(observation_id=legacy.id, file_id=legacy_file.id),
                    GeoObservationPublication(
                        observation_id=legacy.id,
                        published_article_id=publication.id,
                        discovered=None,
                        mentioned=None,
                        accuracy=None,
                    ),
                    GeoObservationCitation(
                        observation_id=legacy.id,
                        url="https://example.com/citation",
                        source_type="OFFICIAL",
                        published_article_id=publication.id,
                    ),
                ]
            )
            db.commit()

            detail = get_geo_observation_detail(db, chain[1].id, actor=actor)
            assert detail.observation_kind == "MANUAL_ARTICLE_SEARCH"
            assert detail.selected_observation_id == chain[1].id
            assert detail.chain_root_id == chain[0].id
            assert detail.chain_tail_id == chain[2].id
            assert [item.observation.id for item in detail.correction_history] == [
                item.id for item in chain
            ]
            assert [item.is_selected for item in detail.correction_history] == [False, True, False]
            assert [item.is_chain_tail for item in detail.correction_history] == [
                False,
                False,
                True,
            ]
            assert all(
                item.query_topic is not None
                and item.query_topic.canonical_question == topic.canonical_question
                for item in detail.correction_history
            )
            assert [
                item.evidence[0].file.original_filename for item in detail.correction_history
            ] == ["a-manual.png", "b-manual.png", "c-manual.png"]
            assert [
                len(item.observation.attachment_file_ids) for item in detail.correction_history
            ] == [1, 2, 3]
            assert detail.correction_history[-1].observation.available_actions == [
                "CORRECT",
                "DELETE",
            ]
            assert all(
                not item.observation.available_actions for item in detail.correction_history[:-1]
            )

            legacy_detail = get_geo_observation_detail(db, legacy.id, actor=actor)
            assert legacy_detail.observation_kind == "LEGACY_MODEL_RESULT"
            assert legacy_detail.observation.actual_prompt == "旧模型完整问题"
            assert legacy_detail.observation.citations[0].published_article_id == publication.id
            assert legacy_detail.published_articles[0].platform_name == (
                publication.platform_profile_name_snapshot
            )
            assert legacy_detail.evidence[0].file.id == legacy_file.id

            actor.account_type = "ENGINEER"
            engineer_detail = get_geo_observation_detail(db, chain[-1].id, actor=actor)
            assert engineer_detail.correction_history[-1].observation.available_actions == [
                "CORRECT"
            ]


@pytest.mark.integration
def test_geo_observation_detail_query_count_does_not_grow_with_chain_length() -> None:
    """递归链和批量上下文读取不随节点数产生逐项 SQL。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="e" * 64)
            actor = graph["user"]
            product = graph["product"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            publication = _complete_publication(db, graph, suffix="geo-detail-count")
            chain: list[GeoObservation] = []
            for index in range(4):
                node = GeoObservation(
                    observation_kind="MANUAL_ARTICLE_SEARCH",
                    query_topic_id=topic.id,
                    product_id=product.id,
                    search_platform="Google",
                    search_query="固定查询次数",
                    tested_at=datetime(2026, 8, 8 + index, tzinfo=UTC),
                    notes="",
                    supersedes_id=chain[-1].id if chain else None,
                    tested_by=actor.id,
                )
                db.add(node)
                db.flush()
                chain.append(node)
                db.add(
                    GeoObservationPublication(
                        observation_id=node.id,
                        published_article_id=publication.id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    )
                )
            db.commit()
            db.expire_all()

            first_count = _statement_count(
                engine,
                lambda: get_geo_observation_detail(db, chain[0].id, actor=actor),
            )
            db.expire_all()
            tail_count = _statement_count(
                engine,
                lambda: get_geo_observation_detail(db, chain[-1].id, actor=actor),
            )
            assert first_count == tail_count


@pytest.mark.integration
def test_geo_observation_detail_reports_not_found() -> None:
    """不存在目标返回 404，缺少成果或链身份冲突返回 409。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="f" * 64)
            actor = graph["user"]
            assert isinstance(actor, User)
            with pytest.raises(AppError, match="GEO 观测") as missing:
                get_geo_observation_detail(db, uuid.uuid4(), actor=actor)
            assert missing.value.status_code == 404

            product = graph["product"]
            topic = graph["topic"]
            incomplete = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=topic.id,
                product_id=product.id,
                search_platform="Google",
                search_query="缺少成果事实",
                tested_at=datetime(2026, 8, 12, tzinfo=UTC),
                notes="",
                tested_by=actor.id,
            )
            db.add(incomplete)
            db.flush()
            with pytest.raises(AppError, match="缺少关联成果事实") as context_error:
                get_geo_observation_detail(db, incomplete.id, actor=actor)
            assert context_error.value.status_code == 409

            conflicting = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=topic.id,
                product_id=product.id,
                search_platform="Google",
                search_query="链中被改写的搜索词",
                tested_at=datetime(2026, 8, 12, 1, tzinfo=UTC),
                notes="",
                supersedes_id=incomplete.id,
                tested_by=actor.id,
            )
            db.add(conflicting)
            db.flush()
            with pytest.raises(AppError, match="更正链不完整") as chain_error:
                get_geo_observation_detail(db, conflicting.id, actor=actor)
            assert chain_error.value.status_code == 409
            assert chain_error.value.code == "GEO_OBSERVATION_CONTEXT_INCOMPLETE"
            assert chain_error.value.details == {}


@pytest.mark.integration
def test_geo_context_http_rejects_incomplete_chain_without_partial_history() -> None:
    """真实 PostgreSQL 损坏链在 detail/context 两入口返回同一完整错误信封。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        overrides = dict(app.dependency_overrides)
        try:
            with Session(engine) as verify:
                catalog = _geo_context_catalog(verify)
                baseline = _geo_context_snapshot(verify)
            for scenario in (
                "branch",
                "cycle",
                "missing-parent",
                "product",
                "search_platform",
                "search_query",
                "kind",
            ):
                with engine.connect().execution_options(isolation_level="REPEATABLE READ") as conn:
                    transaction = conn.begin()
                    try:
                        with Session(conn, expire_on_commit=False) as seed:
                            graph = _seed_graph(seed)
                            actor = graph["user"]
                            actor.account_type = "ADMIN"
                            seed.flush()
                            target_id = _seed_geo_context_chain(seed, graph, scenario)
                            before = _geo_context_snapshot(seed)
                            actor_id = actor.id

                        def database_session() -> Iterator[Session]:
                            with Session(conn, join_transaction_mode="create_savepoint") as db:
                                # fixture 已在外层建立真实 RR 事务；先绑定以免路由重设隔离级别。
                                assert db.connection().get_isolation_level() == "REPEATABLE READ"
                                yield db

                        app.dependency_overrides[get_db] = database_session
                        auth = SimpleNamespace(
                            user=SimpleNamespace(id=actor_id, account_type="ADMIN")
                        )
                        app.dependency_overrides[get_current_session] = lambda auth=auth: auth
                        for endpoint in ("detail", "correction-context"):
                            request_id = f"geo-context-{scenario}-{endpoint}"
                            with pytest.warns(SAWarning, match="execution_options ignored"):
                                response = TestClient(app).get(
                                    f"/api/v1/geo-observations/{target_id}/{endpoint}",
                                    headers={"X-Request-ID": request_id},
                                )
                            assert response.status_code == 409, response.text
                            assert response.headers["X-Request-ID"] == request_id
                            assert response.json() == {
                                "error": {
                                    "code": "GEO_OBSERVATION_CONTEXT_INCOMPLETE",
                                    "message": "GEO 观测更正链存在分支"
                                    if scenario == "branch"
                                    else "GEO 观测更正链不完整",
                                    "details": {},
                                    "request_id": request_id,
                                }
                            }
                            with Session(conn) as verify:
                                assert _geo_context_snapshot(verify) == before
                    finally:
                        transaction.rollback()
                with Session(engine) as verify:
                    assert _geo_context_catalog(verify) == catalog
                    assert _geo_context_snapshot(verify) == baseline
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(overrides)
            engine.dispose()


@pytest.mark.parametrize("scenario", ["duplicate-descendant", "disconnected-walk", "output-type"])
def test_geo_context_synthetic_defensive_boundaries(
    scenario: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """仅注入无法由当前 snapshot/UNION/projection 合同产生的防御性返回，不模拟并发。"""
    target = GeoObservation(
        id=uuid.uuid4(),
        product_id=uuid.uuid4(),
        observation_kind="MANUAL_ARTICLE_SEARCH",
        search_platform="Perplexity",
        search_query="synthetic defensive boundary",
        supersedes_id=None,
        query_topic_id=None,
    )
    nodes = [target, target]
    if scenario == "disconnected-walk":
        nodes = [
            target,
            GeoObservation(
                id=uuid.uuid4(),
                product_id=target.product_id,
                observation_kind=target.observation_kind,
                search_platform=target.search_platform,
                search_query=target.search_query,
                supersedes_id=uuid.uuid4(),
            ),
        ]
    synthetic_db = SimpleNamespace(
        execute=lambda _statement: SimpleNamespace(all=lambda: [(target.id, None)]),
        scalars=lambda _statement: nodes,
        get=lambda *_args: target,
    )
    message = "GEO 观测更正链不完整"
    if scenario == "output-type":
        message = "GEO 观测更正链类型不一致"
        monkeypatch.setattr(geo_service, "_manual_observation_chain", lambda *_args: [target])
        monkeypatch.setattr(
            geo_service,
            "geo_observations_out",
            lambda *_args, **_kwargs: [
                LegacyGeoObservationOut.model_construct(
                    id=target.id,
                    product_id=target.product_id,
                    product_label="synthetic",
                )
            ],
        )
        monkeypatch.setattr(geo_service, "_geo_observation_detail_evidence", lambda *_args: {})
        synthetic_db.scalars = lambda _statement: []
    with pytest.raises(AppError) as error:
        if scenario == "output-type":
            get_geo_observation_detail(synthetic_db, target.id, actor=SimpleNamespace())
        else:
            geo_service._manual_observation_chain(synthetic_db, target)
    assert (
        error.value.status_code,
        error.value.code,
        error.value.message,
        error.value.details,
    ) == (
        409,
        "GEO_OBSERVATION_CONTEXT_INCOMPLETE",
        message,
        {},
    )
