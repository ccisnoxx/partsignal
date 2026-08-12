"""冻结 OpenAPI 与运行时路由的契约测试。"""

import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
from fastapi.testclient import TestClient

from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.routers.planning import _content_task_read_snapshot
from app.security import hash_token
from app.tools.contract_check import check


def test_runtime_openapi_matches_frozen_operations() -> None:
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    assert check(contract) == []


def test_geo_observation_list_contract_is_compact_and_preserves_v1() -> None:
    """V2 列表使用独立紧凑读模型，V1 完整列表合同保持原样。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    operation = paths["/api/v1/geo-observations/list-items"]["get"]

    assert [parameter["name"] for parameter in operation["parameters"]] == [
        "search",
        "product_id",
        "geo_platform",
        "accuracy",
        "date_from",
        "date_to",
        "sort",
        "page",
        "page_size",
    ]
    assert operation["parameters"][-1]["schema"]["enum"] == [10, 20, 50]
    assert set(operation["responses"]) == {"200", "401", "403", "409", "422"}
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/GeoObservationListPage"
    }

    item = schemas["GeoObservationListItem"]
    assert set(item["required"]) == {
        "id",
        "observation_kind",
        "query_text",
        "product",
        "geo_platform",
        "outcomes",
        "related_achievement_count",
        "evidence_count",
        "recorder",
        "observed_at",
        "available_actions",
    }
    assert not {
        "notes",
        "citations",
        "article_results",
        "attachment_file_ids",
        "workflow_stage",
        "primary_task",
    } & set(item["properties"])
    assert item["properties"]["available_actions"]["items"]["enum"] == [
        "CORRECT",
        "DELETE",
    ]
    assert schemas["GeoObservationListPage"]["properties"]["items"]["items"] == {
        "$ref": "#/components/schemas/GeoObservationListItem"
    }
    assert paths["/api/v1/geo-observations"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/GeoObservationList"}
    assert "422" in paths["/api/v1/geo-observations/{observation_id}"]["delete"][
        "responses"
    ]
    assert set(paths["/api/v1/geo-observation-publications"]["get"]["responses"]) == {
        "200", "401", "403", "404", "422"
    }
    assert set(paths["/api/v1/geo-observations"]["post"]["responses"]) == {
        "201", "401", "403", "404", "409", "422"
    }
    assert set(schemas["GeoArticleResultCreate"]["required"]) == {
        "published_article_id", "discovered", "mentioned", "accuracy"
    }
    assert not {"recommendation", "citation"} & set(
        schemas["GeoArticleResultCreate"]["properties"]
    )


def test_published_content_issue_contract_has_one_workspace_read_model_and_real_errors() -> None:
    """内容问题列表、工作区与命令必须声明同一 structured error 边界。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    context = document["components"]["schemas"]["PublishedContentIssueWorkspaceContext"]

    assert set(context["required"]) == {"issue", "article", "repair_task"}
    assert set(paths["/api/v1/published-content-issues"]["get"]["responses"]) == {
        "200", "401", "403", "409", "422"
    }
    for path, method, success in (
        ("/api/v1/published-articles/{article_id}/issues", "post", "201"),
        ("/api/v1/published-content-issues/{issue_id}", "get", "200"),
        ("/api/v1/published-content-issues/{issue_id}/workspace-context", "get", "200"),
        ("/api/v1/published-content-issues/{issue_id}/repair-context", "get", "200"),
        ("/api/v1/published-content-issues/{issue_id}/repair-task", "post", "201"),
        ("/api/v1/published-content-issues/{issue_id}/resolve", "post", "200"),
    ):
        assert set(paths[path][method]["responses"]) == {
            success, "401", "403", "404", "409", "422"
        }


def test_publication_work_read_contract_matches_runtime_error_matrix() -> None:
    """三个工作读取面必须声明共享认证与上下文错误。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]

    list_responses = paths["/api/v1/publication-works"]["get"]["responses"]
    assert set(list_responses) == {"200", "401", "403", "409", "422"}
    for status in ("401", "403", "409", "422"):
        assert list_responses[status] == {"$ref": "#/components/responses/ErrorResponse"}

    for path in (
        "/api/v1/publication-works/{work_id}",
        "/api/v1/publication-works/{work_id}/workspace-context",
    ):
        responses = paths[path]["get"]["responses"]
        assert set(responses) == {"200", "401", "403", "404", "409", "422"}
        for status in ("401", "403", "404", "409", "422"):
            assert responses[status] == {"$ref": "#/components/responses/ErrorResponse"}


def test_product_create_contract_declares_input_limits_and_error_responses() -> None:
    """冻结创建产品的长度边界与可预期错误响应。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    operation = document["paths"]["/api/v1/products"]["post"]
    product_create = document["components"]["schemas"]["ProductCreate"]

    assert set(operation["responses"]) == {"201", "401", "403", "409", "422"}
    for field_name in ("part_number", "brand", "category"):
        assert product_create["properties"][field_name]["minLength"] == 1
        assert product_create["properties"][field_name]["maxLength"] == 160


def test_content_task_creation_contract_is_three_fields_with_one_options_read_model() -> None:
    """创建任务不得恢复旧字段，可选范围由单一读模型提供。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]

    create = paths["/api/v1/content-tasks"]["post"]
    options = paths["/api/v1/content-tasks/creation-options"]["get"]
    assert set(schemas["ContentTaskCreate"]["required"]) == {
        "product_id",
        "fact_version_id",
        "platform_profile_id",
    }
    assert set(schemas["ContentTaskCreate"]["properties"]) == set(
        schemas["ContentTaskCreate"]["required"]
    )
    assert set(create["responses"]) == {"201", "401", "403", "404", "409", "422"}
    assert set(options["responses"]) == {"200", "401", "403", "422"}
    assert (
        schemas["ContentTaskCreationProductOption"]["properties"]["approved_fact_versions"][
            "minItems"
        ]
        == 1
    )
    assert schemas["ContentTaskRequestedProduct"]["properties"]["eligibility"]["enum"] == [
        "ELIGIBLE",
        "NOT_FOUND",
        "PRODUCT_INACTIVE",
        "NO_APPROVED_FACTS",
    ]


def test_content_task_detail_contract_is_one_compact_read_model() -> None:
    """任务详情独立于 command response，并冻结一次绘制所需的紧凑区块。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    operation = document["paths"]["/api/v1/content-tasks/{content_task_id}/detail"]["get"]
    detail = document["components"]["schemas"]["ContentTaskDetail"]

    assert set(operation["responses"]) == {"200", "401", "403", "404", "422"}
    assert set(detail["required"]) == {
        "task",
        "product",
        "platform",
        "fact",
        "current_content",
        "generation",
        "review",
        "publishing",
        "source",
        "activity",
    }
    assert "body_markdown" not in str(detail)
    assert document["components"]["schemas"]["ContentTask"]["allOf"][1]["required"] == [
        "id",
        "platform_profile_id",
        "query_topic_id",
        "source_published_content_issue_id",
        "current_content_version_id",
        "workflow_stage",
        "primary_task",
        "available_actions",
        "deletion",
        "status",
        "revision",
        "created_by",
        "created_at",
        "archived_at",
    ]


def test_content_version_detail_contract_is_readonly_and_compact() -> None:
    """详情合同不得复用动作投影或返回浏览器需要再次拼接的完整资源。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    operation = document["paths"]["/api/v1/content-versions/{content_version_id}/detail"]["get"]
    schemas = document["components"]["schemas"]
    detail = schemas["ContentVersionDetail"]
    content = schemas["ContentVersionDetailContent"]

    assert set(operation["responses"]) == {"200", "401", "403", "404", "409", "422"}
    assert set(detail["required"]) == {
        "content",
        "fact_version",
        "generation_lineage",
        "review_result",
        "review_timeline",
    }
    assert {"change_summary", "creator", "updated_at", "is_current"} <= set(content["required"])
    assert "available_actions" not in str(detail)
    assert "primary_task" not in str(detail)
    assert "quality_issues" not in str(detail)
    assert "change_summary" not in schemas["ContentVersion"]["properties"]
    assert "updated_at" not in schemas["ContentVersion"]["properties"]


def test_content_task_creation_options_enforce_engineer_and_uuid_boundaries() -> None:
    """选项读模型与创建命令共用工程师权限，并在边界拒绝非法 UUID。"""
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[_content_task_read_snapshot] = lambda: None
    try:
        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
            user=SimpleNamespace(account_type="VIEWER")
        )
        assert TestClient(app).get("/api/v1/content-tasks/creation-options").status_code == 403

        app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
            user=SimpleNamespace(account_type="ENGINEER")
        )
        invalid = TestClient(app).get(
            "/api/v1/content-tasks/creation-options?requested_product_id=not-a-uuid"
        )
        assert invalid.status_code == 422
        assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    finally:
        app.dependency_overrides.clear()


def test_product_detail_contract_is_compact_and_update_has_matching_limits() -> None:
    """详情读模型不得泄漏正文，更新字段必须与创建字段保持同一边界。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    operation = document["paths"]["/api/v1/products/{product_id}/detail"]["get"]
    detail = document["components"]["schemas"]["ProductDetail"]
    update = document["components"]["schemas"]["ProductUpdate"]

    assert set(operation["responses"]) == {"200", "401", "403", "404"}
    assert set(detail["required"]) == {
        "product",
        "approved_fact",
        "pending_fact",
        "content",
        "publishing",
        "geo",
        "activity",
    }
    assert "body_markdown" not in str(detail)
    for field_name in ("part_number", "brand", "category"):
        assert update["properties"][field_name]["minLength"] == 1
        assert update["properties"][field_name]["maxLength"] == 160


def test_fact_workspace_contract_is_a_complete_single_read_model() -> None:
    """Facts endpoint 必须一次返回完整上下文并声明真实错误边界。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    path = document["paths"]["/api/v1/products/{product_id}/facts"]
    submission = document["paths"]["/api/v1/products/{product_id}/fact-review-submissions"]["post"]
    draft = document["components"]["schemas"]["ProductFactsDraft"]
    context = document["components"]["schemas"]["ProductFactsProductContext"]

    assert set(path["get"]["responses"]) == {"200", "401", "403", "404"}
    assert set(path["put"]["responses"]) == {"200", "401", "403", "404", "409", "422"}
    assert set(submission["responses"]) == {"201", "401", "403", "404", "409", "422"}
    assert set(draft["required"]) == {
        "product_id",
        "product",
        "body_markdown",
        "classification",
        "approved_fact",
        "pending_fact",
        "available_actions",
        "revision",
    }
    assert set(context["required"]) == {
        "id",
        "part_number",
        "brand",
        "category",
        "status",
        "workflow_stage",
    }


def test_fact_review_contract_locates_target_and_declares_command_errors() -> None:
    """产品级审核上下文必须完整，写命令必须声明真实错误边界。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]

    product_context = paths["/api/v1/products/{product_id}/fact-review-context"]["get"]
    version_detail = paths["/api/v1/fact-versions/{fact_version_id}"]["get"]
    exact_context = paths["/api/v1/fact-versions/{fact_version_id}/review-context"]["get"]
    approve = paths["/api/v1/fact-versions/{fact_version_id}/approve"]["post"]
    request_changes = paths["/api/v1/fact-versions/{fact_version_id}/request-changes"]["post"]

    assert set(product_context["responses"]) == {"200", "401", "403", "404"}
    assert set(version_detail["responses"]) == {"200", "401", "403", "404", "422"}
    assert {
        "id",
        "product_id",
        "version",
        "status",
        "body_markdown",
        "classification",
        "change_summary",
        "revision",
        "created_by",
        "created_at",
    } <= set(schemas["FactVersion"]["required"])
    assert set(exact_context["responses"]) == {"200", "401", "403", "404"}
    assert set(approve["responses"]) == {"200", "401", "403", "404", "409", "422"}
    assert set(request_changes["responses"]) == {
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
    }
    assert set(schemas["FactReviewContext"]["required"]) == {
        "fact_version",
        "diff",
        "available_actions",
        "review_history",
    }
    assert schemas["FactReviewDecision"]["enum"] == ["APPROVE", "REQUEST_CHANGES"]
    assert set(schemas["ProductFactReviewTarget"]["required"]) == {
        "fact_version",
        "diff",
        "available_actions",
        "review_history",
    }
    assert set(schemas["ProductFactReviewWorkspace"]["required"]) == {"product", "review"}


def test_fact_review_submission_rejects_blank_summary_before_business_command() -> None:
    """事实提交摘要只含空白时必须在请求边界返回字段级 422。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type="ENGINEER"),
        csrf_hash=hash_token(csrf_token),
    )
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).post(
            f"/api/v1/products/{uuid.uuid4()}/fact-review-submissions",
            headers={"X-CSRF-Token": csrf_token},
            json={"expected_revision": 0, "change_summary": "   "},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    payload = response.json()["error"]
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(
        issue["loc"][:2] == ["body", "change_summary"] for issue in payload["details"]["errors"]
    )


@pytest.mark.parametrize("field_name", ["part_number", "brand", "category"])
def test_product_update_rejects_blank_identity_before_business_command(field_name: str) -> None:
    """产品基本信息更新必须在请求边界拒绝空白字段。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type="ENGINEER"),
        csrf_hash=hash_token(csrf_token),
    )
    body = {
        "expected_revision": 0,
        "part_number": "PS-001",
        "brand": "PartSignal",
        "category": "MCU",
        "status": "ACTIVE",
    }
    body[field_name] = "   "
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).patch(
            f"/api/v1/products/{uuid.uuid4()}",
            headers={"X-CSRF-Token": csrf_token},
            json=body,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("field_name", "invalid_value"),
    [
        ("part_number", "   "),
        ("brand", "   "),
        ("category", "   "),
        ("part_number", "P" * 161),
        ("brand", "B" * 161),
        ("category", "C" * 161),
    ],
)
def test_product_create_rejects_blank_and_overlong_fields_before_business_command(
    field_name: str,
    invalid_value: str,
) -> None:
    """产品创建请求必须按实际保存值校验非空与 160 字符上限。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type="ENGINEER"),
        csrf_hash=hash_token(csrf_token),
    )
    body = {"part_number": "PS-001", "brand": "PartSignal", "category": "MCU"}
    body[field_name] = invalid_value
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).post(
            "/api/v1/products",
            headers={"X-CSRF-Token": csrf_token},
            json=body,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    payload = response.json()["error"]
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(issue["loc"][:2] == ["body", field_name] for issue in payload["details"]["errors"])


def test_live_health_does_not_require_external_dependencies() -> None:
    response = TestClient(app).get("/api/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": None}


@pytest.mark.parametrize(
    ("account_type", "headers", "expected_status", "expected_code"),
    [
        (
            "ENGINEER",
            {"X-CSRF-Token": "contract-test-csrf-token-more-than-32-characters"},
            403,
            "PERMISSION_DENIED",
        ),
        ("ADMIN", {}, 422, "VALIDATION_ERROR"),
        (
            "ADMIN",
            {"X-CSRF-Token": "wrong-contract-test-csrf-token-more-than-32-chars"},
            403,
            "CSRF_INVALID",
        ),
    ],
)
def test_query_topic_delete_rejects_non_admin_and_missing_csrf(
    account_type: str,
    headers: dict[str, str],
    expected_status: int,
    expected_code: str,
) -> None:
    """删除问题的权限和 CSRF 必须在进入业务命令前拒绝。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type=account_type),
        csrf_hash=hash_token(csrf_token),
    )
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).delete(
            f"/api/v1/query-topics/{uuid.uuid4()}?expected_revision=0",
            headers=headers,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == expected_status
    assert response.json()["error"]["code"] == expected_code


def test_query_topic_delete_rejects_anonymous_request() -> None:
    """匿名请求必须在访问删除命令前返回统一认证错误。"""
    app.dependency_overrides[get_db] = lambda: object()
    try:
        response = TestClient(app).delete(
            f"/api/v1/query-topics/{uuid.uuid4()}?expected_revision=0",
            headers={"X-CSRF-Token": "contract-test-csrf-token-more-than-32-characters"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


@pytest.mark.parametrize("query", ["", "?expected_revision=-1"])
def test_product_delete_requires_valid_revision_before_business_command(query: str) -> None:
    """产品删除必须在进入数据库命令前拒绝缺失或非法 revision。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type="ADMIN"),
        csrf_hash=hash_token(csrf_token),
    )
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).delete(
            f"/api/v1/products/{uuid.uuid4()}{query}",
            headers={"X-CSRF-Token": csrf_token},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    ("path", "tags"),
    [
        ("/api/v1/content-tasks/{id}/manual-versions", []),
        ("/api/v1/content-tasks/{id}/manual-versions", ["   "]),
        ("/api/v1/content-versions/{id}/revisions", []),
        ("/api/v1/content-versions/{id}/revisions", ["   "]),
    ],
)
def test_content_revision_routes_reject_invalid_tags(path: str, tags: list[str]) -> None:
    """绕过前端时，两个内容写入入口仍返回带字段位置的 422。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type="ENGINEER"),
        csrf_hash=hash_token(csrf_token),
    )
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).post(
            path.format(id=uuid.uuid4()),
            headers={"X-CSRF-Token": csrf_token},
            json={
                "title": "标题",
                "summary": "摘要",
                "body_markdown": "正文",
                "tags": tags,
                "change_summary": "人工校对",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    payload = response.json()["error"]
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(issue["loc"][:2] == ["body", "tags"] for issue in payload["details"]["errors"])


def test_content_draft_update_rejects_empty_tags_before_business_command() -> None:
    """人工草稿原地保存继续使用内容标签请求边界。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type="ENGINEER"),
        csrf_hash=hash_token(csrf_token),
    )
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).put(
            f"/api/v1/content-versions/{uuid.uuid4()}",
            headers={"X-CSRF-Token": csrf_token},
            json={
                "expected_revision": 0,
                "title": "标题",
                "summary": "摘要",
                "body_markdown": "正文",
                "tags": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    payload = response.json()["error"]
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(issue["loc"][:2] == ["body", "tags"] for issue in payload["details"]["errors"])
