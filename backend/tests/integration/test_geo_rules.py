"""真实 PostgreSQL/会话的规则权限、CAS、preview、历史与事务保证。"""

import json
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from app.errors import AppError
from app.models.geo_rules import GeoRuleSetRevision
from app.models.identity import AuditLog, User
from app.schemas.geo_rules import GeoRuleSnapshot, GeoRuleUpdateRequest
from app.services import geo_rules
from tests.integration.geo_questions_support import QuestionsAPI
from tests.integration.geo_questions_support import questions_api as questions_api
from tests.integration.geo_questions_support import questions_engine as questions_engine
from tests.unit.test_geo_surface_contract import contract as contract
from tests.unit.test_geo_surface_contract import validate

pytestmark = pytest.mark.integration
PATH = "/api/v1/geo/rules"


def test_permissions_csrf_schema(questions_api: QuestionsAPI) -> None:
    api = questions_api
    for path in (PATH, PATH + "/preview"):
        response = api.engineer.get(path) if path == PATH else api.engineer.post(path, json={})
        assert response.status_code == 403
    current = api.admin.get(PATH).json()
    payload = {"expected_revision": current["revision"], "configuration": current["configuration"]}
    assert api.engineer.put(PATH, json=payload).status_code == 403
    assert (
        api.admin.put(
            PATH, json=payload, headers={"X-CSRF-Token": "incorrect-csrf-token-at-least-32-bytes"}
        ).status_code
        == 403
    )
    assert (
        api.admin.post(
            PATH + "/preview",
            json=payload,
            headers={"X-CSRF-Token": "incorrect-csrf-token-at-least-32-bytes"},
        ).status_code
        == 403
    )
    payload["configuration"]["sample_policy"]["reportable_minimum"] = True
    assert api.admin.put(PATH, json=payload).status_code == 422


def test_preview_update_noop_conflict_and_history(
    questions_api: QuestionsAPI, contract: dict
) -> None:
    api = questions_api
    before = api.admin.get(PATH).json()
    validate(contract, "GeoRuleSetRead", before)
    with api.factory() as db:
        frozen = geo_rules.freeze_current_rules(db)
        historical = frozen.snapshot().model_dump(mode="json")
        audit_count = db.scalar(select(func.count()).select_from(AuditLog))
    configuration = deepcopy(before["configuration"])
    configuration["sample_policy"]["stable_minimum"] += 2
    payload = {"expected_revision": before["revision"], "configuration": configuration}
    preview = api.admin.post(
        PATH + "/preview", json={**payload, "samples": {"current_runs": 5, "previous_runs": 5}}
    )
    assert preview.status_code == 200, preview.text
    value = preview.json()
    validate(contract, "GeoRulePreviewRead", value)
    assert value["changed"] and value["proposed_revision"] == before["revision"] + 1
    assert value["current_sample_level"] == "REPORTABLE"
    assert not value["sample_gates"][0]["sample_sufficient"]
    assert api.admin.get(PATH).json() == before
    with api.factory() as db:
        assert db.scalar(select(func.count()).select_from(AuditLog)) == audit_count
        assert db.get(GeoRuleSetRevision, value["proposed_revision"]) is None
    after = api.admin.put(PATH, json=payload)
    assert after.status_code == 200, after.text
    assert after.json()["revision"] == value["proposed_revision"]
    with api.factory() as db:
        future = geo_rules.freeze_current_rules(db)
        assert future.snapshot() == GeoRuleSnapshot.model_validate(value["snapshot"])
        assert (
            db.get(GeoRuleSetRevision, before["revision"]).configuration
            == historical["configuration"]
        )
        assert db.scalar(select(func.count()).select_from(AuditLog)) == audit_count + 1
    assert frozen.snapshot().model_dump(mode="json") == historical
    noop = {**payload, "expected_revision": after.json()["revision"]}
    assert api.admin.put(PATH, json=noop).json() == after.json()
    for response in (
        api.admin.put(PATH, json=payload),
        api.admin.post(PATH + "/preview", json=payload),
    ):
        assert (
            response.status_code == 409 and response.json()["error"]["code"] == "REVISION_CONFLICT"
        )


def test_audit_failure_rolls_back_revision_and_pointer(
    questions_api: QuestionsAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = questions_api
    before = api.admin.get(PATH).json()
    configuration = deepcopy(before["configuration"])
    configuration["dedup_window_days"] += 1

    def fail(*args, **kwargs):
        raise RuntimeError("模拟审计写入失败")

    monkeypatch.setattr(geo_rules, "append_audit", fail)
    with api.factory() as db:
        actor = db.get(User, api.admin_id)
        with pytest.raises(RuntimeError, match="模拟审计"):
            geo_rules.update_rules(
                db,
                GeoRuleUpdateRequest(
                    expected_revision=before["revision"], configuration=configuration
                ),
                actor=actor,
                request_id="geo701-rollback",
            )
        assert db.get(GeoRuleSetRevision, before["revision"] + 1) is None
    assert api.admin.get(PATH).json() == before


def test_two_concurrent_editors_only_one_commits(questions_api: QuestionsAPI) -> None:
    api = questions_api
    before = api.admin.get(PATH).json()
    with api.factory() as db:
        second_admin = User(
            username=f"geo701-race-{uuid4()}",
            display_name="另一位虚构管理员",
            password_hash="unused",
            account_type="ADMIN",
            is_active=True,
            must_change_password=False,
            revision=0,
        )
        db.add(second_admin)
        db.commit()
        second_admin_id = second_admin.id
        audits_before = db.scalar(select(func.count()).select_from(AuditLog))
    start = Barrier(2)

    def update(editor: tuple):
        actor_id, increment = editor
        with api.factory() as db:
            actor = db.get(User, actor_id)
            configuration = deepcopy(before["configuration"])
            configuration["visibility_drop_points"] = increment / 10
            start.wait(timeout=10)
            try:
                return geo_rules.update_rules(
                    db,
                    GeoRuleUpdateRequest(
                        expected_revision=before["revision"], configuration=configuration
                    ),
                    actor=actor,
                    request_id=f"geo701-race-{increment}",
                ).revision
            except AppError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(update, ((api.admin_id, 2), (second_admin_id, 3))))
    assert sorted(map(str, results)) == sorted([str(before["revision"] + 1), "REVISION_CONFLICT"])
    assert api.admin.get(PATH).json()["revision"] == before["revision"] + 1
    with api.factory() as db:
        assert db.scalar(select(func.count()).select_from(AuditLog)) == audits_before + 1


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE geo_rule_set_revisions SET configuration=configuration WHERE revision=1",
        "DELETE FROM geo_rule_set_revisions WHERE revision=1",
        "TRUNCATE geo_rule_set_revisions CASCADE",
        "DELETE FROM geo_rule_set_current",
        "UPDATE geo_rule_set_current SET revision=revision",
        "TRUNCATE geo_rule_set_current",
        "INSERT INTO geo_rule_set_revisions(revision,configuration) VALUES(100000,'{}')",
    ],
)
def test_database_rejects_history_mutation_and_invalid_configuration(
    questions_api: QuestionsAPI, sql: str
) -> None:
    with questions_api.factory() as db:
        with pytest.raises(IntegrityError):
            db.execute(text(sql))
        db.rollback()
        assert geo_rules.get_rules(db).revision >= 1


@pytest.mark.parametrize(
    "path,value",
    [
        (("sample_policy", "reportable_minimum"), 3.0),
        (("sample_policy", "stable_minimum"), 5.0),
        (("run_failure_consecutive_limit",), 3.0),
        (("recovery", "minimum_runs"), 5.0),
        (("recovery", "fact_error_max_count"), 0.0),
    ],
)
def test_pg_rejects_decimal_integer_representation(
    questions_api: QuestionsAPI, path: tuple, value: float
) -> None:
    with questions_api.factory() as db:
        current = geo_rules.get_rules(db)
        configuration = current.configuration.model_dump(mode="json")
        target = configuration
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value
        serialized = json.dumps(configuration)
        assert (
            db.scalar(
                text("SELECT geo_rule_configuration_valid(CAST(:config AS jsonb))"),
                {"config": serialized},
            )
            is False
        )
        with pytest.raises(IntegrityError) as failure:
            db.execute(
                text(
                    "INSERT INTO geo_rule_set_revisions(revision,configuration,created_by) "
                    "VALUES (:revision,CAST(:config AS jsonb),:actor)"
                ),
                {
                    "revision": current.revision + 1,
                    "config": serialized,
                    "actor": questions_api.admin_id,
                },
            )
        assert failure.value.orig.diag.constraint_name == "ck_geo_rule_configuration_valid"
        db.rollback()
        assert geo_rules.get_rules(db).revision == current.revision
