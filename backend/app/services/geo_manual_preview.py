"""Slice 1C：人工录入只读规则预判与人工采集失败标记服务。"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.geo_citation_urls import normalize_citation_url
from app.models.geo_manual_collection import GeoManualDraft
from app.models.geo_runs import GeoObservationRun
from app.models.identity import User
from app.schemas.geo_analysis import (
    GeoAnalysisConfiguration,
    GeoAnalysisInputSnapshot,
    GeoAnalysisParameters,
    GeoRecommendationKind,
)
from app.schemas.geo_answers import GeoAnswerCitationOut
from app.schemas.geo_daily_checklist import (
    GeoManualFailOut,
    GeoManualFailRequest,
    GeoManualPreviewCitationSuggestion,
    GeoManualPreviewOut,
    GeoManualPreviewRequest,
    GeoManualPreviewSubjectSuggestion,
)
from app.schemas.geo_runs import GeoRunInputSnapshot, GeoRunStatus
from app.services import geo_analysis_execution as execution
from app.services.geo_analysis_inputs import RULE_SET_VERSION
from app.services.geo_citation_matching import (
    _active_publications,
    extract_urls_from_text,
    match_url_against_publications,
)
from app.services.geo_fact_versions import FactAssembly
from app.services.geo_plan_locks import command
from app.services.geo_run_lifecycle import database_now, lock_run, refresh_batch, run_state
from app.services.geo_run_policy import run_transition


def preview_manual_observation(
    db: Session, *, run_id: UUID, payload: GeoManualPreviewRequest
) -> GeoManualPreviewOut:
    """纯只读规则预判：别名命中、推荐初判、URL 抽取与文章发布候选匹配（零数据库写入）。"""
    run = db.get(GeoObservationRun, run_id)
    if run is None:
        raise not_found("GEO 运行")
    frozen = GeoRunInputSnapshot.model_validate(run.input_snapshot)
    answer_text = payload.answer_text or ""
    now = datetime.now(UTC)

    extracted_raw = extract_urls_from_text(answer_text)
    merged: list[tuple[str, str, str, str | None, Literal["INPUT", "EXTRACTED_FROM_TEXT"]]] = []
    seen_norm: set[str] = set()
    for item in payload.citations:
        try:
            info = normalize_citation_url(item.original_url.strip())
        except ValueError:
            continue
        if info.normalized_url not in seen_norm:
            seen_norm.add(info.normalized_url)
            merged.append(
                (info.original_url, info.normalized_url, info.hostname, item.title, "INPUT")
            )
    for raw in extracted_raw:
        info = normalize_citation_url(raw)
        if info.normalized_url not in seen_norm:
            seen_norm.add(info.normalized_url)
            merged.append(
                (info.original_url, info.normalized_url, info.hostname, None, "EXTRACTED_FROM_TEXT")
            )

    synthetic_answer_id = uuid4()
    synthetic_citations = tuple(
        GeoAnswerCitationOut(
            id=uuid4(),
            answer_snapshot_id=synthetic_answer_id,
            position=idx,
            occurrences=[idx],
            original_url=orig,
            normalized_url=norm,
            hostname=host,
            title=title,
            extraction_source="MANUAL",
            created_at=now,
        )
        for idx, (orig, norm, host, title, _src) in enumerate(merged, start=1)
    )
    snapshot = GeoAnalysisInputSnapshot(
        schema_version=1,
        answer_sha256=hashlib.sha256(answer_text.encode("utf-8")).hexdigest(),
        subjects=sorted(frozen.subjects, key=lambda s: s.id),
        fact_versions=[],
        configuration=GeoAnalysisConfiguration(
            rule_set_version=RULE_SET_VERSION,
            model_name=None,
            model_version=None,
            prompt_template_version=None,
            prompt_sha256=None,
            parameters=GeoAnalysisParameters(
                temperature=None, top_p=None, max_output_tokens=None, seed=None
            ),
        ),
    )
    result = execution.analyze(
        execution.AnalysisInput(
            snapshot=snapshot,
            answer_text=answer_text,
            citations=synthetic_citations,
            facts=FactAssembly(()),
        )
    )
    mentions_by_sub = {m.subject_id: m for m in result.mentions.mentions}
    recs_by_sub = {r.subject_id: r for r in result.recommendations.recommendations}
    subjects_out = [
        GeoManualPreviewSubjectSuggestion(
            subject_id=sub.id,
            subject_type=sub.subject_type.value,
            display_name=sub.display_name,
            product_id=sub.product_id,
            mentioned=sub.id in mentions_by_sub,
            mention_count=mentions_by_sub[sub.id].mention_count if sub.id in mentions_by_sub else 0,
            matched_aliases=(
                list(mentions_by_sub[sub.id].matched_aliases) if sub.id in mentions_by_sub else []
            ),
            recommendation=(
                recs_by_sub[sub.id].recommendation
                if sub.id in recs_by_sub
                else GeoRecommendationKind.NOT_RECOMMENDED
            ),
            rank=recs_by_sub[sub.id].rank if sub.id in recs_by_sub else None,
        )
        for sub in frozen.subjects
    ]
    publications = _active_publications(db)
    citation_suggestions: list[GeoManualPreviewCitationSuggestion] = []
    for orig, norm, host, _title, source in merged:
        candidate = match_url_against_publications(norm, host, publications)
        citation_suggestions.append(
            GeoManualPreviewCitationSuggestion(
                original_url=orig,
                normalized_url=norm,
                hostname=host,
                source=source,
                suggested_article_publication_id=(
                    candidate.article_publication_id if candidate else None
                ),
                suggested_article_title=candidate.article_title if candidate else None,
                suggested_publication_title=candidate.publication_title if candidate else None,
                suggested_platform_name=candidate.platform_name if candidate else None,
                match_method=candidate.match_method if candidate else None,
                suggested_link_status=candidate.link_status if candidate else None,
                match_reason=candidate.match_reason if candidate else None,
            )
        )
    return GeoManualPreviewOut(
        run_id=run.id,
        subjects=subjects_out,
        extracted_urls=extracted_raw,
        citation_suggestions=citation_suggestions,
        review_required_reasons=list(result.review_required_reasons),
    )


def fail_manual_run(
    db: Session,
    *,
    run_id: UUID,
    payload: GeoManualFailRequest,
    actor: User,
    request_id: str,
) -> GeoManualFailOut:
    """将待录入的人工运行标记为真实采集异常 FAILED（不伪装为未命中）。"""
    with command(db, actor) as current:
        locked = lock_run(db, run_id)
        if locked is None:
            raise not_found("GEO 运行")
        batch, run = locked
        if run.input_snapshot["profile"]["collection_mode"] != "MANUAL":
            raise AppError("GEO_MANUAL_MODE_REQUIRED", "只有 MANUAL 运行可标记人工采集失败", 409)
        if run.revision != payload.expected_run_revision:
            raise AppError("REVISION_CONFLICT", "运行状态已被其他请求变更，请刷新", 409)
        run_transition(run_state(db, run), GeoRunStatus.FAILED)
        draft = db.get(GeoManualDraft, run.id)
        if draft is not None:
            db.delete(draft)
            db.flush()
        now = database_now(db)
        run.status = "FAILED"
        run.error_stage = "COLLECTION"
        run.error_code = payload.error_code.value
        run.error_summary = payload.error_summary
        run.finished_at = now
        run.revision += 1
        db.flush()
        refresh_batch(db, batch, now)
        append_audit(
            db,
            AuditEntry(
                actor_id=current.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_manual_observation.failed",
                target_type="GeoObservationRun",
                target_id=run.id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="已标记人工采集异常失败",
                details={
                    "facts": {
                        "run_id": str(run.id),
                        "error_code": payload.error_code.value,
                        "revision": run.revision,
                    }
                },
            ),
        )
        out = GeoManualFailOut(
            run_id=run.id,
            status="FAILED",
            revision=run.revision,
            error_stage="COLLECTION",
            error_code=payload.error_code,
            error_summary=payload.error_summary,
            finished_at=now,
        )
        db.commit()
        return out
