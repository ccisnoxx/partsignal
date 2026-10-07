"""规则应用服务：User→当前指针锁、CAS、审计原子提交和只读 preview。"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import append_audit
from app.audit_types import AuditEntry, AuditModule, AuditOutcome
from app.errors import AppError
from app.models.geo_rules import GeoRuleSetCurrent, GeoRuleSetRevision
from app.models.identity import User
from app.schemas.geo_rules import (
    GeoRuleConfiguration,
    GeoRulePreviewRead,
    GeoRulePreviewRequest,
    GeoRuleSetRead,
    GeoRuleUpdateRequest,
)
from app.services.geo_rule_policy import FrozenRuleSet, sample_gates
from app.services.geo_surface_locks import command, revision_conflict


def _current(db: Session, *, lock: bool = False) -> GeoRuleSetRevision:
    query = (
        select(GeoRuleSetCurrent)
        .where(GeoRuleSetCurrent.id == 1)
        .execution_options(populate_existing=True)
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    pointer = db.scalar(query)
    if pointer is None:
        raise AppError("GEO_RULES_UNAVAILABLE", "规则配置尚未完成数据库迁移", 503)
    record = db.get(GeoRuleSetRevision, pointer.revision)
    if record is None:
        raise RuntimeError("规则当前指针指向不存在的 revision")
    return record


def _read(record: GeoRuleSetRevision) -> GeoRuleSetRead:
    return GeoRuleSetRead(
        revision=record.revision,
        configuration=GeoRuleConfiguration.model_validate(record.configuration),
        updated_at=record.created_at,
        updated_by=record.created_by,
        available_actions=["UPDATE", "PREVIEW"],
    )


def get_rules(db: Session) -> GeoRuleSetRead:
    return _read(_current(db))


def freeze_current_rules(db: Session) -> FrozenRuleSet:
    """未来评估在自身一致读事务中调用，并将 snapshot 完整写入 Opportunity。"""
    record = _current(db)
    return FrozenRuleSet.freeze(
        record.revision, GeoRuleConfiguration.model_validate(record.configuration)
    )


def update_rules(
    db: Session, payload: GeoRuleUpdateRequest, *, actor: User, request_id: str
) -> GeoRuleSetRead:
    with command(db, actor) as current_actor:
        before = _current(db, lock=True)
        if before.revision != payload.expected_revision:
            raise revision_conflict()
        value = payload.configuration.model_dump(mode="json")
        if before.configuration == value:
            result = _read(before)
            db.commit()
            return result
        after = GeoRuleSetRevision(
            revision=before.revision + 1,
            configuration=value,
            created_by=current_actor.id,
        )
        db.add(after)
        db.flush()
        pointer = db.get(GeoRuleSetCurrent, 1)
        assert pointer is not None
        pointer.revision = after.revision
        append_audit(
            db,
            AuditEntry(
                actor_id=current_actor.id,
                business_module=AuditModule.CONFIGURATION,
                action="geo_rule_set.updated",
                target_type="GeoRuleSet",
                target_id="current",
                request_id=request_id,
                outcome=AuditOutcome.SUCCESS,
                result_message="GEO 规则集已更新，仅用于未来评估",
                details={"facts": {"revision": after.revision}},
            ),
        )
        result = _read(after)
        db.commit()
        return result


def preview_rules(db: Session, payload: GeoRulePreviewRequest) -> GeoRulePreviewRead:
    current = _current(db)
    if current.revision != payload.expected_revision:
        raise revision_conflict()
    changed = current.configuration != payload.configuration.model_dump(mode="json")
    revision = current.revision + int(changed)
    frozen = FrozenRuleSet.freeze(revision, payload.configuration)
    policy = frozen.sample_policy()
    return GeoRulePreviewRead(
        baseline_revision=current.revision,
        proposed_revision=revision,
        changed=changed,
        snapshot=frozen.snapshot(),
        current_sample_level=policy.level(payload.samples.current_runs),
        previous_sample_level=policy.level(payload.samples.previous_runs),
        sample_gates=sample_gates(
            frozen,
            current_runs=payload.samples.current_runs,
            previous_runs=payload.samples.previous_runs,
        ),
        preview_scope="CONFIGURATION_AND_SAMPLE_GATES",
    )
