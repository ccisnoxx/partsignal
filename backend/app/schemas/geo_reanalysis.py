"""管理员重新分析的闭合原因与稳定接受回执，不表达计算已完成。"""

from enum import StrEnum
from uuid import UUID

from pydantic import Field

from app.schemas.base import ContractModel


class ReanalysisReason(StrEnum):
    RULES_UPDATED = "RULES_UPDATED"
    DICTIONARY_UPDATED = "DICTIONARY_UPDATED"
    FACTS_UPDATED = "FACTS_UPDATED"
    RETRY_FAILED = "RETRY_FAILED"


class GeoRunReanalysisRequest(ContractModel):
    expected_revision: int = Field(strict=True, ge=0)
    reason: ReanalysisReason


class GeoRunReanalysisAccepted(ContractModel):
    run_id: UUID
    analysis_revision_id: UUID
    request_id: str = Field(min_length=1, max_length=100, pattern=r"^[\x20-\x7E]+$")
