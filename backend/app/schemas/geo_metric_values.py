"""回答级指标与公共读模型共享的闭合样本/排除值与统计区间 DTO；公式仍由服务拥有。"""

from enum import StrEnum
from typing import Literal

from pydantic import Field

from app.schemas.base import ContractModel


class SampleLevel(StrEnum):
    NONE = "NONE"
    OBSERVED = "OBSERVED"
    REPORTABLE = "REPORTABLE"
    STABLE = "STABLE"


class MetricExclusion(StrEnum):
    RUN_NOT_COMPLETED = "RUN_NOT_COMPLETED"
    ANSWER_MISSING_OR_EMPTY = "ANSWER_MISSING_OR_EMPTY"
    CURRENT_ANALYSIS_UNAVAILABLE = "CURRENT_ANALYSIS_UNAVAILABLE"
    CURRENT_REVIEW_REQUIRED = "CURRENT_REVIEW_REQUIRED"
    INTEGRITY_ERROR = "INTEGRITY_ERROR"
    ADMINISTRATOR_EXCLUDED = "ADMINISTRATOR_EXCLUDED"
    SUPERSEDED_ATTEMPT = "SUPERSEDED_ATTEMPT"
    DIMENSION_MISMATCH = "DIMENSION_MISMATCH"
    SUBJECT_NOT_APPLICABLE = "SUBJECT_NOT_APPLICABLE"
    MENTION_MODE_NOT_APPLICABLE = "MENTION_MODE_NOT_APPLICABLE"
    INTENT_NOT_APPLICABLE = "INTENT_NOT_APPLICABLE"
    RELIABLE_ORDER_UNAVAILABLE = "RELIABLE_ORDER_UNAVAILABLE"
    TARGET_RANK_UNAVAILABLE = "TARGET_RANK_UNAVAILABLE"
    CITATION_OBSERVATION_UNAVAILABLE = "CITATION_OBSERVATION_UNAVAILABLE"
    CITATION_CLASSIFICATION_INCOMPLETE = "CITATION_CLASSIFICATION_INCOMPLETE"
    ASSESSABLE_CLAIM_UNAVAILABLE = "ASSESSABLE_CLAIM_UNAVAILABLE"
    INSUFFICIENT_REPEATS = "INSUFFICIENT_REPEATS"


class GeoConfidenceInterval(ContractModel):
    """比率指标的 95% Wilson 置信区间。"""

    lower: float = Field(ge=0.0, le=1.0)
    upper: float = Field(ge=0.0, le=1.0)
    confidence_level: float = Field(default=0.95, ge=0.95, le=0.95)
    method: Literal["WILSON_95"] = "WILSON_95"
    sample_size: int = Field(ge=1)


class GeoDeltaConfidenceInterval(ContractModel):
    """两窗口比率差值的 95% Newcombe-Wilson 置信区间（excludes_zero 不代表因果成立）。"""

    lower: float = Field(ge=-1.0, le=1.0)
    upper: float = Field(ge=-1.0, le=1.0)
    confidence_level: float = Field(default=0.95, ge=0.95, le=0.95)
    method: Literal["NEWCOMBE_WILSON_95"] = "NEWCOMBE_WILSON_95"
    excludes_zero: bool


class GeoCrossRunDispersion(ContractModel):
    """同维度 cell 跨合格运行的样本方差与标准差（ddof=1）。"""

    run_count: int = Field(ge=2)
    sample_variance: float = Field(ge=0.0)
    sample_std_dev: float = Field(ge=0.0)
