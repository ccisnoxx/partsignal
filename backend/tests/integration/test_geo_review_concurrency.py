"""真实PG行锁交错验证复核revision竞争和current pointer发布边界。"""

import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import psycopg
import pytest
from sqlalchemy import select, text

from app.errors import AppError
from app.models.identity import User
from app.schemas.geo_reviews import GeoRunReviewRequest
from app.services import geo_reviews as service
from app.services.geo_run_lifecycle import lock_run
from tests.integration.geo_analysis_support import bind, finish, pending, publish
from tests.integration.geo_reviews_support import (
    analysis_engine,
    answer_database,
    harness,
    plan_database,
    review_api,
    run_database,
)

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "harness",
    "plan_database",
    "review_api",
    "run_database",
]


def wait_for_lock(api, pid):
    deadline = time.monotonic() + 4
    with psycopg.connect(api.harness.database.url, autocommit=True) as observer:
        while time.monotonic() < deadline:
            row = observer.execute(
                "SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s", (pid,)
            ).fetchone()
            if row and row[0] == "Lock":
                return
            time.sleep(0.01)
    pytest.fail("第二连接未进入预期行锁等待")


def call_review(api, case, payload, ready=None, pid=None):
    with api.harness.factory() as db:
        actor = db.get(User, api.engineer_id)
        db.execute(text("SET LOCAL lock_timeout='8s'"))
        if pid is not None:
            pid.append(db.scalar(select(text("pg_backend_pid()"))))
            ready.set()
        try:
            return service.review_run(
                db, run_id=case.run_id, payload=payload, actor=actor, request_id="geo507-race"
            )
        except AppError as error:
            return error.code


def test_same_expected_revision_has_one_winner(review_api, monkeypatch):
    api, held, release, ready = review_api, Event(), Event(), Event()
    case = api.create()
    payload = GeoRunReviewRequest.model_validate(api.payload(case))
    original = service.append_audit

    def pause(db, entry):
        original(db, entry)
        held.set()
        assert release.wait(8)

    monkeypatch.setattr(service, "append_audit", pause)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(call_review, api, case, payload)
        assert held.wait(4)
        pid = []
        second = pool.submit(call_review, api, case, payload, ready, pid)
        try:
            assert ready.wait(4)
            wait_for_lock(api, pid[0])
        finally:
            release.set()
        assert first.result(timeout=8).run_revision == payload.expected_run_revision + 1
        assert second.result(timeout=8) == "REVISION_CONFLICT"
    current = api.detail(case)
    assert len(current["analysis"]["reviews"]) == 1
    assert current["run"]["revision"] == payload.expected_run_revision + 1


def test_concurrent_pointer_publication_rejects_waiting_old_review(review_api):
    api = review_api
    case = api.create()
    payload = GeoRunReviewRequest.model_validate(api.payload(case))
    with psycopg.connect(api.harness.database.url) as conn:
        newer = pending(conn, case, analyzer_version="geo507-concurrent-v2")
        bind(conn, case, newer)
        finish(conn, newer)
    ready, pid = Event(), []
    with api.harness.factory() as publisher:
        locked = lock_run(publisher, case.run_id)
        assert locked is not None
        publisher.execute(
            text(
                "UPDATE geo_observation_runs SET current_analysis_revision_id=:analysis,"
                "revision=revision+1 WHERE id=:run"
            ),
            {"analysis": newer, "run": case.run_id},
        )
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(call_review, api, case, payload, ready, pid)
            try:
                assert ready.wait(4)
                wait_for_lock(api, pid[0])
            finally:
                publisher.commit()
            assert future.result(timeout=8) == "GEO_REVIEW_STALE_ANALYSIS"
    current = api.detail(case)
    assert current["analysis"]["selection"]["current_analysis_revision_id"] == str(newer)
    assert current["analysis"]["reviews"] == []


def test_review_before_new_pointer_becomes_history(review_api):
    api = review_api
    case = api.create()
    assert api.submit(case).status_code == 201
    with psycopg.connect(api.harness.database.url) as conn:
        newer = pending(conn, case, analyzer_version="geo507-after-review-v2")
        bind(conn, case, newer)
        finish(conn, newer)
        publish(conn, case, newer)
    current = api.detail(case)
    assert current["analysis"]["selection"]["current_review_id"] is None
    assert not current["analysis"]["reviews"][0]["is_current"]
