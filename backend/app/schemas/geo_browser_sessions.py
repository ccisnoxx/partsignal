"""浏览器会话管理合同；秘密仅接受写入，不进入公共投影。"""

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, SecretStr, field_serializer, field_validator

from app.schemas.base import ContractModel
from app.schemas.geo_prompt_variants import Revision


class GeoBrowserSessionImport(ContractModel):
    expected_revision: Revision
    storage_state: SecretStr = Field(
        min_length=1, max_length=131072, json_schema_extra={"writeOnly": True}
    )
    expires_at: AwareDatetime
    approved_account: Literal[True]

    @field_validator("approved_account", mode="before")
    @classmethod
    def explicit_approval(cls, value: object) -> object:
        if value is not True:
            raise ValueError("必须明确确认账号授权")
        return value


class GeoBrowserSessionCommand(ContractModel):
    expected_revision: Revision
    session_reference: UUID


class GeoBrowserSessionPurge(ContractModel):
    expected_revision: Revision


BrowserSessionHealth = Literal["AVAILABLE", "EXPIRED", "REVOKED", "MISSING", "UNREADABLE"]
BrowserSessionAction = Literal["IMPORT", "CHECK_HEALTH", "REVOKE", "PURGE"]


class GeoBrowserSessionMetadata(ContractModel):
    session_reference: UUID
    health: BrowserSessionHealth
    expires_at: datetime
    imported_at: datetime
    last_checked_at: datetime
    revoked_at: datetime | None
    purged_at: datetime | None


class GeoBrowserSessionContext(ContractModel):
    profile_id: UUID
    profile_revision: Revision
    session: GeoBrowserSessionMetadata | None
    cleanup_pending_count: int = Field(ge=0)
    available_actions: list[BrowserSessionAction]
    login_probe: Literal["NOT_IMPLEMENTED"]


class GeoBrowserSessionAccessRequest(ContractModel):
    profile_id: UUID


class GeoBrowserSessionEnvelope(ContractModel):
    session_reference: UUID
    profile_id: UUID
    expires_at: datetime = Field(
        json_schema_extra={"format": "date-time"},
        description="AAD绑定期限：UTC六位微秒，固定+00:00后缀",
    )
    envelope: Annotated[str, Field(min_length=1, max_length=262144, repr=False)]

    @field_serializer("expires_at")
    def binding_expiry(self, value: datetime) -> str:
        return value.astimezone(UTC).isoformat(timespec="microseconds")
