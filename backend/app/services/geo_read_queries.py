"""Batch/Run一致读取；所有关联按页或按完整Batch集合批量加载。"""

from collections import defaultdict
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session, aliased

from app.errors import not_found
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_batch_creation import GeoBatchSubject
from app.models.geo_runs import GeoObservationBatch as Batch
from app.models.geo_runs import GeoObservationRun as Run
from app.models.identity import User
from app.schemas.geo_answers import GeoAnswerCitationOut, GeoAnswerSnapshotOut
from app.schemas.geo_read_filters import (
    GeoBatchFilters,
    GeoGlobalRunFilters,
    GeoReadFilters,
    GeoRunFilters,
)
from app.schemas.geo_read_models import (
    GeoBatchDetail,
    GeoBatchListPage,
    GeoRunAttemptSummary,
    GeoRunDataQuality,
    GeoRunDetail,
    GeoRunListPage,
    GeoRunTimelineEvent,
)
from app.schemas.geo_runs import GeoObservationBatchOut, GeoObservationRunOut
from app.services import geo_read_projections as projection
from app.services.geo_analysis_queries import analysis_detail, review_required_expression
from app.services.geo_answer_evidence import answer_evidence_files
from app.services.geo_batch_policy import BATCH_STATUS_RULES
from app.services.geo_collection_profiles import ProfileFacts, load_profile_facts

_FACT_FIELDS = (
    "id",
    "batch_id",
    "collection_profile_id",
    "run_cell_key",
    "attempt_no",
    "previous_attempt_id",
    "status",
    "external_call_state",
    "error_stage",
    "error_code",
    "error_summary",
    "cost_amount",
    "cost_currency",
    "created_at",
    "started_at",
    "collected_at",
    "finished_at",
)


def _as_of(db: Session) -> datetime:
    if (
        db.connection().get_isolation_level() not in {"REPEATABLE READ", "SERIALIZABLE"}
        or db.autoflush
    ):
        raise ValueError("GEO读模型必须使用禁止autoflush的REPEATABLE READ一致快照")
    value = db.scalar(select(func.now()))
    assert value is not None
    return value


def _run_query(*, compact: bool = False) -> Select[Any]:
    successor = aliased(Run)
    fields = _FACT_FIELDS if compact else GeoObservationRunOut.model_fields
    return select(
        *(getattr(Run, name) for name in fields),
        Run.input_snapshot["profile"]["collection_mode"].as_string().label("collection_mode"),
        Run.input_snapshot["profile"]["surface"]["id"].as_string().label("surface_id"),
        Run.input_snapshot["profile"]["revision"].as_integer().label("profile_revision"),
        Run.input_snapshot["profile"]["adapter_key"].as_string().label("adapter_key"),
        Run.input_snapshot["profile"]["adapter_version"].as_string().label("adapter_version"),
        Run.input_snapshot["profile"]["ai_channel_id"].as_string().label("ai_channel_id"),
        Run.input_snapshot["profile"]["ai_model_id"].as_string().label("ai_model_id"),
        GeoAnswerSnapshot.id.label("answer_snapshot_id"),
        Run.current_analysis_revision_id,
        review_required_expression().label("analysis_needs_review"),
        select(successor.id)
        .where(successor.previous_attempt_id == Run.id)
        .exists()
        .label("has_successor"),
    ).outerjoin(GeoAnswerSnapshot, GeoAnswerSnapshot.run_id == Run.id)


def _batch(db: Session, batch_id: UUID) -> Batch:
    batch = db.scalar(
        select(Batch).where(Batch.id == batch_id).execution_options(populate_existing=True)
    )
    if batch is None:
        raise not_found("GEO批次")
    return batch


def _batch_rows(
    db: Session, batches: Sequence[Batch]
) -> tuple[dict[UUID, list[Mapping[str, Any]]], dict[UUID, ProfileFacts]]:
    rows = (
        db.execute(_run_query(compact=True).where(Run.batch_id.in_([b.id for b in batches])))
        .mappings()
        .all()
    )
    grouped: dict[UUID, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["batch_id"]].append(dict(row))
    profiles = load_profile_facts(db, list({r["collection_profile_id"] for r in rows}))
    return grouped, profiles


def _window(
    query: Select[Any], model: type[Batch] | type[Run], filters: GeoReadFilters
) -> Select[Any]:
    if filters.created_from is not None:
        query = query.where(model.created_at >= filters.created_from)
    if filters.created_to is not None:
        query = query.where(model.created_at < filters.created_to)
    return query


def _page(
    query: Select[Any], model: type[Batch] | type[Run], filters: GeoReadFilters
) -> Select[Any]:
    return (
        query.order_by(*_order(model, filters))
        .offset((filters.page - 1) * filters.page_size)
        .limit(filters.page_size)
    )


def _order(model: type[Batch] | type[Run], filters: GeoReadFilters) -> tuple[Any, Any]:
    return (
        (model.created_at.desc(), model.id.desc())
        if filters.sort == "CREATED_DESC"
        else (model.created_at, model.id)
    )


def list_batches(db: Session, *, filters: GeoBatchFilters, actor: User) -> GeoBatchListPage:
    as_of = _as_of(db)
    query = _window(select(Batch), Batch, filters)
    if filters.q is not None and filters.q.strip():
        query = query.where(
            Batch.plan_snapshot["name"].as_string().icontains(filters.q.strip(), autoescape=True)
        )
    if filters.plan_id is not None:
        query = query.where(Batch.plan_id == filters.plan_id)
    if filters.subject_id is not None:
        query = query.where(
            select(GeoBatchSubject.batch_id)
            .where(
                GeoBatchSubject.batch_id == Batch.id,
                GeoBatchSubject.subject_id == filters.subject_id,
            )
            .exists()
        )
    if filters.status is not None:
        successor = aliased(Run)
        counts = (
            select(
                Run.batch_id,
                func.count().label("total"),
                *(
                    func.count().filter(Run.status.in_(states)).label(status.value)
                    for status, _, states in BATCH_STATUS_RULES
                ),
            )
            .where(~select(successor.id).where(successor.previous_attempt_id == Run.id).exists())
            .group_by(Run.batch_id)
            .subquery()
        )
        projected_status = case(
            *(
                (
                    counts.c[status.value] == counts.c.total
                    if kind == "EXACT"
                    else counts.c[status.value] > 0,
                    status.value,
                )
                for status, kind, _ in BATCH_STATUS_RULES
            ),
            else_="PLANNED",
        )
        query = query.join(counts, counts.c.batch_id == Batch.id).where(
            projected_status == filters.status
        )
    if filters.trigger_type is not None:
        query = query.where(Batch.trigger_type == filters.trigger_type)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    batches = db.scalars(
        _page(query, Batch, filters).execution_options(populate_existing=True)
    ).all()
    grouped, profiles = _batch_rows(db, batches)
    return GeoBatchListPage(
        items=[
            projection.batch_item(b, projection.batch_projection(b, grouped[b.id], profiles, actor))
            for b in batches
        ],
        total=total,
        page=filters.page,
        page_size=filters.page_size,
        as_of=as_of,
    )


def get_batch(db: Session, *, batch_id: UUID, actor: User) -> GeoBatchDetail:
    as_of = _as_of(db)
    batch = _batch(db, batch_id)
    grouped, profiles = _batch_rows(db, [batch])
    summary, workflow, started, finished = projection.batch_projection(
        batch, grouped[batch.id], profiles, actor
    )
    return GeoBatchDetail(
        batch=GeoObservationBatchOut.model_validate(
            {name: getattr(batch, name) for name in GeoObservationBatchOut.model_fields}
            | {"status": workflow.status, "started_at": started, "finished_at": finished}
        ),
        summary=summary,
        workflow=workflow,
        as_of=as_of,
    )


def list_runs(
    db: Session, *, filters: GeoRunFilters, actor: User, batch_id: UUID | None = None
) -> GeoRunListPage:
    as_of = _as_of(db)
    if batch_id is not None:
        _batch(db, batch_id)
    elif isinstance(filters, GeoGlobalRunFilters):
        batch_id = filters.batch_id
    # 深分页只排序/跳过稳定ID与时间；冻结JSON和关联投影仅加载已选中的一页。
    # 两段SQL位于同一RR快照，保持全部过滤、latest和确定性排序语义。
    query = _window(select(Run.id, Run.created_at), Run, filters)
    successor = aliased(Run)
    if filters.latest_only:
        query = query.where(
            ~select(successor.id).where(successor.previous_attempt_id == Run.id).exists()
        )
    if batch_id is not None:
        query = query.where(Run.batch_id == batch_id)
    if filters.plan_id is not None:
        query = query.where(
            select(Batch.id)
            .where(Batch.id == Run.batch_id, Batch.plan_id == filters.plan_id)
            .exists()
        )
    for field in ("status", "prompt_variant_id", "collection_profile_id", "error_code"):
        value = getattr(filters, field)
        if value is not None:
            query = query.where(getattr(Run, field) == value)
    if filters.needs_review is not None:
        required = review_required_expression()
        query = query.where(required if filters.needs_review else ~required)
    for value, expression in (
        (filters.query_topic_id, Run.input_snapshot["prompt"]["query_topic_id"].as_string()),
        (filters.engine_surface_id, Run.input_snapshot["profile"]["surface"]["id"].as_string()),
        (filters.collection_mode, Run.input_snapshot["profile"]["collection_mode"].as_string()),
    ):
        if value is not None:
            query = query.where(expression == str(value))
    for field in ("subject_id", "product_id"):
        value = getattr(filters, field)
        if value is not None:
            key = "id" if field == "subject_id" else field
            query = query.where(Run.input_snapshot["subjects"].contains([{key: str(value)}]))
    if filters.q is not None and filters.q.strip():
        query = query.where(
            Run.input_snapshot["prompt"]["prompt_text"]
            .as_string()
            .icontains(filters.q.strip(), autoescape=True)
        )
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    page = _page(query, Run, filters).subquery()
    rows = db.execute(
        _run_query().join(page, Run.id == page.c.id).order_by(*_order(Run, filters))
    ).mappings().all()
    profiles = load_profile_facts(db, list({r["collection_profile_id"] for r in rows}))
    return GeoRunListPage(
        items=[projection.run_item(dict(row), profiles, actor) for row in rows],
        total=total,
        page=filters.page,
        page_size=filters.page_size,
        as_of=as_of,
    )


def _attempts_and_timeline(
    rows: Sequence[Mapping[str, Any]], cell: str
) -> tuple[list[GeoRunAttemptSummary], list[GeoRunTimelineEvent]]:
    attempts = [
        GeoRunAttemptSummary.model_validate(
            {name: r[name] for name in GeoRunAttemptSummary.model_fields}
        )
        for r in sorted(rows, key=lambda r: r["attempt_no"])
        if r["run_cell_key"] == cell
    ]
    fields = {
        "created_at": "CREATED",
        "started_at": "STARTED",
        "collected_at": "COLLECTED",
        "finished_at": "FINISHED",
    }
    timeline = [
        GeoRunTimelineEvent(
            run_id=a.id, attempt_no=a.attempt_no, event=event, occurred_at=getattr(a, name)
        )
        for a in attempts
        for name, event in fields.items()
        if getattr(a, name) is not None
    ]
    order = {event: index for index, event in enumerate(fields.values())}
    timeline.sort(
        key=lambda item: (item.occurred_at, item.attempt_no, order[item.event], str(item.run_id))
    )
    return attempts, timeline


def get_run(db: Session, *, run_id: UUID, actor: User) -> GeoRunDetail:
    as_of = _as_of(db)
    row = db.execute(_run_query().where(Run.id == run_id)).mappings().one_or_none()
    if row is None:
        raise not_found("GEO运行")
    batch = _batch(db, row["batch_id"])
    grouped, profiles = _batch_rows(db, [batch])
    batch_value = projection.batch_item(
        batch, projection.batch_projection(batch, grouped[batch.id], profiles, actor)
    )
    answer = db.scalar(
        select(GeoAnswerSnapshot)
        .where(GeoAnswerSnapshot.run_id == run_id)
        .execution_options(populate_existing=True)
    )
    citations = db.scalars(
        select(GeoAnswerCitation)
        .where(GeoAnswerCitation.answer_snapshot_id.in_([] if answer is None else [answer.id]))
        .order_by(GeoAnswerCitation.position, GeoAnswerCitation.id)
    ).all()
    if (answer is not None and len(citations) != answer.citation_count) or (
        answer is None and row["collected_at"] is not None
    ):
        raise projection.incomplete()
    attempts, timeline = _attempts_and_timeline(grouped[batch.id], row["run_cell_key"])
    analysis = analysis_detail(
        db,
        run_id=run_id,
        current_analysis_id=row["current_analysis_revision_id"],
        run_status=row["status"],
        answer_id=answer.id if answer else None,
        citation_count=answer.citation_count if answer else 0,
        actor=actor,
    )
    evidence = answer_evidence_files(db, [answer] if answer else [], as_of)
    return GeoRunDetail(
        run=projection.run_item(dict(row), profiles, actor),
        batch=batch_value,
        answer=GeoAnswerSnapshotOut.model_validate(answer) if answer else None,
        citations=[GeoAnswerCitationOut.model_validate(c) for c in citations],
        evidence_files=evidence[answer.id] if answer else [],
        attempts=attempts,
        timeline=timeline,
        analysis=analysis,
        data_quality=GeoRunDataQuality(
            assessment="NOT_IMPLEMENTED",
            metric_eligible=False if analysis.review_required else None,
            reason_code="GEO_REVIEW_REQUIRED"
            if analysis.review_required
            else "METRIC_ELIGIBILITY_NOT_IMPLEMENTED",
            unavailable_sections=["METRICS", "OPPORTUNITIES", "RETEST"],
        ),
        as_of=as_of,
    )
