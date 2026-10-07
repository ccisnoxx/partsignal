"""GEO-601 纯计算的不可变内部合同；不属于 API DTO 或持久化模型。"""

from dataclasses import dataclass
from enum import StrEnum
from uuid import UUID

from app.schemas.configuration import IntentType
from app.schemas.geo_analysis import GeoClaimSeverity, GeoClaimVerdict, GeoRecommendationKind
from app.schemas.geo_runs import GeoRunStatus


class MetricCode(StrEnum):
    ANSWER_COVERAGE = "answer_coverage"
    NATURAL_VISIBILITY = "natural_visibility"
    BRANDED_ANSWER = "branded_answer"
    PRODUCT_MENTION = "product_mention"
    RECOMMENDATION_RATE = "recommendation_rate"
    TOP_RECOMMENDATION_RATE = "top_recommendation_rate"
    AVERAGE_RECOMMENDATION_RANK = "average_recommendation_rank"
    MENTION_SOV = "mention_sov"
    RECOMMENDATION_SOV = "recommendation_sov"
    OWNED_SOURCE_COVERAGE = "owned_source_coverage"
    OWNED_CITATION_SHARE = "owned_citation_share"
    DOMAIN_COVERAGE = "domain_coverage"
    ACCURATE_CLAIM_RATE = "accurate_claim_rate"
    PARTIAL_CLAIM_RATE = "partial_claim_rate"
    INCORRECT_CLAIM_RATE = "incorrect_claim_rate"
    SEVERE_ERROR_RUN_RATE = "severe_error_run_rate"
    MENTION_STABILITY = "mention_stability"
    RECOMMENDATION_STABILITY = "recommendation_stability"


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


@dataclass(frozen=True)
class MetricDimensions:
    """未知版本保持 None；profile/subject 版本和规则版本变化也默认分开。"""

    query_topic_id: UUID
    query_topic_revision: int
    prompt_variant_id: UUID
    prompt_revision: int
    collection_profile_id: UUID
    profile_revision: int
    engine_surface_id: UUID
    surface_revision: int
    collection_mode: str
    language_code: str
    region_code: str
    login_state: str
    mention_mode: str
    intent_type: IntentType
    source_model: str | None
    source_product: str | None
    model_version: str | None
    product_version: str | None
    rule_set_version: str
    analysis_configuration_key: str
    subject_versions: tuple[tuple[UUID, int], ...]
    fact_version_bindings: tuple[tuple[UUID, UUID], ...]
    window_key: str


@dataclass(frozen=True)
class MetricSubject:
    subject_id: UUID
    mentioned: bool
    described: bool
    recommendation: GeoRecommendationKind
    rank: int | None

    def __post_init__(self) -> None:
        if self.rank is not None and (
            self.rank < 1 or self.recommendation != GeoRecommendationKind.RECOMMENDED
        ):
            raise ValueError("可靠 rank 必须为正整数且属于 RECOMMENDED 对象")

    @property
    def recommended(self) -> bool:
        return self.recommendation == GeoRecommendationKind.RECOMMENDED


@dataclass(frozen=True)
class MetricCitation:
    """URL/hostname 已通过 GEO-304 归一边界；此处不请求 URL。"""

    normalized_url: str
    hostname: str
    owned: bool


@dataclass(frozen=True)
class MetricClaim:
    subject_id: UUID
    verdict: GeoClaimVerdict
    severity: GeoClaimSeverity


@dataclass(frozen=True)
class MetricRun:
    """调用方提供一致快照中的 current 有效事实，禁止历史最佳结果回退。"""

    run_id: UUID
    batch_id: UUID
    repeat_index: int
    dimensions: MetricDimensions
    status: GeoRunStatus
    answer_present: bool
    current_analysis_available: bool
    review_required: bool
    current_review_valid: bool
    integrity_valid: bool
    administrator_excluded: bool
    superseded_attempt: bool
    applicable_subject_ids: frozenset[UUID]
    subjects: tuple[MetricSubject, ...]
    citations: tuple[MetricCitation, ...]
    claims: tuple[MetricClaim, ...]
    citation_absence_observable: bool
    citation_classification_complete: bool

    def __post_init__(self) -> None:
        if self.repeat_index < 1:
            raise ValueError("repeat_index 必须为正整数")
        identities = [subject.subject_id for subject in self.subjects]
        if len(set(identities)) != len(identities):
            raise ValueError("同一运行的对象事实不得重复")
        bound = {identity for identity, _ in self.dimensions.subject_versions}
        if not set(identities) <= bound or not self.applicable_subject_ids <= bound:
            raise ValueError("指标事实和适用对象必须属于冻结 subject binding")
        if any(claim.subject_id not in bound for claim in self.claims):
            raise ValueError("声明必须属于冻结 subject binding")


@dataclass(frozen=True)
class MetricScope:
    subject_id: UUID
    is_product: bool = False
    sov_subject_ids: frozenset[UUID] = frozenset()
    domain: str | None = None


@dataclass(frozen=True)
class MetricEligibility:
    exclusion_reasons: tuple[MetricExclusion, ...]

    @property
    def eligible(self) -> bool:
        return not self.exclusion_reasons


@dataclass(frozen=True)
class SamplePolicy:
    reportable_minimum: int = 3
    stable_minimum: int = 5

    def __post_init__(self) -> None:
        if not 1 < self.reportable_minimum < self.stable_minimum:
            raise ValueError("样本门槛须满足 1 < REPORTABLE < STABLE")

    def level(self, eligible_run_count: int) -> SampleLevel:
        if eligible_run_count == 0:
            return SampleLevel.NONE
        if eligible_run_count < self.reportable_minimum:
            return SampleLevel.OBSERVED
        if eligible_run_count < self.stable_minimum:
            return SampleLevel.REPORTABLE
        return SampleLevel.STABLE


@dataclass(frozen=True)
class MetricResult:
    metric_code: MetricCode
    formula_version: str
    dimensions: MetricDimensions
    scope: MetricScope
    value: float | None
    numerator: int
    denominator: int
    sample_level: SampleLevel
    eligible_run_count: int
    excluded_run_count: int
    exclusion_reason_counts: tuple[tuple[MetricExclusion, int], ...]
    eligible_run_ids: tuple[UUID, ...]
    unjudgeable_claim_count: int
