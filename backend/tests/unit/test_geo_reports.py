"""报告CSV公开列、注入边界、惰性内存与取消生命周期。"""

import csv
import io
import tracemalloc
from dataclasses import replace
from datetime import UTC, datetime
from hashlib import sha256
from uuid import uuid4

import anyio
import pytest
from starlette.requests import ClientDisconnect

from app.errors import AppError
from app.schemas.geo_answer_insights import GeoAnswerInsights, GeoInsightWindow
from app.services import geo_reports
from app.services.geo_answer_insights import BUSINESS_METRICS, SOV_METRICS
from app.services.geo_insight_evidence import InsightCitation, InsightClaim, InsightEvidence
from app.services.geo_insight_quality import data_quality
from app.services.geo_metric_types import MetricCitation, MetricClaim
from app.services.geo_overview import QUALITY_CODES
from app.services.geo_report_csv import (
    COLUMNS,
    CsvStream,
    GeoCsvResponse,
    encode_row,
    export_rows,
    safe_cell,
)
from app.services.geo_report_formulas import report_formulas
from tests.unit.test_geo_overview import filters, source


@pytest.mark.parametrize(
    "text",
    [
        "=SUM(A1)",
        "+1",
        "-1",
        "@SUM(A1)",
        " \u2003\u00a0=1",
        "\tplain",
        "\rplain",
        "\nplain",
        "\x00plain",
        "\u200b@formula",
        "\u0085-1",
        " \ufeffplain",
        "\t\n",
    ],
)
def test_formula_and_control_prefixes_are_quoted_without_altering_original(text):
    assert safe_cell(text) == "'" + text


@pytest.mark.parametrize("text", ["普通中文", 'a,"quoted"\nline', "\u2003普通中文", "", "42"])
def test_safe_text_is_unchanged_and_csv_round_trips(text):
    encoded = encode_row(("text",), {"text": text, "secret": "never-export"})
    assert next(csv.reader(io.StringIO(encoded.decode())))[0] == text
    assert b"never-export" not in encoded


def test_null_unknown_and_decimal_zero_are_distinct():
    from decimal import Decimal

    assert safe_cell(None) == ""
    assert safe_cell("UNKNOWN") == "UNKNOWN"
    assert safe_cell(Decimal(0)) == "0"


def test_stream_is_lazy_constant_memory_for_100k_synthetic_rows_and_releases_once():
    read, released = [], []

    def rows():
        for index in range(100_000):
            if index % 10_000 == 0:
                read.append(index)
            yield {"id": index, "text": '中文,引号"\n原文'}

    iterator = rows()
    tracemalloc.start()
    try:
        stream = CsvStream(("id", "text"), iterator, next(iterator), lambda: released.append(True))
        assert read == [0]
        initial = next(stream)
        assert initial.startswith(b"\xef\xbb\xbf")
        assert read == [0]
        chunks = 1
        for chunk in stream:
            assert len(chunk) < 100
            chunks += 1
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    stream.close()
    assert chunks == 100_000
    assert read == list(range(0, 100_000, 10_000))
    assert peak < 1_000_000
    assert released == [True]


def stream_fixture(*, failing=False):
    released = []

    def rows():
        yield {"text": "first"}
        if failing:
            raise ValueError("explicit-generation-failure")
        while True:
            yield {"text": "later"}

    iterator = rows()
    stream = CsvStream(("text",), iterator, next(iterator), lambda: released.append(True))
    return stream, released


def test_iteration_failure_propagates_and_closes_stream():
    stream, released = stream_fixture(failing=True)
    next(stream)
    with pytest.raises(ValueError, match="explicit-generation-failure"):
        next(stream)
    assert released == [True] and stream.closed


def test_disconnect_waits_for_running_producer_before_closing_generator():
    import threading

    entered, proceed = threading.Event(), threading.Event()
    released = []

    def rows():
        yield {"text": "first"}
        entered.set()
        assert proceed.wait(5), "producer未获有界释放"
        yield {"text": "second"}

    iterator = rows()
    stream = CsvStream(("text",), iterator, next(iterator), lambda: released.append(True))
    response = GeoCsvResponse(stream, as_of=datetime.now(UTC), kind="runs")

    async def exercise():
        async def send(message):
            pass

        async def receive():
            assert await anyio.to_thread.run_sync(entered.wait, 5)
            proceed.set()
            return {"type": "http.disconnect"}

        await response({"type": "http", "asgi": {"spec_version": "2.3"}}, receive, send)

    anyio.run(exercise)
    assert released == [True] and stream.closed


@pytest.mark.parametrize("failure", ["disconnect", "send-error", "cancel"])
def test_response_always_releases_on_disconnect_send_error_and_cancellation(failure):
    stream, released = stream_fixture()
    response = GeoCsvResponse(stream, as_of=datetime.now(UTC), kind="runs")

    async def exercise():
        sent = anyio.Event()

        async def send(message):
            if message["type"] == "http.response.body":
                sent.set()
                if failure == "send-error":
                    raise OSError("closed-client")
                await anyio.sleep_forever()

        async def receive():
            await sent.wait()
            return {"type": "http.disconnect"}

        spec = "2.4" if failure == "send-error" else "2.3"
        scope = {"type": "http", "asgi": {"spec_version": spec}}
        if failure == "cancel":
            async with anyio.create_task_group() as group:
                group.start_soon(response, scope, receive, send)
                await sent.wait()
                group.cancel_scope.cancel()
        elif failure == "send-error":
            with pytest.raises(ClientDisconnect):
                await response(scope, receive, send)
        else:
            await response(scope, receive, send)

    anyio.run(exercise)
    assert released == [True] and stream.closed


def test_fixed_columns_exclude_secret_evidence_and_raw_urls_and_keep_claim_text():
    for columns in COLUMNS.values():
        assert len(columns) == len(set(columns))
        assert not set(columns) & {
            "answer_text",
            "input_snapshot",
            "fact_excerpt",
            "explanation",
            "raw_payload",
            "original_url",
            "normalized_url",
            "signed_url",
            "api_key",
            "lease_token",
        }
    assert "claim_text" in COLUMNS["claims"]


def test_event_exports_keep_unjudgeable_selected_claims_and_deduplicate_citations():
    value = source()
    subject = value.snapshot.subjects[0].id
    citation = InsightCitation(
        uuid4(),
        "https://example.test/a?signature=private-canary",
        "example.test",
        "\u2003=1",
        (1, 2),
        "OWNED",
        subject,
        (subject,),
    )
    claim = InsightClaim(
        uuid4(),
        subject,
        None,
        "OTHER",
        "\t+中文声明",
        "UNJUDGEABLE",
        "LOW",
        "private-fact-canary",
        "private-explanation-canary",
    )
    value = replace(
        value,
        metric=replace(
            value.metric,
            citations=(MetricCitation(citation.normalized_url, citation.hostname, True),),
            citation_classification_complete=True,
            claims=(MetricClaim(subject, "UNJUDGEABLE", "LOW"),),
        ),
        evidence=InsightEvidence(citations=(citation,), claims=(claim,)),
    )
    for kind, expected_field, identity in (
        ("citations", "citation_id", citation.citation_id),
        ("claims", "claim_assessment_id", claim.claim_assessment_id),
    ):
        rows = list(export_rows([value], filters(subject_ids=[subject]), kind, value.created_at))
        assert len(rows) == 1 and rows[0][expected_field] == identity
        encoded = encode_row(COLUMNS[kind], rows[0]).decode()
        assert "private-" not in encoded
        if kind == "claims":
            assert rows[0]["verdict"] == "UNJUDGEABLE"
            assert "'\t+中文声明" in encoded
        else:
            assert (
                rows[0]["normalized_url_sha256"]
                == sha256(citation.normalized_url.encode()).hexdigest()
            )


def test_failed_candidates_are_runs_rows_but_never_event_rows():
    value = source()
    value = replace(value, metric=replace(value.metric, status="FAILED"))
    rows = list(export_rows([value], filters(), "runs", value.created_at))
    assert rows[0]["status"] == "FAILED" and rows[0]["generic_eligible"] is False
    assert "RUN_NOT_COMPLETED" in rows[0]["exclusion_reasons"]
    assert list(export_rows([value], filters(), "citations", value.created_at)) == []
    assert list(export_rows([value], filters(), "claims", value.created_at)) == []


def test_formula_notes_cover_all_actual_business_and_quality_codes():
    codes = {row.metric_code for row in report_formulas()}
    assert codes == {m.value for m in (*BUSINESS_METRICS, *SOV_METRICS)} | set(QUALITY_CODES)


@pytest.mark.parametrize(
    "state,reason", [("empty", "NO_DATA"), ("failed", "NO_ELIGIBLE_RUNS"), ("ready", None)]
)
def test_preview_preserves_as_of_quality_and_explicit_unavailability(monkeypatch, state, reason):
    query = filters()
    value = source()
    if state == "failed":
        value = replace(value, metric=replace(value.metric, status="FAILED"))
    inputs = [] if state == "empty" else [value]
    as_of = datetime(2026, 3, 1, tzinfo=UTC)
    insights = GeoAnswerInsights(
        as_of=as_of,
        filters=query,
        current_window=GeoInsightWindow(date_from=query.date_from, date_to=query.date_to),
        previous_window=GeoInsightWindow(date_from=query.date_from, date_to=query.date_to),
        current_cells=[],
        previous_cells=[],
        trends=[],
        question_coverage=[],
        product_matrix_cell_keys=[],
        platform_performance=[],
        competitor_sov_cell_keys=[],
        citation_insights=[],
        fact_risks=[],
        data_quality=data_quality(inputs, query),
        unavailable_sections=["OPPORTUNITIES"],
    )
    monkeypatch.setattr(geo_reports, "get_insights", lambda db, filters: insights)

    class Clock:
        def scalar(self, query):
            return as_of.replace(hour=1)

    report = geo_reports.get_preview(Clock(), query)
    assert report.as_of == report.insights.as_of == as_of
    assert report.generated_at == as_of.replace(hour=1)
    assert report.unavailable_reason == reason and report.available == (reason is None)
    assert report.insights.data_quality.overview.candidate_run_count == len(inputs)
    assert report.exports[-1].unavailable_reason == "NOT_IMPLEMENTED"


def test_opportunities_fails_before_opening_database_or_writing_audit():
    with pytest.raises(AppError) as error:
        geo_reports.prepare_csv(None, None, filters(), "opportunities", "test")
    assert error.value.status_code == 501 and error.value.code == "NOT_IMPLEMENTED"


def test_filter_digest_normalizes_all_filter_sets_without_storing_plaintext():
    first, second = uuid4(), uuid4()
    one = filters(subject_ids=[first, second, first], language_codes=["en", "zh"])
    two = filters(subject_ids=[second, first], language_codes=["zh", "en"])
    assert geo_reports.filter_sha256(one) == geo_reports.filter_sha256(two)
    assert geo_reports.filter_sha256(one) != geo_reports.filter_sha256(filters(subject_ids=[first]))


def test_asgi24_raw_task_cancel_serializes_close_with_active_producer(monkeypatch):
    """原生Task.cancel可越过AnyIO shield，不能在生产线程中途关闭生成器/Session。"""
    import asyncio
    import threading

    entered, proceed, close_entered = threading.Event(), threading.Event(), threading.Event()
    active, finalized = threading.Event(), threading.Event()
    released = []

    def rows():
        try:
            yield {"text": "first"}
            active.set()
            entered.set()
            try:
                assert proceed.wait(5), "producer未获有界释放"
            finally:
                active.clear()
            yield {"text": "second"}
        finally:
            finalized.set()

    iterator = rows()
    stream = CsvStream(
        ("text",), iterator, next(iterator), lambda: released.append(not active.is_set())
    )
    close = stream.close

    def observed_close():
        close_entered.set()
        close()

    monkeypatch.setattr(stream, "close", observed_close)
    response = GeoCsvResponse(stream, as_of=datetime.now(UTC), kind="runs")

    async def exercise():
        async def send(message):
            pass

        async def receive():
            await asyncio.Event().wait()

        task = asyncio.create_task(
            response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, send)
        )
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            task.cancel()
            assert await asyncio.to_thread(close_entered.wait, 5)
            proceed.set()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            proceed.set()

    asyncio.run(exercise())
    assert stream.closed and finalized.is_set()
    assert released == [True]
