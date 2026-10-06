"""比较证据读取：冻结来源身份与最新复测各走明确选择，共用601输入转换。"""

from datetime import timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_retests import GeoRetestBaseline, GeoRetestRequest
from app.models.geo_runs import GeoObservationBatch as Batch
from app.models.geo_runs import GeoObservationRun as Run
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_retest_comparisons import GeoRetestComparisonChoice
from app.schemas.geo_retests import GeoRetestBaselineSnapshot
from app.services.geo_overview_queries import (
    FrozenEvidenceSelection,
    OverviewInput,
    load_evidence_inputs,
)
from app.services.geo_read_projections import incomplete


def choices(db: Session, opportunity_id: UUID) -> list[GeoRetestComparisonChoice]:
    return [
        GeoRetestComparisonChoice.model_validate(row)
        for row in db.execute(
            select(
                Batch.id.label("batch_id"),
                GeoRetestBaseline.id.label("baseline_id"),
                GeoRetestBaseline.baseline_batch_id,
                Batch.created_at,
                Batch.status,
            )
            .join(GeoRetestRequest, GeoRetestRequest.batch_id == Batch.id)
            .join(GeoRetestBaseline, GeoRetestBaseline.id == GeoRetestRequest.baseline_id)
            .where(GeoRetestBaseline.opportunity_id == opportunity_id)
            .order_by(Batch.created_at.desc(), Batch.id.desc())
        )
    ]


def selected_baseline(
    db: Session, opportunity_id: UUID, retest_batch_id: UUID
) -> tuple[GeoRetestBaseline, GeoRetestBaselineSnapshot]:
    baseline = db.scalar(
        select(GeoRetestBaseline)
        .join(GeoRetestRequest, GeoRetestRequest.baseline_id == GeoRetestBaseline.id)
        .where(
            GeoRetestRequest.batch_id == retest_batch_id,
            GeoRetestBaseline.opportunity_id == opportunity_id,
        )
        .execution_options(populate_existing=True)
    )
    if baseline is None:
        raise not_found("机会复测批次")
    return baseline, GeoRetestBaselineSnapshot.model_validate(baseline.snapshot)


def frozen_inputs(
    db: Session, snapshot: GeoRetestBaselineSnapshot, filters: GeoOverviewFilters
) -> list[OverviewInput]:
    answer_ids = [c.answer_snapshot_id for c in snapshot.cells if c.answer_snapshot_id is not None]
    answer_runs = dict(
        db.execute(
            select(GeoAnswerSnapshot.id, GeoAnswerSnapshot.run_id).where(
                GeoAnswerSnapshot.id.in_(answer_ids)
            )
        )
        .tuples()
        .all()
    )
    if set(answer_runs) != set(answer_ids):
        raise incomplete()
    sources = {
        s.run_id: s
        for s in snapshot.trigger_snapshot.sources
        if s.source_role not in {"BASELINE", "RETEST"}
    }
    historical = {
        (row.prompt_variant_id, row.collection_profile_id, row.repeat_index): row
        for row in db.execute(
            select(
                Run.id,
                Run.prompt_variant_id,
                Run.collection_profile_id,
                Run.repeat_index,
                GeoAnswerSnapshot.id.label("answer_id"),
            )
            .outerjoin(GeoAnswerSnapshot, GeoAnswerSnapshot.run_id == Run.id)
            .where(Run.id.in_(sources), Run.batch_id == snapshot.baseline_batch_id)
        )
    }
    selections = {}
    for cell in snapshot.cells:
        # trigger 后的新attempt可在705创建时成为latest；首次触发的历史身份仍优先。
        original = historical.get(
            (cell.input_snapshot.prompt.id, cell.input_snapshot.profile.id, cell.repeat_index)
        )
        identity = (
            original.id
            if original
            else answer_runs[cell.answer_snapshot_id]
            if cell.answer_snapshot_id
            else cell.root_run_id
        )
        source = sources.get(identity)
        selections[identity] = FrozenEvidenceSelection(
            source.analysis_revision_id if source else None,
            source.review_id if source else None,
            original.answer_id if original else cell.answer_snapshot_id,
            cell.input_snapshot,
        )
    return load_evidence_inputs(db, filters, list(selections), frozen=selections)


def latest_inputs(db: Session, batch_id: UUID, filters: GeoOverviewFilters) -> list[OverviewInput]:
    identities = list(
        db.scalars(
            select(Run.id)
            .where(Run.batch_id == batch_id)
            .distinct(Run.prompt_variant_id, Run.collection_profile_id, Run.repeat_index)
            .order_by(
                Run.prompt_variant_id,
                Run.collection_profile_id,
                Run.repeat_index,
                Run.attempt_no.desc(),
            )
        )
    )
    return load_evidence_inputs(db, filters, identities)


def window_filters(batch: Batch, inputs: list[OverviewInput]) -> GeoOverviewFilters:
    # 窗口按实际创建到批次结束；排除请求时钟，读取相同证据得到稳定指纹。
    start = min([batch.created_at, *[s.created_at for s in inputs]])
    end = max([batch.finished_at or batch.created_at, *[s.created_at for s in inputs]])
    return GeoOverviewFilters(date_from=start, date_to=end + timedelta(microseconds=1))
