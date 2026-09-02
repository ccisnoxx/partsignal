"""Wave 1 路由运行时 response metadata 与冻结合同的逐操作校验。"""

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


def _wave_projection(document: dict[str, Any]) -> dict[str, Any]:
    projected = deepcopy(document)
    projected["paths"] = {
        path: {
            method: operation
            for method, operation in path_item.items()
            if isinstance(operation, dict)
            and operation.get("operationId") in WAVE_1_OPERATION_IDS
        }
        for path, path_item in document["paths"].items()
        if any(
            isinstance(operation, dict)
            and operation.get("operationId") in WAVE_1_OPERATION_IDS
            for operation in path_item.values()
        )
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


@pytest.mark.parametrize("operation_id", WAVE_1_OPERATION_IDS)
def test_each_wave_operation_has_exact_frozen_response_statuses(
    operation_id: str, wave_operations: tuple[dict[str, Any], dict[str, Any]]
) -> None:
    contract, runtime = wave_operations
    assert set(runtime[operation_id]["responses"]) == set(contract[operation_id]["responses"])


def test_wave_response_comparator_has_no_differences() -> None:
    contract = _wave_projection(_contract_document())
    runtime = _wave_projection(app.openapi())
    failures = compare_response_contracts(contract, runtime)
    assert failures == []


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
