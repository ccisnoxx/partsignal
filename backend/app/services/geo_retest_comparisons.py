"""706 比较读取；单一 RR 快照或命令持锁后复用同一证据裁决。"""

from dataclasses import replace
from uuid import UUID

from sqlalchemy import bindparam, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_opportunity_decisions import GeoOpportunityDecision as Decision
from app.models.geo_runs import GeoObservationBatch as Batch
from app.models.identity import User
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_opportunities import GeoOpportunitySourceRole, GeoOpportunitySourceSnapshot
from app.schemas.geo_retest_comparisons import (
    GeoOpportunityComparisonRead,
    GeoOpportunityDecision,
    GeoRetestComparison,
    GeoRetestComparisonMetric,
    GeoRetestComparisonWindow,
)
from app.services.geo_opportunity_queries import command_item
from app.services.geo_overview_queries import OverviewInput
from app.services.geo_retest_comparison_inputs import (
    choices,
    frozen_inputs,
    latest_inputs,
    selected_baseline,
    window_filters,
)
from app.services.geo_retest_comparison_metrics import actual_differences, environments, metrics
from app.services.geo_retest_recovery import recovery


def comparison(db: Session, opportunity_id: UUID, retest_batch_id: UUID) -> GeoRetestComparison:
    baseline, snapshot = selected_baseline(db, opportunity_id, retest_batch_id)
    before_batch = db.get(Batch, baseline.baseline_batch_id, populate_existing=True)
    after_batch = db.get(Batch, retest_batch_id, populate_existing=True)
    assert before_batch is not None and after_batch is not None
    trigger = snapshot.trigger_snapshot
    filters = GeoOverviewFilters(date_from=trigger.source_date_from, date_to=trigger.source_date_to)
    before = frozen_inputs(db, snapshot, filters)
    after = latest_inputs(db, retest_batch_id, filters)
    before_filters, after_filters = filters, window_filters(after_batch, after)
    before = [
        replace(
            s,
            metric=replace(
                s.metric,
                dimensions=replace(
                    s.metric.dimensions,
                    window_key=f"{before_filters.date_from.isoformat()}/{before_filters.date_to.isoformat()}",
                ),
            ),
        )
        for s in before
    ]
    after = [
        replace(
            s,
            metric=replace(
                s.metric,
                dimensions=replace(
                    s.metric.dimensions,
                    window_key=f"{after_filters.date_from.isoformat()}/{after_filters.date_to.isoformat()}",
                ),
            ),
        )
        for s in after
    ]
    before_metrics, _ = metrics(before, snapshot, before_filters, baseline=before)
    after_metrics, reasons = metrics(after, snapshot, after_filters, baseline=before)
    differences = actual_differences(before, after)

    def window(
        batch: Batch,
        parts: list[OverviewInput],
        values: list[GeoRetestComparisonMetric],
        selected_filters: GeoOverviewFilters,
        role: GeoOpportunitySourceRole,
    ) -> GeoRetestComparisonWindow:
        return GeoRetestComparisonWindow(
            batch_id=batch.id,
            date_from=selected_filters.date_from,
            date_to=selected_filters.date_to,
            candidate_run_count=len(parts),
            metrics=values,
            environments=environments(parts),
            sources=[
                GeoOpportunitySourceSnapshot(
                    run_id=s.metric.run_id,
                    analysis_revision_id=s.analysis_id,
                    review_id=s.review_id,
                    source_role=role,
                )
                for s in parts
            ],
        )

    result = GeoRetestComparison(
        baseline_id=baseline.id,
        retest_batch_id=retest_batch_id,
        fingerprint="0" * 64,
        baseline=window(
            before_batch, before, before_metrics, before_filters, GeoOpportunitySourceRole.BASELINE
        ),
        retest=window(
            after_batch, after, after_metrics, after_filters, GeoOpportunitySourceRole.RETEST
        ),
        comparable=not differences,
        differences=differences,
        recovery=recovery(
            snapshot,
            after_metrics,
            comparable=not differences,
            pending=any(
                s.metric.status in {"PENDING", "RUNNING", "COLLECTED", "ANALYZING", "NEEDS_REVIEW"}
                for s in after
            ),
            extra_reasons=reasons,
        ),
    )
    fingerprint = db.scalar(
        select(
            func.geo_retest_comparison_fingerprint(
                bindparam("snapshot", result.model_dump(mode="json"), type_=JSONB)
            )
        )
    )
    assert isinstance(fingerprint, str)
    result.fingerprint = fingerprint
    return result


def get_comparison(
    db: Session, opportunity_id: UUID, retest_batch_id: UUID | None = None, *, actor: User
) -> GeoOpportunityComparisonRead:
    if db.autoflush or db.connection().get_isolation_level() not in {
        "REPEATABLE READ",
        "SERIALIZABLE",
    }:
        raise ValueError("比较读取必须在禁止autoflush的一致快照内执行")
    opportunity = db.get(GeoOpportunity, opportunity_id, populate_existing=True)
    if opportunity is None:
        raise not_found("GEO机会")
    options = choices(db, opportunity_id)
    selected = (
        retest_batch_id if retest_batch_id is not None else options[0].batch_id if options else None
    )
    if selected is not None and selected not in {c.batch_id for c in options}:
        raise not_found("机会复测批次")
    result = comparison(db, opportunity_id, selected) if selected is not None else None
    decisions = [
        GeoOpportunityDecision.model_validate(row)
        for row in db.scalars(
            select(Decision)
            .where(Decision.opportunity_id == opportunity_id)
            .order_by(Decision.created_at, Decision.id)
        )
    ]
    as_of = db.scalar(select(func.now()))
    assert as_of is not None
    return GeoOpportunityComparisonRead(
        opportunity=command_item(db, opportunity_id, actor),
        opportunity_id=opportunity_id,
        opportunity_revision=opportunity.revision,
        as_of=as_of,
        retests=options,
        selected_retest_batch_id=selected,
        comparison=result,
        decisions=decisions,
    )
