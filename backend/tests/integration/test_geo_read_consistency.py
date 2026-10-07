"""有界交错证明RR跨查询快照与固定查询成本，GET没有隐式写入。"""

from uuid import uuid4

import pytest
from sqlalchemy import event, select, text

from app.models.identity import SessionRecord
from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.test_geo_manual_collection import evidence, payload, prefix, submit
from tests.integration.test_geo_read_models import BATCHES, RUNS, batch_run, detail

pytestmark = pytest.mark.integration


def capture(api, path, params=None):
    statements = []
    levels = []

    def collect(conn, cursor, statement, parameters, context, many):
        statements.append(statement)
        levels.append(conn.get_isolation_level())

    event.listen(api.api.engine, "before_cursor_execute", collect)
    try:
        response = api.api.engineer.get(path, params=params)
        assert response.status_code == 200, response.text
    finally:
        event.remove(api.api.engine, "before_cursor_execute", collect)
    assert all(level == "REPEATABLE READ" for level in levels)
    assert all(sql.lstrip().startswith("SELECT") for sql in statements)
    assert not any(
        "base_url" in sql
        or "request_parameters" in sql
        or "ai_channel_headers" in sql
        or "lease_token" in sql
        for sql in statements
    )
    return response.json(), len(statements)


def test_query_count_constant_with_runs_references_and_batches(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    with api.api.factory() as db:
        before = list(
            db.scalars(
                select(SessionRecord.last_seen_at).where(
                    SessionRecord.user_id == api.api.engineer_id
                )
            )
        )
    small_detail, detail_count = capture(api, prefix(run))
    _, batch_count = capture(api, f"{BATCHES}/{run.batch_id}")
    _, list_count = capture(api, BATCHES, {"q": api.name})
    _, run_count = capture(api, RUNS, {"subject_id": str(api.subject)})
    dense = batch_run(api, repeats=10)
    screenshot, _ = evidence(api)
    citations = [
        {"original_url": f"https://fixture.test/{index}", "position": index + 1}
        for index in range(40)
    ]
    submitted = submit(
        api, run, payload(run, screenshot_file_id=str(screenshot), citations=citations)
    )
    assert submitted.status_code == 201, submitted.text
    for _ in range(10):
        batch_run(api)
    rich_detail, rich_count = capture(api, prefix(run))
    assert len(rich_detail["citations"]) == 40 and small_detail["answer"] is None
    # GEO-507固定增加6次批量历史/结果读取，不能随run、引用或review数增长。
    assert rich_count == detail_count == 15
    assert capture(api, f"{BATCHES}/{dense[0].batch_id}")[1] == batch_count == 5
    assert capture(api, BATCHES, {"q": api.name})[1] == list_count == 6
    assert capture(api, RUNS, {"subject_id": str(api.subject)})[1] == run_count == 5
    assert capture(api, f"{BATCHES}/{dense[0].batch_id}/runs")[1] == 6
    with api.api.factory() as db:
        after = list(
            db.scalars(
                select(SessionRecord.last_seen_at).where(
                    SessionRecord.user_id == api.api.engineer_id
                )
            )
        )
    assert before == after


def test_count_rows_and_current_eligibility_share_snapshot(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    inserted = False

    def after_count(conn, cursor, statement, parameters, context, many):
        nonlocal inserted
        if inserted or "count(*)" not in statement or "geo_observation_runs" not in statement:
            return
        inserted = True
        batch_run(api)
        with api.api.factory() as db:
            db.execute(
                text(
                    "UPDATE geo_collection_profiles SET is_active=false,"
                    "revision=revision+1 WHERE id=:id"
                ),
                {"id": api.profile},
            )
            db.commit()

    event.listen(api.api.engine, "after_cursor_execute", after_count)
    try:
        response = api.api.engineer.get(RUNS, params={"subject_id": str(api.subject)})
    finally:
        event.remove(api.api.engine, "after_cursor_execute", after_count)
    assert response.status_code == 200, response.text
    value = response.json()
    assert inserted and value["total"] == 1 and len(value["items"]) == 1
    assert value["items"][0]["id"] == str(run.id)
    assert value["items"][0]["available_actions"] == ["ENTER_MANUAL_OBSERVATION"]
    current = api.api.engineer.get(RUNS, params={"subject_id": str(api.subject)}).json()
    assert current["total"] == 2 and all(
        not item["collection_eligible"] for item in current["items"]
    )


def test_detail_concurrent_submit_cannot_mix_old_status_and_new_evidence(plans_api):
    api = plans_api
    run = batch_run(api)[0]
    screenshot, _ = evidence(api)
    value = payload(
        run,
        screenshot_file_id=str(screenshot),
        citations=[{"original_url": "https://fixture.test/a", "position": 1}],
    )
    submitted = False

    def after_run(conn, cursor, statement, parameters, context, many):
        nonlocal submitted
        if (
            submitted
            or "FROM geo_observation_runs LEFT OUTER JOIN geo_answer_snapshots" not in statement
        ):
            return
        submitted = True
        response = submit(api, run, value, key=str(uuid4()))
        assert response.status_code == 201, response.text

    event.listen(api.api.engine, "after_cursor_execute", after_run)
    try:
        observed = detail(api, run)
    finally:
        event.remove(api.api.engine, "after_cursor_execute", after_run)
    assert submitted and observed["run"]["status"] == "PENDING"
    assert (
        observed["answer"] is None
        and observed["evidence_files"] == []
        and observed["citations"] == []
    )
    assert observed["batch"]["summary"]["status_counts"]["pending"] == 1
    assert [event["event"] for event in observed["timeline"]] == ["CREATED"]
    current = detail(api, run)
    assert current["run"]["status"] == "COLLECTED" and current["answer"] is not None
    assert len(current["evidence_files"]) == len(current["citations"]) == 1
