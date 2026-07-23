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
