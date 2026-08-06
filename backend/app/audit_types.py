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
        "product.deleted",
        "fact_version.deleted",
        "content_task.deleted",
        "content_task.permanently_deleted",
        "query_topic.deleted",
        "platform_type.deleted",
        "platform_profile.deleted",
        "platform_account.deleted",
        "geo_observation.deleted",
    }
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
