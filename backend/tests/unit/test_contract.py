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
from app.routers import observation as observation_router
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
        "query_topic_id",
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


def test_geo_observation_list_accepts_page_size_from_query_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """合法分页值必须从 HTTP 查询字符串解析为整数。"""
    received_page_sizes: list[int] = []

    def list_items(_db: object, **kwargs: object) -> dict[str, object]:
        page_size = kwargs["page_size"]
        assert isinstance(page_size, int)
        received_page_sizes.append(page_size)
        return {"items": [], "page": 1, "page_size": page_size, "total": 0}

    monkeypatch.setattr(observation_router, "list_geo_observation_items_service", list_items)
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=SimpleNamespace(account_type="ADMIN")
    )
    try:
        response = TestClient(app).get(
            "/api/v1/geo-observations/list-items",
            params={"page_size": 20},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["page_size"] == 20
    assert received_page_sizes == [20]


def test_query_topic_list_contract_preserves_full_list_and_adds_v2_read_model() -> None:
    """V1 选项列表保持全量语义，V2 列表独立提供分页与引用摘要。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    operation = paths["/api/v1/query-topics/list-items"]["get"]

    assert [parameter["name"] for parameter in operation["parameters"]] == [
        "q",
        "sort",
        "page",
        "page_size",
    ]
    assert operation["parameters"][-1]["schema"]["enum"] == [10, 20, 50]
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/QueryTopicListPage"
    }
    assert paths["/api/v1/query-topics"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/QueryTopicList"}
    assert set(schemas["QueryTopicReferenceSummary"]["required"]) == {
        "content_task_count",
        "geo_optimization_count",
        "observation_count",
    }
    assert schemas["QueryTopicListItem"]["allOf"][1]["required"] == ["references"]
    for name in ("QueryTopicCreate", "QueryTopicUpdate"):
        variants = schemas[name]["properties"]["variants"]
        assert variants["items"]["minLength"] == 1
        assert variants["uniqueItems"] is True


def test_platform_list_contract_exposes_readiness_options_and_delete_revision() -> None:
    """平台列表由服务端投影就绪度，删除必须提交 canonical revision。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    operation = paths["/api/v1/platform-profiles"]["get"]

    assert [parameter["name"] for parameter in operation["parameters"]] == [
        "q",
        "platform_type_id",
        "status",
        "configuration_status",
        "readiness_status",
        "page",
        "page_size",
    ]
    assert schemas["PlatformReadinessStatus"]["enum"] == [
        "COMPLETE",
        "MISSING_PROMPT",
        "MISSING_ACCOUNT",
    ]
    assert {
        "enabled_platform_account_count",
        "readiness_status",
        "primary_task",
    } <= set(schemas["PlatformProfile"]["required"])
    assert schemas["PlatformProfileList"]["properties"]["platform_type_options"] == {
        "type": "array",
        "description": "当前用户可读取的全部平台类型选项，按名称和 ID 稳定排序",
        "items": {"$ref": "#/components/schemas/PlatformTypeSummary"},
    }
    assert set(schemas["PlatformProfileDetail"]["required"]) == {
        "profile",
        "account_summary",
        "reference_summary",
        "platform_type_options",
    }
    assert schemas["PlatformProfileDetail"]["properties"]["platform_type_options"] == {
        "type": "array",
        "description": "当前用户可读取的全部平台类型选项，按名称和 ID 稳定排序",
        "items": {"$ref": "#/components/schemas/PlatformTypeSummary"},
    }
    delete_parameters = paths["/api/v1/platform-profiles/{platform_profile_id}"]["delete"][
        "parameters"
    ]
    assert delete_parameters[1] == {
        "name": "expected_revision",
        "in": "query",
        "required": True,
        "schema": {"type": "integer", "minimum": 0},
    }
    account_delete_parameters = paths["/api/v1/platform-accounts/{platform_account_id}"][
        "delete"
    ]["parameters"]
    assert account_delete_parameters[1] == {
        "name": "expected_revision",
        "in": "query",
        "required": True,
        "schema": {"type": "integer", "minimum": 0},
    }


def test_ai_channel_list_contract_is_safe_and_revisioned() -> None:
    """列表与行命令只暴露安全摘要，并统一使用 canonical revision。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    summary = schemas["AIChannelSummary"]

    assert "base_url" not in summary["properties"]
    assert {"model_count", "configuration_status"} <= set(summary["required"])
    assert schemas["AIChannelConfigurationStatus"]["enum"] == ["READY", "NEEDS_SETUP"]
    for operation_id in ("enable", "disable"):
        operation = paths[f"/api/v1/ai-channels/{{channel_id}}/{operation_id}"]["post"]
        assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/AIChannelSummary"
        }
        assert set(operation["responses"]) == {"200", "401", "403", "404", "409", "422"}

    delete_operation = paths["/api/v1/ai-channels/{channel_id}"]["delete"]
    assert delete_operation["parameters"][1] == {
        "name": "expected_revision",
        "in": "query",
        "required": True,
        "schema": {"type": "integer", "minimum": 0},
    }
    assert set(delete_operation["responses"]) == {"204", "401", "403", "404", "409", "422"}

    header = schemas["AIChannelHeader"]
    assert "value" not in header["properties"]
    header_delete = paths["/api/v1/ai-channel-headers/{header_id}"]["delete"]
    assert header_delete["parameters"][1] == {
        "name": "expected_channel_revision",
        "in": "query",
        "required": True,
        "schema": {"type": "integer", "minimum": 0},
    }
    assert set(header_delete["responses"]) == {"204", "401", "403", "404", "409", "422"}

    revision_body = {"$ref": "#/components/requestBodies/RevisionRequest"}
    discovery = paths["/api/v1/ai-channels/{channel_id}/discover-models"]["post"]
    assert discovery["requestBody"] == revision_body
    assert set(discovery["responses"]) == {
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
        "502",
        "504",
    }
    model_test = paths["/api/v1/ai-models/{model_id}/test"]["post"]
    assert model_test["requestBody"] == revision_body
    assert set(model_test["responses"]) == {
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
        "502",
        "504",
    }
    model_delete = paths["/api/v1/ai-models/{model_id}"]["delete"]
    assert model_delete["parameters"][1] == {
        "name": "expected_revision",
        "in": "query",
        "required": True,
        "schema": {"type": "integer", "minimum": 0},
    }
    assert set(model_delete["responses"]) == {"204", "401", "403", "404", "409", "422"}


def test_platform_type_contract_exposes_count_bounds_and_delete_revision() -> None:
    """平台类型列表直接提供权威数量，写合同与数据库边界一致。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]

    platform_type = schemas["PlatformType"]
    assert "platform_count" in platform_type["required"]
    assert platform_type["properties"]["platform_count"] == {
        "type": "integer",
        "minimum": 0,
        "description": "直接引用该类型的全部 PlatformProfile 数，包含 Enabled 与 Disabled",
    }
    for name in ("PlatformTypeCreate", "PlatformTypeUpdate", "PlatformType"):
        assert schemas[name]["properties"]["name"]["maxLength"] == 160
        assert schemas[name]["properties"]["slug"]["maxLength"] == 100

    delete_parameters = paths["/api/v1/platform-types/{platform_type_id}"]["delete"][
        "parameters"
    ]
    assert delete_parameters[1] == {
        "name": "expected_revision",
        "in": "query",
        "required": True,
        "description": "当前平台类型 revision",
        "schema": {"type": "integer", "minimum": 0},
    }
    assert set(paths["/api/v1/platform-types"]["get"]["responses"]) == {
        "200", "401", "403"
    }
    assert set(paths["/api/v1/platform-types"]["post"]["responses"]) == {
        "201", "401", "403", "409", "422"
    }
    assert set(paths["/api/v1/platform-types/{platform_type_id}"]["patch"]["responses"]) == {
        "200", "401", "403", "404", "409", "422"
    }
    assert set(paths["/api/v1/platform-types/{platform_type_id}"]["delete"]["responses"]) == {
        "204", "401", "403", "404", "409", "422"
    }


def test_geo_observation_detail_contract_is_one_readonly_generated_union() -> None:
    """V2 Detail 一次返回两类完整事实，基础 GeoObservation 合同保持不变。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    operation = paths["/api/v1/geo-observations/{observation_id}/detail"]["get"]

    assert set(operation["responses"]) == {"200", "401", "403", "404", "409", "422"}
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/GeoObservationDetail"
    }
    assert schemas["GeoObservationDetail"]["discriminator"] == {
        "propertyName": "observation_kind",
        "mapping": {
            "LEGACY_MODEL_RESULT": "#/components/schemas/LegacyGeoObservationDetail",
            "MANUAL_ARTICLE_SEARCH": "#/components/schemas/ManualGeoObservationDetail",
        },
    }
    assert set(schemas["LegacyGeoObservationDetail"]["required"]) == {
        "observation_kind",
        "observation",
        "query_topic",
        "product",
        "published_articles",
        "evidence",
    }
    assert set(schemas["ManualGeoObservationDetail"]["required"]) == {
        "observation_kind",
        "selected_observation_id",
        "chain_root_id",
        "chain_tail_id",
        "product",
        "correction_history",
    }
    assert set(schemas["GeoObservationCorrectionHistoryItem"]["required"]) == {
        "observation",
        "query_topic",
        "evidence",
        "is_original",
        "is_selected",
        "is_chain_tail",
    }
    assert schemas["GeoObservationDetailEvidence"]["properties"] == {
        "file": {"$ref": "#/components/schemas/FileRecord"},
        "download": {"$ref": "#/components/schemas/SignedUrl"},
    }
    assert paths["/api/v1/geo-observations/{observation_id}"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {"$ref": "#/components/schemas/GeoObservation"}
    assert paths["/api/v1/geo-observations"]["post"]["responses"]["201"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/GeoObservation"}


def test_geo_observation_correction_context_reuses_detail_and_append_contract() -> None:
    """更正上下文只补当前候选，写入继续复用追加式 ObservationCreate。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    operation = paths["/api/v1/geo-observations/{observation_id}/correction-context"]["get"]

    assert operation["operationId"] == "getGeoObservationCorrectionContext"
    assert set(operation["responses"]) == {"200", "401", "403", "404", "409", "422"}
    assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/GeoObservationCorrectionContext"
    }
    context = schemas["GeoObservationCorrectionContext"]
    assert set(context["required"]) == {
        "detail",
        "correction_article_results",
        "query_topic_options",
    }
    assert context["properties"]["detail"] == {
        "$ref": "#/components/schemas/ManualGeoObservationDetail"
    }
    assert context["properties"]["correction_article_results"]["items"] == {
        "$ref": "#/components/schemas/GeoArticleResult"
    }
    assert context["properties"]["query_topic_options"]["items"] == {
        "$ref": "#/components/schemas/GeoObservationDetailQueryTopic"
    }
    assert "supersedes_id" in schemas["GeoObservationCreate"]["properties"]
    assert "/api/v1/geo-observations/{observation_id}/correction" not in paths


def test_geo_insight_contract_projects_actor_aware_optimization_source() -> None:
    """洞察行直接携带可提交来源，页面不得按区块或状态重建规则。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]

    assert set(paths["/api/v1/geo-insights"]["get"]["responses"]) == {
        "200",
        "401",
        "404",
        "422",
    }
    assert set(
        paths["/api/v1/geo-insights/optimization-content-tasks"]["post"]["responses"]
    ) == {"201", "401", "403", "409", "422"}
    assert set(schemas["GeoInsightOptimizationAction"]["required"]) == {
        "rule_code",
        "date_from",
        "date_to",
        "published_article_id",
        "query_topic_id",
        "geo_platform",
    }
    for name in ("GeoInsightContentPerformance", "GeoInsightCoverageItem"):
        assert "optimization_action" in schemas[name]["required"]
        assert schemas[name]["properties"]["optimization_action"]["anyOf"] == [
            {"$ref": "#/components/schemas/GeoInsightOptimizationAction"},
            {"type": "null"},
        ]


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
