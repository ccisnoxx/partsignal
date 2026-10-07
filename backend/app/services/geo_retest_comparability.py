"""严格复测差异列表；当前资格仅用于门禁，不生成替代输入。"""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.collectors.registry import collector_registry
from app.config import settings
from app.models.ai_generation import AIModel
from app.models.configuration import QueryTopic
from app.models.geo_answers import GeoAnswerSnapshot
from app.models.geo_catalog import GeoSubject
from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.schemas.geo_retests import GeoRetestBaselineSnapshot, GeoRetestDifference
from app.schemas.geo_retests import GeoRetestDifferenceCode as Code
from app.schemas.geo_runs import GeoRunPromptSnapshot
from app.schemas.geo_surfaces import GeoCollectionMode
from app.services.geo_batch_snapshots import freeze_subjects
from app.services.geo_collection_profiles import load_profile_facts


def differences(
    db: Session, opportunity: GeoOpportunity, snapshot: GeoRetestBaselineSnapshot
) -> list[GeoRetestDifference]:
    result: list[GeoRetestDifference] = []

    def add(code: Code, identity: UUID | None, field: str, reason: str | None = None) -> None:
        value = GeoRetestDifference(code=code, resource_id=identity, field=field, reason=reason)
        if value not in result:
            result.append(value)

    if opportunity.status != "IN_PROGRESS":
        add(Code.OPPORTUNITY_NOT_IN_PROGRESS, opportunity.id, "status")
    trigger_runs = {
        s.run_id
        for s in snapshot.trigger_snapshot.sources
        if s.source_role not in {"BASELINE", "RETEST"}
    }
    source_batch_ids = set(
        db.scalars(select(GeoObservationRun.batch_id).where(GeoObservationRun.id.in_(trigger_runs)))
    )
    if snapshot.baseline_batch_id not in source_batch_ids:
        add(Code.BASELINE_NOT_SOURCE, snapshot.baseline_batch_id, "baseline_batch_id")
    batch = db.get(GeoObservationBatch, snapshot.baseline_batch_id, populate_existing=True)
    assert batch is not None
    if batch.status not in {"COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "BUDGET_BLOCKED"}:
        add(Code.BASELINE_NOT_FINISHED, batch.id, "status")
    plan = snapshot.plan_snapshot
    expected = {
        (p, c, n)
        for p in plan.prompt_variant_ids
        for c in plan.collection_profile_ids
        for n in range(1, plan.repeat_count + 1)
    }
    actual = {
        (c.input_snapshot.prompt.id, c.input_snapshot.profile.id, c.repeat_index)
        for c in snapshot.cells
    }
    if (
        actual != expected
        or len(actual) != len(snapshot.cells)
        or len(actual) != batch.requested_run_count
    ):
        add(Code.MATRIX_INVALID, batch.id, "cells")
    v, q = GeoPromptVariant, QueryTopic
    prompts = {
        row.id: row
        for row in db.execute(
            select(
                v.id,
                v.revision,
                v.query_topic_id,
                q.revision.label("query_topic_revision"),
                q.canonical_question,
                q.intent_type,
                v.prompt_text,
                v.mention_mode,
                v.priority,
                v.language_code,
                v.region_code,
                v.is_active,
            )
            .join(q, q.id == v.query_topic_id)
            .where(v.id.in_(plan.prompt_variant_ids))
        ).mappings()
    }
    profiles = load_profile_facts(db, plan.collection_profile_ids)
    roles = {s.subject_id: s.role for s in plan.subjects}
    current_subjects = freeze_subjects(db, roles)
    active_subjects = set(
        db.scalars(select(GeoSubject.id).where(GeoSubject.id.in_(roles), GeoSubject.is_active))
    )
    latest_versions = {
        row.profile_id: row
        for row in db.execute(
            select(
                GeoObservationRun.collection_profile_id.label("profile_id"),
                GeoAnswerSnapshot.source_product,
                GeoAnswerSnapshot.source_model,
                GeoAnswerSnapshot.source_version,
            )
            .join(GeoAnswerSnapshot, GeoAnswerSnapshot.run_id == GeoObservationRun.id)
            .where(GeoObservationRun.collection_profile_id.in_(plan.collection_profile_ids))
            .distinct(GeoObservationRun.collection_profile_id)
            .order_by(
                GeoObservationRun.collection_profile_id,
                GeoAnswerSnapshot.collected_at.desc(),
                GeoAnswerSnapshot.id.desc(),
            )
        )
    }
    model_ids = {
        p.profile.ai_model_id for p in profiles.values() if p.profile.ai_model_id is not None
    }
    models = {
        row.id: row.model_id
        for row in db.execute(select(AIModel.id, AIModel.model_id).where(AIModel.id.in_(model_ids)))
    }
    for cell in snapshot.cells:
        frozen = cell.input_snapshot
        prompt = prompts.get(frozen.prompt.id)
        if prompt is None or not prompt.is_active:
            add(Code.VARIANT_UNAVAILABLE, frozen.prompt.id, "prompt")
        else:
            current_prompt = GeoRunPromptSnapshot.model_validate(
                {k: val for k, val in prompt.items() if k not in {"is_active"}}
            )
            if current_prompt.query_topic_revision != frozen.prompt.query_topic_revision:
                add(Code.TOPIC_CHANGED, frozen.prompt.query_topic_id, "query_topic_revision")
            if current_prompt != frozen.prompt:
                add(Code.VARIANT_CHANGED, frozen.prompt.id, "prompt")
        profile = profiles.get(frozen.profile.id)
        if profile is None:
            add(Code.PROFILE_UNAVAILABLE, frozen.profile.id, "profile")
        else:
            eligibility = profile.eligibility(registry=collector_registry, configuration=settings)
            for blocker in eligibility.blockers:
                add(Code.PROFILE_UNAVAILABLE, frozen.profile.id, blocker.field, blocker.code.value)
            if not profile.matches_frozen_profile(
                revision=frozen.profile.revision,
                engine_surface_id=frozen.profile.surface.id,
                collection_mode=GeoCollectionMode(frozen.profile.collection_mode),
                adapter_key=frozen.profile.adapter_key,
                adapter_version=frozen.profile.adapter_version,
                ai_channel_id=frozen.profile.ai_channel_id,
                ai_model_id=frozen.profile.ai_model_id,
                registry=collector_registry,
            ):
                add(Code.PROFILE_CHANGED, frozen.profile.id, "profile")
            if profile.surface.revision != frozen.profile.surface.revision:
                add(Code.SURFACE_CHANGED, frozen.profile.surface.id, "surface_revision")
            if (
                frozen.profile.ai_model_id is not None
                and models.get(frozen.profile.ai_model_id) != cell.source_model
            ):
                add(Code.MODEL_VERSION_CHANGED, frozen.profile.id, "source_model")
        for subject in frozen.subjects:
            if subject.id not in active_subjects:
                add(Code.SUBJECT_UNAVAILABLE, subject.id, "subjects")
        if current_subjects != frozen.subjects:
            add(Code.SUBJECT_CHANGED, batch.id, "subjects")
        observed = latest_versions.get(frozen.profile.id)
        if (
            cell.source_version is None
            or (cell.source_model is None and cell.source_product is None)
            or observed is None
            or observed.source_version is None
        ):
            add(Code.MODEL_VERSION_UNKNOWN, frozen.profile.id, "source_version")
        elif (cell.source_product, cell.source_model, cell.source_version) != (
            observed.source_product,
            observed.source_model,
            observed.source_version,
        ):
            add(Code.MODEL_VERSION_CHANGED, frozen.profile.id, "source_version")
    return result
