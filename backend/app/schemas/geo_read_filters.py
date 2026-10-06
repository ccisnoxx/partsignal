"""冻结维度筛选；运行默认每cell最新attempt。"""

from typing import Annotated, Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BeforeValidator, Field, model_validator

from app.schemas.base import ContractModel
from app.schemas.geo_runs import GeoBatchStatus, GeoBatchTriggerType, GeoRunErrorCode, GeoRunStatus
from app.schemas.geo_surfaces import GeoCollectionMode


class GeoReadFilters(ContractModel):
    q: str | None = Field(default=None, max_length=200, pattern=r"^[^\x00]*$")
    created_from: AwareDatetime | None = None
    created_to: AwareDatetime | None = None
    sort: Literal["CREATED_DESC", "CREATED_ASC"] = "CREATED_DESC"
    page: int = Field(default=1, ge=1)
    page_size: Annotated[Literal[10, 20, 50], BeforeValidator(int)] = 20

    @model_validator(mode="after")
    def time_window(self) -> Self:
        if (
            self.created_from is not None
            and self.created_to is not None
            and self.created_from >= self.created_to
        ):
            raise ValueError("时间窗口必须满足 created_from < created_to")
        return self


class GeoBatchFilters(GeoReadFilters):
    plan_id: UUID | None = None
    subject_id: UUID | None = None
    status: GeoBatchStatus | None = None
    trigger_type: GeoBatchTriggerType | None = None


class GeoRunFilters(GeoReadFilters):
    plan_id: UUID | None = None
    subject_id: UUID | None = None
    product_id: UUID | None = None
    query_topic_id: UUID | None = None
    prompt_variant_id: UUID | None = None
    collection_profile_id: UUID | None = None
    engine_surface_id: UUID | None = None
    collection_mode: GeoCollectionMode | None = None
    status: GeoRunStatus | None = None
    error_code: GeoRunErrorCode | None = None
    needs_review: bool | None = None
    latest_only: bool = True


class GeoGlobalRunFilters(GeoRunFilters):
    batch_id: UUID | None = None
