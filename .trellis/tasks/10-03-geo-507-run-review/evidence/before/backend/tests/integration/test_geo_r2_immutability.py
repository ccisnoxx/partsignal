"""R2：已提交聚合的 SQL 攻击必须失败，整笔事务及对外事实保持原样。"""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tests.integration.geo_plans_support import plans_api as plans_api
from tests.integration.geo_plans_support import questions_api as questions_api
from tests.integration.geo_plans_support import questions_engine as questions_engine
from tests.integration.test_geo_manual_collection import (
    batch_run,
    evidence,
    payload,
    prefix,
    submit,
)
from tests.integration.test_geo_manual_races import cancel_storage_writer

pytestmark = pytest.mark.integration
__all__ = ["plans_api", "questions_api", "questions_engine"]


def committed_facts(api, run, file_id):
    # 查询条件限定当前聚合，避免把其他用例的数据当作本用例证据。
    selections = {
        "geo_observation_batches": "id=:batch",
        "geo_observation_runs": "batch_id=:batch",
        "geo_batch_creation_requests": "batch_id=:batch",
        "geo_batch_subjects": "batch_id=:batch",
        "geo_answer_snapshots": "run_id=:run",
        "geo_answer_citations": (
            "answer_snapshot_id IN (SELECT id FROM geo_answer_snapshots WHERE run_id=:run)"
        ),
        "geo_manual_submissions": "run_id=:run",
        "geo_manual_drafts": "run_id=:run",
        "file_records": "id=:file",
        "audit_logs": "target_id=:target",
        "query_topics": "id=:topic",
    }
    with api.api.factory() as db:
        return {
            table: list(
                db.scalars(
                    text(
                        f"SELECT to_jsonb(t) FROM {table} t WHERE {where} "
                        "ORDER BY to_jsonb(t)::text"
                    ),
                    {
                        "batch": run.batch_id,
                        "run": run.id,
                        "file": file_id,
                        "target": str(run.id),
                        "topic": api.api.topic,
                    },
                )
            )
            for table, where in selections.items()
        }


def public_facts(api, run):
    response = api.api.engineer.get(prefix(run))
    assert response.status_code == 200
    value = response.json()
    # as_of 和短期签名属于每次读取的能力，不属于冻结业务事实。
    value.pop("as_of")
    for file in value["evidence_files"]:
        file.pop("download")
    return value


@pytest.mark.parametrize(
    "statement,constraint",
    [
        (
            "UPDATE geo_answer_snapshots SET answer_text='篡改' WHERE run_id=:run",
            "ck_geo_answers_immutable",
        ),
        ("DELETE FROM geo_answer_snapshots WHERE run_id=:run", "ck_geo_answers_immutable"),
        (
            "UPDATE geo_answer_citations SET id=id WHERE answer_snapshot_id=:answer",
            "ck_geo_citations_immutable",
        ),
        (
            "DELETE FROM geo_answer_citations WHERE answer_snapshot_id=:answer",
            "ck_geo_citations_immutable",
        ),
        (
            "UPDATE geo_manual_submissions SET identity_hash=identity_hash WHERE run_id=:run",
            "ck_geo_manual_submissions_immutable",
        ),
        (
            "DELETE FROM geo_manual_submissions WHERE run_id=:run",
            "ck_geo_manual_submissions_immutable",
        ),
        (
            "UPDATE geo_batch_creation_requests SET request_hash=request_hash "
            "WHERE batch_id=:batch",
            "ck_geo_creation_immutable",
        ),
        ("DELETE FROM geo_batch_subjects WHERE batch_id=:batch", "ck_geo_creation_immutable"),
        (
            "UPDATE geo_observation_runs SET input_snapshot='{}',revision=revision+1 WHERE id=:run",
            "ck_geo_runs_immutable",
        ),
        ("DELETE FROM geo_observation_runs WHERE id=:run", "ck_geo_runs_immutable"),
        (
            "UPDATE geo_observation_batches SET rule_snapshot='{}',revision=revision+1 "
            "WHERE id=:batch",
            "ck_geo_batches_immutable",
        ),
        ("DELETE FROM geo_observation_batches WHERE id=:batch", "ck_geo_batches_immutable"),
        (
            "UPDATE file_records SET status='DELETING' WHERE id=:file",
            "ck_geo_evidence_file_immutable",
        ),
        ("DELETE FROM file_records WHERE id=:file", "ck_geo_evidence_file_immutable"),
    ],
)
def test_committed_aggregate_attack_rolls_back_entire_transaction(plans_api, statement, constraint):
    api = plans_api
    run = batch_run(api)[0]
    file_id, _ = evidence(api)
    value = payload(
        run,
        screenshot_file_id=str(file_id),
        citations=[
            {
                "original_url": "https://example.test/r2",
                "position": 1,
                "title": "虚构来源",
            }
        ],
    )
    result = submit(api, run, value)
    assert result.status_code == 201, result.text
    receipt = result.json()
    before = committed_facts(api, run, file_id)
    public_before = public_facts(api, run)
    assert all(before[table] for table in before if table != "geo_manual_drafts")
    with api.api.factory() as db:
        # 先做一次合法更新，证明错误回滚的不只是最后一条非法语句。
        db.execute(
            text(
                "UPDATE query_topics SET canonical_question='必须回滚',revision=revision+1 "
                "WHERE id=:id"
            ),
            {"id": api.api.topic},
        )
        with pytest.raises(IntegrityError) as raised:
            db.execute(
                text(statement),
                {
                    "run": run.id,
                    "batch": run.batch_id,
                    "answer": receipt["answer_snapshot_id"],
                    "file": file_id,
                },
            )
            db.commit()
        assert raised.value.orig.sqlstate == "23514"
        assert raised.value.orig.diag.constraint_name == constraint
        db.rollback()
        assert db.scalar(text("SELECT 1")) == 1
    assert committed_facts(api, run, file_id) == before
    assert public_facts(api, run) == public_before
    assert submit(api, run, value).json() == receipt


@pytest.mark.parametrize("attack", ["late_answer", "reopen"])
def test_committed_cancelled_run_cannot_accept_late_result(plans_api, attack):
    api = plans_api
    source, cancelled = batch_run(api, repeats=2)
    file_id, _ = evidence(api)
    assert submit(api, source, payload(source, screenshot_file_id=str(file_id))).status_code == 201
    with api.api.factory() as db:
        cancel_storage_writer(db, cancelled)
    before = committed_facts(api, cancelled, file_id)
    with api.api.factory() as db:
        # PostgreSQL 行锁的合法同值更新不改历史，真实修改仍必须被拒绝。
        db.execute(
            text("UPDATE geo_observation_runs SET revision=revision WHERE id=:id"),
            {"id": cancelled.id},
        )
        db.commit()
        with pytest.raises(IntegrityError) as raised:
            if attack == "late_answer":
                db.execute(
                    text(
                        "INSERT INTO geo_answer_snapshots "
                        "(id,run_id,prompt_text,answer_text,answer_format,collected_at, "
                        "raw_payload_summary,citation_count,screenshot_file_id) "
                        "SELECT gen_random_uuid(),:run,prompt_text,answer_text,answer_format, "
                        "collected_at,raw_payload_summary,0,screenshot_file_id "
                        "FROM geo_answer_snapshots WHERE run_id=:source"
                    ),
                    {"run": cancelled.id, "source": source.id},
                )
            else:
                db.execute(
                    text(
                        "UPDATE geo_observation_runs SET status='COLLECTED',revision=revision+1 "
                        "WHERE id=:id"
                    ),
                    {"id": cancelled.id},
                )
            db.commit()
        assert raised.value.orig.sqlstate == "23514"
        assert raised.value.orig.diag.constraint_name == (
            "ck_geo_answers_submission" if attack == "late_answer" else "ck_geo_runs_terminal"
        )
        db.rollback()
    assert committed_facts(api, cancelled, file_id) == before
