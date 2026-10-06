"""机会的一致读与服务端列表投影；读取不重新评估规则。"""

from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, Select, case, func, or_, select
from sqlalchemy.orm import Session

from app.errors import not_found
from app.models.configuration import QueryTopic
from app.models.geo_catalog import GeoSubject
from app.models.geo_opportunities import (
    GeoOpportunity as Opportunity,
)
from app.models.geo_opportunities import (
    GeoOpportunityAction,
    GeoOpportunityEvaluation,
    GeoOpportunitySource,
)
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_runs import GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.models.identity import User
from app.models.product_facts import Product
from app.schemas.geo_opportunities import GeoOpportunityStatus, GeoOpportunityTriggerSnapshot
from app.schemas.geo_opportunity_workbench import (
    GeoOpportunityDetail,
    GeoOpportunityFilterOption,
    GeoOpportunityFilterOptions,
    GeoOpportunityFilters,
    GeoOpportunityLinkedEvaluation,
    GeoOpportunityListItem,
    GeoOpportunityListPage,
    GeoOpportunitySourceFilters,
)
from app.schemas.geo_rules import GeoRuleCode
from app.services.geo_opportunity_action_views import action_records
from app.services.geo_opportunity_policy import RULE_PRESENTATION, action_types, workflow


def _as_of(db: Session) -> datetime:
    if (
        db.connection().get_isolation_level() not in {"REPEATABLE READ", "SERIALIZABLE"}
        or db.autoflush
    ):
        raise ValueError("机会读取必须使用禁止autoflush的一致快照")
    value = db.scalar(select(func.now()))
    assert value is not None
    return value


def _query() -> Select[Any]:
    source_count = (
        select(func.count(GeoOpportunitySource.id))
        .where(GeoOpportunitySource.opportunity_id == Opportunity.id)
        .scalar_subquery()
    )
    action_count = (
        select(func.count(GeoOpportunityAction.id))
        .where(GeoOpportunityAction.opportunity_id == Opportunity.id)
        .scalar_subquery()
    )
    return (
        select(
            Opportunity,
            func.coalesce(GeoSubject.display_name, Product.brand + " " + Product.part_number).label(
                "subject_name"
            ),
            GeoSubject.product_id.label("product_id"),
            QueryTopic.canonical_question.label("query_topic_name"),
            GeoPromptVariant.prompt_text.label("prompt_variant_name"),
            GeoCollectionProfile.name.label("collection_profile_name"),
            GeoEngineSurface.name.label("engine_surface_name"),
            source_count.label("source_count"),
            action_count.label("action_count"),
        )
        .outerjoin(GeoSubject, GeoSubject.id == Opportunity.subject_id)
        .outerjoin(Product, Product.id == GeoSubject.product_id)
        .outerjoin(QueryTopic, QueryTopic.id == Opportunity.query_topic_id)
        .outerjoin(GeoPromptVariant, GeoPromptVariant.id == Opportunity.prompt_variant_id)
        .outerjoin(
            GeoCollectionProfile, GeoCollectionProfile.id == Opportunity.collection_profile_id
        )
        .outerjoin(GeoEngineSurface, GeoEngineSurface.id == Opportunity.engine_surface_id)
    )


def _item(row: Mapping[Any, Any], actor: User) -> GeoOpportunityListItem:
    opportunity = row["GeoOpportunity"]
    trigger = GeoOpportunityTriggerSnapshot.model_validate(opportunity.trigger_snapshot)
    title, description = RULE_PRESENTATION[GeoRuleCode(opportunity.rule_code)]
    return GeoOpportunityListItem(
        **{
            field: getattr(opportunity, field)
            for field in (
                "id",
                "rule_code",
                "priority",
                "status",
                "revision",
                "source_date_from",
                "source_date_to",
                "created_at",
                "last_seen_at",
                "acknowledged_at",
                "acknowledged_by",
                "resolved_at",
                "resolved_by",
                "resolution_code",
                "resolution_comment",
            )
        },
        **{
            field: row[field]
            for field in (
                "subject_name",
                "product_id",
                "query_topic_name",
                "prompt_variant_name",
                "collection_profile_name",
                "engine_surface_name",
                "source_count",
                "action_count",
            )
        },
        **workflow(GeoOpportunityStatus(opportunity.status), actor).model_dump(),
        scope=trigger.scope,
        title=title,
        description=description,
        value=trigger.value,
        threshold=trigger.threshold,
        numerator=trigger.numerator,
        denominator=trigger.denominator,
    )


def command_item(db: Session, opportunity_id: UUID, actor: User) -> GeoOpportunityListItem:
    """命令事务已flush且持有机会锁，不开启另一个读取事务。"""
    row = db.execute(_query().where(Opportunity.id == opportunity_id)).mappings().one()
    return _item(row, actor)


def _filter_options(db: Session) -> GeoOpportunityFilterOptions:
    """选项来自机会自身引用集合；名称是当前元数据，不作为历史证据。"""

    def options(model: Any, field: Any, name: Any) -> list[GeoOpportunityFilterOption]:
        rows = db.execute(
            select(model.id, name.label("name"))
            .where(model.id.in_(select(field)))
            .order_by(name, model.id)
        )
        return [GeoOpportunityFilterOption(id=row.id, name=row.name) for row in rows]

    subject_rows = db.execute(
        select(
            GeoSubject.id,
            func.coalesce(GeoSubject.display_name, Product.brand + " " + Product.part_number).label(
                "name"
            ),
        )
        .outerjoin(Product, Product.id == GeoSubject.product_id)
        .where(GeoSubject.id.in_(select(Opportunity.subject_id)))
    )
    subjects = sorted(
        [GeoOpportunityFilterOption(id=row.id, name=row.name) for row in subject_rows],
        key=lambda row: (row.name, str(row.id)),
    )
    products = db.execute(
        select(Product.id, (Product.brand + " " + Product.part_number).label("name"))
        .where(
            Product.id.in_(
                select(GeoSubject.product_id).join(
                    Opportunity, Opportunity.subject_id == GeoSubject.id
                )
            )
        )
        .order_by(Product.brand, Product.part_number, Product.id)
    )
    return GeoOpportunityFilterOptions(
        subjects=subjects,
        products=[GeoOpportunityFilterOption(id=row.id, name=row.name) for row in products],
        query_topics=options(QueryTopic, Opportunity.query_topic_id, QueryTopic.canonical_question),
        prompt_variants=options(
            GeoPromptVariant, Opportunity.prompt_variant_id, GeoPromptVariant.prompt_text
        ),
        collection_profiles=options(
            GeoCollectionProfile, Opportunity.collection_profile_id, GeoCollectionProfile.name
        ),
        engine_surfaces=options(
            GeoEngineSurface, Opportunity.engine_surface_id, GeoEngineSurface.name
        ),
    )


def list_opportunities(
    db: Session, filters: GeoOpportunityFilters, *, actor: User
) -> GeoOpportunityListPage:
    as_of = _as_of(db)
    query = _query()
    for field in (
        "status",
        "priority",
        "rule_code",
        "subject_id",
        "query_topic_id",
        "prompt_variant_id",
        "collection_profile_id",
        "engine_surface_id",
    ):
        value = getattr(filters, field)
        if value is not None:
            query = query.where(getattr(Opportunity, field) == value)
    if filters.product_id is not None:
        query = query.where(GeoSubject.product_id == filters.product_id)
    if filters.collection_mode is not None:
        query = query.where(
            select(GeoOpportunitySource.id)
            .join(GeoObservationRun, GeoObservationRun.id == GeoOpportunitySource.run_id)
            .where(
                GeoOpportunitySource.opportunity_id == Opportunity.id,
                GeoObservationRun.input_snapshot["profile"]["collection_mode"].as_string()
                == filters.collection_mode,
            )
            .exists()
        )
    if filters.created_from is not None:
        query = query.where(Opportunity.created_at >= filters.created_from)
    if filters.created_to is not None:
        query = query.where(Opportunity.created_at < filters.created_to)
    if filters.q is not None and filters.q.strip():
        text = filters.q.strip()
        matching_rules = [
            code
            for code, presentation in RULE_PRESENTATION.items()
            if text.casefold() in " ".join((code, *presentation)).casefold()
        ]
        query = query.where(
            or_(
                Opportunity.rule_code.in_(matching_rules),
                Opportunity.rule_code.icontains(text, autoescape=True),
                GeoSubject.display_name.icontains(text, autoescape=True),
                Product.part_number.icontains(text, autoescape=True),
                Product.brand.icontains(text, autoescape=True),
                QueryTopic.canonical_question.icontains(text, autoescape=True),
                GeoPromptVariant.prompt_text.icontains(text, autoescape=True),
                GeoCollectionProfile.name.icontains(text, autoescape=True),
                GeoEngineSurface.name.icontains(text, autoescape=True),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    ordering: list[ColumnElement[Any]] = [Opportunity.created_at.desc(), Opportunity.id.desc()]
    if filters.sort == "PRIORITY_DESC":
        ordering.insert(
            0,
            case(
                {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}, value=Opportunity.priority
            ).desc(),
        )
    elif filters.sort == "LAST_SEEN_DESC":
        ordering.insert(0, Opportunity.last_seen_at.desc())
    rows = db.execute(
        query.order_by(*ordering)
        .offset((filters.page - 1) * filters.page_size)
        .limit(filters.page_size)
        .execution_options(populate_existing=True)
    ).mappings()
    return GeoOpportunityListPage(
        items=[_item(row, actor) for row in rows],
        total=total,
        page=filters.page,
        page_size=filters.page_size,
        as_of=as_of,
        filter_options=_filter_options(db),
    )


def get_opportunity(
    db: Session, opportunity_id: UUID, filters: GeoOpportunitySourceFilters, *, actor: User
) -> GeoOpportunityDetail:
    from app.services.geo_opportunity_evidence import source_page

    as_of = _as_of(db)
    row = (
        db.execute(
            _query()
            .where(Opportunity.id == opportunity_id)
            .execution_options(populate_existing=True)
        )
        .mappings()
        .one_or_none()
    )
    if row is None:
        raise not_found("GEO机会")
    opportunity = row["GeoOpportunity"]
    evaluation = db.scalar(
        select(GeoOpportunityEvaluation)
        .where(GeoOpportunityEvaluation.opportunity_id == opportunity_id)
        .order_by(GeoOpportunityEvaluation.created_at.desc(), GeoOpportunityEvaluation.id.desc())
        .limit(1)
    )
    latest = (
        None
        if evaluation is None
        else GeoOpportunityLinkedEvaluation(
            id=evaluation.id,
            rule_set_revision=evaluation.rule_set_revision,
            evaluated_as_of=evaluation.as_of,
            created_at=evaluation.created_at,
            disposition=evaluation.disposition,
            result_snapshot=GeoOpportunityTriggerSnapshot.model_validate(
                evaluation.result_snapshot
            ),
        )
    )
    actions = db.scalars(
        select(GeoOpportunityAction)
        .where(GeoOpportunityAction.opportunity_id == opportunity_id)
        .order_by(GeoOpportunityAction.created_at, GeoOpportunityAction.id)
    )
    return GeoOpportunityDetail(
        opportunity=_item(row, actor),
        trigger_snapshot=GeoOpportunityTriggerSnapshot.model_validate(opportunity.trigger_snapshot),
        latest_evaluation=latest,
        sources=source_page(db, opportunity_id, filters, as_of),
        actions=action_records(db, list(actions)),
        available_action_types=action_types(
            GeoOpportunityStatus(opportunity.status), GeoRuleCode(opportunity.rule_code), actor
        ),
        as_of=as_of,
    )
