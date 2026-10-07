"""显式采集重试命令与稳定的新尝试身份；不返回后续可变执行状态。"""

from uuid import UUID

from pydantic import AwareDatetime

from app.schemas.base import ContractModel
from app.schemas.geo_runs import NonNegative, Positive


class GeoRunRetryRequest(ContractModel):
    expected_revision: NonNegative


class GeoRunRetryCreated(ContractModel):
    run_id: UUID
    batch_id: UUID
    previous_attempt_id: UUID
    attempt_no: Positive
    created_at: AwareDatetime
