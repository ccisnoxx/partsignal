"""从明确加载的 Catalog 关联形成公共投影，不查询或修改 ORM。"""

from collections.abc import Sequence
from dataclasses import asdict

from app.models.geo_catalog import GeoSubject, GeoSubjectAlias, GeoSubjectDomain
from app.models.product_facts import Product
from app.schemas.common import AccountType
from app.schemas.geo_catalog import (
    GeoNamedSubjectOut,
    GeoOwnProductSubjectOut,
    GeoSubjectAliasKind,
    GeoSubjectAliasOut,
    GeoSubjectDeletionBlocker,
    GeoSubjectDeletionProjection,
    GeoSubjectDomainOut,
    GeoSubjectDomainRelationType,
    GeoSubjectOut,
    GeoSubjectParentSummary,
    GeoSubjectProductSummary,
    GeoSubjectReferences,
    GeoSubjectType,
)
from app.services.geo_catalog_policy import (
    SubjectReferenceCounts,
    require_subject_identity,
    require_subject_parent,
    subject_workflow,
)


def subject_out(
    subject: GeoSubject,
    *,
    actor_type: AccountType,
    product: Product | None,
    parent: GeoSubject | None,
    aliases: Sequence[GeoSubjectAlias],
    domains: Sequence[GeoSubjectDomain],
    references: SubjectReferenceCounts,
) -> GeoSubjectOut:
    """调用服务必须在同一读取快照批量取得全部输入，不能拿当前页推算引用。"""
    kind = GeoSubjectType(subject.subject_type)
    require_subject_identity(kind, subject.product_id)
    if subject.parent_subject_id != (parent.id if parent else None):
        raise ValueError("父级投影必须与当前 Subject 绑定一致")
    parent_kind = GeoSubjectType(parent.subject_type) if parent else None
    require_subject_parent(
        kind, subject_id=subject.id, parent_id=subject.parent_subject_id, parent_type=parent_kind
    )
    if subject.parent_subject_type != parent_kind:
        raise ValueError("父级判别列必须与真实父级身份一致")
    if subject.product_id != (product.id if product else None):
        raise ValueError("Product 投影必须与当前 Subject 绑定一致")
    if any(item.subject_id != subject.id for item in aliases) or any(
        item.subject_id != subject.id for item in domains
    ):
        raise ValueError("不能投影其他 Subject 的子字典")
    workflow = subject_workflow(
        is_active=subject.is_active, actor_type=actor_type, references=references
    )
    parent_summary = (
        GeoSubjectParentSummary.model_validate(
            {
                "id": parent.id,
                "subject_type": parent.subject_type,
                "display_name": parent.display_name,
                "is_active": parent.is_active,
            }
        )
        if parent
        else None
    )
    common = {
        "id": subject.id,
        "parent_subject_id": subject.parent_subject_id,
        "parent": parent_summary,
        "description": subject.description,
        "is_active": subject.is_active,
        "aliases": [
            GeoSubjectAliasOut(
                id=item.id,
                subject_id=item.subject_id,
                alias=item.alias,
                normalized_alias=item.normalized_alias,
                alias_kind=GeoSubjectAliasKind(item.alias_kind),
                language_code=item.language_code,
                is_active=item.is_active,
                available_actions=list(workflow.alias_actions),
                created_at=item.created_at,
            )
            for item in aliases
        ],
        "domains": [
            GeoSubjectDomainOut.model_validate(
                {
                    "id": item.id,
                    "subject_id": item.subject_id,
                    "hostname": item.hostname,
                    "relation_type": GeoSubjectDomainRelationType(item.relation_type),
                    "is_active": item.is_active,
                    "available_actions": list(workflow.domain_actions),
                    "created_at": item.created_at,
                }
            )
            for item in domains
        ],
        "references": GeoSubjectReferences(**asdict(references)),
        "workflow_stage": workflow.stage,
        "primary_task": workflow.primary_task,
        "available_actions": list(workflow.actions),
        "deletion": None
        if workflow.deletion_blockers is None
        else GeoSubjectDeletionProjection(
            blockers=[
                GeoSubjectDeletionBlocker(type=kind, count=count)
                for kind, count in workflow.deletion_blockers
            ],
        ),
        "revision": subject.revision,
        "created_by": subject.created_by,
        "created_at": subject.created_at,
        "updated_at": subject.updated_at,
    }
    if product is not None:
        if any(
            value is not None
            for value in (
                subject.canonical_name,
                subject.normalized_name,
                subject.display_name,
            )
        ):
            raise ValueError("OWN_PRODUCT 不能持久化 Product 名称副本")
        return GeoOwnProductSubjectOut.model_validate(
            common
            | {
                "subject_type": kind,
                "product_id": product.id,
                "product": GeoSubjectProductSummary(
                    id=product.id,
                    part_number=product.part_number,
                    brand=product.brand,
                    category=product.category,
                    revision=product.revision,
                ),
                "canonical_name": product.part_number,
                "display_name": f"{product.brand} {product.part_number}",
            }
        )
    return GeoNamedSubjectOut.model_validate(
        common
        | {
            "subject_type": kind,
            "product_id": None,
            "product": None,
            "canonical_name": subject.canonical_name,
            "display_name": subject.display_name,
        }
    )
