"""原始证据和文件生命周期的 PostgreSQL 最终防线。"""

import hashlib
from typing import Any

import psycopg
import pytest
from psycopg import sql
from psycopg.types.json import Jsonb

from app.geo_citation_urls import normalize_citation_url
from app.schemas.geo_answers import GeoRawPayloadSummary
from tests.integration.geo_answers_support import (
    AnswerDatabase,
    answer_connection,
    answer_database,
    citation,
    collect,
    file_record,
    new_run,
    plan_database,
    run_database,
    snapshot,
)

pytestmark = pytest.mark.integration
__all__ = ["answer_connection", "answer_database", "plan_database", "run_database"]


def finalize(conn: psycopg.Connection[Any]) -> None:
    conn.execute("SET CONSTRAINTS ALL IMMEDIATE")


@pytest.mark.parametrize("url", ["https://a/", "https://[2001:db8::]/a"])
def test_canonical_single_label_and_ipv6_round_trip(answer_connection, answer_database, url):
    normalized = normalize_citation_url(url)
    conn, db = answer_connection, answer_database
    r = new_run(conn, db)
    a = snapshot(conn, db, r, citation_count=1)
    citation(
        conn,
        a,
        original_url=url,
        normalized_url=normalized.normalized_url,
        hostname=normalized.hostname,
    )
    collect(conn, r)
    finalize(conn)


def test_original_answer_hash_and_complete_citations(
    answer_connection: psycopg.Connection[Any], answer_database: AnswerDatabase
) -> None:
    conn, db = answer_connection, answer_database
    r = new_run(conn, db)
    a = snapshot(conn, db, r, citation_count=2)
    citation(conn, a, occurrences=[1, 3])
    citation(
        conn,
        a,
        position=2,
        occurrences=[2],
        original_url="https://other.test/b",
        normalized_url="https://other.test/b",
        hostname="other.test",
    )
    collect(conn, r)
    finalize(conn)
    original, digest = conn.execute(
        "SELECT answer_text,answer_sha256 FROM geo_answer_snapshots WHERE id=%s", (a,)
    ).fetchone()
    assert original == "  原始回答\r\nA-1\n"
    assert digest == hashlib.sha256(original.encode()).hexdigest()


@pytest.mark.parametrize(
    ("table", "field", "value", "constraint"),
    [
        ("geo_answer_snapshots", "answer_text", "改写", "ck_geo_answers_immutable"),
        ("geo_answer_snapshots", "prompt_text", "改写", "ck_geo_answers_immutable"),
        ("geo_answer_snapshots", "raw_payload_summary", Jsonb({}), "ck_geo_answers_immutable"),
        ("geo_answer_snapshots", "screenshot_file_id", None, "ck_geo_answers_immutable"),
        ("geo_answer_citations", "title", "改写", "ck_geo_citations_immutable"),
        ("geo_answer_citations", "position", 2, "ck_geo_citations_immutable"),
        ("geo_answer_citations", "original_url", "https://evil.test", "ck_geo_citations_immutable"),
    ],
)
def test_update_rejected(
    answer_connection: psycopg.Connection[Any],
    answer_database: AnswerDatabase,
    table: str,
    field: str,
    value: Any,
    constraint: str,
) -> None:
    conn, db = answer_connection, answer_database
    r = new_run(conn, db)
    a = snapshot(conn, db, r, citation_count=1)
    c = citation(conn, a)
    collect(conn, r)
    finalize(conn)
    with pytest.raises(psycopg.errors.CheckViolation) as raised:
        conn.execute(
            sql.SQL("UPDATE {} SET {}=%s WHERE id=%s").format(
                sql.Identifier(table), sql.Identifier(field)
            ),
            (value, a if table.endswith("snapshots") else c),
        )
    assert raised.value.diag.constraint_name == constraint


@pytest.mark.parametrize("table", ["geo_answer_snapshots", "geo_answer_citations"])
@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_even_noop_and_delete_rejected(
    answer_connection: psycopg.Connection[Any],
    answer_database: AnswerDatabase,
    table: str,
    operation: str,
) -> None:
    conn, db = answer_connection, answer_database
    r = new_run(conn, db)
    a = snapshot(conn, db, r, citation_count=1)
    c = citation(conn, a)
    collect(conn, r)
    finalize(conn)
    query = (
        f"UPDATE {table} SET id=id WHERE id=%s"
        if operation == "UPDATE"
        else f"DELETE FROM {table} WHERE id=%s"
    )
    with pytest.raises(psycopg.errors.CheckViolation):
        conn.execute(query, (a if table.endswith("snapshots") else c,))


def test_citation_cannot_append_after_commit(answer_database: AnswerDatabase) -> None:
    db = answer_database
    with psycopg.connect(db.url) as conn:
        r = new_run(conn, db)
        a = snapshot(conn, db, r)
        collect(conn, r)
    with psycopg.connect(db.url) as conn:
        with pytest.raises(psycopg.errors.CheckViolation) as raised:
            citation(conn, a)
        assert raised.value.diag.constraint_name == "ck_geo_citations_submission"


@pytest.mark.parametrize(
    "case", ["no-answer", "no-collection", "missing-citation", "overlap", "wrong-prompt"]
)
def test_incomplete_submission_rejected(
    answer_connection: psycopg.Connection[Any], answer_database: AnswerDatabase, case: str
) -> None:
    conn, db = answer_connection, answer_database
    r = new_run(conn, db)
    with pytest.raises(psycopg.errors.CheckViolation):
        if case != "no-answer":
            a = snapshot(
                conn,
                db,
                r,
                citation_count=2 if case == "overlap" else (1 if case == "missing-citation" else 0),
                **({"prompt_text": "另一问题"} if case == "wrong-prompt" else {}),
            )
            if case == "overlap":
                citation(conn, a, occurrences=[1, 3])
                citation(
                    conn,
                    a,
                    position=2,
                    occurrences=[2, 3],
                    original_url="https://other.test/b",
                    normalized_url="https://other.test/b",
                    hostname="other.test",
                )
        if case != "no-collection":
            collect(conn, r)
        finalize(conn)


@pytest.mark.parametrize(
    "patch",
    [
        {"api_key": "fixture-secret"},
        {"payload_format": "fixture-secret"},
        {"payload_bytes": "fixture-secret"},
        {"payload_bytes": {"headers": "fixture"}},
        {"payload_bytes": True},
        {"payload_bytes": -1},
        {"payload_bytes": 52428801},
    ],
)
def test_summary_secret_and_bad_leaves_rejected(
    answer_connection: psycopg.Connection[Any],
    answer_database: AnswerDatabase,
    patch: dict[str, Any],
) -> None:
    conn, db = answer_connection, answer_database
    r = new_run(conn, db)
    with pytest.raises(psycopg.errors.CheckViolation) as raised:
        snapshot(
            conn, db, r, raw_payload_summary=Jsonb(GeoRawPayloadSummary().model_dump() | patch)
        )
    assert raised.value.diag.constraint_name == "ck_geo_answers_summary"


@pytest.mark.parametrize(
    "patch",
    [
        {"status": "PENDING", "verified_at": None},
        {"status": "DELETING"},
        {"access_level": "PUBLIC"},
        {"category": "PLATFORM_LOGO"},
        {"content_type": "text/plain"},
        {"sha256": "x"},
        {"size": 10485761},
    ],
)
def test_file_qualification_direct_sql(
    answer_connection: psycopg.Connection[Any],
    answer_database: AnswerDatabase,
    patch: dict[str, Any],
) -> None:
    conn, db = answer_connection, answer_database
    f = file_record(conn, db, **patch)
    r = new_run(conn, db)
    with pytest.raises(psycopg.errors.CheckViolation) as raised:
        snapshot(conn, db, r, screenshot_file_id=f)
    assert raised.value.diag.constraint_name == "ck_geo_answers_file_eligible"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("sha256", "0" * 64),
        ("status", "DELETING"),
        ("access_level", "PUBLIC"),
        ("object_key", "changed"),
    ],
)
def test_referenced_file_is_immutable(
    answer_connection: psycopg.Connection[Any],
    answer_database: AnswerDatabase,
    field: str,
    value: str,
) -> None:
    conn, db = answer_connection, answer_database
    f = file_record(conn, db)
    r = new_run(conn, db)
    snapshot(conn, db, r, screenshot_file_id=f)
    collect(conn, r)
    finalize(conn)
    with pytest.raises(psycopg.Error) as raised:
        conn.execute(
            sql.SQL("UPDATE file_records SET {}=%s WHERE id=%s").format(sql.Identifier(field)),
            (value, f),
        )
    if field == "status":
        assert raised.value.sqlstate == "23514"
        assert raised.value.diag.constraint_name == "ck_geo_evidence_file_immutable"
    else:
        # 既有 file_records_guard 更早拒绝元数据变更，继续保留其 55000 防线。
        assert raised.value.sqlstate == "55000"
