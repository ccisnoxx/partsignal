"""GEO-601 人工复算金标：虚构冻结样本，预期值不由待测公式生成。"""

from dataclasses import replace
from uuid import UUID

from app.schemas.configuration import IntentType
from app.schemas.geo_analysis import GeoClaimSeverity, GeoClaimVerdict, GeoRecommendationKind
from app.schemas.geo_runs import GeoRunStatus
from app.services.geo_metric_types import (
    MetricCitation,
    MetricClaim,
    MetricDimensions,
    MetricRun,
    MetricScope,
    MetricSubject,
)

OWN, COMPETITOR, REFERENCE = UUID(int=1), UUID(int=2), UUID(int=3)
DIMENSIONS = MetricDimensions(
    query_topic_id=UUID(int=10),
    query_topic_revision=0,
    prompt_variant_id=UUID(int=11),
    prompt_revision=0,
    collection_profile_id=UUID(int=12),
    profile_revision=0,
    engine_surface_id=UUID(int=13),
    surface_revision=0,
    collection_mode="API",
    language_code="zh-hans",
    region_code="CN",
    login_state="NOT_APPLICABLE",
    mention_mode="UNBRANDED",
    intent_type=IntentType.PRODUCT,
    source_model="fake-model",
    source_product="fake-product",
    model_version="v1",
    product_version="v1",
    rule_set_version="v1",
    analysis_configuration_key="fixture",
    subject_versions=((OWN, 0), (COMPETITOR, 0), (REFERENCE, 0)),
    fact_version_bindings=((OWN, UUID(int=20)),),
    window_key="2026-10-03",
)
SCOPE = MetricScope(
    OWN, is_product=True, sov_subject_ids=frozenset({OWN, COMPETITOR}), domain="other.example"
)


def subject(identity, mentioned=False, described=False, recommendation="UNKNOWN", rank=None):
    return MetricSubject(
        identity, mentioned, described, GeoRecommendationKind(recommendation), rank
    )


def claim(verdict, severity="LOW", identity=OWN):
    return MetricClaim(identity, GeoClaimVerdict(verdict), GeoClaimSeverity(severity))


def observation(index=1, **patch):
    run = MetricRun(
        run_id=UUID(int=100 + index),
        batch_id=UUID(int=99),
        repeat_index=index,
        dimensions=DIMENSIONS,
        status=GeoRunStatus.COMPLETED,
        answer_present=True,
        current_analysis_available=True,
        review_required=False,
        current_review_valid=False,
        integrity_valid=True,
        administrator_excluded=False,
        superseded_attempt=False,
        applicable_subject_ids=frozenset({OWN, COMPETITOR}),
        subjects=(),
        citations=(),
        claims=(),
        citation_absence_observable=True,
        citation_classification_complete=True,
    )
    return replace(run, **patch)


def gold_runs():
    # r1/r2 提及 own+competitor；r3 全部未提及。REFERENCE 始终出现但不属于 SOV 集合。
    reference = subject(REFERENCE, True, recommendation="RECOMMENDED", rank=3)
    first = observation(
        subjects=(
            subject(OWN, True, True, "RECOMMENDED", 1),
            subject(COMPETITOR, True, False, "RECOMMENDED", 2),
            reference,
        ),
        citations=(
            MetricCitation("https://owned.example/a", "owned.example", True),
            MetricCitation("https://owned.example/a", "owned.example", True),
            MetricCitation("https://other.example/a", "other.example", False),
        ),
        claims=(
            claim("ACCURATE"),
            claim("ACCURATE"),
            claim("PARTIAL"),
            claim("INCORRECT", "HIGH"),
            claim("UNJUDGEABLE"),
        ),
    )
    second = observation(
        2,
        subjects=(
            subject(OWN, True, False, "CONSIDERED"),
            subject(COMPETITOR, True, False, "RECOMMENDED", 1),
            reference,
        ),
        citations=(MetricCitation("https://other.example/b", "other.example", False),),
        claims=(claim("ACCURATE"), claim("INCORRECT", "LOW")),
    )
    third = observation(3, claims=(claim("UNJUDGEABLE"),))
    # 失败即使带有正确分析事实也整体排除，不能当作未提及或择优成功重试。
    failed = replace(first, run_id=UUID(int=104), repeat_index=4, status=GeoRunStatus.FAILED)
    return (first, second, third, failed)


# (metric_code, numerator, denominator, eligible runs, excluded runs, UNJUDGEABLE count)
# 18 项覆盖字典全部公式；比例用下列整数独立手算。
GOLD = [
    ("answer_coverage", 2, 3, 3, 1, 0),
    ("natural_visibility", 2, 3, 3, 1, 0),
    ("branded_answer", 1, 3, 3, 1, 0),
    ("product_mention", 2, 3, 3, 1, 0),
    ("recommendation_rate", 1, 3, 3, 1, 0),
    ("top_recommendation_rate", 1, 2, 2, 2, 0),
    ("average_recommendation_rank", 1, 1, 1, 3, 0),
    ("mention_sov", 2, 4, 3, 1, 0),
    ("recommendation_sov", 1, 3, 3, 1, 0),
    ("owned_source_coverage", 1, 3, 3, 1, 0),
    ("owned_citation_share", 1, 3, 3, 1, 0),
    ("domain_coverage", 2, 3, 3, 1, 0),
    ("accurate_claim_rate", 3, 6, 2, 2, 2),
    ("partial_claim_rate", 1, 6, 2, 2, 2),
    ("incorrect_claim_rate", 2, 6, 2, 2, 2),
    ("severe_error_run_rate", 1, 2, 2, 2, 2),
    ("mention_stability", 2, 3, 3, 1, 0),
    ("recommendation_stability", 2, 3, 3, 1, 0),
]
