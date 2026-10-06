"""回答级实时报告；公式与方法说明由服务端拥有。"""

from typing import Literal

from pydantic import AwareDatetime

from app.schemas.base import ContractModel
from app.schemas.geo_answer_insights import GeoAnswerInsights, InsightMetric
from app.schemas.geo_insights import GeoOverviewFilters, OverviewMetric

ExportKind = Literal["runs", "citations", "claims", "opportunities"]


class GeoReportFormula(ContractModel):
    metric_code: OverviewMetric | InsightMetric
    label: str
    formula_version: str
    numerator_description: str
    denominator_description: str


class GeoReportExport(ContractModel):
    kind: ExportKind
    available: bool
    unavailable_reason: Literal["NOT_IMPLEMENTED"] | None


class GeoReportPreview(ContractModel):
    as_of: AwareDatetime
    generated_at: AwareDatetime
    source_mode: Literal["LIVE"] = "LIVE"
    filters: GeoOverviewFilters
    available: bool
    unavailable_reason: Literal["NO_DATA", "NO_ELIGIBLE_RUNS"] | None
    insights: GeoAnswerInsights
    formulas: list[GeoReportFormula]
    method_notes: list[str]
    exports: list[GeoReportExport]
