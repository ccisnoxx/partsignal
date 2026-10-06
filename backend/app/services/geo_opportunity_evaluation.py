"""手动评估事务 owner：请求去重、领域服务调用、冻结摘要与安全审计。"""

import json
import re
from collections import Counter
from hashlib import sha256
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError
from app.models.geo_opportunity_evaluation import GeoOpportunityEvaluationRun
from app.models.identity import User
from app.schemas.common import AccountType
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_opportunity_evaluation import (
    GeoOpportunityEvaluationReceipt,
    GeoOpportunityEvaluationRequest,
    GeoOpportunityUnavailableReason,
)
from app.services.current_actor import current_actor_command
from app.services.geo_opportunities import ensure_evaluation_enabled, evaluate_opportunities
from app.services.geo_ops_runtime import observe


@observe("opportunity_evaluate", "OPPORTUNITY")
def run_evaluation(
    db: Session,
    payload: GeoOpportunityEvaluationRequest,
    *,
    actor: User,
    request_id: str,
    idempotency_key: str,
) -> GeoOpportunityEvaluationReceipt:
    if re.fullmatch(r"[\x21-\x7e]{8,128}", idempotency_key) is None:
        raise AppError("VALIDATION_ERROR", "幂等键必须为8至128个可打印ASCII非空白字符", 422)
    snapshot = payload.model_dump(mode="json")
    key_hash = sha256(idempotency_key.encode()).hexdigest()
    request_hash = sha256(
        json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current:
        if db.connection().get_isolation_level() != "READ COMMITTED":
            raise ValueError("手动评估要求 READ COMMITTED")
        ensure_evaluation_enabled()
        db.execute(text("SET LOCAL lock_timeout = '5s'"))
        db.execute(text("SET LOCAL statement_timeout = '120s'"))
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"geo-evaluation:{current.id}:{key_hash}"},
        )
        previous = db.scalar(
            select(GeoOpportunityEvaluationRun).where(
                GeoOpportunityEvaluationRun.created_by == current.id,
                GeoOpportunityEvaluationRun.request_key_sha256 == key_hash,
            )
        )
        if previous is not None:
            if previous.request_sha256 != request_hash:
                raise AppError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一机会评估请求", 409)
            receipt = GeoOpportunityEvaluationReceipt.model_validate(previous.receipt)
            db.commit()
            return receipt.model_copy(update={"replayed": True})
        filters = GeoOverviewFilters(
            date_from=payload.date_from,
            date_to=payload.date_to,
            subject_ids=payload.subject_ids,
            engine_surface_ids=payload.engine_surface_ids,
            collection_profile_ids=payload.collection_profile_ids,
            collection_modes=payload.collection_modes,
        )
        results = evaluate_opportunities(
            db,
            filters,
            actor=current,
            request_id=request_id,
            rule_set_revision=payload.rule_set_revision,
            commit=False,
        )
        # evaluator 对缺候选规则也返回显式结果，因此捕获时点始终存在。
        if not results:
            raise RuntimeError("机会 evaluator 缺少评估结果和捕获时点")
        created = sum(r.disposition == "CREATED" and not r.replayed for r in results)
        reused = sum(
            r.opportunity_id is not None and (r.replayed or r.disposition != "CREATED")
            for r in results
        )
        reasons = Counter(code for r in results for code in r.unavailable_reasons)
        receipt = GeoOpportunityEvaluationReceipt(
            evaluation_run_id=uuid4(),
            rule_set_revision=payload.rule_set_revision,
            evaluated_cells=len(results),
            created=created,
            existing_reused=reused,
            skipped=len(results) - created - reused,
            unavailable_reasons=[
                GeoOpportunityUnavailableReason(code=code, count=count)
                for code, count in sorted(reasons.items())
            ],
            as_of=results[0].as_of,
            replayed=False,
        )
        db.add(
            GeoOpportunityEvaluationRun(
                id=receipt.evaluation_run_id,
                created_by=current.id,
                request_key_sha256=key_hash,
                request_sha256=request_hash,
                rule_set_revision=payload.rule_set_revision,
                request_snapshot=snapshot,
                receipt=receipt.model_dump(mode="json"),
            )
        )
        append_audit(
            db,
            AuditEntry(
                actor_id=current.id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_opportunity.evaluated",
                target_type="GeoOpportunityEvaluationRun",
                target_id=receipt.evaluation_run_id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="管理员已显式完成一次机会评估",
                details={
                    "facts": {
                        "scope": payload.scope,
                        "revision": payload.rule_set_revision,
                        "evaluated_cells": receipt.evaluated_cells,
                        "created": receipt.created,
                        "existing_reused": receipt.existing_reused,
                        "skipped": receipt.skipped,
                        "unavailable_reasons": sorted(reasons),
                        "as_of": receipt.as_of.isoformat(),
                        "filter_sha256": request_hash,
                    }
                },
            ),
        )
        db.commit()
        return receipt
