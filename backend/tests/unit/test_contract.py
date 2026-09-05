"""冻结 OpenAPI 与运行时路由的契约测试。"""

import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import yaml
from fastapi.testclient import TestClient

from app.config import settings
from app.db import get_db
from app.deps import get_current_session
from app.errors import AppError
from app.main import app
from app.routers import configuration as configuration_router
from app.routers import identity as identity_router
from app.routers import observation as observation_router
from app.routers import planning as planning_router
from app.routers.planning import _content_task_read_snapshot
from app.schemas.common import RevisionRequest
from app.security import hash_token
from app.services import ai_configuration, file_records
from app.services.credentials import CredentialCipher
from app.services.openai_client import OpenAICompatibleClient
from app.services.storage import StorageUnavailable
from app.tools.contract_check import check, operation_map, resolve_schema


def _statuses(*values: str) -> set[str]:
    """为既有业务 status 集合加入跨切面 request-context 400。"""
    return {*values, "400"}


def test_runtime_openapi_matches_frozen_operations() -> None:
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    assert check(contract) == []


def test_static_request_context_metadata_covers_all_operations_and_responses() -> None:
    """静态合同逐操作声明 request ID、400 信封和全部 response Header。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    operations = operation_map(document)
    assert len(operations) == 162
    assert len({operation["operationId"] for operation in operations.values()}) == 162
    assert sum(len(operation["responses"]) for operation in operations.values()) == 1024

    expected_parameter = {
        "name": "X-Request-ID",
        "in": "header",
        "required": False,
        "schema": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": r"^[\x20-\x7E]+$",
        },
    }
    expected_header = {
        "required": True,
        "schema": {
            "type": "string",
            "minLength": 1,
            "maxLength": 100,
            "pattern": r"^[\x20-\x7E]+$",
        },
    }
    assert document["components"]["parameters"]["RequestIdHeader"] == expected_parameter
    assert document["components"]["headers"]["RequestIdResponseHeader"] == expected_header
    error_response = document["components"]["responses"]["ErrorResponse"]
    assert error_response["content"] == {
        "application/json": {"schema": {"$ref": "#/components/schemas/ErrorEnvelope"}}
    }
    assert error_response["headers"]["X-Request-ID"] == {
        "$ref": "#/components/headers/RequestIdResponseHeader"
    }

    for operation in operations.values():
        parameters = [
            resolve_schema(document, parameter)
            for parameter in operation.get("parameters", [])
            if resolve_schema(document, parameter).get("name") == "X-Request-ID"
        ]
        assert parameters == [expected_parameter]
        assert operation["responses"]["400"] == {
            "$ref": "#/components/responses/ErrorResponse"
        }
        assert "default" not in operation["responses"]
        assert "4XX" not in operation["responses"]
        for response in operation["responses"].values():
            resolved = resolve_schema(document, response)
            assert resolved["headers"]["X-Request-ID"] == {
                "$ref": "#/components/headers/RequestIdResponseHeader"
            }


def test_frozen_response_status_signatures_cover_every_operation() -> None:
    """逐 operation 冻结精确 response 集合，避免合同回退到宽泛状态模板。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    expected_by_signature = {
        ("200",): ("getLiveHealth",),
        ("200", "503"): ("getReadyHealth",),
        ("200", "204", "401"): ("getCurrentUser",),
        ("200", "401", "403"): (
            "getCsrfToken",
            "getAuditLogFilterOptions",
            "listQueryTopics",
            "listPlatformPrompts",
            "listPlatformTypes",
            "listPublicationReadyItems",
            "getPublicationWorkbenchSummary",
            "getDashboardSummary",
        ),
        ("200", "401", "422"): ("login",),
        ("200", "204", "401", "403"): ("getContentHumanizationPrompt",),
        ("200", "401", "403", "409"): ("getWorkbench",),
        ("200", "401", "403", "422"): (
            "listUsers",
            "bulkUpdateUserStatus",
            "exportUsers",
            "listAuditLogs",
            "listProducts",
            "listQueryTopicItems",
            "listPlatformProfiles",
            "exportPlatformProfiles",
            "listAIChannels",
            "listContentTasks",
            "getContentTaskCreationOptions",
            "listPlatformAccounts",
            "getGeoMetrics",
        ),
        ("201", "401", "403", "422"): (
            "createQueryTopic",
            "createAIChannel",
            "createFileUploadIntent",
        ),
        ("204", "401", "403", "422"): ("logout", "changePassword"),
        ("200", "401", "403", "404", "422"): (
            "getProduct",
            "getProductDetail",
            "getProductFactsDraft",
            "listFactVersions",
            "listProductFactHistory",
            "getProductFactReviewContext",
            "getFactVersion",
            "getFactReviewContext",
            "getPlatformProfile",
            "getPlatformPrompt",
            "getPlatformPromptPreviewOptions",
            "getAIChannel",
            "getAIChannelUsageSummary",
            "listAIChannelAuditLogs",
            "listAIModels",
            "getContentTask",
            "getContentTaskDetail",
            "listGenerationJobs",
            "listContentTaskVersions",
            "getGenerationJob",
            "getContentVersion",
            "compareContentVersions",
            "listGeoObservationPublications",
            "getFileRecord",
        ),
        ("200", "401", "403", "409", "422"): (
            "putContentHumanizationPrompt",
            "listPublicationWorks",
            "listPublishedArticles",
            "listPublishedContentIssues",
            "listGeoObservations",
            "listGeoObservationItems",
        ),
        ("201", "401", "403", "409", "422"): (
            "createUser",
            "createProduct",
            "createPlatformPrompt",
            "createPlatformType",
        ),
        ("200", "401", "403", "404", "409", "422"): (
            "updateUser",
            "resetUserPassword",
            "getAuditLog",
            "updateProduct",
            "replaceProductFactsDraft",
            "approveFactVersion",
            "requestFactVersionChanges",
            "retireFactVersion",
            "updateQueryTopic",
            "updatePlatformProfile",
            "enablePlatformProfile",
            "disablePlatformProfile",
            "updatePlatformPrompt",
            "updatePlatformType",
            "updateAIChannel",
            "replaceAIChannelApiKey",
            "enableAIChannel",
            "disableAIChannel",
            "updateAIChannelHeader",
            "updateAIModel",
            "testAIModel",
            "enableAIModel",
            "disableAIModel",
            "getContentEditorContext",
            "getContentTaskReviewContext",
            "getContentTaskGenerationOptions",
            "cancelContentTask",
            "archiveContentTask",
            "restoreContentTask",
            "getContentTaskPermanentDeletionPreview",
            "updateContentDraft",
            "getContentReviewContext",
            "getContentVersionDetail",
            "submitContentVersion",
            "abandonContentVersion",
            "approveContentVersion",
            "requestContentVersionChanges",
            "getPublicationPackage",
            "updatePlatformAccount",
            "enablePlatformAccount",
            "disablePlatformAccount",
            "getPublicationWork",
            "getPublicationWorkspaceContext",
            "updatePublicationPreparation",
            "markPublicationPlatformReview",
            "registerPublicationResult",
            "verifyPublicationWork",
            "switchPublicationContentVersion",
            "closePublicationWork",
            "getPublishedArticle",
            "previewPublishedArticlePermanentDeletion",
            "getPublishedContentIssue",
            "getPublishedContentIssueWorkspaceContext",
            "getPublishedContentRepairContext",
            "resolvePublishedContentIssue",
            "getGeoObservation",
            "getGeoObservationDetail",
            "getGeoObservationCorrectionContext",
            "getGeoInsights",
            "abortFileUpload",
            "getFileDownloadUrl",
        ),
        ("201", "401", "403", "404", "409", "422"): (
            "submitProductFactReview",
            "createPlatformProfile",
            "createAIChannelHeader",
            "createContentTask",
            "createManualContentVersion",
            "createContentRevision",
            "createPlatformAccount",
            "createPublicationWork",
            "openPublishedContentIssue",
            "createPublishedContentRepairTask",
            "createGeoObservation",
            "createGeoOptimizationContentTask",
            "createAIModel",
        ),
        ("201", "401", "403", "409", "422", "503"): (
            "createPlatformLogoCandidate",
        ),
        ("202", "401", "403", "404", "409", "422"): (
            "createGenerationJob",
            "createHumanizationJob",
            "retryGenerationJob",
        ),
        ("204", "401", "403", "404", "409", "422"): (
            "deleteUser",
            "deleteProduct",
            "deleteFactVersion",
            "deleteQueryTopic",
            "deletePlatformProfile",
            "deletePlatformPrompt",
            "deletePlatformType",
            "deleteAIChannel",
            "deleteAIChannelHeader",
            "deleteAIModel",
            "deleteContentTask",
            "permanentlyDeleteContentTask",
            "deleteContentDraft",
            "deletePlatformAccount",
            "permanentlyDeletePublishedArticle",
            "deleteGeoObservation",
        ),
        ("200", "401", "403", "404", "409", "422", "503"): (
            "completeFileUpload",
        ),
        ("200", "401", "403", "404", "409", "422", "502", "504"): (
            "discoverAIChannelModels",
        ),
    }
    expected = {
        operation_id: set(statuses) | {"400"}
        for statuses, operation_ids in expected_by_signature.items()
        for operation_id in operation_ids
    }
    operations = {
        operation["operationId"]: operation
        for path in document["paths"].values()
        for operation in path.values()
        if isinstance(operation, dict) and "operationId" in operation
    }

    assert len(expected) == 162
    assert set(operations) == set(expected)
    for operation_id, operation in operations.items():
        responses = operation["responses"]
        assert set(responses) == expected[operation_id]
        assert "500" not in responses
        assert "default" not in responses
        for status, response in responses.items():
            if status not in {"200", "201", "202", "204"}:
                assert response == {"$ref": "#/components/responses/ErrorResponse"}

    validation_free = {
        "getLiveHealth",
        "getReadyHealth",
        "getAuditLogFilterOptions",
        "getCsrfToken",
        "getCurrentUser",
        "getContentHumanizationPrompt",
        "getDashboardSummary",
        "listPlatformPrompts",
        "listPlatformTypes",
        "listPublicationReadyItems",
        "getPublicationWorkbenchSummary",
        "listQueryTopics",
        "getWorkbench",
    }
    assert len(validation_free) == 13
    assert sum("422" in statuses for statuses in expected.values()) == 149
    assert {
        operation_id for operation_id, statuses in expected.items() if "422" not in statuses
    } == validation_free
    assert expected["testAIModel"] == {"200", "400", "401", "403", "404", "409", "422"}
    assert expected["discoverAIChannelModels"] == {
        "200",
        "400",
        "401",
        "403",
        "404",
        "409",
        "422",
        "502",
        "504",
    }
    assert expected["completeFileUpload"] == {
        "200",
        "400",
        "401",
        "403",
        "404",
        "409",
        "422",
        "503",
    }


def test_audit_contract_separates_list_metadata_from_safe_detail() -> None:
    """列表不携带详情副本，单条详情只允许登记后的安全值。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    schemas = document["components"]["schemas"]
    detail_operation = document["paths"]["/api/v1/audit-logs/{audit_log_id}"]["get"]

    assert "change_summary" not in schemas["AuditLog"]["properties"]
    assert schemas["AuditChange"]["properties"]["before"] == {
        "$ref": "#/components/schemas/AuditSafeValue"
    }
    assert schemas["AuditLogDetail"]["properties"]["facts"] == {
        "type": "object",
        "additionalProperties": {"$ref": "#/components/schemas/AuditSafeValue"},
    }
    assert schemas["AuditLogDetail"]["type"] == "object"
    assert schemas["AuditLogDetail"]["additionalProperties"] is False
    assert set(detail_operation["responses"]) == _statuses("200", "401", "403", "404", "409", "422")


def test_user_management_contract_is_revisioned_and_typed() -> None:
    """用户凭据、删除和批量状态命令必须共享明确的并发合同。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]

    delete_parameters = paths["/api/v1/users/{user_id}"]["delete"]["parameters"]
    assert delete_parameters[1] == {
        "name": "expected_revision",
        "in": "query",
        "required": True,
        "schema": {"type": "integer", "minimum": 0},
    }

    reset = paths["/api/v1/users/{user_id}/reset-password"]["post"]
    assert set(reset["responses"]) == _statuses("200", "401", "403", "404", "409", "422")
    assert reset["responses"]["200"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/User"
    }
    assert set(schemas["ResetPasswordRequest"]["required"]) == {
        "temporary_password",
        "expected_revision",
    }
    assert schemas["ResetPasswordRequest"]["properties"]["expected_revision"] == {
        "type": "integer",
        "minimum": 0,
    }
    assert schemas["UserBulkStatusFailure"]["properties"]["code"]["enum"] == [
        "NOT_FOUND",
        "REVISION_CONFLICT",
        "LAST_ADMIN_REQUIRED",
        "INVALID_STATE_TRANSITION",
    ]


def test_geo_observation_list_contract_is_compact_and_preserves_v1() -> None:
    """V2 列表使用独立紧凑读模型，V1 完整列表合同保持原样。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    operation = paths["/api/v1/geo-observations/list-items"]["get"]
    query_parameters = [
        parameter for parameter in operation["parameters"] if "name" in parameter
    ]

    assert [parameter["name"] for parameter in query_parameters] == [
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
    assert query_parameters[-1]["schema"]["enum"] == [10, 20, 50]
    assert set(operation["responses"]) == _statuses("200", "401", "403", "409", "422")
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
    assert set(paths["/api/v1/geo-observation-publications"]["get"]["responses"]) == _statuses(
        "200", "401", "403", "404", "422"
    )
    assert set(paths["/api/v1/geo-observations"]["post"]["responses"]) == _statuses(
        "201", "401", "403", "404", "409", "422"
    )
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


@pytest.mark.parametrize("page_size", [10, 20, 50])
def test_query_topic_list_accepts_page_size_from_query_string(
    page_size: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Query Topic 合法分页值必须经真实 HTTP 边界解析为整数。"""
    received_page_sizes: list[int] = []

    def list_items(*, db: object, **kwargs: object) -> dict[str, object]:
        assert db is not None
        value = kwargs["page_size"]
        assert isinstance(value, int)
        received_page_sizes.append(value)
        return {"items": [], "page": 1, "page_size": value, "total": 0}

    monkeypatch.setattr(planning_router, "list_query_topic_items_query", list_items)
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=SimpleNamespace(account_type="ADMIN")
    )
    try:
        response = TestClient(app).get(
            "/api/v1/query-topics/list-items",
            params={"page_size": page_size},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["page_size"] == page_size
    assert received_page_sizes == [page_size]


def test_query_topic_list_uses_integer_default_page_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """省略分页值时必须继续向服务传递整数默认值 20。"""
    received_page_sizes: list[int] = []

    def list_items(*, db: object, **kwargs: object) -> dict[str, object]:
        assert db is not None
        value = kwargs["page_size"]
        assert isinstance(value, int)
        received_page_sizes.append(value)
        return {"items": [], "page": 1, "page_size": value, "total": 0}

    monkeypatch.setattr(planning_router, "list_query_topic_items_query", list_items)
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=SimpleNamespace(account_type="ADMIN")
    )
    try:
        response = TestClient(app).get("/api/v1/query-topics/list-items")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["page_size"] == 20
    assert received_page_sizes == [20]


def test_query_topic_list_rejects_non_enum_page_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """非枚举分页值必须在进入服务前返回统一校验错误。"""
    collaborator_calls: list[object] = []

    def list_items(*, db: object, **kwargs: object) -> dict[str, object]:
        collaborator_calls.append((db, kwargs))
        return {"items": [], "page": 1, "page_size": 30, "total": 0}

    monkeypatch.setattr(planning_router, "list_query_topic_items_query", list_items)
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=SimpleNamespace(account_type="ADMIN")
    )
    try:
        response = TestClient(app).get(
            "/api/v1/query-topics/list-items",
            params={"page_size": 30},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    payload = response.json()["error"]
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(
        issue["loc"] == ["query", "page_size"] for issue in payload["details"]["errors"]
    )
    assert collaborator_calls == []


def test_query_topic_list_contract_preserves_full_list_and_adds_v2_read_model() -> None:
    """V1 选项列表保持全量语义，V2 列表独立提供分页与引用摘要。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    operation = paths["/api/v1/query-topics/list-items"]["get"]
    query_parameters = [
        parameter for parameter in operation["parameters"] if "name" in parameter
    ]

    assert [parameter["name"] for parameter in query_parameters] == [
        "q",
        "sort",
        "page",
        "page_size",
    ]
    assert query_parameters[-1]["schema"]["enum"] == [10, 20, 50]
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
    assert schemas["QueryTopicListItem"]["required"] == [
        "canonical_question",
        "intent_type",
        "variants",
        "id",
        "available_actions",
        "deletion",
        "primary_task",
        "revision",
        "created_at",
        "references",
    ]
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
    query_parameters = [
        parameter for parameter in operation["parameters"] if "name" in parameter
    ]

    assert [parameter["name"] for parameter in query_parameters] == [
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
        assert set(operation["responses"]) == _statuses("200", "401", "403", "404", "409", "422")

    delete_operation = paths["/api/v1/ai-channels/{channel_id}"]["delete"]
    assert delete_operation["parameters"][1] == {
        "name": "expected_revision",
        "in": "query",
        "required": True,
        "schema": {"type": "integer", "minimum": 0},
    }
    assert set(delete_operation["responses"]) == _statuses("204", "401", "403", "404", "409", "422")

    header = schemas["AIChannelHeader"]
    assert "value" not in header["properties"]
    header_delete = paths["/api/v1/ai-channel-headers/{header_id}"]["delete"]
    assert header_delete["parameters"][1] == {
        "name": "expected_channel_revision",
        "in": "query",
        "required": True,
        "schema": {"type": "integer", "minimum": 0},
    }
    assert set(header_delete["responses"]) == _statuses("204", "401", "403", "404", "409", "422")

    revision_body = {"$ref": "#/components/requestBodies/RevisionRequest"}
    discovery = paths["/api/v1/ai-channels/{channel_id}/discover-models"]["post"]
    assert discovery["requestBody"] == revision_body
    assert set(discovery["responses"]) == _statuses(
        "200", "401", "403", "404", "409", "422", "502", "504"
    )
    model_test = paths["/api/v1/ai-models/{model_id}/test"]["post"]
    assert model_test["requestBody"] == revision_body
    assert set(model_test["responses"]) == _statuses("200", "401", "403", "404", "409", "422")
    model_delete = paths["/api/v1/ai-models/{model_id}"]["delete"]
    assert model_delete["parameters"][1] == {
        "name": "expected_revision",
        "in": "query",
        "required": True,
        "schema": {"type": "integer", "minimum": 0},
    }
    assert set(model_delete["responses"]) == _statuses("204", "401", "403", "404", "409", "422")


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
    assert set(paths["/api/v1/platform-types"]["get"]["responses"]) == _statuses(
        "200", "401", "403"
    )
    assert set(paths["/api/v1/platform-types"]["post"]["responses"]) == _statuses(
        "201", "401", "403", "409", "422"
    )
    assert set(
        paths["/api/v1/platform-types/{platform_type_id}"]["patch"]["responses"]
    ) == _statuses(
        "200", "401", "403", "404", "409", "422"
    )
    assert set(
        paths["/api/v1/platform-types/{platform_type_id}"]["delete"]["responses"]
    ) == _statuses(
        "204", "401", "403", "404", "409", "422"
    )


def test_geo_observation_detail_contract_is_one_readonly_generated_union() -> None:
    """V2 Detail 一次返回两类完整事实，基础 GeoObservation 合同保持不变。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]
    schemas = document["components"]["schemas"]
    operation = paths["/api/v1/geo-observations/{observation_id}/detail"]["get"]

    assert set(operation["responses"]) == _statuses("200", "401", "403", "404", "409", "422")
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
    assert set(operation["responses"]) == _statuses("200", "401", "403", "404", "409", "422")
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

    assert set(paths["/api/v1/geo-insights"]["get"]["responses"]) == _statuses(
        "200", "401", "403", "404", "409", "422"
    )
    assert set(
        paths["/api/v1/geo-insights/optimization-content-tasks"]["post"]["responses"]
    ) == _statuses("201", "401", "403", "404", "409", "422")
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
    assert set(paths["/api/v1/published-content-issues"]["get"]["responses"]) == _statuses(
        "200", "401", "403", "409", "422"
    )
    for path, method, success in (
        ("/api/v1/published-articles/{article_id}/issues", "post", "201"),
        ("/api/v1/published-content-issues/{issue_id}", "get", "200"),
        ("/api/v1/published-content-issues/{issue_id}/workspace-context", "get", "200"),
        ("/api/v1/published-content-issues/{issue_id}/repair-context", "get", "200"),
        ("/api/v1/published-content-issues/{issue_id}/repair-task", "post", "201"),
        ("/api/v1/published-content-issues/{issue_id}/resolve", "post", "200"),
    ):
        assert set(paths[path][method]["responses"]) == _statuses(
            success, "401", "403", "404", "409", "422"
        )


def test_publication_work_read_contract_matches_runtime_error_matrix() -> None:
    """三个工作读取面必须声明共享认证与上下文错误。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = document["paths"]

    list_responses = paths["/api/v1/publication-works"]["get"]["responses"]
    assert set(list_responses) == _statuses("200", "401", "403", "409", "422")
    for status in ("401", "403", "409", "422"):
        assert list_responses[status] == {"$ref": "#/components/responses/ErrorResponse"}

    for path in (
        "/api/v1/publication-works/{work_id}",
        "/api/v1/publication-works/{work_id}/workspace-context",
    ):
        responses = paths[path]["get"]["responses"]
        assert set(responses) == _statuses("200", "401", "403", "404", "409", "422")
        for status in ("401", "403", "404", "409", "422"):
            assert responses[status] == {"$ref": "#/components/responses/ErrorResponse"}


def test_product_create_contract_declares_input_limits_and_error_responses() -> None:
    """冻结创建产品的长度边界与可预期错误响应。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    operation = document["paths"]["/api/v1/products"]["post"]
    product_create = document["components"]["schemas"]["ProductCreate"]

    assert set(operation["responses"]) == _statuses("201", "401", "403", "409", "422")
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
    assert set(create["responses"]) == _statuses("201", "401", "403", "404", "409", "422")
    assert set(options["responses"]) == _statuses("200", "401", "403", "422")
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

    assert set(operation["responses"]) == _statuses("200", "401", "403", "404", "422")
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
    assert set(document["components"]["schemas"]["ContentTask"]["required"]) == {
        "product_id",
        "fact_version_id",
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
    }


def test_content_version_detail_contract_is_readonly_and_compact() -> None:
    """详情合同不得复用动作投影或返回浏览器需要再次拼接的完整资源。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    operation = document["paths"]["/api/v1/content-versions/{content_version_id}/detail"]["get"]
    schemas = document["components"]["schemas"]
    detail = schemas["ContentVersionDetail"]
    content = schemas["ContentVersionDetailContent"]

    assert set(operation["responses"]) == _statuses("200", "401", "403", "404", "409", "422")
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

    assert set(operation["responses"]) == _statuses("200", "401", "403", "404", "422")
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

    assert set(path["get"]["responses"]) == _statuses("200", "401", "403", "404", "422")
    assert set(path["put"]["responses"]) == _statuses("200", "401", "403", "404", "409", "422")
    assert set(submission["responses"]) == _statuses("201", "401", "403", "404", "409", "422")
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

    assert set(product_context["responses"]) == _statuses("200", "401", "403", "404", "422")
    assert set(version_detail["responses"]) == _statuses("200", "401", "403", "404", "422")
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
    assert set(exact_context["responses"]) == _statuses("200", "401", "403", "404", "422")
    assert set(approve["responses"]) == _statuses("200", "401", "403", "404", "409", "422")
    assert set(request_changes["responses"]) == _statuses(
        "200", "401", "403", "404", "409", "422"
    )
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


def test_error_envelope_without_details_keeps_empty_wire_object() -> None:
    """统一错误信封在未提供业务详情时仍输出四个稳定字段。"""
    response = TestClient(app).get(
        "/api/health/live",
        headers={"X-Request-ID": "r" * 101},
    )

    assert response.status_code == 400
    error = response.json()["error"]
    assert set(error) == {"code", "message", "details", "request_id"}
    assert error["details"] == {}


def test_phase_b_shared_contract_shapes_are_explicit() -> None:
    """共享错误、健康、GEO、生成联合和 CSV 响应必须与冻结语义一致。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    document = yaml.safe_load(contract.read_text(encoding="utf-8"))
    schemas = document["components"]["schemas"]

    assert schemas["ErrorDetail"]["required"] == [
        "code",
        "message",
        "details",
        "request_id",
    ]
    assert "checks" not in schemas["HealthResponse"]["required"]
    assert schemas["HealthResponse"]["properties"]["checks"]["type"] == [
        "object",
        "null",
    ]
    basis = schemas["ContentTaskDetailGeoOptimization"]["properties"]["basis"]
    assert basis["discriminator"] == {
        "propertyName": "rule_code",
        "mapping": {
            "CONTENT_DECLINE": (
                "#/components/schemas/ContentTaskDetailGeoContentDeclineBasis"
            ),
            "LONG_UNMENTIONED": (
                "#/components/schemas/ContentTaskDetailGeoLongUnmentionedBasis"
            ),
            "QUESTION_COVERAGE_GAP": (
                "#/components/schemas/ContentTaskDetailGeoQuestionCoverageBasis"
            ),
        },
    }
    generation_union = schemas["GenerationInputSnapshot"]["anyOf"]
    generation_refs = [
        "#/components/schemas/LegacyGenerationSnapshot",
        "#/components/schemas/MarkdownGenerationSnapshotV2",
        "#/components/schemas/GenerationSnapshot",
    ]
    humanization_refs = [
        "#/components/schemas/LegacyHumanizationSnapshot",
        "#/components/schemas/HumanizationSnapshot",
    ]
    assert [branch["$ref"] for branch in generation_union] == generation_refs
    assert [
        branch["$ref"]
        for branch in schemas["GenerationJobDetail"]["properties"]["input_snapshot"]["anyOf"]
    ] == generation_refs + humanization_refs
    assert [
        branch["$ref"]
        for branch in schemas["GenerationTrace"]["properties"]["input_snapshot"]["anyOf"]
    ] == generation_refs
    assert [
        branch["$ref"]
        for branch in schemas["HumanizationTrace"]["properties"]["input_snapshot"]["anyOf"]
    ] == humanization_refs
    for schema_name in (
        "LegacyGenerationSnapshot",
        "MarkdownGenerationSnapshotV2",
        "GenerationSnapshot",
    ):
        assert "contract_version" in schemas[schema_name]["required"]
    for operation_id in ("exportUsers", "exportPlatformProfiles"):
        operation = next(
            operation
            for path in document["paths"].values()
            for operation in path.values()
            if isinstance(operation, dict) and operation.get("operationId") == operation_id
        )
        response = operation["responses"]["200"]
        assert response["content"] == {"text/csv": {"schema": {"type": "string"}}}
        assert response["headers"]["Content-Disposition"] == {
            "required": True,
            "schema": {"type": "string"},
        }
        assert response["headers"]["X-Request-ID"] == {
            "$ref": "#/components/headers/RequestIdResponseHeader"
        }


def test_response_components_are_flattened_closed_objects() -> None:
    """response 派生组件必须是完整、封闭且不依赖 closed base 的对象。"""
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    schemas = yaml.safe_load(contract.read_text(encoding="utf-8"))["components"]["schemas"]
    expected_properties = {
        "AuditLogDetail": {
            "id", "actor_id", "actor", "business_module", "action", "target_type",
            "target_id", "outcome", "primary_task", "request_id", "created_at", "changes",
            "facts", "result_message", "error_code", "related_entry",
        },
        "QueryTopic": {
            "canonical_question", "intent_type", "variants", "id", "available_actions",
            "deletion", "primary_task", "revision", "created_at",
        },
        "QueryTopicListItem": {
            "canonical_question", "intent_type", "variants", "id", "available_actions",
            "deletion", "primary_task", "revision", "created_at", "references",
        },
        "PlatformLogoUpload": {"source", "file_id", "url"},
        "PlatformPromptUpdate": {"name", "template_markdown", "expected_revision"},
        "PlatformPromptListItem": {
            "id", "name", "revision", "updated_at", "updated_by", "bound_platform_count",
            "available_actions",
        },
        "PlatformPromptDetail": {
            "id", "name", "revision", "updated_at", "updated_by", "bound_platform_count",
            "available_actions", "template_markdown", "created_at", "bound_platforms",
        },
        "ContentTask": {
            "product_id", "fact_version_id", "platform_profile_id", "id", "query_topic_id",
            "source_published_content_issue_id", "current_content_version_id", "workflow_stage",
            "primary_task", "available_actions", "deletion", "status", "revision", "created_by",
            "created_at", "archived_at",
        },
        "ContentTaskListItem": {
            "product_id", "fact_version_id", "platform_profile_id", "id", "query_topic_id",
            "source_published_content_issue_id", "current_content_version_id", "workflow_stage",
            "primary_task", "available_actions", "deletion", "status", "revision", "created_by",
            "created_at", "archived_at", "identifier", "product", "platform", "current_content",
            "latest_generation_status", "updated_at",
        },
        "GenerationJobDetail": {
            "id", "content_task_id", "job_type", "source_content_version_id", "status",
            "workflow_stage", "primary_task", "available_actions", "attempt_count",
            "content_version_id", "retry_of_id", "error_code", "error_summary",
            "provider_request_id", "response_duration_ms", "prompt_tokens", "completion_tokens",
            "total_tokens", "created_at", "started_at", "finished_at", "input_snapshot",
        },
        "PlatformAccount": {
            "platform_profile_id", "label", "account_identifier", "id", "is_active",
            "workflow_stage", "primary_task", "available_actions", "deletion", "revision",
        },
        "GeoInsightPublicationOption": {"id", "label", "platform_name"},
        "GeoInsightRatePoint": {"numerator", "denominator", "value", "date"},
        "GeoInsightDecliningContent": {
            "published_article_id", "product_id", "content_platform_id", "title",
            "content_platform", "observation_count", "discovery_rate", "mention_rate",
            "accuracy_rate", "primary_task", "optimization_action", "basis",
        },
        "GeoInsightLongUnmentionedContent": {
            "published_article_id", "product_id", "content_platform_id", "title",
            "content_platform", "observation_count", "discovery_rate", "mention_rate",
            "accuracy_rate", "primary_task", "optimization_action", "unmentioned_days",
            "last_mentioned_at",
        },
    }
    assert {
        name
        for name, schema in schemas.items()
        if name in expected_properties and "allOf" in schema
    } == set()
    expected_required = {
        "GenerationJobDetail": {
            "id", "content_task_id", "job_type", "source_content_version_id", "status",
            "workflow_stage", "primary_task", "available_actions", "attempt_count", "created_at",
            "input_snapshot",
        }
    }
    for name, properties in expected_properties.items():
        schema = schemas[name]
        assert "allOf" not in schema
        assert schema["type"] == "object"
        assert schema["additionalProperties"] is False
        assert set(schema["properties"]) == properties
        assert set(schema["required"]) == expected_required.get(name, properties)


@pytest.mark.parametrize("provider_status", [502, 504])
def test_ai_model_provider_failure_is_projected_to_failed_200(
    provider_status: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实模型测试捕获 provider 502/504 并回写 FAILED，而非向 API 泄漏。"""
    model_id = uuid.uuid4()
    channel_id = uuid.uuid4()
    actor = SimpleNamespace(id=uuid.uuid4())
    channel = SimpleNamespace(
        id=channel_id,
        revision=4,
        protocol_type="openai-compatible-chat-completions",
        base_url="https://provider.example.com/v1",
        timeout_seconds=5,
        api_key_ciphertext=CredentialCipher(settings.ai_credential_encryption_key).encrypt(
            "test-key", associated_data=f"ai_channel:{channel_id}:api_key"
        ),
    )
    model = SimpleNamespace(
        id=model_id,
        channel_id=channel_id,
        revision=7,
        model_id="test-model",
        request_parameters={},
        test_status="UNTESTED",
        last_test_error_summary=None,
        last_tested_at=None,
        is_enabled=True,
    )
    db = Mock()
    db.scalar.side_effect = [channel_id, channel, model, channel_id, channel, model]
    db.scalars.return_value = []

    def provider_failure(self: OpenAICompatibleClient, **kwargs: object) -> None:
        del self, kwargs
        raise AppError("AI_PROVIDER_ERROR", f"模拟 provider {provider_status}", provider_status)

    monkeypatch.setattr(OpenAICompatibleClient, "test_connection", provider_failure)

    result = ai_configuration.test_ai_model(
        db=db,
        model_id=model_id,
        payload=RevisionRequest(expected_revision=7),
        actor=actor,
        request_id="contract-ai-model",
    )

    assert result is model
    assert model.test_status == "FAILED"
    assert model.last_test_error_summary == f"模拟 provider {provider_status}"
    assert model.is_enabled is False
    assert model.revision == 8
    assert db.commit.call_count == 2


def test_ai_model_route_projects_failed_test_as_http_200(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """模型测试路由将已持久化的 FAILED 投影为正常的 200 响应。"""
    model_id = uuid.uuid4()
    now = datetime.now(UTC)
    model = SimpleNamespace(
        id=model_id,
        channel_id=uuid.uuid4(),
        display_name="测试模型",
        model_id="test-model",
        request_parameters={},
        is_enabled=False,
        test_status="FAILED",
        last_tested_at=now,
        last_test_error_summary="provider unavailable",
        revision=8,
        created_by=uuid.uuid4(),
        created_at=now,
        updated_at=now,
    )
    monkeypatch.setattr(
        configuration_router,
        "test_ai_model_command",
        lambda **kwargs: model,
    )
    app.dependency_overrides[get_db] = lambda: Mock(get=lambda *_args: None)
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=SimpleNamespace(account_type="ADMIN"),
        csrf_hash=hash_token("contract-test-csrf-token-more-than-32-characters"),
    )
    try:
        response = TestClient(app).post(
            f"/api/v1/ai-models/{model_id}/test",
            headers={"X-CSRF-Token": "contract-test-csrf-token-more-than-32-characters"},
            json={"expected_revision": 7},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["test_status"] == "FAILED"


def test_complete_file_upload_storage_failure_keeps_pending_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """对象存储不可用时，真实完成服务返回 503 且不推进文件状态。"""
    file_id = uuid.uuid4()
    actor = SimpleNamespace(id=uuid.uuid4())
    file = SimpleNamespace(
        id=file_id,
        uploader_id=actor.id,
        status="PENDING",
        object_key="evidence/test.bin",
        size=4,
        sha256="a" * 64,
        content_type="application/octet-stream",
        category="PUBLICATION_ASSET",
    )
    db = Mock()
    db.get.return_value = file
    storage = Mock()
    storage.head.side_effect = StorageUnavailable("模拟对象存储不可用")
    monkeypatch.setattr(file_records, "get_evidence_storage", lambda: storage)

    with pytest.raises(AppError) as raised:
        file_records.complete_file_upload(
            db=db,
            file_id=file_id,
            actor=actor,
            request_id="contract-file-upload",
        )

    assert raised.value.status_code == 503
    assert raised.value.code == "DEPENDENCY_UNAVAILABLE"
    assert file.status == "PENDING"
    db.commit.assert_not_called()


@pytest.mark.parametrize(
    ("path", "query_module", "query_name", "csv_content"),
    [
        ("/api/v1/users/export", identity_router, "export_users_query", "id\n"),
        (
            "/api/v1/platform-profiles/export",
            configuration_router,
            "export_platform_profiles_query",
            "id\n",
        ),
    ],
)
def test_csv_export_routes_return_downloadable_csv(
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    query_module: object,
    query_name: str,
    csv_content: str,
) -> None:
    """两个导出路由都直接返回 CSV 与非空下载文件名。"""
    monkeypatch.setattr(query_module, query_name, lambda **kwargs: csv_content)
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: SimpleNamespace(
        user=SimpleNamespace(account_type="ADMIN")
    )
    try:
        response = TestClient(app).get(path)
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"].startswith("attachment; filename=")
    assert response.text == csv_content


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
