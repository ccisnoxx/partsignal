"""七个变体操作的真实合同、权限、历史门禁、筛选和原子审计。"""

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, text

from app.main import app
from app.models.configuration import QueryTopic
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.identity import AuditLog
from app.services import geo_prompt_variants as commands
from tests.integration.geo_questions_support import (
    CSRF,
    PREFIX,
    QuestionsAPI,
    questions_api,
    questions_engine,
)

pytestmark = pytest.mark.integration
__all__ = ["questions_api", "questions_engine"]


def error(response: object, status: int, code: str) -> None:
    assert response.status_code == status
    envelope = response.json()
    assert envelope["error"]["code"] == code
    assert envelope["error"]["request_id"] == response.headers["X-Request-ID"]


def state(api: QuestionsAPI, variant_id: str) -> tuple:
    with api.factory() as db:
        return db.execute(
            text(
                "SELECT to_jsonb(v), (SELECT count(*) FROM audit_logs "
                "WHERE target_id=CAST(v.id AS text)) "
                "FROM geo_prompt_variants v WHERE id=:id"
            ),
            {"id": variant_id},
        ).one()


def test_engineer_crud_explicit_mode_noop_revision_and_audit(questions_api: QuestionsAPI) -> None:
    api = questions_api
    row = api.create()
    path = f"{PREFIX}/{row['id']}"
    assert row["mention_mode"] == "UNBRANDED"  # 文本点名并不推导字段。
    assert row["language_code"] == "zh-hans" and row["region_code"] == "CN"
    assert row["created_by"] == str(api.engineer_id)
    assert row["run_entry"] == {"available": False, "reason_code": "NOT_IMPLEMENTED"}
    assert row["query_topic"]["id"] == str(api.topic)
    before = state(api, row["id"])
    same = api.engineer.patch(path, json={"expected_revision": 0, "language_code": "ZH-Hans"})
    assert same.status_code == 200 and state(api, row["id"]) == before
    updated = api.admin.patch(path, json={"expected_revision": 0, "prompt_text": "新问题"}).json()
    assert updated["revision"] == 1 and updated["mention_mode"] == "UNBRANDED"
    error(
        api.engineer.patch(path, json={"expected_revision": 0, "priority": "STANDARD"}),
        409,
        "REVISION_CONFLICT",
    )
    disabled = api.engineer.post(path + "/disable", json={"expected_revision": 1}).json()
    assert disabled["revision"] == 2 and "ENABLE" in disabled["available_actions"]
    before = state(api, row["id"])
    assert api.engineer.post(path + "/disable", json={"expected_revision": 2}).status_code == 200
    assert state(api, row["id"]) == before
    enabled = api.engineer.post(path + "/enable", json={"expected_revision": 2}).json()
    assert enabled["revision"] == 3
    assert api.engineer.delete(path, params={"expected_revision": 3}).status_code == 204
    error(api.engineer.get(path), 404, "NOT_FOUND")
    with api.factory() as db:
        logs = list(db.scalars(select(AuditLog).where(AuditLog.target_id == row["id"])))
        assert {item.action for item in logs} == {
            "geo_prompt_variant.created",
            "geo_prompt_variant.updated",
            "geo_prompt_variant.enabled",
            "geo_prompt_variant.disabled",
            "geo_prompt_variant.deleted",
        }
        assert len(logs) == 5
        assert all(set(item.details["facts"]) == {"revision", "is_active"} for item in logs)
        assert db.get(QueryTopic, api.topic).variants == ["旧数组不得导入"]
        assert (
            db.scalar(
                text(
                    "SELECT count(*) FROM information_schema.tables "
                    "WHERE table_name IN ('geo_observation_runs','geo_observation_batches')"
                )
            )
            == 0
        )


def test_auth_csrf_invalid_input_and_topic_identity(questions_api: QuestionsAPI) -> None:
    api = questions_api
    row = api.create()
    path = f"{PREFIX}/{row['id']}"
    create_path = f"/api/v1/geo/query-topics/{api.topic}/prompt-variants"
    requests = [
        ("get", PREFIX, {}),
        ("get", path, {}),
        ("post", create_path, {"json": api.payload()}),
        ("patch", path, {"json": {"expected_revision": 0, "prompt_text": "修改"}}),
        ("post", path + "/enable", {"json": {"expected_revision": 0}}),
        ("post", path + "/disable", {"json": {"expected_revision": 0}}),
        ("delete", path, {"params": {"expected_revision": 0}}),
    ]
    with TestClient(app) as anonymous:
        for method, url, kwargs in requests:
            error(anonymous.request(method, url, **kwargs), 401, "AUTH_REQUIRED")
    before = state(api, row["id"])
    api.engineer.headers["X-CSRF-Token"] = "wrong" * 8
    for method, url, kwargs in requests[2:]:
        error(api.engineer.request(method, url, **kwargs), 403, "CSRF_INVALID")
    del api.engineer.headers["X-CSRF-Token"]
    error(
        api.engineer.post(path + "/disable", json={"expected_revision": 0}), 422, "VALIDATION_ERROR"
    )
    api.engineer.headers["X-CSRF-Token"] = CSRF
    for payload in [
        api.payload(mention_mode=None),
        api.payload(created_by=str(uuid4())),
        api.payload(query_topic_id=str(uuid4())),
    ]:
        error(api.engineer.post(create_path, json=payload), 422, "VALIDATION_ERROR")
    error(api.engineer.get(PREFIX, params={"page_size": 100}), 422, "VALIDATION_ERROR")
    error(api.engineer.get(PREFIX, params={"region_code": "unknown"}), 422, "VALIDATION_ERROR")
    error(api.engineer.get(PREFIX, params={"q": "\x00"}), 422, "VALIDATION_ERROR")
    assert state(api, row["id"]) == before


def test_history_is_immutable_and_duplicate_inactive_identity(questions_api: QuestionsAPI) -> None:
    api = questions_api
    row = api.create(prompt_text="历史问题")
    path = f"{PREFIX}/{row['id']}"
    # 模拟内部锁存边界，不创建虚构 Run，也不通过公共 API 开放该字段。
    with api.factory() as db:
        db.execute(
            text(
                "UPDATE geo_prompt_variants SET first_referenced_at=clock_timestamp(), "
                "revision=revision+1,updated_at=clock_timestamp() WHERE id=:id"
            ),
            {"id": row["id"]},
        )
        db.commit()
    historical = api.engineer.get(path).json()
    assert historical["workflow_stage"] == "REFERENCED"
    assert historical["primary_task"] == "VIEW_DETAILS"
    assert set(historical["available_actions"]) == {"DISABLE", "COPY"}
    assert historical["deletion"]["blockers"] == ["HISTORY_REFERENCE"]
    before = state(api, row["id"])
    error(
        api.engineer.patch(path, json={"expected_revision": 1, "prompt_text": "篡改"}),
        409,
        "GEO_PROMPT_VARIANT_IMMUTABLE",
    )
    error(
        api.engineer.delete(path, params={"expected_revision": 1}), 409, "GEO_PROMPT_VARIANT_IN_USE"
    )
    assert state(api, row["id"]) == before
    assert (
        api.engineer.post(path + "/disable", json={"expected_revision": 1}).json()["revision"] == 2
    )
    error(
        api.engineer.post(path + "/enable", json={"expected_revision": 2}),
        409,
        "GEO_PROMPT_VARIANT_IMMUTABLE",
    )
    create_path = f"/api/v1/geo/query-topics/{api.topic}/prompt-variants"
    error(
        api.engineer.post(create_path, json=api.payload(prompt_text="历史问题")),
        409,
        "GEO_PROMPT_VARIANT_EXISTS",
    )
    copy = api.create(prompt_text="新的语义问题")
    assert copy["id"] != row["id"] and copy["first_referenced_at"] is None


def test_filters_pagination_fixed_queries_and_topic_summary(questions_api: QuestionsAPI) -> None:
    api = questions_api
    for index in range(12):
        api.create(
            prompt_text=f"问题 {index:02d} %_", mention_mode="BRANDED" if index < 2 else "UNBRANDED"
        )
    params = {"query_topic_id": str(api.topic), "sort": "TEXT_ASC", "page_size": 10}
    first = api.engineer.get(PREFIX, params=params).json()
    second = api.engineer.get(PREFIX, params=params | {"page": 2}).json()
    assert first["total"] == 12 and len(second["items"]) == 2
    assert len({r["id"] for r in first["items"] + second["items"]}) == 12
    for key, value, total in [
        ("mention_mode", "BRANDED", 2),
        ("language_code", "ZH-Hans", 12),
        ("region_code", "cn", 12),
        ("priority", "CORE", 12),
        ("intent_type", "REPLACEMENT", 12),
        ("is_active", False, 0),
        ("q", "%_", 12),
        ("q", "not-present", 0),
    ]:
        result = api.engineer.get(PREFIX, params=params | {key: value})
        assert result.status_code == 200 and result.json()["total"] == total
    with api.factory() as db:
        topic = db.get(QueryTopic, api.topic)
        topic.canonical_question = "新主题摘要"
        topic.revision += 1
        db.commit()
    selects = []

    def observe(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            selects.append(statement)

    event.listen(api.engine, "before_cursor_execute", observe)
    try:
        response = api.engineer.get(PREFIX, params=params)
    finally:
        event.remove(api.engine, "before_cursor_execute", observe)
    assert len(selects) == 4  # 认证 + count/rows + 计划引用批量查询；不随行数增长。
    assert all(
        r["query_topic"]["canonical_question"] == "新主题摘要" for r in response.json()["items"]
    )


def test_audit_failure_rolls_back_semantic_change(
    questions_api: QuestionsAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    api = questions_api
    row = api.create()
    before = state(api, row["id"])

    def reject(*args, **kwargs):
        raise RuntimeError("审计失败测试")

    monkeypatch.setattr(commands, "append_audit", reject)
    with pytest.raises(RuntimeError, match="审计失败测试"):
        api.engineer.patch(
            f"{PREFIX}/{row['id']}", json={"expected_revision": 0, "prompt_text": "新语义"}
        )
    assert state(api, row["id"]) == before
    with api.factory() as db:
        assert db.get(GeoPromptVariant, UUID(row["id"])).prompt_text == row["prompt_text"]
