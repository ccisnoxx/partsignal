"""管理员显式评估的请求范围及冻结回执。"""

from datetime import UTC, timedelta
from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_insights import Identities
from app.schemas.geo_surfaces import GeoCollectionMode


class GeoOpportunityEvaluationRequest(ContractModel):
    scope: Literal["ALL", "FILTERED"]
    date_from: AwareDatetime
    date_to: AwareDatetime
    rule_set_revision: int = Field(ge=1)
    subject_ids: Identities = Field(default_factory=list)
    engine_surface_ids: Identities = Field(default_factory=list)
    collection_profile_ids: Identities = Field(default_factory=list)
    collection_modes: list[GeoCollectionMode] = Field(default_factory=list, max_length=3)

    @model_validator(mode="after")
    def explicit_scope(self) -> Self:
        self.date_from = self.date_from.astimezone(UTC)
        self.date_to = self.date_to.astimezone(UTC)
        if not timedelta(0) < self.date_to - self.date_from <= timedelta(days=31):
            raise ValueError("评估窗口必须满足 date_from < date_to 且不超过31天")
        for field in (
            "subject_ids",
            "engine_surface_ids",
            "collection_profile_ids",
            "collection_modes",
        ):
            setattr(self, field, sorted(set(getattr(self, field))))
        filtered = bool(self.subject_ids or self.engine_surface_ids or self.collection_profile_ids)
        if filtered != (self.scope == "FILTERED"):
            raise ValueError(
                "ALL 不允许对象过滤；FILTERED 至少指定 Subject/Surface/Profile 一类过滤"
            )
        return self


class GeoOpportunityUnavailableReason(ContractModel):
    code: str
    count: int = Field(ge=1)


class GeoOpportunityEvaluationReceipt(ContractModel):
    evaluation_run_id: UUID
    rule_set_revision: int = Field(ge=1)
    evaluated_cells: int = Field(ge=0)
    created: int = Field(ge=0)
    existing_reused: int = Field(ge=0)
    skipped: int = Field(ge=0)
    unavailable_reasons: list[GeoOpportunityUnavailableReason]
    as_of: AwareDatetime
    replayed: bool
