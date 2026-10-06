"""从不可变首次证据和显式来源批次建立基线；不写入、不替换历史选择。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_retests import GeoRetestBaseline
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.schemas.geo_retests import GeoRetestBaselineSnapshot, GeoRetestCell


def baseline_snapshot(
    db: Session, opportunity: GeoOpportunity, batch_id: UUID
) -> tuple[UUID | None, GeoRetestBaselineSnapshot]:
    saved = db.scalar(
        select(GeoRetestBaseline).where(
            GeoRetestBaseline.opportunity_id == opportunity.id,
            GeoRetestBaseline.baseline_batch_id == batch_id,
        )
    )
    if saved is not None:
        return saved.id, GeoRetestBaselineSnapshot.model_validate(saved.snapshot)
    batch = db.get(GeoObservationBatch, batch_id, populate_existing=True)
    if batch is None:
        raise not_found("基线批次")
    r, a = GeoObservationRun, GeoAnswerSnapshot
    roots = list(
        db.scalars(
            select(r)
            .where(r.batch_id == batch_id, r.attempt_no == 1)
            .order_by(r.prompt_variant_id, r.collection_profile_id, r.repeat_index)
        )
    )
    # latest attempt决定基线采集版本；不是选择最优或最后成功答案。
    latest = (
        select(r.id, r.prompt_variant_id, r.collection_profile_id, r.repeat_index)
        .where(r.batch_id == batch_id)
        .distinct(r.prompt_variant_id, r.collection_profile_id, r.repeat_index)
        .order_by(r.prompt_variant_id, r.collection_profile_id, r.repeat_index, r.attempt_no.desc())
        .subquery()
    )
    answers = {
        (row.prompt_variant_id, row.collection_profile_id, row.repeat_index): row
        for row in db.execute(
            select(
                latest, a.id.label("answer_id"), a.source_product, a.source_model, a.source_version
            ).outerjoin(a, a.run_id == latest.c.id)
        )
    }
    cells = []
    for root in roots:
        answer = answers[root.prompt_variant_id, root.collection_profile_id, root.repeat_index]
        cells.append(
            GeoRetestCell(
                root_run_id=root.id,
                repeat_index=root.repeat_index,
                input_snapshot=root.input_snapshot,
                answer_snapshot_id=answer.answer_id,
                source_product=answer.source_product,
                source_model=answer.source_model,
                source_version=answer.source_version,
            )
        )
    return None, GeoRetestBaselineSnapshot(
        schema_version=1,
        opportunity_id=opportunity.id,
        baseline_batch_id=batch_id,
        trigger_snapshot=opportunity.trigger_snapshot,
        plan_snapshot=batch.plan_snapshot,
        rule_snapshot=batch.rule_snapshot,
        cells=cells,
    )
