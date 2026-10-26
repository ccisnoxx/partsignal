"""704行动协议：来源快照与三类命令，目标领域仍拥有业务资格。"""

from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, HttpUrl

from app.schemas.base import ContractModel
from app.schemas.geo_opportunities import (
    GeoOpportunitySourceSnapshot,
    GeoOpportunityTriggerSnapshot,
)
from app.schemas.publication import PublishedContentIssueKind, PublishedContentRepairContext


class GeoOpportunityActionSourceSnapshot(ContractModel):
    schema_version: Literal[1]
    opportunity_id: UUID
    opportunity_revision: int = Field(ge=1)
    trigger_snapshot: GeoOpportunityTriggerSnapshot
    sources: list[GeoOpportunitySourceSnapshot] = Field(min_length=1)
    product_id: UUID
    query_topic_id: UUID | None
    fact_version_id: UUID | None
    platform_profile_id: UUID | None
    published_article_id: UUID | None
    published_content_issue_id: UUID | None
    request_id: str = Field(min_length=1, max_length=100, pattern=r"^[\x20-\x7E]+$")


class GeoOpportunityFactRevisionRequest(ContractModel):
    expected_revision: int = Field(strict=True, ge=1)
    product_id: UUID


class GeoOpportunityFactRevisionProduct(ContractModel):
    product_id: UUID
    brand: str
    part_number: str


class GeoOpportunityFactRevisionOptions(ContractModel):
    opportunity_id: UUID
    opportunity_revision: int = Field(ge=1)
    available_action_types: list[Literal["FACT_REVISION"]]
    products: list[GeoOpportunityFactRevisionProduct]
    as_of: AwareDatetime


class GeoOpportunityContentTaskRequest(GeoOpportunityFactRevisionRequest):
    fact_version_id: UUID
    platform_profile_id: UUID


class GeoOpportunityOpenIssueRequest(ContractModel):
    mode: Literal["OPEN_ISSUE"]
    expected_revision: int = Field(strict=True, ge=1)
    published_article_id: UUID
    kind: PublishedContentIssueKind
    description: str = Field(
        min_length=1, max_length=2000, pattern=r"^[^\x00]*\S[^\x00]*$", strict=True
    )


class GeoOpportunityIssueRevisionRequest(ContractModel):
    expected_revision: int = Field(strict=True, ge=1)
    published_content_issue_id: UUID
    expected_issue_revision: int = Field(strict=True, ge=0)


class GeoOpportunityLinkIssueRequest(GeoOpportunityIssueRevisionRequest):
    mode: Literal["LINK_ISSUE"]


class GeoOpportunityCreateRepairRequest(GeoOpportunityIssueRevisionRequest):
    mode: Literal["CREATE_REPAIR"]
    fact_version_id: UUID


GeoOpportunityPublicationRepairRequest = Annotated[
    GeoOpportunityOpenIssueRequest
    | GeoOpportunityLinkIssueRequest
    | GeoOpportunityCreateRepairRequest,
    Field(discriminator="mode"),
]


class GeoOpportunityPublicationRepairMode(StrEnum):
    OPEN_ISSUE = "OPEN_ISSUE"
    LINK_ISSUE = "LINK_ISSUE"
    CREATE_REPAIR = "CREATE_REPAIR"


class GeoOpportunityPublicationRepairCandidate(ContractModel):
    published_article_id: UUID
    published_content_issue_id: UUID | None
    issue_revision: int | None = Field(ge=0)
    actual_title: str
    platform_profile_name: str
    final_url: HttpUrl
    available: bool
    unavailable_reason: str | None


class GeoOpportunityPublicationRepairOptions(ContractModel):
    opportunity_id: UUID
    opportunity_revision: int = Field(ge=1)
    available_action_types: list[Literal["PUBLICATION_REPAIR"]]
    mode: GeoOpportunityPublicationRepairMode
    candidates: list[GeoOpportunityPublicationRepairCandidate]
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=50)
    total: int = Field(ge=0)
    repair_context: PublishedContentRepairContext | None
    as_of: AwareDatetime
