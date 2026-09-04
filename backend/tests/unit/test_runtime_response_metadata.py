"""Wave 1/2/3 路由运行时 response metadata 与冻结合同的逐操作校验。"""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.exceptions import RequestValidationError
from fastapi.openapi.utils import get_openapi
from sqlalchemy.exc import IntegrityError

import app.main as main_module
from app.errors import AppError
from app.main import (
    REQUEST_ID_HEADER_NAME,
    REQUEST_ID_MAX_LENGTH,
    REQUEST_ID_MIN_LENGTH,
    REQUEST_ID_PATTERN,
    app,
)
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

WAVE_3_OPERATION_IDS = (
    "getPublicationPackage",
    "listPublicationReadyItems",
    "getPublicationWorkbenchSummary",
    "listPlatformAccounts",
    "createPlatformAccount",
    "updatePlatformAccount",
    "enablePlatformAccount",
    "disablePlatformAccount",
    "deletePlatformAccount",
    "createPublicationWork",
    "listPublicationWorks",
    "getPublicationWork",
    "getPublicationWorkspaceContext",
    "updatePublicationPreparation",
    "markPublicationPlatformReview",
    "registerPublicationResult",
    "switchPublicationContentVersion",
    "verifyPublicationWork",
    "closePublicationWork",
    "listPublishedArticles",
    "getPublishedArticle",
    "previewPublishedArticlePermanentDeletion",
    "permanentlyDeletePublishedArticle",
    "openPublishedContentIssue",
    "listPublishedContentIssues",
    "getPublishedContentIssue",
    "getPublishedContentIssueWorkspaceContext",
    "getPublishedContentRepairContext",
    "createPublishedContentRepairTask",
    "resolvePublishedContentIssue",
    "listGeoObservations",
    "listGeoObservationItems",
    "getGeoObservation",
    "getGeoObservationDetail",
    "getGeoObservationCorrectionContext",
    "deleteGeoObservation",
    "listGeoObservationPublications",
    "createGeoObservation",
    "getGeoMetrics",
    "getGeoInsights",
    "createGeoOptimizationContentTask",
    "getDashboardSummary",
    "getWorkbench",
)

WAVE_3_GROUPS = {
    "publication": {
        "getPublicationPackage",
        "listPublicationReadyItems",
        "getPublicationWorkbenchSummary",
        "listPlatformAccounts",
        "createPlatformAccount",
        "updatePlatformAccount",
        "enablePlatformAccount",
        "disablePlatformAccount",
        "deletePlatformAccount",
        "createPublicationWork",
        "listPublicationWorks",
        "getPublicationWork",
        "getPublicationWorkspaceContext",
        "updatePublicationPreparation",
        "markPublicationPlatformReview",
        "registerPublicationResult",
        "switchPublicationContentVersion",
        "verifyPublicationWork",
        "closePublicationWork",
        "listPublishedArticles",
        "getPublishedArticle",
        "previewPublishedArticlePermanentDeletion",
        "permanentlyDeletePublishedArticle",
        "openPublishedContentIssue",
        "listPublishedContentIssues",
        "getPublishedContentIssue",
        "getPublishedContentIssueWorkspaceContext",
        "getPublishedContentRepairContext",
        "createPublishedContentRepairTask",
        "resolvePublishedContentIssue",
    },
    "observation": {
        "listGeoObservations",
        "listGeoObservationItems",
        "getGeoObservation",
        "getGeoObservationDetail",
        "getGeoObservationCorrectionContext",
        "deleteGeoObservation",
        "listGeoObservationPublications",
        "createGeoObservation",
        "getGeoMetrics",
        "getGeoInsights",
        "createGeoOptimizationContentTask",
        "getDashboardSummary",
    },
    "workbench": {"getWorkbench"},
}

WAVE_3_EXPECTED_STATUSES = {
    "getPublicationPackage": {"200", "401", "403", "404", "409", "422"},
    "listPublicationReadyItems": {"200", "401", "403"},
    "getPublicationWorkbenchSummary": {"200", "401", "403"},
    "listPlatformAccounts": {"200", "401", "403", "422"},
    "createPlatformAccount": {"201", "401", "403", "404", "409", "422"},
    "updatePlatformAccount": {"200", "401", "403", "404", "409", "422"},
    "enablePlatformAccount": {"200", "401", "403", "404", "409", "422"},
    "disablePlatformAccount": {"200", "401", "403", "404", "409", "422"},
    "deletePlatformAccount": {"204", "401", "403", "404", "409", "422"},
    "createPublicationWork": {"201", "401", "403", "404", "409", "422"},
    "listPublicationWorks": {"200", "401", "403", "409", "422"},
    "getPublicationWork": {"200", "401", "403", "404", "409", "422"},
    "getPublicationWorkspaceContext": {"200", "401", "403", "404", "409", "422"},
    "updatePublicationPreparation": {"200", "401", "403", "404", "409", "422"},
    "markPublicationPlatformReview": {"200", "401", "403", "404", "409", "422"},
    "registerPublicationResult": {"200", "401", "403", "404", "409", "422"},
    "switchPublicationContentVersion": {"200", "401", "403", "404", "409", "422"},
    "verifyPublicationWork": {"200", "401", "403", "404", "409", "422"},
    "closePublicationWork": {"200", "401", "403", "404", "409", "422"},
    "listPublishedArticles": {"200", "401", "403", "409", "422"},
    "getPublishedArticle": {"200", "401", "403", "404", "409", "422"},
    "previewPublishedArticlePermanentDeletion": {
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
    },
    "permanentlyDeletePublishedArticle": {"204", "401", "403", "404", "409", "422"},
    "openPublishedContentIssue": {"201", "401", "403", "404", "409", "422"},
    "listPublishedContentIssues": {"200", "401", "403", "409", "422"},
    "getPublishedContentIssue": {"200", "401", "403", "404", "409", "422"},
    "getPublishedContentIssueWorkspaceContext": {
        "200",
        "401",
        "403",
        "404",
        "409",
        "422",
    },
    "getPublishedContentRepairContext": {"200", "401", "403", "404", "409", "422"},
    "createPublishedContentRepairTask": {"201", "401", "403", "404", "409", "422"},
    "resolvePublishedContentIssue": {"200", "401", "403", "404", "409", "422"},
    "listGeoObservations": {"200", "401", "403", "409", "422"},
    "listGeoObservationItems": {"200", "401", "403", "409", "422"},
    "getGeoObservation": {"200", "401", "403", "404", "409", "422"},
    "getGeoObservationDetail": {"200", "401", "403", "404", "409", "422"},
    "getGeoObservationCorrectionContext": {"200", "401", "403", "404", "409", "422"},
    "deleteGeoObservation": {"204", "401", "403", "404", "409", "422"},
    "listGeoObservationPublications": {"200", "401", "403", "404", "422"},
    "createGeoObservation": {"201", "401", "403", "404", "409", "422"},
    "getGeoMetrics": {"200", "401", "403", "422"},
    "getGeoInsights": {"200", "401", "403", "404", "409", "422"},
    "createGeoOptimizationContentTask": {"201", "401", "403", "404", "409", "422"},
    "getDashboardSummary": {"200", "401", "403"},
    "getWorkbench": {"200", "401", "403", "409"},
}

GEO_SUCCESS_OPERATION_IDS = (
    "listGeoObservations",
    "createGeoObservation",
    "getGeoObservation",
    "getGeoObservationDetail",
    "getGeoObservationCorrectionContext",
)

# Phase X 为所有既有波次追加同一个跨切面 400；业务错误状态集合本身不变。
for _expected_statuses in (*WAVE_2_EXPECTED_STATUSES.values(), *WAVE_3_EXPECTED_STATUSES.values()):
    _expected_statuses.add("400")


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


def _resolved_response(document: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    reference = response.get("$ref")
    if not isinstance(reference, str):
        return response
    prefix = "#/components/"
    assert reference.startswith(prefix)
    section, name = reference[len(prefix) :].split("/", maxsplit=1)
    resolved = document["components"][section][name]
    assert isinstance(resolved, dict)
    return resolved


def _resolved_runtime_response(response: dict[str, Any]) -> dict[str, Any]:
    """使用完整 runtime document 解析 operation projection 中的 response ref。"""
    return _resolved_response(app.openapi(), response)


def _strip_request_context_metadata(document: dict[str, Any]) -> dict[str, Any]:
    """移除 Phase X 字段，以证明 custom builder 不改动原 route metadata。"""
    stripped = deepcopy(document)
    for path_item in stripped["paths"].values():
        for operation in path_item.values():
            if not isinstance(operation, dict) or "operationId" not in operation:
                continue
            original_parameters = operation.get("parameters")
            operation["parameters"] = [
                parameter
                for parameter in original_parameters or []
                if not (
                    isinstance(parameter, dict)
                    and parameter.get("$ref")
                    == "#/components/parameters/RequestIdHeader"
                )
            ]
            if not operation["parameters"]:
                operation.pop("parameters")
            operation["responses"].pop("400", None)
            for response in operation["responses"].values():
                resolved = _resolved_response(stripped, response)
                headers = resolved.get("headers", {})
                if isinstance(headers, dict):
                    headers.pop(REQUEST_ID_HEADER_NAME, None)
                    if not headers:
                        resolved.pop("headers", None)
    return stripped


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


def test_runtime_request_context_covers_all_operations_and_responses() -> None:
    runtime = app.openapi()
    operations = _operation_map(runtime)

    assert len(operations) == 162
    assert len(set(operations)) == 162
    assert sum(len(operation["responses"]) for operation in operations.values()) == 1023
    parameter_ref = {"$ref": "#/components/parameters/RequestIdHeader"}
    header_ref = {"$ref": "#/components/headers/RequestIdResponseHeader"}
    parameter_schema = {
        "type": "string",
        "minLength": REQUEST_ID_MIN_LENGTH,
        "maxLength": REQUEST_ID_MAX_LENGTH,
        "pattern": REQUEST_ID_PATTERN,
    }
    assert runtime["components"]["parameters"]["RequestIdHeader"] == {
        "name": REQUEST_ID_HEADER_NAME,
        "in": "header",
        "required": False,
        "schema": parameter_schema,
    }
    assert runtime["components"]["responses"]["ErrorResponse"] == {
        "description": "业务或校验错误",
        "headers": {REQUEST_ID_HEADER_NAME: header_ref},
        "content": {
            "application/json": {
                "schema": {"$ref": "#/components/schemas/ErrorEnvelope"}
            }
        },
    }
    for operation in operations.values():
        assert sum(parameter == parameter_ref for parameter in operation["parameters"]) == 1
        assert operation["responses"]["400"] == {
            "$ref": "#/components/responses/ErrorResponse"
        }
        assert "default" not in operation["responses"]
        assert "4XX" not in operation["responses"]
        for response in operation["responses"].values():
            resolved = _resolved_response(runtime, response)
            assert resolved["headers"][REQUEST_ID_HEADER_NAME] == header_ref
    assert runtime["components"]["headers"]["RequestIdResponseHeader"] == {
        "required": True,
        "schema": parameter_schema,
    }


def test_runtime_request_context_merge_does_not_change_route_metadata() -> None:
    raw = get_openapi(title=app.title, version=app.version, routes=app.routes)
    augmented = app.openapi()
    stripped = _strip_request_context_metadata(augmented)

    assert sum(len(operation["responses"]) for operation in _operation_map(raw).values()) == 861
    assert sum(
        len(operation["responses"]) for operation in _operation_map(stripped).values()
    ) == 861
    assert compare_response_contracts(raw, stripped) == []
    assert _operation_map(raw) == _operation_map(stripped)


def test_custom_openapi_does_not_cache_document_when_metadata_merge_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """merge 失败前不得发布 raw 或 partial OpenAPI document。"""
    cached_schema = app.openapi_schema
    app.openapi_schema = None

    def reject_merge(document: dict[str, Any]) -> None:
        assert document["paths"]
        assert app.openapi_schema is None
        raise RuntimeError("metadata conflict")

    monkeypatch.setattr(main_module, "_merge_request_context_metadata", reject_merge)
    try:
        with pytest.raises(RuntimeError, match="metadata conflict"):
            main_module._custom_openapi()
        assert app.openapi_schema is None
    finally:
        app.openapi_schema = cached_schema


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


def test_wave_3_inventory_is_complete_and_disjoint(
    wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    contract, runtime = wave_operations
    assert len(WAVE_3_OPERATION_IDS) == 43
    assert len(set(WAVE_3_OPERATION_IDS)) == 43
    assert {name: len(ids) for name, ids in WAVE_3_GROUPS.items()} == {
        "publication": 30,
        "observation": 12,
        "workbench": 1,
    }
    assert set().union(*WAVE_3_GROUPS.values()) == set(WAVE_3_OPERATION_IDS)
    assert set(WAVE_3_EXPECTED_STATUSES) == set(WAVE_3_OPERATION_IDS)
    all_wave_ids = (
        set(WAVE_1_OPERATION_IDS) | set(WAVE_2_OPERATION_IDS) | set(WAVE_3_OPERATION_IDS)
    )
    assert len(all_wave_ids) == 162
    assert not set(WAVE_1_OPERATION_IDS) & set(WAVE_2_OPERATION_IDS)
    assert not set(WAVE_1_OPERATION_IDS) & set(WAVE_3_OPERATION_IDS)
    assert not set(WAVE_2_OPERATION_IDS) & set(WAVE_3_OPERATION_IDS)
    assert set(WAVE_3_OPERATION_IDS) <= set(contract)
    assert set(WAVE_3_OPERATION_IDS) <= set(runtime)


@pytest.mark.parametrize("operation_id", WAVE_3_OPERATION_IDS)
def test_each_wave_3_operation_has_explicit_expected_response_statuses(
    operation_id: str, wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    contract, runtime = wave_operations
    expected = WAVE_3_EXPECTED_STATUSES[operation_id]
    assert set(contract[operation_id]["responses"]) == expected
    assert set(runtime[operation_id]["responses"]) == expected


def test_wave_3_response_comparator_has_no_differences() -> None:
    failures = compare_response_contracts(
        _wave_projection(_contract_document(), WAVE_3_OPERATION_IDS),
        _wave_projection(app.openapi(), WAVE_3_OPERATION_IDS),
    )
    assert failures == []


@pytest.mark.parametrize("operation_id", WAVE_3_OPERATION_IDS)
def test_wave_3_error_responses_use_project_error_envelope(
    operation_id: str, wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    _, runtime = wave_operations
    expected_statuses = WAVE_3_EXPECTED_STATUSES[operation_id]
    responses = runtime[operation_id]["responses"]
    error_statuses = expected_statuses - {"200", "201", "202", "204"}
    for status_code in error_statuses:
        assert _resolved_runtime_response(responses[status_code])["content"][
            "application/json"
        ]["schema"] == {
            "$ref": "#/components/schemas/ErrorEnvelope"
        }
    assert not {code for code in responses if code.startswith("5")}
    assert "4XX" not in responses
    assert "default" not in responses
    if "422" not in expected_statuses:
        assert "422" not in responses


def test_wave_3_success_occurrences_and_response_boundaries(
    wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    _, runtime = wave_operations
    assert {
        operation_id
        for operation_id in WAVE_3_OPERATION_IDS
        if "422" not in WAVE_3_EXPECTED_STATUSES[operation_id]
    } == {
        "listPublicationReadyItems",
        "getPublicationWorkbenchSummary",
        "getDashboardSummary",
        "getWorkbench",
    }
    success_occurrences = {
        status_code: sum(
            status_code in WAVE_3_EXPECTED_STATUSES[operation_id]
            for operation_id in WAVE_3_OPERATION_IDS
        )
        for status_code in ("200", "201", "204")
    }
    assert success_occurrences == {"200": 34, "201": 6, "204": 3}
    error_occurrences = {
        status_code: sum(
            status_code in WAVE_3_EXPECTED_STATUSES[operation_id]
            for operation_id in WAVE_3_OPERATION_IDS
        )
        for status_code in ("401", "403", "404", "409", "422")
    }
    assert error_occurrences == {"401": 43, "403": 43, "404": 32, "409": 37, "422": 39}
    for operation_id in WAVE_3_OPERATION_IDS:
        responses = runtime[operation_id]["responses"]
        assert all(
            REQUEST_ID_HEADER_NAME in _resolved_runtime_response(response).get("headers", {})
            for response in responses.values()
        )
        for status_code in ("200", "201"):
            if status_code in responses:
                assert set(responses[status_code]["content"]) == {"application/json"}
        if "204" in responses:
            assert "content" not in responses["204"]


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
        assert _resolved_runtime_response(responses[status_code])["content"][
            "application/json"
        ]["schema"] == {
            "$ref": "#/components/schemas/ErrorEnvelope"
        }
    if operation_id == "listQueryTopics":
        assert "422" not in responses
        assert "4XX" not in responses
        assert "default" not in responses
    else:
        assert _resolved_runtime_response(responses["422"])["content"][
            "application/json"
        ]["schema"] == {
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
        assert all(
            REQUEST_ID_HEADER_NAME in _resolved_runtime_response(response).get("headers", {})
            for response in responses.values()
        )
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
        schema = _resolved_runtime_response(responses["422"])["content"][
            "application/json"
        ]["schema"]
        assert schema == {"$ref": "#/components/schemas/ErrorEnvelope"}
    else:
        assert "422" not in responses
    for status_code, response in responses.items():
        if status_code not in {"401", "403", "404", "409", "422", "502", "503", "504"}:
            continue
        assert _resolved_runtime_response(response)["content"]["application/json"]["schema"] == {
            "$ref": "#/components/schemas/ErrorEnvelope"
        }


def test_error_envelope_schema_has_single_required_wire_shape() -> None:
    schemas = app.openapi()["components"]["schemas"]
    envelope = schemas["ErrorEnvelope"]
    detail = schemas["ErrorDetail"]
    assert envelope["required"] == ["error"]
    assert detail["required"] == ["code", "message", "details", "request_id"]
    assert detail["properties"]["details"]["default"] == {}


def test_app_exception_handlers_keep_known_boundaries_without_global_integrity_mapping() -> None:
    """未知数据库约束不应被应用级 handler 伪装成 revision 冲突。"""
    assert AppError in app.exception_handlers
    assert RequestValidationError in app.exception_handlers
    assert IntegrityError not in app.exception_handlers


def test_health_special_errors_and_csv_metadata() -> None:
    operations = _operation_map(app.openapi())
    assert set(operations["getLiveHealth"]["responses"]) == {"200", "400"}
    assert set(operations["getReadyHealth"]["responses"]) == {"200", "400", "503"}
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
        assert response["headers"][REQUEST_ID_HEADER_NAME] == {
            "$ref": "#/components/headers/RequestIdResponseHeader"
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
