"""审计写入的强类型业务契约。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class AuditModule(StrEnum):
    """审计工作台使用的业务模块。"""

    IDENTITY = "IDENTITY"
    PRODUCT_FACTS = "PRODUCT_FACTS"
    CONTENT_PLANNING = "CONTENT_PLANNING"
    CONTENT_PRODUCTION = "CONTENT_PRODUCTION"
    CONTENT_REVIEW = "CONTENT_REVIEW"
    PUBLICATION = "PUBLICATION"
    GEO_OBSERVATION = "GEO_OBSERVATION"
    CONFIGURATION = "CONFIGURATION"
    FILE_MANAGEMENT = "FILE_MANAGEMENT"


class AuditOutcome(StrEnum):
    """一次业务命令的真实执行结果。"""

    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    DENIED = "DENIED"


RETAINED_AUDIT_ACTIONS = frozenset(
    {
        "user.created",
        "user.updated",
        "user.deleted",
        "user.exported",
        "user.password_changed",
        "user.password_reset",
        "ai_channel.created",
        "ai_channel.updated",
        "ai_channel.deleted",
        "ai_channel.api_key_replaced",
        "ai_channel.enabled",
        "ai_channel.disabled",
        "ai_channel_header.created",
        "ai_channel_header.updated",
        "ai_channel_header.deleted",
        "ai_model.created",
        "ai_model.updated",
        "ai_model.deleted",
        "ai_model.enabled",
        "ai_model.disabled",
        "platform_profile.enabled",
        "platform_profile.disabled",
        "platform_prompt.created",
        "platform_prompt.updated",
        "platform_prompt.deleted",
        "content_humanization_prompt.saved",
        "fact_version.approve",
        "content_version.approve",
        "content_version.deleted",
        "publication_work.completed",
        "published_article.permanently_deleted",
        "product.created",
        "product.updated",
        "product.deleted",
        "fact_version.deleted",
        "content_task.deleted",
        "content_task.permanently_deleted",
        "query_topic.created",
        "query_topic.updated",
        "query_topic.deleted",
        "platform_type.deleted",
        "platform_profile.deleted",
        "platform_account.deleted",
        "geo_observation.deleted",
    }
)

type AuditSafeScalar = str | int | float | bool | None
type AuditSafeValue = AuditSafeScalar | list[AuditSafeScalar]

AUDIT_FACT_KEYS: dict[AuditModule, frozenset[str]] = {
    AuditModule.IDENTITY: frozenset(
        {"account_type", "is_active", "source", "status", "row_count", "revision"}
    ),
    AuditModule.PRODUCT_FACTS: frozenset(
        {"product_id", "review_record_count", "revision", "status", "version"}
    ),
    AuditModule.CONTENT_PLANNING: frozenset(
        {
            "content_review_record_count",
            "content_version_count",
            "fact_version_id",
            "generation_job_count",
            "platform_profile_id",
            "platform_profile_version_id",
            "platform_type_id",
            "previous_active_version_id",
            "publication_work_count",
            "reason",
            "replacement_version_id",
            "revision",
            "status",
            "version",
        }
    ),
    AuditModule.CONTENT_PRODUCTION: frozenset(
        {
            "based_on_id",
            "content_version_id",
            "retry_of_id",
            "source_content_version_id",
            "task_id",
            "version",
        }
    ),
    AuditModule.CONTENT_REVIEW: frozenset({"revision", "status"}),
    AuditModule.PUBLICATION: frozenset(
        {
            "attachment_count",
            "content_version_id",
            "fact_version_id",
            "platform_profile_id",
            "platform_profile_version_id",
            "publication_id",
            "publication_reference_count",
            "repair_task_id",
            "revision",
            "status",
            "status_event_count",
            "task_id",
            "trigger_status",
        }
    ),
    AuditModule.GEO_OBSERVATION: frozenset(
        {
            "article_count",
            "article_result_count",
            "attachment_count",
            "observation_count",
            "product_id",
            "publication_count",
            "query_topic_id",
            "root_observation_id",
            "supersedes_id",
        }
    ),
    AuditModule.CONFIGURATION: frozenset(
        {
            "account_count",
            "allowed_domain_count",
            "bound_platform_count",
            "bound_platform_ids",
            "channel_id",
            "configured",
            "header_name",
            "is_active",
            "is_sensitive",
            "model_count",
            "platform_account_count",
            "platform_profile_id",
            "platform_type_id",
            "previous_active_version_id",
            "protocol_type",
            "provider_brand",
            "reason",
            "reference_count",
            "replacement_version_id",
            "revision",
            "status",
            "test_status",
            "unbound_platform_count",
            "version",
        }
    ),
    AuditModule.FILE_MANAGEMENT: frozenset({"access_level", "category", "size", "status"}),
}

AUDIT_CHANGE_FIELDS: dict[AuditModule, frozenset[str]] = {
    AuditModule.IDENTITY: frozenset({"account_type", "display_name", "is_active"}),
    AuditModule.PRODUCT_FACTS: frozenset({"status"}),
    AuditModule.CONTENT_PLANNING: frozenset(
        {"generation_data_classification", "generation_input_configured", "status"}
    ),
    AuditModule.CONTENT_PRODUCTION: frozenset(),
    AuditModule.CONTENT_REVIEW: frozenset({"status"}),
    AuditModule.PUBLICATION: frozenset({"is_active", "status"}),
    AuditModule.GEO_OBSERVATION: frozenset(),
    AuditModule.CONFIGURATION: frozenset(
        {
            "allowed_domain_count",
            "is_active",
            "is_configured",
            "logo_configured",
            "name",
            "platform_type_id",
            "revision",
            "status",
            "website_configured",
        }
    ),
    AuditModule.FILE_MANAGEMENT: frozenset({"status"}),
}


def is_audit_safe_value(value: Any) -> bool:
    """审计详情只允许标量或一层标量数组。"""
    if value is None or isinstance(value, str | int | float | bool):
        return True
    return isinstance(value, list) and all(
        item is None or isinstance(item, str | int | float | bool) for item in value
    )


@dataclass(frozen=True, slots=True)
class AuditEntry:
    """一次追加式审计写入所需的完整字段。"""

    actor_id: uuid.UUID
    business_module: AuditModule
    action: str
    target_type: str
    target_id: uuid.UUID | str | None
    request_id: str
    outcome: AuditOutcome
    result_message: str
    error_code: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
