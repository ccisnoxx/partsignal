"""人工取消协议：运行与草稿双版本，原因仅进入受控历史。"""

from uuid import UUID

from pydantic import AwareDatetime, Field, field_validator

from app.schemas.base import ContractModel


class GeoManualRunCancelRequest(ContractModel):
    expected_revision: int = Field(strict=True, ge=0)
    expected_draft_revision: int = Field(strict=True, ge=0)
    reason: str = Field(strict=True, min_length=1, max_length=2000, pattern=r"^[^\x00]*$")

    @field_validator("reason")
    @classmethod
    def explicit_reason(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("取消原因不能为空")
        return value


class GeoManualRunCancellationOut(ContractModel):
    run_id: UUID
    cancelled_by: UUID
    cancelled_at: AwareDatetime
    reason: str = Field(min_length=1, max_length=2000)
    run_revision: int = Field(ge=1)
    draft_revision: int = Field(ge=0)
