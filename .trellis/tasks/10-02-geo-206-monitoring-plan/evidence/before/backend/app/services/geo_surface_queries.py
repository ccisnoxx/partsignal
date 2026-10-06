"""GEO 管理的一致快照分页与固定次数批量读取，不加载外部服务秘密。"""

from collections.abc import Sequence
from typing import Literal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.schemas.common import AccountType
from app.schemas.geo_surface_management import (
    GeoCollectionProfileListPage,
    GeoCollectionProfileRead,
    GeoEngineSurfaceListPage,
    GeoEngineSurfaceRead,
)
from app.schemas.geo_surfaces import GeoCollectionMode, GeoSurfaceKind
from app.services.geo_collection_profiles import load_profile_facts
from app.services.geo_surface_projections import profile_read, surface_read


def surface_profile_counts(db: Session, ids: Sequence[UUID]) -> dict[UUID, int]:
    if not ids:
        return {}
    return dict(
        db.execute(
            select(GeoCollectionProfile.engine_surface_id, func.count(GeoCollectionProfile.id))
            .where(GeoCollectionProfile.engine_surface_id.in_(ids))
            .group_by(GeoCollectionProfile.engine_surface_id)
            .execution_options(autoflush=False)
        )
        .tuples()
        .all()
    )


def surfaces_read(
    db: Session, surfaces: Sequence[GeoEngineSurface], *, actor_type: AccountType
) -> list[GeoEngineSurfaceRead]:
    counts = surface_profile_counts(db, [item.id for item in surfaces])
    return [
        surface_read(item, actor_type=actor_type, profile_count=counts.get(item.id, 0))
        for item in surfaces
    ]


def profiles_read(
    db: Session, profiles: Sequence[GeoCollectionProfile], *, actor_type: AccountType
) -> list[GeoCollectionProfileRead]:
    if not profiles:
        return []
    surfaces = {
        row.id: row
        for row in db.scalars(
            select(GeoEngineSurface)
            .where(GeoEngineSurface.id.in_({item.engine_surface_id for item in profiles}))
            .execution_options(populate_existing=True, autoflush=False)
        )
    }
    facts = load_profile_facts(db, [item.id for item in profiles])
    return [
        profile_read(item, surfaces[item.engine_surface_id], facts[item.id], actor_type=actor_type)
        for item in profiles
    ]


def get_surface(db: Session, surface_id: UUID, *, actor_type: AccountType) -> GeoEngineSurfaceRead:
    surface = db.get(GeoEngineSurface, surface_id, populate_existing=True)
    if surface is None:
        raise not_found("GEO 观测面")
    return surfaces_read(db, [surface], actor_type=actor_type)[0]


def get_profile(
    db: Session, profile_id: UUID, *, actor_type: AccountType
) -> GeoCollectionProfileRead:
    profile = db.get(GeoCollectionProfile, profile_id, populate_existing=True)
    if profile is None:
        raise not_found("GEO 采集配置")
    return profiles_read(db, [profile], actor_type=actor_type)[0]


def _pattern(q: str) -> str:
    return "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def list_surfaces(
    db: Session,
    *,
    actor_type: AccountType,
    q: str | None = None,
    surface_kind: GeoSurfaceKind | None = None,
    is_active: bool | None = None,
    sort: Literal["NAME_ASC", "UPDATED_DESC"] = "NAME_ASC",
    page: int = 1,
    page_size: Literal[10, 20, 50] = 20,
) -> GeoEngineSurfaceListPage:
    query = select(GeoEngineSurface)
    if surface_kind is not None:
        query = query.where(GeoEngineSurface.surface_kind == surface_kind)
    if is_active is not None:
        query = query.where(GeoEngineSurface.is_active == is_active)
    if q is not None and q.strip():
        query = query.where(
            or_(
                GeoEngineSurface.name.ilike(_pattern(q), escape="\\"),
                GeoEngineSurface.slug.ilike(_pattern(q), escape="\\"),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    query = (
        query.order_by(func.lower(GeoEngineSurface.name), GeoEngineSurface.id)
        if sort == "NAME_ASC"
        else query.order_by(GeoEngineSurface.updated_at.desc(), GeoEngineSurface.id.desc())
    )
    rows = list(
        db.scalars(
            query.offset((page - 1) * page_size)
            .limit(page_size)
            .execution_options(populate_existing=True, autoflush=False)
        )
    )
    assert total is not None
    return GeoEngineSurfaceListPage(
        items=surfaces_read(db, rows, actor_type=actor_type),
        page=page,
        page_size=page_size,
        total=total,
    )


def list_profiles(
    db: Session,
    *,
    actor_type: AccountType,
    q: str | None = None,
    engine_surface_id: UUID | None = None,
    collection_mode: GeoCollectionMode | None = None,
    is_active: bool | None = None,
    sort: Literal["NAME_ASC", "UPDATED_DESC"] = "NAME_ASC",
    page: int = 1,
    page_size: Literal[10, 20, 50] = 20,
) -> GeoCollectionProfileListPage:
    query = select(GeoCollectionProfile)
    for column, value in (
        (GeoCollectionProfile.engine_surface_id, engine_surface_id),
        (GeoCollectionProfile.collection_mode, collection_mode),
        (GeoCollectionProfile.is_active, is_active),
    ):
        if value is not None:
            query = query.where(column == value)
    if q is not None and q.strip():
        query = query.where(GeoCollectionProfile.name.ilike(_pattern(q), escape="\\"))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    query = (
        query.order_by(func.lower(GeoCollectionProfile.name), GeoCollectionProfile.id)
        if sort == "NAME_ASC"
        else query.order_by(GeoCollectionProfile.updated_at.desc(), GeoCollectionProfile.id.desc())
    )
    rows = list(
        db.scalars(
            query.offset((page - 1) * page_size)
            .limit(page_size)
            .execution_options(populate_existing=True, autoflush=False)
        )
    )
    assert total is not None
    return GeoCollectionProfileListPage(
        items=profiles_read(db, rows, actor_type=actor_type),
        page=page,
        page_size=page_size,
        total=total,
    )
