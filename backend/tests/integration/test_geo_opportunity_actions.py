"""704真实PG/HTTP：复用领域服务、原子回执、历史来源和恢复边界。"""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import delete, event, func, select
from sqlalchemy.exc import IntegrityError

from app.errors import AppError
from app.models.content import ContentTask
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunityAction
from app.models.identity import AuditLog, User
from app.models.product_facts import FactVersion, Product
from app.schemas.content import ContentTaskCreate, ContentTaskPermanentDeleteRequest
from app.schemas.geo_opportunities import GeoOpportunityActionType
from app.schemas.geo_opportunity_actions import GeoOpportunityContentTaskRequest
from app.services import content_planning, publication
from app.services import geo_opportunity_actions as actions
from tests.integration.geo_opportunity_actions_support import (
    citation_opportunity,
    count,
    post,
    publish_task,
    ready,
)
from tests.integration.test_geo_opportunity_workbench import (
    PATH,
    analysis_engine,
    answer_database,
    api,
    detail,
    harness,
    overview_api,
    plan_database,
    review_api,
    run_database,
)

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "api",
    "harness",
    "overview_api",
    "plan_database",
    "review_api",
    "run_database",
]


def test_fact_navigation_and_content_creation_preserve_sources_replay_and_safe_audit(api):
    case, filters, correction, identity, payload = ready(api)
    before = detail(api, identity)
    assert before["available_action_types"] == ["FACT_REVISION", "CONTENT_TASK"]
    with api.harness.factory() as db:
        facts_before = count(db, FactVersion)
        body_before = db.get(Product, UUID(payload["product_id"])).facts_body_markdown
    fact = {k: payload[k] for k in ("expected_revision", "product_id")}
    result = post(api, identity, "fact-revision", fact, "geo704-fact-key")
    assert result.status_code == 200, result.text
    assert result.headers["Cache-Control"] == "no-store"
    action = result.json()["action"]
    assert action["target_type"] == "Product" and action["target_id"] == payload["product_id"]
    assert (
        action["navigation_path"]
        == f"/products/{payload['product_id']}/facts?source_opportunity_id={identity}"
    )
    payload["expected_revision"] = result.json()["opportunity_revision"]
    created = post(api, identity, "content-task", payload, "geo704-content-key")
    assert created.status_code == 200, created.text
    receipt = created.json()
    replay = post(api, identity, "content-task", payload, "geo704-content-key")
    assert replay.status_code == 200 and replay.json() == receipt | {"replayed": True}
    conflict = post(
        api, identity, "content-task", payload | {"expected_revision": 999}, "geo704-content-key"
    )
    assert (
        conflict.status_code == 409 and conflict.json()["error"]["code"] == "IDEMPOTENCY_CONFLICT"
    )
    after = detail(api, identity)
    assert after["opportunity"]["status"] == "IN_PROGRESS"
    assert (
        after["trigger_snapshot"] == before["trigger_snapshot"]
        and after["sources"] == before["sources"]
    )
    snapshot = receipt["action"]["source_snapshot"]
    assert snapshot["trigger_snapshot"] == before["trigger_snapshot"]
    assert snapshot["sources"] == [
        {
            k: v
            for k, v in s.items()
            if k in {"run_id", "analysis_revision_id", "review_id", "source_role"}
        }
        for s in before["sources"]["items"]
    ]
    with api.harness.factory() as db:
        task = db.get(ContentTask, UUID(receipt["action"]["target_id"]))
        assert (
            str(task.query_topic_id)
            == snapshot["query_topic_id"]
            == before["opportunity"]["scope"]["query_topic_id"]
        )
        assert str(task.fact_version_id) == payload["fact_version_id"]
        assert (
            count(db, FactVersion) == facts_before
            and db.get(Product, task.product_id).facts_body_markdown == body_before
        )
        logs = list(
            db.scalars(
                select(AuditLog).where(
                    AuditLog.target_id == identity,
                    AuditLog.action == "geo_opportunity.action_linked",
                )
            )
        )
        assert len(logs) == 2
        assert set(logs[-1].details["facts"]) == {
            "action_id",
            "action_type",
            "target_type",
            "target_id",
            "revision",
            "status",
        }
        assert "虚构公开事实" not in str(logs[-1].details)
        log_id = logs[-1].id
    audit = api.admin.get(f"/api/v1/audit-logs/{log_id}")
    assert audit.status_code == 200 and audit.json()["related_entry"]["kind"] == "GeoOpportunity"
    # 新复核/评估只追加来源；旧行动冻结身份不随之重写。
    changed = deepcopy(correction)
    changed["claims"][0]["explanation"] = "行动后新增复核"
    assert api.submit(case, decision="CORRECTED", correction_payload=changed).status_code == 201
    from tests.integration.test_geo_opportunities import evaluate

    evaluate(api, filters)
    newest = detail(api, identity)
    assert newest["sources"]["total"] == 2
    assert newest["actions"][-1]["source_snapshot"] == snapshot


@pytest.mark.parametrize("phase", ["audit", "flush", "commit"])
def test_failure_rolls_back_domain_target_state_receipt_and_audit_then_same_key_recovers(
    api, monkeypatch, phase
):
    _, _, _, identity, payload = ready(api)
    with api.harness.factory() as db:
        before = (count(db, ContentTask), count(db, GeoOpportunityAction), count(db, AuditLog))
        actor = db.get(User, api.engineer_id)
        original = actions.append_audit

        def fail(*_args):
            raise RuntimeError("虚构行动审计失败")

        if phase == "audit":
            monkeypatch.setattr(actions, "append_audit", fail)
        elif phase == "flush":

            def fail_flush(_session, _context, _instances):
                if any(isinstance(row, GeoOpportunityAction) for row in db.new):
                    fail()

            event.listen(db, "before_flush", fail_flush)
        else:
            event.listen(db, "before_commit", fail)
        with pytest.raises(RuntimeError, match="审计失败"):
            actions.link_action(
                db,
                UUID(identity),
                GeoOpportunityContentTaskRequest(**payload),
                kind=GeoOpportunityActionType.CONTENT_TASK,
                actor=actor,
                request_id="geo704-failure",
                idempotency_key="geo704-recovery-key",
            )
        assert (
            count(db, ContentTask),
            count(db, GeoOpportunityAction),
            count(db, AuditLog),
        ) == before
        assert db.get(GeoOpportunity, UUID(identity)).status == "ACKNOWLEDGED"
        monkeypatch.setattr(actions, "append_audit", original)
        if phase == "flush":
            event.remove(db, "before_flush", fail_flush)
        elif phase == "commit":
            event.remove(db, "before_commit", fail)
    assert post(api, identity, "content-task", payload, "geo704-recovery-key").status_code == 200


def test_late_cas_conflict_rolls_back_uncommitted_target(api, monkeypatch):
    _, _, _, identity, payload = ready(api)
    original = actions._target

    def conflicting(*args):
        target = original(*args)
        response = api.admin.post(
            f"{PATH}/{identity}/dismiss",
            json={
                "expected_revision": payload["expected_revision"],
                "resolution_code": "OTHER",
                "resolution_comment": "并发关闭",
            },
        )
        assert response.status_code == 200, response.text
        return target

    monkeypatch.setattr(actions, "_target", conflicting)
    with api.harness.factory() as db:
        before = count(db, ContentTask)
    response = post(api, identity, "content-task", payload)
    assert response.status_code == 409 and response.json()["error"]["code"] == "REVISION_CONFLICT"
    with api.harness.factory() as db:
        assert count(db, ContentTask) == before
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoOpportunityAction)
                .where(GeoOpportunityAction.opportunity_id == UUID(identity))
            )
            == 0
        )
        assert db.get(GeoOpportunity, UUID(identity)).status == "DISMISSED"


def test_permissions_csrf_scope_fact_and_required_key(api):
    _, _, _, identity, payload = ready(api)
    path = f"{PATH}/{identity}/actions/content-task"
    assert (
        api.anonymous.post(
            path, json=payload, headers={"Idempotency-Key": "geo704-key"}
        ).status_code
        == 401
    )
    assert api.engineer.post(path, json=payload).status_code == 422
    assert (
        api.engineer.post(
            path,
            json=payload,
            headers={
                "Idempotency-Key": "geo704-key",
                "X-CSRF-Token": "wrong-token-must-be-at-least-32-bytes",
            },
        ).status_code
        == 403
    )
    assert (
        post(api, identity, "content-task", payload | {"unexpected": "private-canary"}).status_code
        == 422
    )
    mismatch = post(api, identity, "content-task", payload | {"product_id": str(uuid4())})
    assert mismatch.status_code == 422 and mismatch.json()["error"]["code"] == "VALIDATION_ERROR"
    invalid_fact = post(
        api,
        identity,
        "content-task",
        payload | {"fact_version_id": str(uuid4())},
        "recover-invalid-fact",
    )
    assert (
        invalid_fact.status_code == 409
        and invalid_fact.json()["error"]["code"] == "FACT_NOT_APPROVED"
    )
    assert post(api, identity, "content-task", payload, "recover-invalid-fact").status_code == 200
    with api.harness.factory.begin() as db:
        actor = db.get(User, api.engineer_id)
        actor.must_change_password = True
    assert post(api, identity, "content-task", payload, "recover-invalid-fact").status_code == 403


def test_concurrent_same_key_replays_and_different_actors_revision_has_one_winner(api):
    _, _, _, identity, payload = ready(api)

    with api.harness.factory() as db:
        tasks_before = count(db, ContentTask)

    def concurrent(actor_ids, keys):
        barrier = Barrier(2)

        def invoke(actor_id, key):
            with api.harness.factory() as db:
                actor = db.get(User, actor_id)
                barrier.wait(timeout=10)
                try:
                    return actions.link_action(
                        db,
                        UUID(identity),
                        GeoOpportunityContentTaskRequest(**payload),
                        kind=GeoOpportunityActionType.CONTENT_TASK,
                        actor=actor,
                        request_id="geo704-concurrent",
                        idempotency_key=key,
                    )
                except AppError as error:
                    return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            return list(pool.map(invoke, actor_ids, keys))

    results = concurrent([api.engineer_id] * 2, ["geo704-concurrent-key"] * 2)
    assert {r.replayed for r in results} == {False, True}
    assert len({r.action.id for r in results}) == 1
    payload["expected_revision"] = results[0].opportunity_revision
    results = concurrent(
        [api.engineer_id, api.harness.database.runs.plan.actor],
        ["different-key-a", "different-key-b"],
    )
    assert len([r for r in results if r == "REVISION_CONFLICT"]) == 1
    with api.harness.factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(GeoOpportunityAction)
                .where(GeoOpportunityAction.opportunity_id == UUID(identity))
            )
            == 2
        )
        assert count(db, ContentTask) == tasks_before + 2


def test_completion_does_not_resolve_and_authorized_aggregate_delete_preserves_action(api):
    _, _, _, identity, payload = ready(api)
    created = post(api, identity, "content-task", payload, "geo704-deletion-key").json()
    task_id = UUID(created["action"]["target_id"])
    with api.harness.factory() as db:
        actor = db.get(User, api.engineer_id)
        with pytest.raises(AppError) as blocked:
            publication.delete_content_task(
                db=db, task_id=task_id, expected_revision=0, actor=actor, request_id="geo704-delete"
            )
        assert blocked.value.code == "CONTENT_TASK_REQUIRES_ARCHIVE"
        db.rollback()
        with pytest.raises(IntegrityError):
            db.execute(delete(ContentTask).where(ContentTask.id == task_id))
        db.rollback()
    publish_task(api, task_id, payload["fact_version_id"])
    assert detail(api, identity)["opportunity"]["status"] == "IN_PROGRESS"
    with api.harness.factory() as db:
        task = db.get(ContentTask, task_id)
        task = publication.archive_content_task(
            db=db, task_id=task_id, expected_revision=task.revision
        )
        publication.permanently_delete_content_task(
            db=db,
            task_id=task_id,
            payload=ContentTaskPermanentDeleteRequest(
                expected_revision=task.revision, confirmation_text="永久删除"
            ),
            actor=db.get(User, api.harness.database.runs.plan.actor),
            request_id="geo704-permanent-delete",
        )
    after = detail(api, identity)
    assert after["actions"][0]["target_available"] is False
    assert after["actions"][0]["navigation_path"] is None
    assert after["actions"][0]["source_snapshot"] == created["action"]["source_snapshot"]
    replay = post(api, identity, "content-task", payload, "geo704-deletion-key")
    assert (
        replay.status_code == 200
        and replay.json()["replayed"]
        and replay.json()["action"]["target_available"] is False
    )


def test_publication_open_link_repair_unique_failure_and_article_deletion_blocker(api):
    _, _, _, identity, payload = ready(api)
    with api.harness.factory() as db:
        task = content_planning.create_content_task(
            db=db,
            payload=ContentTaskCreate(
                **{k: v for k, v in payload.items() if k != "expected_revision"}
            ),
            actor=db.get(User, api.engineer_id),
            request_id="geo704-original",
            idempotency_key=str(uuid4()),
        )
        task_id = task.id
    article_id = publish_task(api, task_id, payload["fact_version_id"])
    identity = citation_opportunity(api, identity)
    request = {
        "mode": "OPEN_ISSUE",
        "expected_revision": 2,
        "published_article_id": str(article_id),
        "kind": "CONTENT_CHANGED",
        "description": "行动的私密说明，不应进入审计",
    }
    opened = post(api, identity, "publication-repair", request, "geo704-open-issue")
    assert opened.status_code == 200, opened.text
    value = opened.json()
    issue_id = value["action"]["target_id"]
    link = {
        "mode": "LINK_ISSUE",
        "expected_revision": value["opportunity_revision"],
        "published_content_issue_id": issue_id,
        "expected_issue_revision": 0,
    }
    linked = post(api, identity, "publication-repair", link)
    assert linked.status_code == 200, linked.text
    repair = link | {
        "mode": "CREATE_REPAIR",
        "expected_revision": linked.json()["opportunity_revision"],
        "fact_version_id": payload["fact_version_id"],
    }
    repaired = post(api, identity, "publication-repair", repair, "geo704-create-repair")
    assert repaired.status_code == 200, repaired.text
    assert repaired.json()["action"]["target_type"] == "ContentTask"
    snapshot = repaired.json()["action"]["source_snapshot"]
    assert (
        snapshot["published_article_id"] == str(article_id)
        and snapshot["published_content_issue_id"] == issue_id
    )
    duplicate = post(
        api,
        identity,
        "publication-repair",
        repair | {"expected_revision": repaired.json()["opportunity_revision"]},
    )
    assert (
        duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "REPAIR_TASK_EXISTS"
    )
    with api.harness.factory() as db:
        with pytest.raises(AppError) as blocked:
            publication.preview_published_article_permanent_deletion(db=db, article_id=article_id)
        assert blocked.value.code == "PUBLISHED_ARTICLE_IN_USE"
        assert "GEO_OPPORTUNITY_ACTION" in str(blocked.value.details)
        db.rollback()
        logs = list(db.scalars(select(AuditLog).where(AuditLog.target_id == identity)))
        assert len(
            [row for row in logs if row.action == "geo_opportunity.action_linked"]
        ) == 3 and all("私密说明" not in str(row.details) for row in logs)
    assert detail(api, identity)["opportunity"]["status"] == "IN_PROGRESS"
