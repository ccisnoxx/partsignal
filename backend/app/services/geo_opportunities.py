"""机会批量应用服务：一致输入捕获、确定性去重与追加证据原子提交。"""

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from hashlib import sha256
from uuid import UUID, uuid4

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.config import settings
from app.errors import AppError
from app.models.geo_catalog import GeoSubject
from app.models.geo_opportunities import (
    OPEN_PREDICATE,
    GeoOpportunity,
    GeoOpportunityEvaluation,
    GeoOpportunitySource,
)
from app.models.geo_rules import GeoRuleSetRevision
from app.models.identity import User
from app.models.product_facts import Product
from app.schemas.common import AccountType
from app.schemas.geo_insights import GeoOverviewFilters
from app.schemas.geo_opportunities import GeoOpportunityTriggerSnapshot
from app.schemas.geo_rules import GeoRuleConfiguration
from app.services.current_actor import current_actor_command
from app.services.geo_catalog_locks import BRAND_TYPES
from app.services.geo_metric_views import MetricWindow
from app.services.geo_opportunity_policy import OPEN_STATUSES, identity_key
from app.services.geo_opportunity_rules import evaluate_rules
from app.services.geo_opportunity_types import RuleEvaluation
from app.services.geo_overview_queries import load_inputs
from app.services.geo_rule_policy import FrozenRuleSet
from app.services.geo_rules import freeze_current_rules


@dataclass(frozen=True)
class EvaluationResult:
    evaluation_id: UUID
    opportunity_id: UUID | None
    disposition: str
    replayed: bool
    as_of: datetime
    unavailable_reasons: tuple[str, ...]


def _snapshot(
    result: RuleEvaluation, filters: GeoOverviewFilters, rules: FrozenRuleSet
) -> dict[str, object]:
    value = GeoOpportunityTriggerSnapshot.model_validate(
        {
            "schema_version": 1,
            "rule_snapshot": rules.snapshot(),
            "rule_code": result.rule_code,
            "scope": asdict(result.scope),
            "source_date_from": filters.date_from,
            "source_date_to": filters.date_to,
            "triggered": result.triggered,
            "priority": result.priority,
            "value": result.value,
            "threshold": result.threshold,
            "numerator": result.numerator,
            "denominator": result.denominator,
            "unavailable_reasons": list(result.unavailable_reasons),
            "sources": [asdict(s) for s in result.sources],
            "details": json.loads(result.details_json),
        }
    )
    return value.model_dump(mode="json")


def _lock_subjects(db: Session, results: list[RuleEvaluation]) -> None:
    """新增历史引用沿Catalog删除锁序：Product→品牌→目标Subject。"""
    ids = {r.scope.subject_id for r in results if r.triggered and r.scope.subject_id is not None}
    if not ids:
        return
    rows = db.execute(
        select(GeoSubject.id, GeoSubject.product_id, GeoSubject.parent_subject_id).where(
            GeoSubject.id.in_(ids)
        )
    ).all()
    products = {r.product_id for r in rows if r.product_id is not None}
    brands = {r.parent_subject_id for r in rows if r.parent_subject_id is not None} | ids
    db.execute(
        select(Product.id)
        .where(Product.id.in_(products))
        .order_by(Product.id)
        .with_for_update(key_share=True)
    ).all()
    db.execute(
        select(GeoSubject.id)
        .where(GeoSubject.id.in_(brands), GeoSubject.subject_type.in_(BRAND_TYPES))
        .order_by(GeoSubject.id)
        .with_for_update(key_share=True)
    ).all()
    locked = set(
        db.scalars(
            select(GeoSubject.id)
            .where(GeoSubject.id.in_(ids))
            .order_by(GeoSubject.id)
            .with_for_update(key_share=True)
        )
    )
    if locked != ids:
        raise AppError("GEO_READ_MODEL_INCOMPLETE", "机会来源对象已不存在", 409)


def _capture(
    db: Session, filters: GeoOverviewFilters, rule_set_revision: int | None = None
) -> tuple[datetime, FrozenRuleSet, list[RuleEvaluation]]:
    # 捕获事务只读；不可变结果和review身份进入写事务，不依赖后续current指针。
    with Session(bind=db.get_bind(), autoflush=False) as reader:
        reader.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        if rule_set_revision is None:
            rules = freeze_current_rules(reader)
        else:
            reader.execute(text("SET LOCAL statement_timeout = '120s'"))
            record = reader.get(GeoRuleSetRevision, rule_set_revision)
            if record is None:
                raise AppError("RESOURCE_NOT_FOUND", "所选 GEO 规则 revision 不存在", 404)
            rules = FrozenRuleSet.freeze(
                record.revision, GeoRuleConfiguration.model_validate(record.configuration)
            )
        window = MetricWindow(filters.date_from, filters.date_to)
        start = min(
            window.previous.date_from,
            filters.date_to - timedelta(days=rules.configuration().repeated_error_window_days),
        )
        combined = filters.model_copy(update={"date_from": start})
        as_of, inputs = load_inputs(reader, combined)
        current = [s for s in inputs if filters.date_from <= s.created_at < filters.date_to]
        batch_ids = {s.metric.batch_id for s in current}
        profile_ids = {s.metric.dimensions.collection_profile_id for s in current}
        # 业务筛选只选择需评估的批次/profile，不能从治理分母或失败序列删掉打断项。
        governance_filters = GeoOverviewFilters(
            date_from=filters.date_from, date_to=filters.date_to
        )
        _, governance = load_inputs(reader, governance_filters) if current else (as_of, [])
        results = evaluate_rules(
            inputs,
            filters,
            rules,
            quality_inputs=[s for s in governance if s.metric.batch_id in batch_ids],
            failure_inputs=[
                s for s in governance if s.metric.dimensions.collection_profile_id in profile_ids
            ],
        )
        reader.rollback()
    return as_of, rules, results


def _append_sources(db: Session, opportunity_id: UUID, result: RuleEvaluation) -> None:
    if not result.sources:
        raise ValueError("触发机会缺少真实运行来源")
    # 精确唯一键含NULLS NOT DISTINCT；不吞其他FK/归属/不可变错误。
    db.execute(
        insert(GeoOpportunitySource)
        .values(
            [{"id": uuid4(), "opportunity_id": opportunity_id, **asdict(s)} for s in result.sources]
        )
        .on_conflict_do_nothing(
            index_elements=[
                "opportunity_id",
                "run_id",
                "analysis_revision_id",
                "review_id",
                "source_role",
            ]
        )
    )


def _persist(
    db: Session,
    result: RuleEvaluation,
    snapshot: dict[str, object],
    key: str,
    *,
    evaluation_key: str,
    rules: FrozenRuleSet,
    as_of: datetime,
    actor_id: UUID,
    request_id: str,
) -> EvaluationResult:
    now = db.scalar(select(func.clock_timestamp()))
    assert now is not None
    closed = db.execute(
        select(GeoOpportunity.id, GeoOpportunity.resolved_at)
        .where(
            GeoOpportunity.identity_key == key,
            GeoOpportunity.status.in_(("RESOLVED", "DISMISSED")),
        )
        .order_by(GeoOpportunity.resolved_at.desc(), GeoOpportunity.id.desc())
        .limit(1)
    ).first()
    recent = closed is not None and closed.resolved_at >= now - timedelta(
        days=rules.configuration().dedup_window_days
    )
    if result.triggered and closed is not None:
        # 关闭/去重到期改变逻辑评估世代；不能让旧重放永久屏蔽新机会。
        evaluation_key = sha256(f"{evaluation_key}:{closed.id}:{recent}".encode()).hexdigest()
    existing = db.scalar(
        select(GeoOpportunityEvaluation).where(
            GeoOpportunityEvaluation.evaluation_key == evaluation_key
        )
    )
    if existing is not None:
        return EvaluationResult(
            existing.id, existing.opportunity_id, existing.disposition, True,
            as_of, result.unavailable_reasons,
        )
    opportunity_id: UUID | None = None
    disposition = "UNAVAILABLE" if result.unavailable_reasons else "NO_TRIGGER"
    if result.triggered:
        current = db.scalar(
            select(GeoOpportunity)
            .where(GeoOpportunity.identity_key == key, GeoOpportunity.status.in_(OPEN_STATUSES))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if current is None:
            if recent:
                disposition = "SUPPRESSED"
            else:
                proposed = uuid4()
                scope = asdict(result.scope)
                scope.pop("environment_key")
                opportunity_id = db.scalar(
                    insert(GeoOpportunity)
                    .values(
                        id=proposed,
                        identity_key=key,
                        rule_code=result.rule_code.value,
                        priority=result.priority,
                        status="OPEN",
                        trigger_snapshot=snapshot,
                        source_date_from=datetime.fromisoformat(str(snapshot["source_date_from"])),
                        source_date_to=datetime.fromisoformat(str(snapshot["source_date_to"])),
                        **scope,
                    )
                    .on_conflict_do_nothing(
                        index_elements=["identity_key"], index_where=text(OPEN_PREDICATE)
                    )
                    .returning(GeoOpportunity.id)
                )
                if opportunity_id is not None:
                    disposition = "CREATED"
                else:
                    # 独立写入者可不遵守advisory锁；partial unique获胜后重读实际开放行。
                    current = db.scalar(
                        select(GeoOpportunity)
                        .where(
                            GeoOpportunity.identity_key == key,
                            GeoOpportunity.status.in_(OPEN_STATUSES),
                        )
                        .with_for_update()
                        .execution_options(populate_existing=True)
                    )
                    if current is None:
                        raise RuntimeError("机会identity冲突后没有开放记录")
        if current is not None:
            opportunity_id = current.id
            current.revision += 1
            # 等待唯一键竞争/行锁后才取更新时钟，不能倒退竞争获胜行的历史时间。
            locked_now = db.scalar(select(func.clock_timestamp()))
            assert locked_now is not None
            current.last_seen_at = max(current.last_seen_at, locked_now)
            disposition = "UPDATED"
            db.flush()
        if opportunity_id is not None:
            _append_sources(db, opportunity_id, result)
    evaluation = GeoOpportunityEvaluation(
        evaluation_key=evaluation_key,
        identity_key=key,
        rule_set_revision=rules.revision,
        opportunity_id=opportunity_id,
        result_snapshot=snapshot,
        disposition=disposition,
        as_of=as_of,
        created_by=actor_id,
    )
    db.add(evaluation)
    db.flush()
    if disposition == "CREATED":
        # 只记录真实创建；同输入重放、追加评估与旁路唯一键获胜都不重复 opened。
        append_audit(
            db,
            AuditEntry(
                actor_id=actor_id,
                business_module=AuditModule.GEO_OBSERVATION,
                action="geo_opportunity.opened",
                target_type="GeoOpportunity",
                target_id=opportunity_id,
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="规则机会已创建，首次来源证据保留",
                details={"facts": {"revision": 1, "status": "OPEN"}},
            ),
        )
    return EvaluationResult(
        evaluation.id, opportunity_id, disposition, False, as_of, result.unavailable_reasons
    )


def ensure_evaluation_enabled() -> None:
    if not settings.geo_monitoring_enabled or not settings.geo_opportunity_evaluation_enabled:
        raise AppError("GEO_MONITORING_DISABLED", "GEO机会评估尚未启用", 409)


def evaluate_opportunities(
    db: Session, filters: GeoOverviewFilters, *, actor: User, request_id: str,
    rule_set_revision: int | None = None, commit: bool = True,
) -> list[EvaluationResult]:
    """管理员领域入口；外层可拥有回执/审计事务，规则与机会写入只有这一处实现。"""
    # 正式评估不能用REVIEWED_ONLY等展示筛选隐藏未终态治理样本或复核缺口。
    if filters.review_policy != "EFFECTIVE":
        raise AppError("VALIDATION_ERROR", "机会评估要求有效结果口径", 422)
    with current_actor_command(db, actor, allowed=(AccountType.ADMIN,)) as current_actor:
        if db.connection().get_isolation_level() != "READ COMMITTED":
            raise ValueError("机会评估写入要求 READ COMMITTED")
        ensure_evaluation_enabled()
        as_of, rules, results = (
            _capture(db, filters) if rule_set_revision is None
            else _capture(db, filters, rule_set_revision)
        )
        prepared = []
        for result in results:
            key = identity_key(result.rule_code, result.scope, filters.date_from, filters.date_to)
            snapshot = _snapshot(result, filters, rules)
            fingerprint = sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
            prepared.append((key, fingerprint, result, snapshot))
        _lock_subjects(db, results)
        for key in sorted({p[0] for p in prepared}):
            db.execute(select(func.pg_advisory_xact_lock(int(key[:16], 16) - (1 << 63))))
        values = [
            _persist(
                db,
                result,
                snapshot,
                key,
                evaluation_key=fingerprint,
                rules=rules,
                as_of=as_of,
                actor_id=current_actor.id,
                request_id=request_id,
            )
            for key, fingerprint, result, snapshot in sorted(prepared, key=lambda p: (p[0], p[1]))
        ]
        if commit:
            db.commit()
        return values
