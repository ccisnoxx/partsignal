"""把服务端一致读快照显式转换成指标内部事实；不查询或写入 ORM。"""

from collections.abc import Sequence
from hashlib import sha256
from uuid import UUID

from app.schemas.geo_analysis import GeoRecommendationKind
from app.schemas.geo_answers import GeoAnswerCitationOut, GeoAnswerSnapshotOut
from app.schemas.geo_reviews import GeoRunAnalysisDetail
from app.schemas.geo_runs import GeoRunInputSnapshot, GeoRunStatus
from app.services.geo_metric_types import (
    MetricCitation,
    MetricClaim,
    MetricDimensions,
    MetricRun,
    MetricScope,
    MetricSubject,
)
from app.services.geo_review_projection import reviewed_results


def metric_run_from_snapshot(
    *,
    run_id: UUID,
    batch_id: UUID,
    repeat_index: int,
    status: GeoRunStatus,
    snapshot: GeoRunInputSnapshot,
    answer: GeoAnswerSnapshotOut | None,
    citations: Sequence[GeoAnswerCitationOut],
    analysis_detail: GeoRunAnalysisDetail,
    window_key: str,
    applicable_subject_ids: frozenset[UUID],
    described_subject_ids: frozenset[UUID],
    citation_absence_observable: bool,
    integrity_valid: bool,
    administrator_excluded: bool = False,
    superseded_attempt: bool = False,
) -> MetricRun:
    """适用/实质描述/无引用结论须有独立依据，不能从未提及或能力开关反推。

    调用方负责同一 RR 快照及 latest attempt 筛选。稳定性和重复输入由公式库再守卫。
    integrity_valid 包含错误/登录页、影响结论的截断和 profile 所需证据门禁。
    """
    if analysis_detail.selection.run_id != run_id or (answer and answer.run_id != run_id):
        raise ValueError("指标输入必须属于同一运行")
    if any(answer is None or item.answer_snapshot_id != answer.id for item in citations):
        raise ValueError("引用必须属于指标原始回答")
    current_id = analysis_detail.selection.current_analysis_revision_id
    current = next(
        (item for item in analysis_detail.revisions if item.analysis.id == current_id), None
    )
    available = (
        current is not None
        and current.analysis.status == "COMPLETED"
        and current.analysis.run_id == run_id
        and answer is not None
        and current.analysis.answer_snapshot_id == answer.id
        and current.analysis.input_snapshot.answer_sha256 == answer.answer_sha256
    )
    current_review_id = analysis_detail.selection.current_review_id
    review = next(
        (
            item.review
            for item in analysis_detail.reviews
            if item.is_current and item.review.id == current_review_id
        ),
        None,
    )
    valid_review = (
        review is not None and review.run_id == run_id and review.analysis_revision_id == current_id
    )
    if current_review_id is not None and not valid_review:
        integrity_valid = False
    required = current is not None and bool(current.analysis.review_required_reasons)
    results = (
        reviewed_results(current, review if valid_review else None, citation_count=len(citations))
        if available and current
        else None
    )
    mentions = (
        {item.subject_id: item.mention_count > 0 for item in results.mentions} if results else {}
    )
    recommendations = {item.subject_id: item for item in results.recommendations} if results else {}
    bound = {item.id for item in snapshot.subjects}
    if not described_subject_ids <= bound:
        raise ValueError("实质描述对象必须属于冻结 subject binding")
    subjects = tuple(
        MetricSubject(
            subject_id=identity,
            mentioned=mentions.get(identity, False),
            described=identity in described_subject_ids,
            recommendation=recommendations[identity].recommendation
            if identity in recommendations
            else GeoRecommendationKind.UNKNOWN,
            rank=recommendations[identity].rank if identity in recommendations else None,
        )
        for identity in sorted(bound)
    )
    categories = {item.citation_id: item for item in results.citations} if results else {}
    complete = (
        answer is not None
        and answer.citation_count == len(citations)
        and len({item.id for item in citations}) == len(citations)
        and results is not None
        and results.citation_classification_complete
        and set(categories) == {item.id for item in citations}
    )
    dimensions = MetricDimensions(
        query_topic_id=snapshot.prompt.query_topic_id,
        query_topic_revision=snapshot.prompt.query_topic_revision,
        prompt_variant_id=snapshot.prompt.id,
        prompt_revision=snapshot.prompt.revision,
        collection_profile_id=snapshot.profile.id,
        profile_revision=snapshot.profile.revision,
        engine_surface_id=snapshot.profile.surface.id,
        surface_revision=snapshot.profile.surface.revision,
        collection_mode=snapshot.profile.collection_mode,
        language_code=snapshot.profile.language_code,
        region_code=snapshot.profile.region_code,
        login_state=snapshot.profile.login_state,
        mention_mode=snapshot.prompt.mention_mode,
        intent_type=snapshot.prompt.intent_type,
        source_model=answer.source_model if answer else None,
        source_product=answer.source_product if answer else None,
        model_version=answer.source_version if answer and answer.source_model else None,
        product_version=answer.source_version if answer and answer.source_product else None,
        rule_set_version=f"{snapshot.rule_set_revision}:"
        + (
            f"{current.analysis.analyzer_version}:"
            f"{current.analysis.input_snapshot.configuration.rule_set_version}"
            if available and current
            else "unavailable"
        ),
        subject_versions=tuple(sorted((item.id, item.revision) for item in snapshot.subjects)),
        analysis_configuration_key=sha256(
            current.analysis.input_snapshot.configuration.model_dump_json().encode()
        ).hexdigest()
        if available and current
        else "unavailable",
        fact_version_bindings=tuple(
            sorted(
                (item.subject_id, item.fact_version_id)
                for item in current.analysis.input_snapshot.fact_versions
            )
        )
        if available and current
        else (),
        window_key=window_key,
    )
    return MetricRun(
        run_id=run_id,
        batch_id=batch_id,
        repeat_index=repeat_index,
        dimensions=dimensions,
        status=status,
        answer_present=answer is not None and bool(answer.answer_text.strip()),
        current_analysis_available=available,
        review_required=required,
        current_review_valid=valid_review,
        integrity_valid=integrity_valid,
        administrator_excluded=administrator_excluded,
        superseded_attempt=superseded_attempt,
        applicable_subject_ids=applicable_subject_ids,
        subjects=subjects,
        citations=tuple(
            MetricCitation(
                item.normalized_url,
                item.hostname,
                item.id in categories and categories[item.id].source_category == "OWNED",
            )
            for item in citations
        ),
        claims=tuple(
            MetricClaim(item.subject_id, item.verdict, item.severity) for item in results.claims
        )
        if results
        else (),
        citation_absence_observable=citation_absence_observable,
        citation_classification_complete=complete,
    )


def metric_scope_from_snapshot(
    snapshot: GeoRunInputSnapshot, *, subject_id: UUID, domain: str | None = None
) -> MetricScope:
    """监测集合来自冻结 PRIMARY/COMPETITOR 绑定，REFERENCE 不贡献 SOV。"""
    subject = next((item for item in snapshot.subjects if item.id == subject_id), None)
    if subject is None:
        raise ValueError("指标目标必须属于冻结 subject binding")
    return MetricScope(
        subject_id=subject_id,
        is_product=subject.subject_type in {"OWN_PRODUCT", "COMPETITOR_PRODUCT"},
        sov_subject_ids=frozenset(
            item.id for item in snapshot.subjects if item.role in {"PRIMARY", "COMPETITOR"}
        ),
        domain=domain,
    )
