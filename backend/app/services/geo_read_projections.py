"""冻结输入与当前资格显式分离；Batch计数只由完整尝试集合投影。"""

from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from datetime import datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from app.collectors.registry import ProfileBlockerCode, collector_registry
from app.config import settings
from app.errors import AppError
from app.models.geo_runs import GeoObservationBatch
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_plan_preview import GeoKnownCostTotal
from app.schemas.geo_read_models import (
    GeoBatchListItem,
    GeoBatchSummary,
    GeoRunCostSummary,
    GeoRunListItem,
    GeoRunStatusCounts,
)
from app.schemas.geo_run_workflow import (
    GeoBatchWorkflowProjection,
    GeoRunPrimaryTask,
    GeoRunWorkflowStage,
)
from app.schemas.geo_runs import GeoObservationRunOut
from app.schemas.geo_surface_management import GeoProfileActivationBlocker
from app.schemas.geo_surfaces import GeoCollectionMode
from app.services.geo_batch_policy import BatchRunState, batch_workflow, latest_cell_attempts
from app.services.geo_collection_profiles import ProfileFacts
from app.services.geo_run_policy import RunCommandAvailability, RunState, retryable, run_workflow

COMMANDS = RunCommandAvailability(manual_entry=True, cancel=False, retry=True)


def incomplete() -> AppError:
    return AppError("GEO_READ_MODEL_INCOMPLETE", "运行历史或原始证据不完整，无法形成一致详情", 409)


def state(row: Mapping[str, Any]) -> RunState:
    return RunState(
        status=row["status"],
        collection_mode=row["collection_mode"],
        external_call_state=row["external_call_state"],
        error_stage=row["error_stage"],
        has_answer=row["answer_snapshot_id"] is not None,
        has_successor=row["has_successor"],
    )


def collection_availability(
    row: Mapping[str, Any], profiles: Mapping[UUID, ProfileFacts]
) -> tuple[bool, bool, list[GeoProfileActivationBlocker]]:
    facts = profiles.get(row["collection_profile_id"])
    if facts is None:
        raise incomplete()
    result = facts.eligibility(registry=collector_registry, configuration=settings)
    matches = (
        facts.profile.collection_mode == row["collection_mode"]
        and str(facts.profile.engine_surface_id) == row["surface_id"]
    )
    if retryable(state(row)):
        matches = matches and facts.matches_frozen_profile(
            revision=row["profile_revision"],
            engine_surface_id=UUID(row["surface_id"]),
            collection_mode=GeoCollectionMode(row["collection_mode"]),
            adapter_key=row["adapter_key"],
            adapter_version=row["adapter_version"],
            ai_channel_id=UUID(row["ai_channel_id"]) if row["ai_channel_id"] else None,
            ai_model_id=UUID(row["ai_model_id"]) if row["ai_model_id"] else None,
            registry=collector_registry,
        )
    blockers = [GeoProfileActivationBlocker(code=b.code, field=b.field) for b in result.blockers]
    if not matches:
        blockers.append(
            GeoProfileActivationBlocker(
                code=ProfileBlockerCode.CONFIGURATION_INVALID, field="profile.binding"
            )
        )
    return result.eligible and matches, matches, blockers


def run_item(
    row: Mapping[str, Any], profiles: Mapping[UUID, ProfileFacts], actor: User
) -> GeoRunListItem:
    eligible, matches, blockers = collection_availability(row, profiles)
    workflow = run_workflow(
        state(row),
        actor_type=AccountType(actor.account_type),
        actor_active=actor.is_active,
        collection_eligible=eligible,
        commands=COMMANDS,
    )
    if row["analysis_needs_review"]:
        workflow = workflow.model_copy(
            update={
                "workflow_stage": GeoRunWorkflowStage.REVIEW_REQUIRED,
                "primary_task": GeoRunPrimaryTask.VIEW_REVIEW,
            }
        )
    elif row["status"] == "NEEDS_REVIEW" and row["current_analysis_revision_id"] is not None:
        # 重分析不改首轮Run历史；当前分析已放行时，不继续展示旧复核待办。
        workflow = workflow.model_copy(
            update={
                "workflow_stage": GeoRunWorkflowStage.COMPLETED,
                "primary_task": GeoRunPrimaryTask.VIEW_OBSERVATION,
            }
        )
    return GeoRunListItem.model_validate(
        {name: row[name] for name in GeoObservationRunOut.model_fields}
        | workflow.model_dump()
        | {
            "answer_snapshot_id": row["answer_snapshot_id"],
            "collection_eligible": eligible,
            "frozen_binding_matches": matches,
            "collection_blockers": blockers,
            "is_latest_attempt": not row["has_successor"],
        }
    )


def batch_projection(
    batch: GeoObservationBatch,
    rows: Sequence[Mapping[str, Any]],
    profiles: Mapping[UUID, ProfileFacts],
    actor: User,
) -> tuple[GeoBatchSummary, GeoBatchWorkflowProjection, datetime | None, datetime | None]:
    values = [BatchRunState(row["run_cell_key"], row["attempt_no"], state(row)) for row in rows]
    try:
        latest = latest_cell_attempts(
            values, requested_run_count=batch.requested_run_count, matrix_committed=True
        )
        eligibility = {
            row["run_cell_key"]: collection_availability(row, profiles)[0]
            for row in rows
            if not row["has_successor"]
        }
        workflow = batch_workflow(
            values,
            requested_run_count=batch.requested_run_count,
            matrix_committed=True,
            actor_type=AccountType(actor.account_type),
            actor_active=actor.is_active,
            collection_eligibility=eligibility,
            run_commands=COMMANDS,
            cancel_available=False,
        )
    except ValueError as error:
        raise incomplete() from error
    counts = Counter(value.state.status.value.lower() for value in latest)
    costs: dict[str, Decimal] = defaultdict(Decimal)
    known = 0
    for row in rows:
        if row["cost_amount"] is not None:
            costs[row["cost_currency"]] += row["cost_amount"]
            known += 1
    summary = GeoBatchSummary(
        requested_run_count=batch.requested_run_count,
        attempt_count=len(rows),
        status_counts=GeoRunStatusCounts(
            **{key: counts[key] for key in GeoRunStatusCounts.model_fields}
        ),
        pending_manual_count=sum(
            value.state.status == "PENDING" and value.state.collection_mode == "MANUAL"
            for value in latest
        ),
        cost=GeoRunCostSummary(
            known_attempt_count=known,
            unknown_attempt_count=len(rows) - known,
            known_costs=[GeoKnownCostTotal(currency=c, value=costs[c]) for c in sorted(costs)],
        ),
    )
    started = min((r["started_at"] for r in rows if r["started_at"] is not None), default=None)
    finished = (
        max((r["finished_at"] for r in rows if r["finished_at"] is not None), default=None)
        if workflow.status in {"COMPLETED", "PARTIAL", "FAILED", "CANCELLED", "BUDGET_BLOCKED"}
        else None
    )
    return summary, workflow, started, finished


def batch_item(
    batch: GeoObservationBatch,
    projection: tuple[
        GeoBatchSummary, GeoBatchWorkflowProjection, datetime | None, datetime | None
    ],
) -> GeoBatchListItem:
    summary, workflow, started, finished = projection
    return GeoBatchListItem(
        **workflow.model_dump(),
        id=batch.id,
        plan_id=batch.plan_id,
        plan_name=batch.plan_snapshot["name"],
        plan_revision=batch.plan_snapshot["plan_revision"],
        trigger_type=batch.trigger_type,
        revision=batch.revision,
        created_by=batch.created_by,
        scheduled_for=batch.scheduled_for,
        created_at=batch.created_at,
        started_at=started,
        finished_at=finished,
        summary=summary,
    )
