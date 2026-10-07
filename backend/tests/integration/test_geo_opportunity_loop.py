"""GEO-707：真实分析与规则触发的完整行动/复测/解决及最小审计。"""

from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.models.content import ContentTask
from app.models.geo_opportunities import (
    GeoOpportunity,
    GeoOpportunityEvaluation,
    GeoOpportunitySource,
)
from app.models.identity import AuditLog
from app.models.product_facts import FactVersion
from app.services import geo_opportunities
from tests.integration.geo_loop_support import (
    PATH,
    complete_content,
    evaluate,
    finish_batch,
    gap,
    loop_case,
    plans_api,
    questions_api,
    questions_engine,
)

pytestmark = pytest.mark.integration
__all__ = ["loop_case", "plans_api", "questions_api", "questions_engine"]


def logs(case, identity):
    with case.api.factory() as db:
        return list(db.scalars(select(AuditLog).where(AuditLog.target_id == str(identity))))


def test_topic_gap_content_completion_retest_explicit_resolve_and_safe_audit(loop_case):
    case = loop_case
    first = gap(case, evaluate(case))
    identity = first.id
    path = f"{PATH}/{identity}"
    assert first.status == "OPEN" and first.trigger_snapshot["denominator"] == 5
    frozen = deepcopy(first.trigger_snapshot)
    assert all(r.replayed for r in evaluate(case))
    assert [log.action for log in logs(case, identity)] == ["geo_opportunity.opened"]
    ack = case.api.engineer.post(f"{path}/acknowledge", json={"expected_revision": 1})
    assert ack.status_code == 200, ack.text
    payload = {
        "expected_revision": ack.json()["revision"],
        "product_id": str(case.graph["product"].id),
        "fact_version_id": str(case.graph["fact"].id),
        "platform_profile_id": str(case.graph["platform"].id),
    }
    key = str(uuid4())
    linked = case.api.engineer.post(
        f"{path}/actions/content-task", json=payload, headers={"Idempotency-Key": key}
    )
    assert linked.status_code == 200, linked.text
    replay = case.api.engineer.post(
        f"{path}/actions/content-task", json=payload, headers={"Idempotency-Key": key}
    )
    assert replay.status_code == 200 and replay.json()["replayed"] is True
    task_id = UUID(linked.json()["action"]["target_id"])
    complete_content(case, task_id)
    with case.api.factory() as db:
        task = db.get(ContentTask, task_id)
        assert task.status == "COMPLETED" and task.query_topic_id == first.query_topic_id
        assert task.product_id == case.graph["product"].id
        assert task.fact_version_id == case.graph["fact"].id
        opportunity = db.get(GeoOpportunity, identity)
        assert opportunity.status == "IN_PROGRESS"
        revision = opportunity.revision
    request = {"expected_revision": revision, "baseline_batch_id": str(case.batch_id)}
    preview = case.api.engineer.get(
        f"{path}/retest-preview", params={"baseline_batch_id": str(case.batch_id)}
    )
    assert preview.status_code == 200, preview.text
    retest_key = str(uuid4())
    created = case.api.engineer.post(
        f"{path}/retest", json=request, headers={"Idempotency-Key": retest_key}
    )
    assert created.status_code == 201, created.text
    replay = case.api.engineer.post(
        f"{path}/retest", json=request, headers={"Idempotency-Key": retest_key}
    )
    assert replay.status_code == 201 and replay.json()["replayed"] is True
    retest_id = UUID(created.json()["batch_id"])
    finish_batch(case.api, retest_id, mentioned=True)
    read = case.api.engineer.get(f"{path}/comparison").json()
    comparison = read["comparison"]
    assert comparison["comparable"] is True
    assert comparison["recovery"]["status"] == "RECOVERED"
    assert comparison["recovery"]["required_run_count"] == 5
    assert comparison["baseline"]["metrics"][0]["value"] == 0
    assert comparison["retest"]["metrics"][0]["value"] == 1
    assert comparison["causal_claim"] == "NOT_ESTABLISHED"
    assert read["opportunity"]["status"] == "IN_PROGRESS" and read["decisions"] == []
    resolved = case.api.engineer.post(
        f"{path}/resolve",
        json={
            "expected_revision": read["opportunity_revision"],
            "resolution_method": "RETEST",
            "resolution_code": "VERIFIED",
            "resolution_comment": "GEO707私密处理原因哨兵",
            "retest_batch_id": str(retest_id),
            "comparison_fingerprint": comparison["fingerprint"],
        },
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["opportunity"]["status"] == "RESOLVED"
    assert resolved.json()["decision"]["comparison_snapshot"] == comparison
    assert (
        case.api.engineer.get(f"{path}/comparison").json()["decisions"][0]["decision"]
        == "RETEST_RESOLVE"
    )
    expected = {
        "geo_opportunity.opened",
        "geo_opportunity.acknowledged",
        "geo_opportunity.action_linked",
        "geo.retest.created",
        "geo_opportunity.resolved",
    }
    audit = logs(case, identity)
    assert len(audit) == 5 and {log.action for log in audit} == expected
    for log in audit:
        detail = case.api.admin.get(f"/api/v1/audit-logs/{log.id}")
        assert detail.status_code == 200, detail.text
        projected = detail.json()
        assert projected["related_entry"]["kind"] == "GeoOpportunity"
        assert projected["changes"] == []
        assert not any(
            s in detail.text
            for s in (
                "GEO707私密处理原因哨兵",
                "工作电压",
                "虚构对照器件",
                "可供选择",
                "answer_text",
                "body_markdown",
                "resolution_comment",
                "csrf",
                "password",
                "token",
            )
        )
    with case.api.factory() as db:
        assert db.get(GeoOpportunity, identity).trigger_snapshot == frozen
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoOpportunitySource)
                .where(GeoOpportunitySource.opportunity_id == identity)
            )
            == 5
        )
        assert (
            db.get(FactVersion, case.graph["fact"].id).body_markdown
            == case.graph["fact"].body_markdown
        )


def test_opened_audit_failure_rolls_back_opportunity_sources_and_evaluations(
    loop_case, monkeypatch
):
    case = loop_case
    models = (GeoOpportunity, GeoOpportunitySource, GeoOpportunityEvaluation, AuditLog)
    with case.api.factory() as db:
        before = [db.scalar(select(func.count()).select_from(m)) for m in models]

    def reject(*_args, **_kwargs):
        raise RuntimeError("GEO707审计写入失败")

    monkeypatch.setattr(geo_opportunities, "append_audit", reject)
    with pytest.raises(RuntimeError, match="GEO707审计写入失败"):
        evaluate(case)
    with case.api.factory() as db:
        assert [db.scalar(select(func.count()).select_from(m)) for m in models] == before
