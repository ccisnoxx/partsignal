"""Catalog 当前聚合读模型；同一快照批量加载身份、字典及直接引用。"""

from collections import defaultdict
from collections.abc import Sequence
from typing import Literal
from uuid import UUID

from sqlalchemy import any_, case, cast, func, or_, select
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Session

from app.deps import DbSession
from app.errors import AppError, not_found
from app.models.geo_batch_creation import GeoBatchSubject
from app.models.geo_catalog import GeoSubject, GeoSubjectAlias, GeoSubjectDomain
from app.models.geo_monitoring_plans import GeoMonitoringPlanSubject
from app.models.geo_runs import GeoObservationRun
from app.models.product_facts import Product
from app.schemas.common import AccountType
from app.schemas.geo_catalog import GeoSubjectListPage, GeoSubjectOut, GeoSubjectType
from app.services.geo_catalog_normalization import catalog_search_key, catalog_text_key
from app.services.geo_catalog_policy import SubjectReferenceCounts
from app.services.geo_subjects import subject_out


def read_snapshot(db: DbSession) -> None:
    """FastAPI 在认证查询前调用；事务及读取快照由服务层拥有。"""
    # 认证更新 last_seen_at；纯读快照不能 autoflush 它而产生会话写锁/序列化故障。
    db.autoflush = False
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})


def subject_references(db: Session, ids: Sequence[UUID]) -> dict[UUID, SubjectReferenceCounts]:
    children = (
        dict(
            db.execute(
                select(
                    GeoSubject.parent_subject_id,
                    func.count(GeoSubject.id),
                )
                .where(GeoSubject.parent_subject_id.in_(ids))
                .group_by(
                    GeoSubject.parent_subject_id,
                )
            )
            .tuples()
            .all()
        )
        if ids
        else {}
    )
    plans = (
        dict(
            db.execute(
                select(GeoMonitoringPlanSubject.subject_id, func.count())
                .where(GeoMonitoringPlanSubject.subject_id.in_(ids))
                .group_by(GeoMonitoringPlanSubject.subject_id)
            )
            .tuples()
            .all()
        )
        if ids
        else {}
    )
    runs = (
        dict(
            db.execute(
                select(GeoBatchSubject.subject_id, func.count(GeoObservationRun.id))
                .join(GeoObservationRun, GeoObservationRun.batch_id == GeoBatchSubject.batch_id)
                .where(GeoBatchSubject.subject_id.in_(ids))
                .group_by(GeoBatchSubject.subject_id)
            )
            .tuples()
            .all()
        )
        if ids
        else {}
    )
    # Analysis/Opportunity 仍未实施；Run 使用冻结主体关系，不使用当前 Plan。
    return {
        key: SubjectReferenceCounts(
            child_subject_count=int(children.get(key, 0)),
            monitoring_plan_count=int(plans.get(key, 0)),
            observation_run_count=int(runs.get(key, 0)),
            analysis_count=0,
            opportunity_count=0,
        )
        for key in ids
    }


def subjects_out(
    db: Session,
    subjects: Sequence[GeoSubject],
    *,
    actor_type: AccountType,
) -> list[GeoSubjectOut]:
    if not subjects:
        return []
    ids = [item.id for item in subjects]
    products = {
        item.id: item
        for item in db.scalars(
            select(Product)
            .where(
                Product.id.in_(
                    [item.product_id for item in subjects if item.product_id is not None]
                )
            )
            .execution_options(populate_existing=True)
        )
    }
    parents = {
        item.id: item
        for item in db.scalars(
            select(GeoSubject)
            .where(
                GeoSubject.id.in_(
                    [
                        item.parent_subject_id
                        for item in subjects
                        if item.parent_subject_id is not None
                    ]
                )
            )
            .execution_options(populate_existing=True)
        )
    }
    aliases: dict[UUID, list[GeoSubjectAlias]] = defaultdict(list)
    domains: dict[UUID, list[GeoSubjectDomain]] = defaultdict(list)
    for alias in db.scalars(
        select(GeoSubjectAlias)
        .where(GeoSubjectAlias.subject_id.in_(ids))
        .order_by(GeoSubjectAlias.created_at, GeoSubjectAlias.id)
        .execution_options(populate_existing=True)
    ):
        aliases[alias.subject_id].append(alias)
    for domain in db.scalars(
        select(GeoSubjectDomain)
        .where(GeoSubjectDomain.subject_id.in_(ids))
        .order_by(GeoSubjectDomain.created_at, GeoSubjectDomain.id)
        .execution_options(populate_existing=True)
    ):
        domains[domain.subject_id].append(domain)
    references = subject_references(db, ids)
    return [
        subject_out(
            item,
            actor_type=actor_type,
            product=products.get(item.product_id) if item.product_id else None,
            parent=parents.get(item.parent_subject_id) if item.parent_subject_id else None,
            aliases=aliases[item.id],
            domains=domains[item.id],
            references=references[item.id],
        )
        for item in subjects
    ]


def get_subject(db: Session, subject_id: UUID, *, actor_type: AccountType) -> GeoSubjectOut:
    subject = db.get(GeoSubject, subject_id, populate_existing=True)
    if subject is None:
        raise not_found("监测对象")
    return subjects_out(db, [subject], actor_type=actor_type)[0]


def list_subjects(
    db: Session,
    *,
    actor_type: AccountType,
    q: str | None = None,
    subject_type: GeoSubjectType | None = None,
    product_id: UUID | None = None,
    parent_subject_id: UUID | None = None,
    is_active: bool | None = None,
    sort: Literal["NAME_ASC", "UPDATED_DESC"] = "NAME_ASC",
    page: int = 1,
    page_size: Literal[10, 20, 50] = 20,
) -> GeoSubjectListPage:
    query = select(GeoSubject).outerjoin(Product, Product.id == GeoSubject.product_id)
    for column, value in (
        (GeoSubject.subject_type, subject_type),
        (GeoSubject.product_id, product_id),
        (GeoSubject.parent_subject_id, parent_subject_id),
        (GeoSubject.is_active, is_active),
    ):
        if value is not None:
            query = query.where(column == value)
    if q is not None and q.strip():
        try:
            needle = catalog_text_key(q)
        except ValueError as error:
            raise AppError("VALIDATION_ERROR", "搜索词规范化后超出长度限制", 422) from error
        # PostgreSQL 16 lower 不等于 Unicode casefold。按已有过滤在同一快照
        # 批量读取当前名称，复用字典规范化；不复制 Product 身份到 Catalog。
        matching_ids = [
            row.id
            for row in db.execute(
                query.with_only_columns(
                    GeoSubject.id, GeoSubject.display_name, Product.part_number, Product.brand
                )
            ).yield_per(500)
            if any(
                needle in catalog_search_key(value)
                for value in (row.display_name, row.part_number, row.brand)
                if value is not None
            )
        ]
        alias_match = (
            select(GeoSubjectAlias.id)
            .where(
                GeoSubjectAlias.subject_id == GeoSubject.id,
                GeoSubjectAlias.normalized_alias.contains(needle, autoescape=True),
            )
            .exists()
        )
        query = query.where(
            or_(
                GeoSubject.normalized_name.contains(needle, autoescape=True),
                # ARRAY 单一绑定参数，避免匹配 ID 多时超过 PostgreSQL 参数上限。
                GeoSubject.id == any_(cast(matching_ids, ARRAY(PgUUID(as_uuid=True)))),
                alias_match,
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    name = case(
        (GeoSubject.subject_type == "OWN_PRODUCT", func.lower(Product.part_number)),
        else_=GeoSubject.normalized_name,
    )
    query = (
        query.order_by(name, GeoSubject.id)
        if sort == "NAME_ASC"
        else query.order_by(
            GeoSubject.updated_at.desc(),
            GeoSubject.id.desc(),
        )
    )
    rows = list(
        db.scalars(
            query.offset((page - 1) * page_size)
            .limit(page_size)
            .execution_options(populate_existing=True)
        )
    )
    assert total is not None
    return GeoSubjectListPage(
        items=subjects_out(db, rows, actor_type=actor_type),
        page=page,
        page_size=page_size,
        total=total,
    )
