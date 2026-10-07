"""人工 GEO 更正链删除的真实 PostgreSQL 完整性与原子性测试。"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.models.content import ContentTask
from app.models.geo_files import (
    FileRecord,
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationPublication,
)
from app.models.identity import AuditLog, User
from app.models.publication import PublishedArticle
from app.security import hash_token
from app.services.geo_observation import delete_geo_observation
from tests.integration.test_geo_observation_detail import _evidence
from tests.integration.test_publication_workflow import (
    _complete_publication,
    _geo_context_catalog,
    _geo_context_snapshot,
    _seed_graph,
    temporary_database,
)


def _seed_chain(db: Session) -> dict[str, object]:
    """用 current-head 全部约束建立可从任意节点删除的完整三节点链。"""
    graph = _seed_graph(db, content_hash="8" * 64)
    actor = graph["user"]
    product = graph["product"]
    topic = graph["topic"]
    assert isinstance(actor, User)
    actor.account_type = "ADMIN"
    publication = _complete_publication(db, graph, suffix="geo-chain-delete")
    nodes: list[GeoObservation] = []
    for index in range(3):
        node = GeoObservation(
            observation_kind="MANUAL_ARTICLE_SEARCH",
            query_topic_id=topic.id,
            product_id=product.id,
            search_platform="Perplexity",
            search_query="完整删除链",
            tested_at=datetime(2026, 9, 16 + index, 8, tzinfo=UTC),
            notes=f"更正节点 {index}",
            supersedes_id=nodes[-1].id if nodes else None,
            tested_by=actor.id,
        )
        db.add(node)
        db.flush()
        db.add(
            GeoObservationPublication(
                observation_id=node.id,
                published_article_id=publication.id,
                discovered=True,
                mentioned=True,
                accuracy="ACCURATE",
            )
        )
        nodes.append(node)
    file = _evidence(db, actor, name="geo-chain-delete", category="OPERATION_SCREENSHOT")
    db.add(GeoObservationAttachment(observation_id=nodes[0].id, file_id=file.id))
    db.commit()
    return {
        "actor_id": actor.id,
        "product_id": product.id,
        "topic_id": topic.id,
        "publication_id": publication.id,
        "task_id": graph["task"].id,
        "file_id": file.id,
        "node_ids": [node.id for node in nodes],
    }


def _snapshot(db: Session) -> dict[str, list[dict[str, object]]]:
    """比较失败前后的真实聚合行，而不是只比较观测数量。"""
    return {
        model.__tablename__: sorted(
            (dict(row) for row in db.execute(select(model.__table__)).mappings()),
            key=repr,
        )
        for model in (
            ContentTask,
            PublishedArticle,
            GeoObservation,
            GeoObservationPublication,
            GeoObservationAttachment,
            FileRecord,
            AuditLog,
        )
    }


def _assert_context_error(error: AppError, message: str) -> None:
    assert (error.status_code, error.code, error.message, error.details) == (
        409,
        "GEO_OBSERVATION_CONTEXT_INCOMPLETE",
        message,
        {},
    )


@pytest.mark.integration
@pytest.mark.parametrize("selected_index", [0, 1, 2])
def test_delete_manual_geo_chain_from_any_node(selected_index: int) -> None:
    """root/middle/tail 任一入口均只删除同一完整链并保留发布成果。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                seeded = _seed_chain(db)
                actor = db.get(User, seeded["actor_id"])
                assert actor is not None
                delete_geo_observation(
                    db=db,
                    observation_id=seeded["node_ids"][selected_index],
                    actor=actor,
                    request_id=f"geo-chain-delete-{selected_index}",
                )
                assert all(
                    db.get(GeoObservation, node_id) is None for node_id in seeded["node_ids"]
                )
                assert db.get(PublishedArticle, seeded["publication_id"]) is not None
                assert db.get(ContentTask, seeded["task_id"]) is not None
                assert db.scalar(select(GeoObservationPublication.observation_id)) is None
                assert db.scalar(select(GeoObservationAttachment.observation_id)) is None
                file = db.get(FileRecord, seeded["file_id"])
                assert file is not None and file.cleanup_after is not None
                audit = db.scalar(
                    select(AuditLog).where(
                        AuditLog.action == "geo_observation.deleted",
                        AuditLog.request_id == f"geo-chain-delete-{selected_index}",
                    )
                )
                assert audit is not None and audit.outcome == "SUCCESS"
        finally:
            engine.dispose()


@pytest.mark.integration
@pytest.mark.parametrize(
    ("damage", "message"),
    [
        ("ancestor_missing", "GEO 观测更正链不完整"),
        ("branch", "GEO 观测更正链存在分支"),
        ("cycle", "GEO 观测更正链不完整"),
        ("cross_product", "GEO 观测更正链不完整"),
        ("cross_kind", "GEO 观测更正链不完整"),
    ],
)
def test_delete_corrupt_manual_chain_has_no_partial_effect(damage: str, message: str) -> None:
    """损坏链在删除/cleanup/audit 之前失败，事务内 DDL 在 finally 回滚。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as seed_db:
                seeded = _seed_chain(seed_db)
                expected_catalog = _geo_context_catalog(seed_db)
                expected_data = _geo_context_snapshot(seed_db)
                successor_index = next(
                    row
                    for row in expected_catalog
                    if row[0] == "index" and row[1] == "uq_geo_observations_supersedes_once"
                )
                assert "UNIQUE INDEX" in successor_index[2]
                append_only_trigger = next(
                    row
                    for row in expected_catalog
                    if row[0] == "trigger" and row[1] == "geo_observations_append_only"
                )
                assert "UPDATE" in append_only_trigger[2]
                assert "DELETE" not in append_only_trigger[2]
                assert append_only_trigger[2].endswith(":O")
            with engine.connect() as connection:
                transaction = connection.begin()
                try:
                    with Session(bind=connection, expire_on_commit=False) as db:
                        root_id, middle_id, tail_id = seeded["node_ids"]
                        selected_id = tail_id
                        if damage == "ancestor_missing":
                            constraint = db.scalar(
                                text(
                                    "SELECT conname FROM pg_constraint "
                                    "WHERE conrelid = 'geo_observations'::regclass "
                                    "AND confrelid = 'geo_observations'::regclass"
                                )
                            )
                            assert isinstance(constraint, str) and constraint.isidentifier()
                            db.execute(
                                text(f'ALTER TABLE geo_observations DROP CONSTRAINT "{constraint}"')
                            )
                            db.execute(
                                text(
                                    "DELETE FROM geo_observation_publications "
                                    "WHERE observation_id = :id"
                                ),
                                {"id": root_id},
                            )
                            db.execute(
                                text(
                                    "DELETE FROM geo_observation_attachments "
                                    "WHERE observation_id = :id"
                                ),
                                {"id": root_id},
                            )
                            db.execute(
                                text("DELETE FROM geo_observations WHERE id = :id"),
                                {"id": root_id},
                            )
                        elif damage == "branch":
                            db.execute(text("DROP INDEX uq_geo_observations_supersedes_once"))
                            branch = GeoObservation(
                                observation_kind="MANUAL_ARTICLE_SEARCH",
                                query_topic_id=seeded["topic_id"],
                                product_id=seeded["product_id"],
                                search_platform="Perplexity",
                                search_query="完整删除链",
                                tested_at=datetime(2026, 9, 20, 8, tzinfo=UTC),
                                notes="事务内分支",
                                supersedes_id=middle_id,
                                tested_by=seeded["actor_id"],
                            )
                            db.add(branch)
                            db.flush()
                        elif damage == "cycle":
                            db.execute(
                                text(
                                    "ALTER TABLE geo_observations DISABLE TRIGGER "
                                    "geo_observations_append_only"
                                )
                            )
                            db.execute(
                                text(
                                    "UPDATE geo_observations SET supersedes_id = :tail "
                                    "WHERE id = :root"
                                ),
                                {"tail": tail_id, "root": root_id},
                            )
                        elif damage == "cross_product":
                            other = _seed_graph(db, content_hash="9" * 64)["product"]
                            db.execute(
                                text(
                                    "ALTER TABLE geo_observations DISABLE TRIGGER "
                                    "geo_observations_append_only"
                                )
                            )
                            db.execute(
                                text(
                                    "UPDATE geo_observations SET product_id = :product "
                                    "WHERE id = :middle"
                                ),
                                {"product": other.id, "middle": middle_id},
                            )
                        else:
                            db.execute(
                                text(
                                    "ALTER TABLE geo_observations DISABLE TRIGGER "
                                    "geo_observations_append_only"
                                )
                            )
                            db.execute(
                                text(
                                    "ALTER TABLE geo_observations DROP CONSTRAINT "
                                    "ck_geo_observations_kind_fields"
                                )
                            )
                            db.execute(
                                text(
                                    "UPDATE geo_observations "
                                    "SET observation_kind = 'LEGACY_MODEL_RESULT' "
                                    "WHERE id = :middle"
                                ),
                                {"middle": middle_id},
                            )
                        actor = db.get(User, seeded["actor_id"])
                        assert actor is not None
                        before = _snapshot(db)
                        with pytest.raises(AppError) as caught:
                            delete_geo_observation(
                                db=db,
                                observation_id=selected_id,
                                actor=actor,
                                request_id=f"geo-chain-corrupt-{damage}",
                            )
                        _assert_context_error(caught.value, message)
                        assert _snapshot(db) == before
                finally:
                    transaction.rollback()
            with Session(engine) as verify:
                assert _geo_context_catalog(verify) == expected_catalog
                assert _geo_context_snapshot(verify) == expected_data
        finally:
            engine.dispose()


@pytest.mark.integration
def test_delete_chain_membership_change_uses_real_second_connection() -> None:
    """另一 PostgreSQL backend 在发现 ID 后删除 tail，锁定集合变化只报 chain changed。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as seed_db:
                seeded = _seed_chain(seed_db)
            root_id, middle_id, tail_id = seeded["node_ids"]
            reached_lock = Event()
            observations: dict[str, int] = {}
            with engine.connect() as main_connection:
                transaction = main_connection.begin()
                try:
                    with Session(bind=main_connection, expire_on_commit=False) as db:
                        actor = db.get(User, seeded["actor_id"])
                        assert actor is not None
                        observations["main_pid"] = main_connection.scalar(
                            text("SELECT pg_backend_pid()")
                        )
                        before = _snapshot(db)

                        def remove_tail_between_discovery_and_lock(
                            connection: Connection,
                            _cursor: object,
                            statement: str,
                            _parameters: object,
                            _context: object,
                            _executemany: bool,
                        ) -> None:
                            if connection is not main_connection or reached_lock.is_set():
                                return
                            if (
                                "geo_observations.id IN" not in statement
                                or "FOR UPDATE" not in statement
                            ):
                                return
                            reached_lock.set()
                            with engine.connect() as contender:
                                observations["contender_pid"] = contender.scalar(
                                    text("SELECT pg_backend_pid()")
                                )
                                try:
                                    contender.execute(
                                        text(
                                            "SELECT id FROM geo_observations WHERE id = :root "
                                            "FOR UPDATE NOWAIT"
                                        ),
                                        {"root": root_id},
                                    ).all()
                                except DBAPIError as error:
                                    assert getattr(error.orig, "sqlstate", None) == "55P03"
                                    observations["root_lock_proved"] = 1
                                    contender.rollback()
                                else:
                                    pytest.fail("发现链后 root 未持有 PostgreSQL FOR UPDATE 锁")
                                contender.execute(text("SET LOCAL lock_timeout = '2s'"))
                                contender.execute(
                                    text(
                                        "DELETE FROM geo_observation_publications "
                                        "WHERE observation_id = :tail"
                                    ),
                                    {"tail": tail_id},
                                )
                                deleted = contender.execute(
                                    text("DELETE FROM geo_observations WHERE id = :tail"),
                                    {"tail": tail_id},
                                )
                                assert deleted.rowcount == 1
                                contender.commit()

                        event.listen(
                            engine, "before_cursor_execute", remove_tail_between_discovery_and_lock
                        )
                        try:
                            with pytest.raises(AppError) as caught:
                                delete_geo_observation(
                                    db=db,
                                    observation_id=tail_id,
                                    actor=actor,
                                    request_id="geo-chain-changed-real-db",
                                )
                        finally:
                            event.remove(
                                engine,
                                "before_cursor_execute",
                                remove_tail_between_discovery_and_lock,
                            )
                        assert reached_lock.is_set()
                        assert observations["main_pid"] != observations["contender_pid"]
                        assert observations["root_lock_proved"] == 1
                        assert (
                            caught.value.status_code,
                            caught.value.code,
                            caught.value.message,
                            caught.value.details,
                        ) == (
                            409,
                            "GEO_OBSERVATION_CHAIN_CHANGED",
                            "GEO 观测更正链已变化",
                            {},
                        )
                        after = _snapshot(db)
                        assert after["audit_logs"] == before["audit_logs"]
                        assert after["content_tasks"] == before["content_tasks"]
                        assert after["published_articles"] == before["published_articles"]
                        assert db.get(GeoObservation, root_id) is not None
                        assert db.get(GeoObservation, middle_id) is not None
                finally:
                    transaction.rollback()
            with Session(engine) as verify:
                assert verify.get(GeoObservation, root_id) is not None
                assert verify.get(GeoObservation, middle_id) is not None
                assert verify.get(GeoObservation, tail_id) is None
                assert (
                    verify.scalar(
                        select(AuditLog).where(AuditLog.action == "geo_observation.deleted")
                    )
                    is None
                )
        finally:
            engine.dispose()


@pytest.mark.integration
def test_delete_geo_observation_http_context_error_preserves_request_and_data() -> None:
    """真实跨产品坏链在 DELETE HTTP 边界返回精确领域信封且不删除任何记录。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                seeded = _seed_chain(db)
                other = _seed_graph(db, content_hash="7" * 64)
                tail_id = seeded["node_ids"][-1]
                child = GeoObservation(
                    observation_kind="MANUAL_ARTICLE_SEARCH",
                    query_topic_id=other["topic"].id,
                    product_id=other["product"].id,
                    search_platform="Perplexity",
                    search_query="完整删除链",
                    tested_at=datetime(2026, 9, 20, 8, tzinfo=UTC),
                    notes="跨产品坏链",
                    supersedes_id=tail_id,
                    tested_by=seeded["actor_id"],
                )
                db.add(child)
                db.commit()
                child_id = child.id
                before = _snapshot(db)
            csrf = "geo-delete-context-csrf-token-with-more-than-32-characters"
            auth = SimpleNamespace(
                user=SimpleNamespace(id=seeded["actor_id"], account_type="ADMIN"),
                csrf_hash=hash_token(csrf),
            )

            def database_session() -> Iterator[Session]:
                with Session(engine, expire_on_commit=False) as db:
                    try:
                        yield db
                    except Exception:
                        db.rollback()
                        raise

            original_overrides = dict(app.dependency_overrides)
            app.dependency_overrides[get_db] = database_session
            app.dependency_overrides[get_current_session] = lambda: auth
            try:
                request_id = "geo-delete-context-http"
                response = TestClient(app).delete(
                    f"/api/v1/geo-observations/{child_id}",
                    headers={"X-CSRF-Token": csrf, "X-Request-ID": request_id},
                )
                assert response.status_code == 409, response.text
                assert response.headers["X-Request-ID"] == request_id
                assert response.json() == {
                    "error": {
                        "code": "GEO_OBSERVATION_CONTEXT_INCOMPLETE",
                        "message": "GEO 观测更正链不完整",
                        "details": {},
                        "request_id": request_id,
                    }
                }
            finally:
                app.dependency_overrides.clear()
                app.dependency_overrides.update(original_overrides)
            with Session(engine) as verify:
                assert _snapshot(verify) == before
        finally:
            engine.dispose()


@pytest.mark.integration
def test_delete_geo_observation_http_chain_changed_requires_new_confirmation() -> None:
    """HTTP DELETE 在真实第二连接改变锁定集合后返回精确 chain-changed 信封。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                seeded = _seed_chain(db)
            root_id, middle_id, tail_id = seeded["node_ids"]
            csrf = "geo-delete-chain-csrf-token-with-more-than-32-characters"
            auth = SimpleNamespace(
                user=SimpleNamespace(id=seeded["actor_id"], account_type="ADMIN"),
                csrf_hash=hash_token(csrf),
            )
            reached_lock = Event()
            backend_ids: dict[str, int] = {}

            def database_session() -> Iterator[Session]:
                with Session(engine, expire_on_commit=False) as db:
                    try:
                        yield db
                    except Exception:
                        db.rollback()
                        raise

            def remove_tail_for_http(
                connection: Connection,
                _cursor: object,
                statement: str,
                _parameters: object,
                _context: object,
                _executemany: bool,
            ) -> None:
                if reached_lock.is_set():
                    return
                if "geo_observations.id IN" not in statement or "FOR UPDATE" not in statement:
                    return
                reached_lock.set()
                backend_ids["request"] = connection.scalar(text("SELECT pg_backend_pid()"))
                with engine.connect() as contender:
                    backend_ids["writer"] = contender.scalar(text("SELECT pg_backend_pid()"))
                    try:
                        contender.execute(
                            text(
                                "SELECT id FROM geo_observations WHERE id = :root FOR UPDATE NOWAIT"
                            ),
                            {"root": root_id},
                        ).all()
                    except DBAPIError as error:
                        assert getattr(error.orig, "sqlstate", None) == "55P03"
                        contender.rollback()
                    else:
                        pytest.fail("HTTP 删除请求未持有 root 行锁")
                    contender.execute(text("SET LOCAL lock_timeout = '2s'"))
                    contender.execute(
                        text(
                            "DELETE FROM geo_observation_publications WHERE observation_id = :tail"
                        ),
                        {"tail": tail_id},
                    )
                    assert (
                        contender.execute(
                            text("DELETE FROM geo_observations WHERE id = :tail"),
                            {"tail": tail_id},
                        ).rowcount
                        == 1
                    )
                    contender.commit()

            original_overrides = dict(app.dependency_overrides)
            app.dependency_overrides[get_db] = database_session
            app.dependency_overrides[get_current_session] = lambda: auth
            event.listen(engine, "before_cursor_execute", remove_tail_for_http)
            try:
                request_id = "geo-delete-chain-http"
                response = TestClient(app).delete(
                    f"/api/v1/geo-observations/{tail_id}",
                    headers={"X-CSRF-Token": csrf, "X-Request-ID": request_id},
                )
                assert response.status_code == 409, response.text
                assert response.headers["X-Request-ID"] == request_id
                assert response.json() == {
                    "error": {
                        "code": "GEO_OBSERVATION_CHAIN_CHANGED",
                        "message": "GEO 观测更正链已变化",
                        "details": {},
                        "request_id": request_id,
                    }
                }
                assert reached_lock.is_set()
                assert backend_ids["request"] != backend_ids["writer"]
            finally:
                event.remove(engine, "before_cursor_execute", remove_tail_for_http)
                app.dependency_overrides.clear()
                app.dependency_overrides.update(original_overrides)
            with Session(engine) as verify:
                assert verify.get(GeoObservation, root_id) is not None
                assert verify.get(GeoObservation, middle_id) is not None
                assert verify.get(GeoObservation, tail_id) is None
                assert (
                    verify.scalar(
                        select(AuditLog).where(AuditLog.action == "geo_observation.deleted")
                    )
                    is None
                )
        finally:
            engine.dispose()


@pytest.mark.integration
def test_delete_unknown_postgres_guard_remains_500_and_rolls_back() -> None:
    """事务局部 55000 DELETE guard 不被伪装成 GEO 409，HTTP 不泄漏数据库诊断。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as seed_db:
                seeded = _seed_chain(seed_db)
                before = _snapshot(seed_db)
                expected_catalog = _geo_context_catalog(seed_db)
                expected_data = _geo_context_snapshot(seed_db)
            with engine.connect() as connection:
                transaction = connection.begin()
                try:
                    connection.execute(
                        text(
                            "CREATE FUNCTION codex_t5_i6_unknown_delete() RETURNS trigger "
                            "LANGUAGE plpgsql AS $$ BEGIN "
                            "RAISE EXCEPTION 'private geo guard diagnostic' "
                            "USING ERRCODE = '55000'; END $$"
                        )
                    )
                    connection.execute(
                        text(
                            "CREATE TRIGGER codex_t5_i6_unknown_delete "
                            "BEFORE DELETE ON geo_observations FOR EACH ROW "
                            "EXECUTE FUNCTION codex_t5_i6_unknown_delete()"
                        )
                    )
                    csrf = "geo-delete-unknown-csrf-token-with-more-than-32-characters"
                    auth = SimpleNamespace(
                        user=SimpleNamespace(id=seeded["actor_id"], account_type="ADMIN"),
                        csrf_hash=hash_token(csrf),
                    )
                    seen_sqlstates: list[str] = []

                    def database_session() -> Iterator[Session]:
                        with Session(
                            bind=connection,
                            expire_on_commit=False,
                            join_transaction_mode="create_savepoint",
                        ) as db:
                            try:
                                yield db
                            except Exception:
                                db.rollback()
                                raise

                    def capture_unknown(context: object) -> None:
                        original = context.original_exception  # type: ignore[attr-defined]
                        sqlstate = getattr(original, "sqlstate", None)
                        if sqlstate is not None:
                            seen_sqlstates.append(sqlstate)

                    original_overrides = dict(app.dependency_overrides)
                    app.dependency_overrides[get_db] = database_session
                    app.dependency_overrides[get_current_session] = lambda: auth
                    event.listen(engine, "handle_error", capture_unknown)
                    try:
                        response = TestClient(app, raise_server_exceptions=False).delete(
                            f"/api/v1/geo-observations/{seeded['node_ids'][-1]}",
                            headers={
                                "X-CSRF-Token": csrf,
                                "X-Request-ID": "geo-delete-unknown-http",
                            },
                        )
                        assert response.status_code == 500
                        assert seen_sqlstates == ["55000"]
                        for secret in (
                            "private geo guard diagnostic",
                            "codex_t5_i6_unknown_delete",
                            "geo_observations",
                            "psycopg",
                            "Traceback",
                        ):
                            assert secret.lower() not in response.text.lower()
                        with Session(bind=connection) as verify:
                            assert _snapshot(verify) == before
                    finally:
                        event.remove(engine, "handle_error", capture_unknown)
                        app.dependency_overrides.clear()
                        app.dependency_overrides.update(original_overrides)
                finally:
                    transaction.rollback()
            with Session(engine) as verify:
                assert _geo_context_catalog(verify) == expected_catalog
                assert _geo_context_snapshot(verify) == expected_data
                assert (
                    verify.scalar(
                        text(
                            "SELECT count(*) FROM pg_trigger "
                            "WHERE tgname = 'codex_t5_i6_unknown_delete'"
                        )
                    )
                    == 0
                )
        finally:
            engine.dispose()
