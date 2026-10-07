"""Overview 同快照批量输入；只读列和 current 结果，不加载凭据或历史最佳分析。"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Select, Text, any_, bindparam, cast, column, func, select
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Session, aliased

from app.geo_citation_urls import CitationUrlMemo
from app.models.geo_analysis import (
    GeoAnalysisRevision,
    GeoClaimAssessment,
    GeoEntityMention,
    GeoRecommendation,
    GeoRunReview,
)
from app.models.geo_analysis_worker import GeoCitationClassification
from app.models.geo_answers import GeoAnswerCitation, GeoAnswerSnapshot
from app.models.geo_files import FileRecord
from app.models.geo_runs import GeoObservationBatch as Batch
from app.models.geo_runs import GeoObservationRun as Run
from app.schemas.base import ContractModel
from app.schemas.geo_analysis import (
    GeoAnalysisInputSnapshot,
    GeoAnalysisRevisionOut,
    GeoAnalysisSelection,
    GeoClaimAssessmentOut,
    GeoEntityMentionOut,
    GeoRecommendationOut,
    GeoRunReviewOut,
)
from app.schemas.geo_answers import GeoAnswerCitationOut, GeoAnswerSnapshotOut
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_reviews import (
    GeoAnalysisResult,
    GeoCitationClassificationOut,
    GeoReviewHistoryItem,
    GeoRunAnalysisDetail,
)
from app.schemas.geo_runs import GeoRunInputSnapshot, GeoRunStatus
from app.services.geo_insight_evidence import InsightEvidence, freeze_insight_evidence
from app.services.geo_metric_inputs import metric_run_from_snapshot
from app.services.geo_metric_types import MetricRun
from app.services.geo_read_projections import incomplete


@dataclass(frozen=True)
class OverviewInput:
    metric: MetricRun
    snapshot: GeoRunInputSnapshot
    created_at: datetime
    batch_created_at: datetime
    analysis_id: UUID | None
    review_id: UUID | None
    cost_amount: Decimal | None
    cost_currency: str | None
    version_known: bool
    evidence_complete: bool
    evidence: InsightEvidence = InsightEvidence()


@dataclass(frozen=True)
class FrozenEvidenceSelection:
    """历史身份由不可变来源提供；None 明确表示当时没有结果，不读 current。"""

    analysis_id: UUID | None
    review_id: UUID | None
    answer_id: UUID | None
    snapshot: GeoRunInputSnapshot


def _snapshot_key() -> Any:
    # 完整JSONB的UTF8内容指纹；不按batch/profile猜测相同，也不建立可写镜像。
    return func.encode(func.sha256(func.convert_to(cast(Run.input_snapshot, Text), "UTF8")), "hex")


def _ids(field: Any, values: Iterable[UUID]) -> Any:
    # 单个类型化数组参数，避免密集窗口为每条查询展开上万个占位符；空数组仍为空集。
    return field == any_(bindparam(None, list(values), type_=ARRAY(PGUUID(as_uuid=True))))


def candidate_query(filters: GeoOverviewFilters) -> Select[Any]:
    successor = aliased(Run)
    query = select(
        Run.id,
        Run.batch_id,
        Run.repeat_index,
        Run.status,
        _snapshot_key().label("input_key"),
        Run.created_at,
        Run.current_analysis_revision_id,
        Run.cost_amount,
        Run.cost_currency,
    ).where(
        Run.created_at >= filters.date_from,
        Run.created_at < filters.date_to,
        ~select(successor.id).where(successor.previous_attempt_id == Run.id).exists(),
    )
    snapshot = Run.input_snapshot
    fields = (
        (snapshot["prompt"]["query_topic_id"].as_string(), filters.query_topic_ids),
        (Run.prompt_variant_id, filters.prompt_variant_ids),
        (snapshot["profile"]["surface"]["id"].as_string(), filters.engine_surface_ids),
        (Run.collection_profile_id, filters.collection_profile_ids),
        (snapshot["profile"]["collection_mode"].as_string(), filters.collection_modes),
        (snapshot["profile"]["language_code"].as_string(), filters.language_codes),
        (snapshot["profile"]["region_code"].as_string(), filters.region_codes),
        (snapshot["profile"]["login_state"].as_string(), filters.login_states),
        (snapshot["prompt"]["intent_type"].as_string(), filters.intent_types),
    )
    for field, values in fields:
        if values:
            query = query.where(field.in_([str(value) for value in values]))
    if filters.mention_mode is not None:
        query = query.where(snapshot["prompt"]["mention_mode"].as_string() == filters.mention_mode)
    if filters.subject_ids or filters.product_ids:
        # 同一冻结 JSON binding 的交集；不能以可变 Catalog 或批次其他对象替代 Run 输入。
        bindings = func.jsonb_array_elements(snapshot["subjects"]).table_valued(
            column("value", JSONB)
        )
        selected = select(1).select_from(bindings)
        if filters.subject_ids:
            selected = selected.where(
                bindings.c.value["id"].as_string().in_([str(v) for v in filters.subject_ids])
            )
        if filters.product_ids:
            selected = selected.where(
                bindings.c.value["product_id"]
                .as_string()
                .in_([str(v) for v in filters.product_ids])
            )
        query = query.where(selected.exists())
    return query.order_by(Run.created_at.desc(), Run.id)


def selected_subjects(snapshot: GeoRunInputSnapshot, filters: GeoOverviewFilters) -> set[UUID]:
    return {
        subject.id
        for subject in snapshot.subjects
        if (not filters.subject_ids or subject.id in filters.subject_ids)
        and (not filters.product_ids or subject.product_id in filters.product_ids)
    }


def load_inputs(
    db: Session,
    filters: GeoOverviewFilters,
    *,
    run_ids: Sequence[UUID] | None = None,
) -> tuple[datetime, list[OverviewInput]]:
    if db.autoflush or db.connection().get_isolation_level() not in {
        "REPEATABLE READ",
        "SERIALIZABLE",
    }:
        raise ValueError("Overview必须在禁止autoflush的一致快照读取")
    as_of = db.scalar(select(func.now()))
    assert as_of is not None
    query = candidate_query(filters)
    if run_ids is not None:
        query = query.where(_ids(Run.id, run_ids))
    rows = db.execute(query).mappings().all()
    return as_of, _load_input_rows(db, filters, rows)


def load_evidence_inputs(
    db: Session,
    filters: GeoOverviewFilters,
    run_ids: Sequence[UUID],
    *,
    frozen: Mapping[UUID, FrozenEvidenceSelection] | None = None,
) -> list[OverviewInput]:
    """显式证据集合复用同一转换；调用方持 RR 或完整 Batch→Run 锁。

    frozen 路径包含已被重试替代的历史 Run，不使用时间筛选或 current 指针。
    当前路径的 run_ids 必须已由调用方选为 latest attempt。
    """
    rows: Sequence[Mapping[Any, Any]] = (
        db.execute(
            select(
                Run.id,
                Run.batch_id,
                Run.repeat_index,
                Run.status,
                _snapshot_key().label("input_key"),
                Run.created_at,
                Run.current_analysis_revision_id,
                Run.cost_amount,
                Run.cost_currency,
            )
            .where(_ids(Run.id, run_ids))
            .order_by(Run.created_at, Run.id)
        )
        .mappings()
        .all()
    )
    if {row["id"] for row in rows} != set(run_ids):
        raise incomplete()
    if frozen is not None:
        rows = [
            dict(row) | {"current_analysis_revision_id": frozen[row["id"]].analysis_id}
            for row in rows
        ]
    return _load_input_rows(db, filters, rows, frozen=frozen)


def _load_input_rows(
    db: Session,
    filters: GeoOverviewFilters,
    rows: Sequence[Mapping[Any, Any]],
    *,
    frozen: Mapping[UUID, FrozenEvidenceSelection] | None = None,
) -> list[OverviewInput]:
    candidates = [row["id"] for row in rows]
    key = _snapshot_key()
    frozen_snapshots = {
        row.input_key: GeoRunInputSnapshot.model_validate(row.input_snapshot)
        for row in db.execute(
            select(key.label("input_key"), Run.input_snapshot)
            .where(_ids(Run.id, candidates))
            .distinct(key)
        )
    }
    # 同一RR内按完整不可变内容批量读取/校验一次。后续消费者只读这些快照。
    snapshots = {row["id"]: frozen_snapshots[row["input_key"]] for row in rows}
    if frozen is not None:
        snapshots = {identity: value.snapshot for identity, value in frozen.items()}
    # 对象和产品必须命中同一个冻结binding，不通过当前Catalog或答案推断关联。
    rows = [row for row in rows if selected_subjects(snapshots[row["id"]], filters)]
    ids = [row["id"] for row in rows]
    answers = {
        item.run_id: GeoAnswerSnapshotOut.model_validate(item)
        for item in db.execute(
            select(GeoAnswerSnapshot.__table__).where(_ids(GeoAnswerSnapshot.run_id, ids))
        )
    }
    if frozen is not None:
        for identity in ids:
            answer = answers.get(identity)
            if frozen[identity].answer_id is None:
                answers.pop(identity, None)
            elif answer is None or answer.id != frozen[identity].answer_id:
                raise incomplete()
    citations: dict[UUID, list[GeoAnswerCitationOut]] = {identity: [] for identity in ids}
    answer_runs = {answer.id: identity for identity, answer in answers.items()}
    url_memo = CitationUrlMemo()
    for item in db.execute(
        select(GeoAnswerCitation.__table__).where(
            _ids(GeoAnswerCitation.answer_snapshot_id, answer_runs)
        )
    ):
        citations[answer_runs[item.answer_snapshot_id]].append(
            GeoAnswerCitationOut.model_validate(item, context=url_memo)
        )
    current_ids = [
        row["current_analysis_revision_id"] for row in rows if row["current_analysis_revision_id"]
    ]
    analysis_inputs = {
        row.input_sha256: GeoAnalysisInputSnapshot.model_validate(row.input_snapshot)
        for row in db.execute(
            select(GeoAnalysisRevision.input_sha256, GeoAnalysisRevision.input_snapshot)
            .where(_ids(GeoAnalysisRevision.id, current_ids))
            .distinct(GeoAnalysisRevision.input_sha256)
        )
    }
    analyses = {
        item.id: GeoAnalysisResult(
            analysis=GeoAnalysisRevisionOut.model_validate(
                dict(item._mapping) | {"input_snapshot": analysis_inputs[item.input_sha256]}
            ),
            mentions=[],
            recommendations=[],
            claims=[],
            citations=[],
            citation_classification_complete=False,
        )
        for item in db.execute(
            select(
                *[c for c in GeoAnalysisRevision.__table__.c if c.name != "input_snapshot"]
            ).where(_ids(GeoAnalysisRevision.id, current_ids))
        )
    }
    _load_results(db, analyses)
    review_query = select(GeoRunReview.__table__)
    if frozen is not None:
        review_query = review_query.where(
            _ids(GeoRunReview.id, [v.review_id for v in frozen.values() if v.review_id is not None])
        )
    else:
        review_query = review_query.where(_ids(GeoRunReview.analysis_revision_id, current_ids))
    reviews = {
        item.analysis_revision_id: GeoRunReviewOut.model_validate(item)
        for item in db.execute(
            review_query.distinct(GeoRunReview.analysis_revision_id).order_by(
                GeoRunReview.analysis_revision_id,
                GeoRunReview.created_at.desc(),
                GeoRunReview.id.desc(),
            )
        )
    }
    if frozen is not None and {v.id for v in reviews.values()} != {
        v.review_id for v in frozen.values() if v.review_id is not None
    }:
        raise incomplete()
    file_ids = {
        identity
        for answer in answers.values()
        for identity in (answer.screenshot_file_id, answer.raw_payload_file_id)
        if identity is not None
    }
    files = dict(
        db.execute(select(FileRecord.id, FileRecord.status).where(_ids(FileRecord.id, file_ids)))
        .tuples()
        .all()
    )
    batches = dict(
        db.execute(
            select(Batch.id, Batch.created_at).where(
                _ids(Batch.id, {row["batch_id"] for row in rows})
            )
        )
        .tuples()
        .all()
    )
    values = [
        _input(
            row,
            snapshots[row["id"]],
            answers.get(row["id"]),
            citations[row["id"]],
            analyses,
            reviews,
            files,
            batches,
            filters,
        )
        for row in rows
    ]
    if filters.review_policy == "REVIEWED_ONLY":
        values = [value for value in values if value.metric.current_review_valid]
    return values


def _load_results(db: Session, results: dict[UUID, GeoAnalysisResult]) -> None:
    # Row仍通过原有from_attributes/Pydantic校验；只读投影无需ORM身份图或实体状态。
    models: tuple[tuple[Any, type[ContractModel], str], ...] = (
        (GeoEntityMention, GeoEntityMentionOut, "mentions"),
        (GeoRecommendation, GeoRecommendationOut, "recommendations"),
        (GeoClaimAssessment, GeoClaimAssessmentOut, "claims"),
        (GeoCitationClassification, GeoCitationClassificationOut, "citations"),
    )
    for model, schema, field in models:
        query = select(model.__table__).where(_ids(model.analysis_revision_id, results))
        for row in db.execute(query):
            getattr(results[row.analysis_revision_id], field).append(schema.model_validate(row))


def _input(
    row: Mapping[Any, Any],
    snapshot: GeoRunInputSnapshot,
    answer: GeoAnswerSnapshotOut | None,
    citations: list[GeoAnswerCitationOut],
    analyses: dict[UUID, GeoAnalysisResult],
    reviews: dict[UUID, GeoRunReviewOut],
    files: dict[UUID, str],
    batches: dict[UUID, datetime],
    filters: GeoOverviewFilters,
) -> OverviewInput:
    current_id = row["current_analysis_revision_id"]
    current = analyses.get(current_id)
    if current_id is not None and (
        current is None
        or current.analysis.run_id != row["id"]
        or current.analysis.status != "COMPLETED"
        or answer is None
        or current.analysis.answer_snapshot_id != answer.id
    ):
        raise incomplete()
    if row["batch_id"] not in batches:
        raise incomplete()
    review = reviews.get(current_id)
    if current:
        current.citation_classification_complete = len(current.citations) == len(citations)
    detail = GeoRunAnalysisDetail(
        selection=GeoAnalysisSelection(
            run_id=row["id"],
            current_analysis_revision_id=current_id,
            current_review_id=review.id if review else None,
        ),
        revisions=[current] if current else [],
        reviews=[GeoReviewHistoryItem(review=review, is_current=True)] if review else [],
        effective_results=None,
        review_required=bool(current and current.analysis.review_required_reasons and not review),
        review_gate_passed=bool(
            current and (not current.analysis.review_required_reasons or review)
        ),
        available_actions=[],
    )
    evidence = answer is not None and bool(answer.answer_text.strip())
    if answer:
        evidence = (
            evidence
            and len(citations) == answer.citation_count
            and all(
                files.get(identity) == "VERIFIED"
                for identity in (answer.screenshot_file_id, answer.raw_payload_file_id)
                if identity is not None
            )
        )
        if snapshot.profile.collection_mode != "API":
            evidence = evidence and (
                not snapshot.profile.settings.require_screenshot
                or answer.screenshot_file_id is not None
            )
    integrity = evidence and (
        answer is not None
        and answer.raw_payload_summary.finish_reason not in {"LENGTH", "CONTENT_FILTER"}
    )
    metric = metric_run_from_snapshot(
        run_id=row["id"],
        batch_id=row["batch_id"],
        repeat_index=row["repeat_index"],
        status=GeoRunStatus(row["status"]),
        snapshot=snapshot,
        answer=answer,
        citations=citations,
        analysis_detail=detail,
        window_key=f"{filters.date_from.isoformat()}/{filters.date_to.isoformat()}",
        applicable_subject_ids=frozenset(subject.id for subject in snapshot.subjects),
        # 当前无实质描述/可观察无引用的独立字段，不用mention、能力或搜索信号伪造。
        described_subject_ids=frozenset(),
        citation_absence_observable=False,
        integrity_valid=integrity,
    )
    return OverviewInput(
        metric=metric,
        snapshot=snapshot,
        created_at=row["created_at"],
        batch_created_at=batches[row["batch_id"]],
        analysis_id=current_id,
        review_id=review.id if review else None,
        cost_amount=row["cost_amount"],
        cost_currency=row["cost_currency"],
        version_known=bool(answer and answer.source_model and answer.source_version),
        evidence_complete=evidence,
        evidence=freeze_insight_evidence(
            snapshot,
            answer,
            citations,
            current,
            review,
            available=metric.current_analysis_available,
        ),
    )
