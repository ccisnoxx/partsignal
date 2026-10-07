"""Plan 命令锁序；初读只确定锁集合，所有可变身份都在锁后重验。"""

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import assert_account_types
from app.errors import AppError, not_found
from app.models.configuration import QueryTopic
from app.models.geo_catalog import GeoSubject
from app.models.geo_monitoring_plans import GeoMonitoringPlan
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import SessionRecord, User
from app.models.product_facts import Product
from app.schemas.common import AccountType
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanConfiguration
from app.services.geo_catalog_locks import BRAND_TYPES
from app.services.geo_plan_queries import configurations
from app.services.geo_surface_locks import lock_bindings


def revision_conflict() -> AppError:
    return AppError("REVISION_CONFLICT", "监测计划或所选配置已被其他请求修改", 409)


@contextmanager
def command(db: Session, actor: User) -> Iterator[User]:
    """复用 User 非键更新锁与 heartbeat 舍弃规则，不持有 Session 写锁。"""
    db.autoflush = False
    try:
        if db.connection().get_isolation_level() != "READ COMMITTED":
            raise ValueError("计划写命令要求 READ COMMITTED 并在行锁后读取当前资格")
        for record in list(db.dirty):
            if isinstance(record, SessionRecord) and record.user_id == actor.id:
                db.expire(record, ["last_seen_at"])
        current = db.scalar(
            select(User)
            .where(User.id == actor.id)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        )
        if current is None or not current.is_active:
            raise AppError("AUTH_REQUIRED", "账号已停用或不存在", 401)
        if current.must_change_password:
            raise AppError("PASSWORD_CHANGE_REQUIRED", "必须先修改临时密码", 403)
        assert_account_types(current, (AccountType.ADMIN, AccountType.ENGINEER))
        yield current
    except Exception:
        db.rollback()
        raise


def lock_resources(db: Session, values: Sequence[GeoMonitoringPlanConfiguration]) -> None:
    subject_ids = {s.subject_id for value in values for s in value.subjects}
    prompt_ids = {p for value in values for p in value.prompt_variant_ids}
    profile_ids = {p for value in values for p in value.collection_profile_ids}
    s, p, v = GeoSubject, GeoCollectionProfile, GeoPromptVariant
    subjects_before = db.execute(
        select(s.id, s.subject_type, s.product_id, s.parent_subject_id).where(s.id.in_(subject_ids))
    ).all()
    profiles_before = db.execute(
        select(p.id, p.engine_surface_id, p.ai_channel_id, p.ai_model_id, p.revision).where(
            p.id.in_(profile_ids)
        )
    ).all()
    prompts_before = db.execute(select(v.id, v.query_topic_id).where(v.id.in_(prompt_ids))).all()
    # 只读取模型绑定ID，lock_bindings不会加载凭据正文。
    lock_bindings(db, tuple((row.ai_channel_id, row.ai_model_id) for row in profiles_before))
    products = {row.product_id for row in subjects_before if row.product_id is not None}
    db.execute(
        select(Product.id).where(Product.id.in_(products)).order_by(Product.id).with_for_update()
    ).all()
    brands = {row.parent_subject_id for row in subjects_before if row.parent_subject_id is not None}
    brands |= {row.id for row in subjects_before if row.subject_type in BRAND_TYPES}
    db.execute(
        select(s.id)
        .where(s.id.in_(brands), s.subject_type.in_(BRAND_TYPES))
        .order_by(s.id)
        .with_for_update()
    ).all()
    subjects_after = db.execute(
        select(s.id, s.subject_type, s.product_id, s.parent_subject_id)
        .where(s.id.in_(subject_ids))
        .order_by(s.id)
        .with_for_update()
    ).all()
    topics = {row.query_topic_id for row in prompts_before}
    db.execute(
        select(QueryTopic.id)
        .where(QueryTopic.id.in_(topics))
        .order_by(QueryTopic.id)
        .with_for_update()
    ).all()
    prompts_after = db.execute(
        select(v.id, v.query_topic_id).where(v.id.in_(prompt_ids)).order_by(v.id).with_for_update()
    ).all()
    surfaces = {row.engine_surface_id for row in profiles_before}
    db.execute(
        select(GeoEngineSurface.id)
        .where(GeoEngineSurface.id.in_(surfaces))
        .order_by(GeoEngineSurface.id)
        .with_for_update()
    ).all()
    profiles_after = db.execute(
        select(p.id, p.engine_surface_id, p.ai_channel_id, p.ai_model_id, p.revision)
        .where(p.id.in_(profile_ids))
        .order_by(p.id)
        .with_for_update()
    ).all()
    if (set(subjects_before), set(prompts_before), set(profiles_before)) != (
        set(subjects_after),
        set(prompts_after),
        set(profiles_after),
    ):
        raise revision_conflict()


def lock_plan(
    db: Session,
    plan_id: UUID,
    expected_revision: int,
    desired: GeoMonitoringPlanConfiguration | None = None,
) -> tuple[GeoMonitoringPlan, GeoMonitoringPlanConfiguration]:
    initial = db.scalar(
        select(GeoMonitoringPlan)
        .where(GeoMonitoringPlan.id == plan_id)
        .execution_options(populate_existing=True)
    )
    if initial is None:
        raise not_found("监测计划")
    before = configurations(db, [initial])[plan_id]
    observed_revision = initial.revision
    lock_resources(db, [before] + ([desired] if desired is not None else []))
    plan = db.scalar(
        select(GeoMonitoringPlan)
        .where(GeoMonitoringPlan.id == plan_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if plan is None:
        raise not_found("监测计划")
    if plan.revision != expected_revision or plan.revision != observed_revision:
        raise revision_conflict()
    current = configurations(db, [plan])[plan_id]
    if current != before:
        raise revision_conflict()
    return plan, current
