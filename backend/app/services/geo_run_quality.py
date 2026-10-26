"""运行详情的质量和导航投影；资格及证据口径复用现有统计所有者。"""

from collections import defaultdict
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.geo_opportunities import GeoOpportunitySource
from app.models.geo_retests import GeoRetestBaseline, GeoRetestRequest
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_read_models import (
    GeoRunDataQuality,
    GeoRunMetricQualification,
    GeoRunNavigation,
    GeoRunOpportunityLink,
    GeoRunRetestLink,
    GeoRunSubjectQuality,
)
from app.services.geo_answer_insights import BUSINESS_METRICS, SOV_METRICS
from app.services.geo_metric_inputs import metric_scope_from_snapshot
from app.services.geo_metrics import metric_eligibility
from app.services.geo_overview import BUSINESS_CODES, generic_exclusion_reasons
from app.services.geo_overview_queries import load_evidence_inputs


def quality_and_navigation(
    db: Session, *, run_id: UUID, created_at: datetime, is_latest_attempt: bool
) -> tuple[GeoRunDataQuality, GeoRunNavigation]:
    # 固定为创建日 UTC；不依赖浏览器时钟，也不暗示单次运行构成可报告的样本量。
    start = created_at.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    filters = GeoOverviewFilters(date_from=start, date_to=start + timedelta(days=1))
    (source,) = load_evidence_inputs(db, filters, [run_id])
    source = replace(
        source, metric=replace(source.metric, superseded_attempt=not is_latest_attempt)
    )
    snapshot, run = source.snapshot, source.metric
    filters = GeoOverviewFilters(
        date_from=filters.date_from,
        date_to=filters.date_to,
        prompt_variant_ids=[snapshot.prompt.id],
        collection_profile_ids=[snapshot.profile.id],
    )
    reasons = generic_exclusion_reasons(source, filters)
    subjects = []
    codes = tuple(dict.fromkeys((*BUSINESS_CODES, *BUSINESS_METRICS, *SOV_METRICS)))
    for subject in snapshot.subjects:
        scope = metric_scope_from_snapshot(snapshot, subject_id=subject.id)
        # REFERENCE 不属于冻结 SOV 集合，与洞察 cell 的选择规则一致。
        metrics = []
        for code in codes:
            if code in SOV_METRICS and subject.id not in scope.sov_subject_ids:
                continue
            eligibility = metric_eligibility(
                run, metric=code, scope=scope, dimensions=run.dimensions
            )
            metrics.append(
                GeoRunMetricQualification.model_validate(
                    {
                        "metric_code": code,
                        "eligible": eligibility.eligible,
                        "exclusion_reasons": list(eligibility.exclusion_reasons),
                    }
                )
            )
        subjects.append(
            GeoRunSubjectQuality(
                subject_id=subject.id, display_name=subject.display_name, metrics=metrics
            )
        )
    quality = GeoRunDataQuality(
        assessment="EXCLUDED" if reasons else "ELIGIBLE",
        metric_eligible=not reasons,
        exclusion_reasons=list(reasons),
        current_analysis_status="COMPLETED" if run.current_analysis_available else "UNAVAILABLE",
        review_status=(
            "NOT_READY"
            if not run.current_analysis_available
            else "REVIEWED"
            if run.current_review_valid
            else "REQUIRED"
            if run.review_required
            else "NOT_REQUIRED"
        ),
        evidence_complete=source.evidence_complete,
        cost_recorded=source.cost_amount is not None and source.cost_currency is not None,
        model_version_known=source.version_known,
        subjects=subjects,
    )
    roles: dict[UUID, set[str]] = defaultdict(set)
    for identity, role in db.execute(
        select(GeoOpportunitySource.opportunity_id, GeoOpportunitySource.source_role).where(
            GeoOpportunitySource.run_id == run_id
        )
    ):
        roles[identity].add(role)
    baseline, request = GeoRetestBaseline, GeoRetestRequest
    retests = [
        GeoRunRetestLink(
            opportunity_id=row.opportunity_id, baseline_id=row.id, retest_batch_id=row.batch_id
        )
        for row in db.execute(
            select(baseline.opportunity_id, baseline.id, request.batch_id)
            .outerjoin(request, request.baseline_id == baseline.id)
            .where(
                or_(baseline.baseline_batch_id == run.batch_id, request.batch_id == run.batch_id)
            )
            .order_by(baseline.created_at, baseline.id, request.created_at, request.id)
        )
    ]
    return quality, GeoRunNavigation(
        insights=filters if is_latest_attempt else None,
        insights_unavailable_reason=None if is_latest_attempt else "SUPERSEDED_ATTEMPT",
        opportunities=[
            GeoRunOpportunityLink.model_validate(
                {
                    "opportunity_id": identity,
                    "source_roles": sorted(source_roles),
                }
            )
            for identity, source_roles in sorted(roles.items())
        ],
        retests=retests,
    )
