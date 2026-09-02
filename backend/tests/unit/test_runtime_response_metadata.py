"""Wave 1/2 路由运行时 response metadata 与冻结合同的逐操作校验。"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml

from app.main import app
from app.tools.contract_check import compare_response_contracts

WAVE_1_OPERATION_IDS = (
    "getLiveHealth",
    "getReadyHealth",
    "login",
    "logout",
    "getCurrentUser",
    "getCsrfToken",
    "changePassword",
    "listUsers",
    "createUser",
    "bulkUpdateUserStatus",
    "exportUsers",
    "updateUser",
    "deleteUser",
    "resetUserPassword",
    "listAuditLogs",
    "getAuditLogFilterOptions",
    "getAuditLog",
    "getContentHumanizationPrompt",
    "putContentHumanizationPrompt",
    "listPlatformTypes",
    "createPlatformType",
    "updatePlatformType",
    "deletePlatformType",
    "exportPlatformProfiles",
    "getPlatformProfile",
    "listPlatformPrompts",
    "createPlatformPrompt",
    "getPlatformPrompt",
    "updatePlatformPrompt",
    "deletePlatformPrompt",
    "createPlatformLogoCandidate",
    "updatePlatformProfile",
    "enablePlatformProfile",
    "disablePlatformProfile",
    "deletePlatformProfile",
    "listAIChannels",
    "createAIChannel",
    "getAIChannel",
    "getAIChannelUsageSummary",
    "listAIChannelAuditLogs",
    "updateAIChannel",
    "replaceAIChannelApiKey",
    "enableAIChannel",
    "disableAIChannel",
    "deleteAIChannel",
    "discoverAIChannelModels",
    "createAIChannelHeader",
    "updateAIChannelHeader",
    "deleteAIChannelHeader",
    "listAIModels",
    "createAIModel",
    "updateAIModel",
    "testAIModel",
    "enableAIModel",
    "disableAIModel",
    "deleteAIModel",
    "createFileUploadIntent",
    "completeFileUpload",
    "getFileRecord",
    "abortFileUpload",
    "getFileDownloadUrl",
)

WAVE_1_GROUPS = {
    "foundation": {"getLiveHealth", "getReadyHealth"},
    "configuration": {
        "getContentHumanizationPrompt",
        "putContentHumanizationPrompt",
        "listPlatformTypes",
        "createPlatformType",
        "updatePlatformType",
        "deletePlatformType",
        "exportPlatformProfiles",
        "getPlatformProfile",
        "listPlatformPrompts",
        "createPlatformPrompt",
        "getPlatformPrompt",
        "updatePlatformPrompt",
        "deletePlatformPrompt",
        "createPlatformLogoCandidate",
        "updatePlatformProfile",
        "enablePlatformProfile",
        "disablePlatformProfile",
        "deletePlatformProfile",
        "listAIChannels",
        "createAIChannel",
        "getAIChannel",
        "getAIChannelUsageSummary",
        "listAIChannelAuditLogs",
        "updateAIChannel",
        "replaceAIChannelApiKey",
        "enableAIChannel",
        "disableAIChannel",
        "deleteAIChannel",
        "discoverAIChannelModels",
        "createAIChannelHeader",
        "updateAIChannelHeader",
        "deleteAIChannelHeader",
        "listAIModels",
        "createAIModel",
        "updateAIModel",
        "testAIModel",
        "enableAIModel",
        "disableAIModel",
        "deleteAIModel",
    },
    "identity": {
        "login",
        "logout",
        "getCurrentUser",
        "getCsrfToken",
        "changePassword",
        "listUsers",
        "createUser",
        "bulkUpdateUserStatus",
        "exportUsers",
        "updateUser",
        "deleteUser",
        "resetUserPassword",
        "listAuditLogs",
        "getAuditLogFilterOptions",
        "getAuditLog",
    },
    "files": {
        "createFileUploadIntent",
        "completeFileUpload",
        "getFileRecord",
        "abortFileUpload",
        "getFileDownloadUrl",
    },
}

WAVE_2_OPERATION_IDS = (
    "listProducts",
    "createProduct",
    "getProduct",
    "getProductDetail",
    "updateProduct",
    "deleteProduct",
    "getProductFactsDraft",
    "replaceProductFactsDraft",
    "listProductFactHistory",
    "listFactVersions",
    "submitProductFactReview",
    "getProductFactReviewContext",
    "getFactVersion",
    "deleteFactVersion",
    "getFactReviewContext",
    "approveFactVersion",
    "requestFactVersionChanges",
    "retireFactVersion",
    "listQueryTopics",
    "listQueryTopicItems",
    "createQueryTopic",
    "updateQueryTopic",
    "deleteQueryTopic",
    "listPlatformProfiles",
    "createPlatformProfile",
    "listContentTasks",
    "createContentTask",
    "getContentTaskCreationOptions",
    "getContentTask",
    "getContentTaskDetail",
    "getContentEditorContext",
    "deleteContentTask",
    "cancelContentTask",
    "archiveContentTask",
    "restoreContentTask",
    "getContentTaskPermanentDeletionPreview",
    "permanentlyDeleteContentTask",
    "getContentTaskGenerationOptions",
    "getPlatformPromptPreviewOptions",
    "createGenerationJob",
    "createHumanizationJob",
    "listGenerationJobs",
    "getGenerationJob",
    "retryGenerationJob",
    "listContentTaskVersions",
    "createManualContentVersion",
    "getContentVersion",
    "getContentVersionDetail",
    "updateContentDraft",
    "deleteContentDraft",
    "getContentTaskReviewContext",
    "getContentReviewContext",
    "createContentRevision",
    "abandonContentVersion",
    "submitContentVersion",
    "approveContentVersion",
    "requestContentVersionChanges",
    "compareContentVersions",
)

WAVE_2_GROUPS = {
    "product_facts": {
        "listProducts",
        "createProduct",
        "getProduct",
        "getProductDetail",
        "updateProduct",
        "deleteProduct",
        "getProductFactsDraft",
        "replaceProductFactsDraft",
        "listProductFactHistory",
        "listFactVersions",
        "submitProductFactReview",
        "getProductFactReviewContext",
        "getFactVersion",
        "deleteFactVersion",
        "getFactReviewContext",
        "approveFactVersion",
        "requestFactVersionChanges",
        "retireFactVersion",
    },
    "planning": {
        "listQueryTopics",
        "listQueryTopicItems",
        "createQueryTopic",
        "updateQueryTopic",
        "deleteQueryTopic",
        "listPlatformProfiles",
        "createPlatformProfile",
        "listContentTasks",
        "createContentTask",
        "getContentTaskCreationOptions",
        "getContentTask",
        "getContentTaskDetail",
        "getContentEditorContext",
        "deleteContentTask",
        "cancelContentTask",
        "archiveContentTask",
        "restoreContentTask",
        "getContentTaskPermanentDeletionPreview",
        "permanentlyDeleteContentTask",
    },
    "production": {
        "getContentTaskGenerationOptions",
        "getPlatformPromptPreviewOptions",
        "createGenerationJob",
        "createHumanizationJob",
        "listGenerationJobs",
        "getGenerationJob",
        "retryGenerationJob",
        "listContentTaskVersions",
        "createManualContentVersion",
        "getContentVersion",
        "getContentVersionDetail",
        "updateContentDraft",
        "deleteContentDraft",
        "getContentTaskReviewContext",
        "getContentReviewContext",
        "createContentRevision",
        "abandonContentVersion",
        "submitContentVersion",
        "approveContentVersion",
        "requestContentVersionChanges",
        "compareContentVersions",
    },
}

WAVE_2_EXPECTED_STATUSES = {
    "listProducts": {"200", "401", "403", "422"},
    "createProduct": {"201", "401", "403", "409", "422"},
    "getProduct": {"200", "401", "403", "404", "422"},
    "getProductDetail": {"200", "401", "403", "404", "422"},
    "updateProduct": {"200", "401", "403", "404", "409", "422"},
    "deleteProduct": {"204", "401", "403", "404", "409", "422"},
    "getProductFactsDraft": {"200", "401", "403", "404", "422"},
    "replaceProductFactsDraft": {"200", "401", "403", "404", "409", "422"},
    "listProductFactHistory": {"200", "401", "403", "404", "422"},
    "listFactVersions": {"200", "401", "403", "404", "422"},
    "submitProductFactReview": {"201", "401", "403", "404", "409", "422"},
    "getProductFactReviewContext": {"200", "401", "403", "404", "422"},
    "getFactVersion": {"200", "401", "403", "404", "422"},
    "deleteFactVersion": {"204", "401", "403", "404", "409", "422"},
    "getFactReviewContext": {"200", "401", "403", "404", "422"},
    "approveFactVersion": {"200", "401", "403", "404", "409", "422"},
    "requestFactVersionChanges": {"200", "401", "403", "404", "409", "422"},
    "retireFactVersion": {"200", "401", "403", "404", "409", "422"},
    "listQueryTopics": {"200", "401", "403"},
    "listQueryTopicItems": {"200", "401", "403", "422"},
    "createQueryTopic": {"201", "401", "403", "422"},
    "updateQueryTopic": {"200", "401", "403", "404", "409", "422"},
    "deleteQueryTopic": {"204", "401", "403", "404", "409", "422"},
    "listPlatformProfiles": {"200", "401", "403", "422"},
    "createPlatformProfile": {"201", "401", "403", "404", "409", "422"},
    "listContentTasks": {"200", "401", "403", "422"},
    "createContentTask": {"201", "401", "403", "404", "409", "422"},
    "getContentTaskCreationOptions": {"200", "401", "403", "422"},
    "getContentTask": {"200", "401", "403", "404", "422"},
    "getContentTaskDetail": {"200", "401", "403", "404", "422"},
    "getContentEditorContext": {"200", "401", "403", "404", "409", "422"},
    "deleteContentTask": {"204", "401", "403", "404", "409", "422"},
    "cancelContentTask": {"200", "401", "403", "404", "409", "422"},
    "archiveContentTask": {"200", "401", "403", "404", "409", "422"},
    "restoreContentTask": {"200", "401", "403", "404", "409", "422"},
    "getContentTaskPermanentDeletionPreview": {"200", "401", "403", "404", "409", "422"},
    "permanentlyDeleteContentTask": {"204", "401", "403", "404", "409", "422"},
    "getContentTaskGenerationOptions": {"200", "401", "403", "404", "409", "422"},
    "getPlatformPromptPreviewOptions": {"200", "401", "403", "404", "422"},
    "createGenerationJob": {"202", "401", "403", "404", "409", "422"},
    "createHumanizationJob": {"202", "401", "403", "404", "409", "422"},
    "listGenerationJobs": {"200", "401", "403", "404", "422"},
    "getGenerationJob": {"200", "401", "403", "404", "422"},
    "retryGenerationJob": {"202", "401", "403", "404", "409", "422"},
    "listContentTaskVersions": {"200", "401", "403", "404", "422"},
    "createManualContentVersion": {"201", "401", "403", "404", "409", "422"},
    "getContentVersion": {"200", "401", "403", "404", "422"},
    "getContentVersionDetail": {"200", "401", "403", "404", "409", "422"},
    "updateContentDraft": {"200", "401", "403", "404", "409", "422"},
    "deleteContentDraft": {"204", "401", "403", "404", "409", "422"},
    "getContentTaskReviewContext": {"200", "401", "403", "404", "409", "422"},
    "getContentReviewContext": {"200", "401", "403", "404", "409", "422"},
    "createContentRevision": {"201", "401", "403", "404", "409", "422"},
    "abandonContentVersion": {"200", "401", "403", "404", "409", "422"},
    "submitContentVersion": {"200", "401", "403", "404", "409", "422"},
    "approveContentVersion": {"200", "401", "403", "404", "409", "422"},
    "requestContentVersionChanges": {"200", "401", "403", "404", "409", "422"},
    "compareContentVersions": {"200", "401", "403", "404", "422"},
}

GEO_SUCCESS_OPERATION_IDS = (
    "listGeoObservations",
    "createGeoObservation",
    "getGeoObservation",
    "getGeoObservationDetail",
    "getGeoObservationCorrectionContext",
)


def _contract_document() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _operation_map(document: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        operation["operationId"]: operation
        for path_item in document["paths"].values()
        for operation in path_item.values()
        if isinstance(operation, dict) and "operationId" in operation
    }


def _wave_projection(
    document: dict[str, Any], operation_ids: tuple[str, ...]
) -> dict[str, Any]:
    projected = deepcopy(document)
    projected["paths"] = {
        path: {
            method: operation
            for method, operation in path_item.items()
            if isinstance(operation, dict)
            and operation.get("operationId") in operation_ids
        }
        for path, path_item in document["paths"].items()
        if any(
            isinstance(operation, dict)
            and operation.get("operationId") in operation_ids
            for operation in path_item.values()
        )
    }
    return projected


def _success_wave_projection(
    document: dict[str, Any], operation_ids: tuple[str, ...]
) -> dict[str, Any]:
    # 投影只用于比较，不能修改 FastAPI 缓存的 runtime OpenAPI 文档。
    projected = deepcopy(_wave_projection(document, operation_ids))
    for path_item in projected["paths"].values():
        for operation in path_item.values():
            if isinstance(operation, dict) and "operationId" in operation:
                operation["responses"] = {
                    status: response
                    for status, response in operation["responses"].items()
                    if str(status).startswith("2")
                }
    return projected


@pytest.fixture(scope="module")
def wave_operations() -> tuple[dict[str, Any], dict[str, Any]]:
    contract = _contract_document()
    runtime = app.openapi()
    return _operation_map(contract), _operation_map(runtime)


def test_wave_1_inventory_is_complete(
    wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    contract, runtime = wave_operations
    assert len(WAVE_1_OPERATION_IDS) == 61
    assert len(set(WAVE_1_OPERATION_IDS)) == 61
    assert {name: len(ids) for name, ids in WAVE_1_GROUPS.items()} == {
        "foundation": 2,
        "configuration": 39,
        "identity": 15,
        "files": 5,
    }
    assert set().union(*WAVE_1_GROUPS.values()) == set(WAVE_1_OPERATION_IDS)
    assert set(WAVE_1_OPERATION_IDS) <= set(contract)
    assert set(WAVE_1_OPERATION_IDS) <= set(runtime)


def test_wave_2_inventory_is_complete(
    wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    contract, runtime = wave_operations
    assert len(WAVE_2_OPERATION_IDS) == 58
    assert len(set(WAVE_2_OPERATION_IDS)) == 58
    assert {name: len(ids) for name, ids in WAVE_2_GROUPS.items()} == {
        "product_facts": 18,
        "planning": 19,
        "production": 21,
    }
    assert set().union(*WAVE_2_GROUPS.values()) == set(WAVE_2_OPERATION_IDS)
    assert set(WAVE_2_EXPECTED_STATUSES) == set(WAVE_2_OPERATION_IDS)
    assert set(WAVE_2_OPERATION_IDS) <= set(contract)
    assert set(WAVE_2_OPERATION_IDS) <= set(runtime)


@pytest.mark.parametrize("operation_id", WAVE_1_OPERATION_IDS)
def test_each_wave_operation_has_exact_frozen_response_statuses(
    operation_id: str, wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    contract, runtime = wave_operations
    assert set(runtime[operation_id]["responses"]) == set(contract[operation_id]["responses"])


@pytest.mark.parametrize("operation_id", WAVE_2_OPERATION_IDS)
def test_each_wave_2_operation_has_explicit_expected_response_statuses(
    operation_id: str, wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    contract, runtime = wave_operations
    expected = WAVE_2_EXPECTED_STATUSES[operation_id]
    assert set(contract[operation_id]["responses"]) == expected
    assert set(runtime[operation_id]["responses"]) == expected


def test_wave_response_comparator_has_no_differences() -> None:
    failures = compare_response_contracts(
        _wave_projection(_contract_document(), WAVE_1_OPERATION_IDS),
        _wave_projection(app.openapi(), WAVE_1_OPERATION_IDS),
    )
    assert failures == []


def test_wave_2_response_comparator_has_no_differences() -> None:
    failures = compare_response_contracts(
        _wave_projection(_contract_document(), WAVE_2_OPERATION_IDS),
        _wave_projection(app.openapi(), WAVE_2_OPERATION_IDS),
    )
    assert failures == []


def test_geo_success_schema_identity_and_alias_compatibility() -> None:
    """验证 GEO success response 的五个受影响操作与 Python 兼容别名。"""
    contract = _contract_document()
    runtime = app.openapi()
    assert len(GEO_SUCCESS_OPERATION_IDS) == 5
    assert len(set(GEO_SUCCESS_OPERATION_IDS)) == 5
    for document in (contract, runtime):
        operation_ids = set(_operation_map(document))
        assert set(GEO_SUCCESS_OPERATION_IDS) <= operation_ids

    schemas = runtime["components"]["schemas"]
    assert "LegacyGeoObservation" in schemas
    assert "ManualGeoObservation" in schemas
    assert "LegacyGeoObservationOut" not in schemas
    assert "ManualGeoObservationOut" not in schemas

    from datetime import UTC, datetime
    from uuid import uuid4

    from app.schemas.geo_files import (
        LegacyGeoObservation,
        LegacyGeoObservationOut,
        ManualGeoObservation,
        ManualGeoObservationOut,
    )

    assert LegacyGeoObservationOut is LegacyGeoObservation
    assert ManualGeoObservationOut is ManualGeoObservation
    identifier = uuid4()
    timestamp = datetime(2026, 9, 1, tzinfo=UTC)
    recorder = {"id": identifier, "username": "tester", "display_name": "测试用户"}
    legacy_payload = {
        "observation_kind": "LEGACY_MODEL_RESULT",
        "id": identifier,
        "query_topic_id": identifier,
        "product_id": identifier,
        "product_label": "产品",
        "actual_prompt": "问题",
        "model_name": "模型",
        "model_version": None,
        "tested_at": timestamp,
        "web_search_enabled": True,
        "answer_summary": "摘要",
        "mentioned": True,
        "recommendation": "RECOMMENDED",
        "accuracy": "ACCURATE",
        "citations": [],
        "published_article_ids": [],
        "attachment_file_ids": [],
        "notes": "备注",
        "supersedes_id": None,
        "tested_by": identifier,
        "recorder": recorder,
        "is_current": True,
        "workflow_stage": "LEGACY",
        "primary_task": "VIEW_HISTORICAL_RECORD",
        "available_actions": ["CORRECT"],
        "created_at": timestamp,
    }
    manual_payload = {
        "observation_kind": "MANUAL_ARTICLE_SEARCH",
        "id": identifier,
        "query_topic_id": None,
        "product_id": identifier,
        "product_label": "产品",
        "search_platform": "平台",
        "search_query": "问题",
        "tested_at": timestamp,
        "article_results": [],
        "attachment_file_ids": [],
        "notes": "备注",
        "supersedes_id": None,
        "tested_by": identifier,
        "recorder": recorder,
        "is_current": True,
        "workflow_stage": "READY",
        "primary_task": "VIEW_ANALYSIS",
        "available_actions": [],
        "created_at": timestamp,
    }
    assert LegacyGeoObservationOut.model_validate(legacy_payload).model_dump(mode="json") == (
        LegacyGeoObservation.model_validate(legacy_payload).model_dump(mode="json")
    )
    assert ManualGeoObservationOut.model_validate(manual_payload).model_dump(mode="json") == (
        ManualGeoObservation.model_validate(manual_payload).model_dump(mode="json")
    )

    failures = compare_response_contracts(
        _success_wave_projection(contract, GEO_SUCCESS_OPERATION_IDS),
        _success_wave_projection(runtime, GEO_SUCCESS_OPERATION_IDS),
    )
    assert failures == []


@pytest.mark.parametrize("operation_id", WAVE_2_OPERATION_IDS)
def test_wave_2_error_statuses_use_project_error_envelope(
    operation_id: str, wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    _, runtime = wave_operations
    expected_statuses = WAVE_2_EXPECTED_STATUSES[operation_id]
    responses = runtime[operation_id]["responses"]
    error_statuses = expected_statuses - {"200", "201", "202", "204"}
    for status_code in error_statuses:
        assert responses[status_code]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorEnvelope"
        }
    if operation_id == "listQueryTopics":
        assert "422" not in responses
        assert "4XX" not in responses
        assert "default" not in responses
    else:
        assert responses["422"]["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorEnvelope"
        }


def test_wave_2_success_occurrences_and_response_boundaries(
    wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    _, runtime = wave_operations
    success_occurrences = {
        status_code: sum(
            status_code in WAVE_2_EXPECTED_STATUSES[operation_id]
            for operation_id in WAVE_2_OPERATION_IDS
        )
        for status_code in ("200", "201", "202", "204")
    }
    assert success_occurrences == {"200": 42, "201": 7, "202": 3, "204": 6}
    for operation_id in WAVE_2_OPERATION_IDS:
        responses = runtime[operation_id]["responses"]
        assert not {code for code in responses if code.startswith("5")}
        assert all("headers" not in response for response in responses.values())
        if "204" in WAVE_2_EXPECTED_STATUSES[operation_id]:
            assert "content" not in responses["204"]


@pytest.mark.parametrize("operation_id", WAVE_1_OPERATION_IDS)
def test_error_statuses_use_project_error_envelope(
    operation_id: str, wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    contract, runtime = wave_operations
    expected_statuses = set(contract[operation_id]["responses"])
    responses = runtime[operation_id]["responses"]
    if "422" in expected_statuses:
        schema = responses["422"]["content"]["application/json"]["schema"]
        assert schema == {"$ref": "#/components/schemas/ErrorEnvelope"}
    else:
        assert "422" not in responses
    for status_code, response in responses.items():
        if status_code not in {"401", "403", "404", "409", "422", "502", "503", "504"}:
            continue
        assert response["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorEnvelope"
        }


def test_error_envelope_schema_has_single_required_wire_shape() -> None:
    schemas = app.openapi()["components"]["schemas"]
    envelope = schemas["ErrorEnvelope"]
    detail = schemas["ErrorDetail"]
    assert envelope["required"] == ["error"]
    assert detail["required"] == ["code", "message", "details", "request_id"]
    assert detail["properties"]["details"]["default"] == {}


def test_health_special_errors_and_csv_metadata() -> None:
    operations = _operation_map(app.openapi())
    assert set(operations["getLiveHealth"]["responses"]) == {"200"}
    assert set(operations["getReadyHealth"]["responses"]) == {"200", "503"}
    assert set(operations["discoverAIChannelModels"]["responses"]) >= {"502", "504"}
    assert "503" in operations["createPlatformLogoCandidate"]["responses"]
    assert "503" in operations["completeFileUpload"]["responses"]
    assert not {"502", "504"}.intersection(operations["testAIModel"]["responses"])
    for operation_id in ("exportUsers", "exportPlatformProfiles"):
        response = operations[operation_id]["responses"]["200"]
        assert set(response["content"]) == {"text/csv"}
        assert response["content"]["text/csv"]["schema"] == {"type": "string"}
        assert response["headers"]["Content-Disposition"] == {
            "required": True,
            "schema": {"type": "string"},
        }


def test_response_models_preserve_validation_and_serialization() -> None:
    from datetime import UTC, datetime
    from uuid import uuid4

    from app.schemas.common import AuditLogDetail
    from app.schemas.configuration import (
        PlatformLogoUpload,
        PlatformPromptDetail,
        PlatformPromptListItem,
    )

    identifier = uuid4()
    timestamp = datetime(2026, 9, 1, tzinfo=UTC)
    prompt_base = {
        "id": identifier,
        "name": "平台 Prompt",
        "revision": 1,
        "updated_at": timestamp,
        "updated_by": identifier,
        "bound_platform_count": 0,
        "available_actions": ["UPDATE"],
    }
    detail = PlatformPromptDetail.model_validate(
        {
            **prompt_base,
            "template_markdown": "# 内容",
            "created_at": timestamp,
            "bound_platforms": [],
        }
    )
    assert detail.model_dump(mode="json") == {
        **prompt_base,
        "id": str(identifier),
        "updated_at": timestamp.isoformat().replace("+00:00", "Z"),
        "updated_by": str(identifier),
        "template_markdown": "# 内容",
        "created_at": timestamp.isoformat().replace("+00:00", "Z"),
        "bound_platforms": [],
    }
    assert PlatformPromptListItem.model_validate(prompt_base).model_dump(mode="json")[
        "available_actions"
    ] == ["UPDATE"]
    logo = PlatformLogoUpload.model_validate(
        {"source": "UPLOAD", "file_id": identifier, "url": "https://example.com/logo.svg"}
    )
    assert logo.model_dump(mode="json") == {
        "source": "UPLOAD",
        "file_id": str(identifier),
        "url": "https://example.com/logo.svg",
    }

    audit = AuditLogDetail.model_validate(
        {
            "id": identifier,
            "actor_id": None,
            "actor": None,
            "business_module": "IDENTITY",
            "action": "user.updated",
            "target_type": "USER",
            "target_id": None,
            "outcome": "SUCCESS",
            "primary_task": "VIEW_LOG_DETAIL",
            "request_id": "request-1",
            "created_at": timestamp,
            "changes": [{"field": "status"}],
            "facts": {"status": "ENABLED"},
            "result_message": "已更新",
            "error_code": None,
            "related_entry": {"status": "AVAILABLE", "kind": None, "parent_id": None},
        }
    )
    assert audit.model_dump(mode="json")["id"] == str(identifier)
    with pytest.raises(ValueError):
        PlatformLogoUpload.model_validate(
            {
                "source": "UPLOAD",
                "file_id": identifier,
                "url": "https://example.com/logo.svg",
                "unexpected": True,
            }
        )


def test_response_models_use_default_flat_closed_schema() -> None:
    from app.schemas.configuration import (
        PlatformLogoUpload,
        PlatformPromptDetail,
        PlatformPromptListItem,
    )

    models = (PlatformLogoUpload, PlatformPromptListItem, PlatformPromptDetail)
    for model in models:
        standalone_schema = model.model_json_schema()
        assert "allOf" not in standalone_schema
        assert standalone_schema["type"] == "object"
        assert standalone_schema["additionalProperties"] is False
        assert set(standalone_schema["required"]) == set(standalone_schema["properties"])
