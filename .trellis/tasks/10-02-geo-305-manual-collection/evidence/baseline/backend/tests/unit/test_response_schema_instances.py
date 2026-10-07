"""用真实 Pydantic 输出验证静态与运行时 response schema 的可满足性。"""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

from app.main import app
from app.schemas.common import AuditLogDetail
from app.schemas.configuration import (
    PlatformLogoUpload,
    PlatformPromptDetail,
    PlatformPromptListItem,
    PlatformPromptUpdate,
    QueryTopicListItem,
    QueryTopicOut,
)
from app.schemas.content import ContentTaskListItem, ContentTaskOut, GenerationJobDetail
from app.schemas.geo_files import (
    GeoInsightDecliningContent,
    GeoInsightLongUnmentionedContent,
    GeoInsightPublicationOption,
    GeoInsightRatePoint,
)
from app.schemas.publication import PlatformAccountOut
from app.tools.contract_check import compare_response_contracts

COMPONENT_MODELS: dict[str, tuple[type[Any], dict[str, Any]]] = {}
RUNTIME_COMPONENT_NAMES = {
    "QueryTopic": "QueryTopicOut",
    "ContentTask": "ContentTaskOut",
    "PlatformAccount": "PlatformAccountOut",
}


def _document() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _validator(document: dict[str, Any], side: str, component: str) -> Draft202012Validator:
    schema = {"$ref": f"urn:partsignal:{side}#/components/schemas/{component}"}
    resource = Resource.from_contents(document, default_specification=DRAFT202012)
    registry = Registry().with_resource(f"urn:partsignal:{side}", resource)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(
        schema,
        registry=registry,
        format_checker=FormatChecker(),
    )


def _base_values() -> dict[str, Any]:
    identifier = uuid4()
    timestamp = datetime(2026, 9, 1, tzinfo=UTC)
    return {"identifier": identifier, "timestamp": timestamp}


def _model_payloads() -> dict[str, tuple[type[Any], dict[str, Any]]]:
    values = _base_values()
    identifier: UUID = values["identifier"]
    timestamp: datetime = values["timestamp"]
    deletion = None
    rate = {"numerator": 1, "denominator": 2, "value": 0.5}
    task = {
        "product_id": identifier,
        "fact_version_id": identifier,
        "platform_profile_id": identifier,
        "id": identifier,
        "query_topic_id": None,
        "source_published_content_issue_id": None,
        "current_content_version_id": None,
        "workflow_stage": "NO_DRAFT",
        "primary_task": "CREATE_FIRST_DRAFT",
        "available_actions": ["CANCEL"],
        "deletion": deletion,
        "status": "OPEN",
        "revision": 1,
        "created_by": identifier,
        "created_at": timestamp,
        "archived_at": None,
    }
    generation_snapshot = {
        "adapter_name": "openai-compatible-chat-completions",
        "contract_version": "content-markdown-v3",
        "channel": {},
        "model": {},
        "platform_profile": {},
        "platform_prompt": {"id": identifier, "name": "Prompt", "revision": 1},
        "fact_version": {
            "id": identifier,
            "product_id": identifier,
            "version": 1,
            "classification": "PUBLIC",
        },
        "system_message": "system",
        "user_message": "user",
    }
    generation_job = {
        "id": identifier,
        "content_task_id": identifier,
        "job_type": "GENERATE",
        "source_content_version_id": None,
        "status": "PENDING",
        "workflow_stage": "IN_PROGRESS",
        "primary_task": "VIEW_EXECUTION_PROGRESS",
        "available_actions": ["RETRY"],
        "attempt_count": 1,
        "created_at": timestamp,
        "input_snapshot": generation_snapshot,
    }
    content_performance = {
        "published_article_id": identifier,
        "product_id": identifier,
        "content_platform_id": identifier,
        "title": "文章",
        "content_platform": "平台",
        "observation_count": 1,
        "discovery_rate": rate,
        "mention_rate": rate,
        "accuracy_rate": rate,
        "primary_task": "VIEW_CONTENT_PERFORMANCE",
        "optimization_action": None,
    }
    return {
        "AuditLogDetail": (
            AuditLogDetail,
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
            },
        ),
        "QueryTopic": (
            QueryTopicOut,
            {
                "canonical_question": "如何选择产品？",
                "intent_type": "PRODUCT",
                "variants": ["如何选择产品"],
                "id": identifier,
                "available_actions": ["UPDATE"],
                "deletion": deletion,
                "primary_task": "USE_FOR_OBSERVATION",
                "revision": 1,
                "created_at": timestamp,
            },
        ),
        "QueryTopicListItem": (
            QueryTopicListItem,
            {
                "canonical_question": "如何选择产品？",
                "intent_type": "PRODUCT",
                "variants": ["如何选择产品"],
                "id": identifier,
                "available_actions": ["UPDATE"],
                "deletion": deletion,
                "primary_task": "USE_FOR_OBSERVATION",
                "revision": 1,
                "created_at": timestamp,
                "references": {
                    "content_task_count": 0,
                    "geo_optimization_count": 0,
                    "observation_count": 0,
                },
            },
        ),
        "PlatformLogoUpload": (
            PlatformLogoUpload,
            {"source": "UPLOAD", "file_id": identifier, "url": "https://example.com/logo.svg"},
        ),
        "PlatformPromptUpdate": (
            PlatformPromptUpdate,
            {"name": "平台 Prompt", "template_markdown": "# 内容", "expected_revision": 1},
        ),
        "PlatformPromptListItem": (
            PlatformPromptListItem,
            {
                "id": identifier,
                "name": "平台 Prompt",
                "revision": 1,
                "updated_at": timestamp,
                "updated_by": identifier,
                "bound_platform_count": 0,
                "available_actions": ["UPDATE"],
            },
        ),
        "PlatformPromptDetail": (
            PlatformPromptDetail,
            {
                "id": identifier,
                "name": "平台 Prompt",
                "revision": 1,
                "updated_at": timestamp,
                "updated_by": identifier,
                "bound_platform_count": 0,
                "available_actions": ["UPDATE"],
                "template_markdown": "# 内容",
                "created_at": timestamp,
                "bound_platforms": [],
            },
        ),
        "ContentTask": (ContentTaskOut, task),
        "ContentTaskListItem": (
            ContentTaskListItem,
            {
                **task,
                "identifier": "CT-1234ABCD",
                "product": {"id": identifier, "brand": "品牌", "part_number": "型号"},
                "platform": {"id": identifier, "name": "平台", "website_url": None, "logo": None},
                "current_content": None,
                "latest_generation_status": None,
                "updated_at": timestamp,
            },
        ),
        "GenerationJobDetail": (GenerationJobDetail, generation_job),
        "PlatformAccount": (
            PlatformAccountOut,
            {
                "platform_profile_id": identifier,
                "label": "账号",
                "account_identifier": "account-1",
                "id": identifier,
                "is_active": True,
                "workflow_stage": "OPERATIONAL",
                "primary_task": "MANAGE_ACCOUNT",
                "available_actions": ["UPDATE"],
                "deletion": deletion,
                "revision": 1,
            },
        ),
        "GeoInsightPublicationOption": (
            GeoInsightPublicationOption,
            {"id": identifier, "label": "文章", "platform_name": "平台"},
        ),
        "GeoInsightRatePoint": (
            GeoInsightRatePoint,
            {**rate, "date": date(2026, 9, 1)},
        ),
        "GeoInsightDecliningContent": (
            GeoInsightDecliningContent,
            {
                **content_performance,
                "primary_task": "VIEW_CONTENT_PERFORMANCE",
                "basis": [
                    {
                        "metric": "mention_rate",
                        "current_value": 0.2,
                        "previous_value": 0.5,
                        "decline": 0.3,
                    }
                ],
            },
        ),
        "GeoInsightLongUnmentionedContent": (
            GeoInsightLongUnmentionedContent,
            {
                **content_performance,
                "unmentioned_days": 30,
                "last_mentioned_at": None,
            },
        ),
    }


COMPONENT_MODELS.update(_model_payloads())


def test_real_model_dumps_satisfy_static_and_runtime_components() -> None:
    static = _document()
    runtime = app.openapi()
    for component, (model, raw_payload) in COMPONENT_MODELS.items():
        payload = model.model_validate(raw_payload).model_dump(mode="json")
        for side, document in (("static", static), ("runtime", runtime)):
            runtime_component = RUNTIME_COMPONENT_NAMES.get(component, component)
            schema_component = component if side == "static" else runtime_component
            errors = list(_validator(document, side, schema_component).iter_errors(payload))
            assert errors == [], f"{side} {component}: {[error.message for error in errors]}"


def test_closed_components_reject_unknown_fields_on_both_documents() -> None:
    static = _document()
    runtime = app.openapi()
    for component, (model, raw_payload) in COMPONENT_MODELS.items():
        payload = model.model_validate(raw_payload).model_dump(mode="json")
        payload["__unexpected"] = True
        for side, document in (("static", static), ("runtime", runtime)):
            runtime_component = RUNTIME_COMPONENT_NAMES.get(component, component)
            schema_component = component if side == "static" else runtime_component
            errors = list(_validator(document, side, schema_component).iter_errors(payload))
            assert errors, f"{side} {component} unexpectedly accepted an unknown field"


RESPONSE_OPERATION_IDS = (
    "getAuditLog",
    "listQueryTopics",
    "createQueryTopic",
    "listQueryTopicItems",
    "updateQueryTopic",
    "listPlatformProfiles",
    "createPlatformProfile",
    "getPlatformProfile",
    "updatePlatformProfile",
    "enablePlatformProfile",
    "disablePlatformProfile",
    "listPlatformPrompts",
    "createPlatformPrompt",
    "getPlatformPrompt",
    "updatePlatformPrompt",
    "listContentTasks",
    "createContentTask",
    "getContentTask",
    "getContentTaskDetail",
    "getContentEditorContext",
    "getContentTaskReviewContext",
    "cancelContentTask",
    "archiveContentTask",
    "restoreContentTask",
    "getGenerationJob",
    "getContentReviewContext",
    "listPublicationReadyItems",
    "listPlatformAccounts",
    "createPlatformAccount",
    "updatePlatformAccount",
    "enablePlatformAccount",
    "disablePlatformAccount",
    "getPublishedContentIssueWorkspaceContext",
    "getPublishedContentRepairContext",
    "createPublishedContentRepairTask",
    "getGeoInsights",
    "createGeoOptimizationContentTask",
)


def _success_projection(document: dict[str, Any]) -> dict[str, Any]:
    projection = deepcopy(document)
    projection["paths"] = {}
    for path, item in document["paths"].items():
        projected_item = deepcopy(item)
        found = False
        for method, operation in list(item.items()):
            if method not in {"get", "post", "put", "patch", "delete"}:
                projected_item.pop(method, None)
                continue
            if operation.get("operationId") not in RESPONSE_OPERATION_IDS:
                projected_item.pop(method, None)
                continue
            found = True
            projected_item[method]["responses"] = {
                status: response
                for status, response in operation["responses"].items()
                if str(status).startswith("2")
            }
        if found:
            projection["paths"][path] = projected_item
    return projection


def test_affected_success_responses_match_without_filters() -> None:
    static = _document()
    runtime = app.openapi()
    expected_operation_counts = Counter(RESPONSE_OPERATION_IDS)
    for document in (static, runtime):
        operation_ids = [
            operation["operationId"]
            for item in document["paths"].values()
            for method, operation in item.items()
            if method in {"get", "post", "put", "patch", "delete"}
            and "operationId" in operation
        ]
        operation_counts = Counter(operation_ids)
        relevant_operation_counts = Counter(
            {
                operation_id: count
                for operation_id, count in operation_counts.items()
                if operation_id in expected_operation_counts
            }
        )
        assert relevant_operation_counts == expected_operation_counts
    assert (
        compare_response_contracts(_success_projection(static), _success_projection(runtime)) == []
    )
