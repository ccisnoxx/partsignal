"""在工厂已持有资源锁时组装安全快照；批量读，无事务或外部 I/O。"""

from collections import defaultdict
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.collectors.registry import collector_registry
from app.models.configuration import QueryTopic
from app.models.geo_catalog import GeoSubject, GeoSubjectAlias, GeoSubjectDomain
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_surfaces import GeoEngineSurface
from app.models.product_facts import Product
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanConfiguration
from app.schemas.geo_runs import (
    GeoRunDataClassification,
    GeoRunInputSnapshot,
    GeoRunProfileSnapshot,
    GeoRunPromptSnapshot,
    GeoRunSubjectSnapshot,
)
from app.services.geo_collection_profiles import ProfileFacts

_PROFILE: TypeAdapter[GeoRunProfileSnapshot] = TypeAdapter(GeoRunProfileSnapshot)


@dataclass(frozen=True)
class BatchInputs:
    prompts: dict[UUID, GeoRunPromptSnapshot]
    profiles: dict[UUID, GeoRunProfileSnapshot]
    subjects: list[GeoRunSubjectSnapshot]
    rule_set_revision: int

    def input_for(self, prompt_id: UUID, profile_id: UUID) -> dict[str, Any]:
        # 当前命令没有数据外发授权；分类为 INTERNAL，不能因调用者未提供而猜为 PUBLIC。
        return GeoRunInputSnapshot(
            schema_version=1,
            data_classification=GeoRunDataClassification.INTERNAL,
            prompt=self.prompts[prompt_id],
            profile=self.profiles[profile_id],
            subjects=self.subjects,
            rule_set_revision=self.rule_set_revision,
        ).model_dump(mode="json")


def freeze_inputs(
    db: Session, value: GeoMonitoringPlanConfiguration, profiles: dict[UUID, ProfileFacts]
) -> BatchInputs:
    v, q = GeoPromptVariant, QueryTopic
    prompts = {
        row.id: GeoRunPromptSnapshot.model_validate(dict(row))
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
            )
            .join(q, q.id == v.query_topic_id)
            .where(v.id.in_(value.prompt_variant_ids))
        ).mappings()
    }
    s = GeoEngineSurface
    surfaces = {
        row.id: dict(row)
        for row in db.execute(
            select(
                s.id,
                s.revision,
                s.name,
                s.surface_kind,
                s.provider_brand,
                s.compliance_status,
                s.capabilities,
            ).where(s.id.in_({facts.surface.id for facts in profiles.values()}))
        ).mappings()
    }
    frozen_profiles = {}
    for identity in value.collection_profile_ids:
        profile = profiles[identity].profile
        frozen_profiles[identity] = _PROFILE.validate_python(
            {
                **{
                    name: getattr(profile, name)
                    for name in (
                        "id",
                        "revision",
                        "name",
                        "collection_mode",
                        "adapter_key",
                        "ai_channel_id",
                        "ai_model_id",
                        "language_code",
                        "region_code",
                        "login_state",
                        "web_search_policy",
                    )
                },
                "settings": dict(profile.settings),
                "adapter_version": collector_registry.resolve(profile.adapter_key).version,
                "surface": surfaces[profile.engine_surface_id],
            }
        )
    ids = [item.subject_id for item in value.subjects]
    aliases: dict[UUID, list[dict[str, Any]]] = defaultdict(list)
    domains: dict[UUID, list[dict[str, Any]]] = defaultdict(list)
    a, d = GeoSubjectAlias, GeoSubjectDomain
    for row in db.execute(
        select(a.subject_id, a.alias, a.normalized_alias, a.alias_kind, a.language_code)
        .where(a.subject_id.in_(ids), a.is_active)
        .order_by(a.subject_id, a.normalized_alias)
    ).mappings():
        aliases[row.subject_id].append(
            {key: val for key, val in row.items() if key != "subject_id"}
        )
    for row in db.execute(
        select(d.subject_id, d.hostname, d.relation_type)
        .where(d.subject_id.in_(ids), d.is_active)
        .order_by(d.subject_id, d.hostname)
    ).mappings():
        domains[row.subject_id].append(
            {key: val for key, val in row.items() if key != "subject_id"}
        )
    subject, product = GeoSubject, Product
    roles = {item.subject_id: item.role for item in value.subjects}
    subjects = [
        GeoRunSubjectSnapshot.model_validate(
            {
                "id": row.id,
                "revision": row.revision,
                "subject_type": row.subject_type,
                "role": roles[row.id],
                "product_id": row.product_id,
                "parent_subject_id": row.parent_subject_id,
                "canonical_name": row.part_number if row.product_id else row.canonical_name,
                "display_name": f"{row.brand} {row.part_number}"
                if row.product_id
                else row.display_name,
                "aliases": aliases[row.id],
                "domains": domains[row.id],
            }
        )
        for row in db.execute(
            select(
                subject.id,
                subject.revision,
                subject.subject_type,
                subject.product_id,
                subject.parent_subject_id,
                subject.canonical_name,
                subject.display_name,
                product.part_number,
                product.brand,
            )
            .outerjoin(product, product.id == subject.product_id)
            .where(subject.id.in_(ids))
            .order_by(subject.id)
        ).mappings()
    ]
    return BatchInputs(prompts, frozen_profiles, subjects, value.rule_set_revision)
