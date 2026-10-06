"""不可变回答证据组件；不包含提交命令或分析分类。"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AfterValidator, Field, StringConstraints, field_validator, model_validator

from app.geo_citation_urls import normalize_citation_url
from app.schemas.base import ContractModel


def _nonblank(value: str) -> str:
    if not value.strip() or "\x00" in value:
        raise ValueError("原始文本必须非空且不能包含 NUL")
    return value


OriginalText = Annotated[
    str, StringConstraints(min_length=1, max_length=1048576), AfterValidator(_nonblank)
]
Position = Annotated[int, Field(strict=True, ge=1, le=1000)]


class GeoRawPayloadSummary(ContractModel):
    """只允许结构事实；不接收 Header、正文、凭据或任意 provider 字符串。"""

    schema_version: Literal[1] = 1
    payload_format: Literal["JSON", "TEXT", "DOM"] | None = None
    payload_bytes: int | None = Field(default=None, strict=True, ge=0, le=52428800)
    finish_reason: Literal["STOP", "LENGTH", "CONTENT_FILTER", "OTHER"] | None = None


class GeoAnswerCitationInput(ContractModel):
    original_url: str = Field(min_length=1, max_length=2083)
    position: Position
    title: str | None = Field(default=None, max_length=2000)
    extraction_source: Literal["STRUCTURED", "DOM", "TEXT", "MANUAL"]

    @field_validator("original_url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        return normalize_citation_url(value).original_url


class GeoAnswerCitationOut(GeoAnswerCitationInput):
    id: UUID
    answer_snapshot_id: UUID
    normalized_url: str = Field(min_length=1, max_length=2083)
    hostname: str = Field(min_length=1, max_length=253)
    occurrences: list[Position] = Field(min_length=1, max_length=1000)
    created_at: datetime

    @model_validator(mode="after")
    def canonical_identity(self) -> GeoAnswerCitationOut:
        normalized = normalize_citation_url(self.original_url)
        if (normalized.normalized_url, normalized.hostname) != (self.normalized_url, self.hostname):
            raise ValueError("引用规范身份必须与原 URL 一致")
        if (
            self.occurrences != sorted(set(self.occurrences))
            or self.position != self.occurrences[0]
        ):
            raise ValueError("引用位置必须唯一递增并保留首次位置")
        return self


class GeoAnswerSnapshotOut(ContractModel):
    id: UUID
    run_id: UUID
    prompt_text: OriginalText
    answer_text: OriginalText
    answer_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    answer_format: Literal["TEXT", "MARKDOWN", "HTML_TEXT"]
    source_product: str | None = Field(max_length=160)
    source_model: str | None = Field(max_length=200)
    source_version: str | None = Field(max_length=200)
    web_search_observed: bool | None
    raw_payload_summary: GeoRawPayloadSummary
    raw_payload_file_id: UUID | None
    screenshot_file_id: UUID | None
    citation_count: int = Field(ge=0, le=1000)
    collected_at: datetime
    created_at: datetime

    @model_validator(mode="after")
    def original_digest(self) -> GeoAnswerSnapshotOut:
        if self.answer_sha256 != hashlib.sha256(self.answer_text.encode("utf-8")).hexdigest():
            raise ValueError("回答哈希与原始 UTF-8 正文不一致")
        return self
