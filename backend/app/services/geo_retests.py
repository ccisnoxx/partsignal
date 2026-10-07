"""RetestPlanner事务：资源锁后比较，逐项复制冻结基线与矩阵，幂等原子提交。"""

import json
import re
from hashlib import sha256
from itertools import batched
from uuid import UUID, uuid4

from sqlalchemy import insert, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError, not_found
from app.models.geo_batch_creation import GeoBatchSubject
from app.models.geo_opportunities import GeoOpportunity
from app.models.geo_retests import GeoRetestBaseline, GeoRetestRequest
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.identity import User
from app.schemas.geo_retests import GeoRetestCreated, GeoRetestPreview
from app.schemas.geo_retests import GeoRetestRequest as Request
from app.services.geo_dispatch import dispatch_created_batch
from app.services.geo_plan_locks import command, lock_resources
from app.services.geo_retest_baselines import baseline_snapshot
from app.services.geo_retest_comparability import differences


def preview_retest(db: Session, opportunity_id: UUID, baseline_batch_id: UUID) -> GeoRetestPreview:
    opportunity = db.get(GeoOpportunity, opportunity_id, populate_existing=True)
    if opportunity is None:
        raise not_found("GEO机会")
    baseline_id, snapshot = baseline_snapshot(db, opportunity, baseline_batch_id)
    changed = differences(db, opportunity, snapshot)
    return GeoRetestPreview(
        opportunity_id=opportunity_id,
        opportunity_revision=opportunity.revision,
        baseline_id=baseline_id,
        baseline_batch_id=baseline_batch_id,
        snapshot=snapshot,
        comparable=not changed,
        requires_new_baseline=bool(changed),
        differences=changed,
    )


def _receipt(db: Session, request: GeoRetestRequest, *, replayed: bool) -> GeoRetestCreated:
    batch = db.get(GeoObservationBatch, request.batch_id)
    assert batch is not None
    return GeoRetestCreated(
        baseline_id=request.baseline_id,
        batch_id=batch.id,
        requested_run_count=batch.requested_run_count,
        opportunity_revision=request.opportunity_revision_after,
        created_at=batch.created_at,
        replayed=replayed,
    )


def create_retest(
    db: Session,
    opportunity_id: UUID,
    payload: Request,
    *,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> GeoRetestCreated:
    if re.fullmatch(r"[\x21-\x7e]{8,128}", idempotency_key) is None:
        raise AppError("VALIDATION_ERROR", "幂等键必须为8至128个可打印ASCII非空白字符", 422)
    key_hash = sha256(idempotency_key.encode()).hexdigest()
    request_hash = sha256(
        json.dumps(
            [str(opportunity_id), payload.model_dump(mode="json")],
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    try:
        with command(db, actor) as current:
            db.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                {"key": f"geo-retest:{current.id}:{key_hash}"},
            )
            previous = db.scalar(
                select(GeoRetestRequest).where(
                    GeoRetestRequest.created_by == current.id,
                    GeoRetestRequest.request_key_sha256 == key_hash,
                )
            )
            if previous is not None:
                if previous.request_sha256 != request_hash:
                    raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一复测请求", 409)
                result = _receipt(db, previous, replayed=True)
                db.commit()
                return result
            opportunity = db.get(GeoOpportunity, opportunity_id, populate_existing=True)
            if opportunity is None:
                raise not_found("GEO机会")
            _, snapshot = baseline_snapshot(db, opportunity, payload.baseline_batch_id)
            # 只以历史ID确定锁集合；不会读取当前Plan重建矩阵。
            lock_resources(db, [snapshot.plan_snapshot], no_key_update=True)
            opportunity = db.scalar(
                select(GeoOpportunity)
                .where(GeoOpportunity.id == opportunity_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if opportunity is None:
                raise not_found("GEO机会")
            if opportunity.revision != payload.expected_revision:
                raise AppError("REVISION_CONFLICT", "机会已被其他请求修改，请刷新后重试", 409)
            baseline_id, snapshot = baseline_snapshot(db, opportunity, payload.baseline_batch_id)
            changed = differences(db, opportunity, snapshot)
            if changed:
                raise AppError(
                    "GEO_RETEST_NOT_COMPARABLE",
                    "基线条件无法严格复现，请建立新基线或取消",
                    409,
                    {
                        "differences": [d.model_dump(mode="json") for d in changed],
                        "requires_new_baseline": True,
                    },
                )
            if baseline_id is None:
                baseline = GeoRetestBaseline(
                    id=uuid4(),
                    opportunity_id=opportunity.id,
                    baseline_batch_id=payload.baseline_batch_id,
                    snapshot=snapshot.model_dump(mode="json"),
                    created_by=current.id,
                )
                db.add(baseline)
                db.flush()
                baseline_id = baseline.id
            batch = GeoObservationBatch(
                id=uuid4(),
                plan_id=snapshot.plan_snapshot.plan_id,
                trigger_type="RETEST",
                source_opportunity_id=opportunity.id,
                baseline_batch_id=payload.baseline_batch_id,
                plan_snapshot=snapshot.plan_snapshot.model_dump(mode="json"),
                rule_snapshot=snapshot.rule_snapshot.model_dump(mode="json"),
                requested_run_count=len(snapshot.cells),
                created_by=current.id,
            )
            db.add(batch)
            db.flush()
            db.execute(
                insert(GeoBatchSubject),
                [
                    {"batch_id": batch.id, "subject_id": s.subject_id, "role": s.role}
                    for s in snapshot.plan_snapshot.subjects
                ],
            )
            for cells in batched(snapshot.cells, 250):
                db.execute(
                    insert(GeoObservationRun),
                    [
                        {
                            "id": uuid4(),
                            "batch_id": batch.id,
                            "prompt_variant_id": c.input_snapshot.prompt.id,
                            "collection_profile_id": c.input_snapshot.profile.id,
                            "repeat_index": c.repeat_index,
                            "input_snapshot": c.input_snapshot.model_dump(mode="json"),
                        }
                        for c in cells
                    ],
                )
            batch.status, batch.revision = "QUEUED", 1
            opportunity.revision += 1
            db.flush()
            request = GeoRetestRequest(
                id=uuid4(),
                baseline_id=baseline_id,
                batch_id=batch.id,
                created_by=current.id,
                request_key_sha256=key_hash,
                request_sha256=request_hash,
                opportunity_revision_after=opportunity.revision,
            )
            db.add(request)
            db.flush()
            append_audit(
                db,
                AuditEntry(
                    actor_id=current.id,
                    business_module=AuditModule.GEO_OBSERVATION,
                    action="geo.retest.created",
                    target_type="GeoOpportunity",
                    target_id=opportunity.id,
                    request_id=request_id,
                    outcome=AuditOutcome.SUCCESS,
                    result_message="严格同口径复测已创建，基线冻结",
                    details={
                        "facts": {
                            "baseline_id": str(baseline_id),
                            "baseline_batch_id": str(payload.baseline_batch_id),
                            "batch_id": str(batch.id),
                            "requested_run_count": len(snapshot.cells),
                            "revision": opportunity.revision,
                        }
                    },
                ),
            )
            result = _receipt(db, request, replayed=False)
            db.commit()
            dispatch_created_batch(db, batch.id)
            return result
    except IntegrityError as error:
        db.rollback()
        if (
            getattr(error.orig, "sqlstate", None),
            getattr(getattr(error.orig, "diag", None), "constraint_name", None),
        ) == ("23505", "uq_geo_retest_request_key"):
            raise AppError("IDEMPOTENCY_CONFLICT", "复测请求键已被使用", 409) from error
        raise
