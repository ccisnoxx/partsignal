"""Catalog 的无 I/O 领域规则；调用服务提供当前身份及完整引用事实。"""

from collections.abc import Iterable
from dataclasses import dataclass, fields
from uuid import UUID

from app.errors import AppError
from app.schemas.common import AccountType
from app.schemas.geo_catalog import (
    GeoSubjectAction,
    GeoSubjectAliasAction,
    GeoSubjectDeletionBlockerType,
    GeoSubjectDomainAction,
    GeoSubjectPrimaryTask,
    GeoSubjectType,
    GeoSubjectWorkflowStage,
)
from app.services.geo_catalog_normalization import catalog_text_key


@dataclass(frozen=True)
class SubjectReferenceCounts:
    """各类直接引用独立去重；未传入事实不能被猜为零。"""

    child_subject_count: int
    monitoring_plan_count: int
    observation_run_count: int
    analysis_count: int
    opportunity_count: int

    def __post_init__(self) -> None:
        for field in fields(self):
            value = getattr(self, field.name)
            if type(value) is not int or value < 0:
                raise ValueError("直接引用数量必须是非负整数")

    def blockers(self) -> tuple[tuple[GeoSubjectDeletionBlockerType, int], ...]:
        pairs = (
            (GeoSubjectDeletionBlockerType.CHILD_SUBJECT, self.child_subject_count),
            (GeoSubjectDeletionBlockerType.MONITORING_PLAN, self.monitoring_plan_count),
            (GeoSubjectDeletionBlockerType.OBSERVATION_RUN, self.observation_run_count),
            (GeoSubjectDeletionBlockerType.ANALYSIS, self.analysis_count),
            (GeoSubjectDeletionBlockerType.OPPORTUNITY, self.opportunity_count),
        )
        return tuple((kind, count) for kind, count in pairs if count > 0)


@dataclass(frozen=True)
class SubjectWorkflow:
    stage: GeoSubjectWorkflowStage
    primary_task: GeoSubjectPrimaryTask
    actions: tuple[GeoSubjectAction, ...]
    deletion_blockers: tuple[tuple[GeoSubjectDeletionBlockerType, int], ...] | None
    alias_actions: tuple[GeoSubjectAliasAction, ...]
    domain_actions: tuple[GeoSubjectDomainAction, ...]


def subject_workflow(
    *, is_active: bool, actor_type: AccountType, references: SubjectReferenceCounts
) -> SubjectWorkflow:
    """读取角色不会改变业务 stage；删除无需先停用无引用对象。"""
    actor_type = AccountType(actor_type)
    stage = GeoSubjectWorkflowStage.ACTIVE if is_active else GeoSubjectWorkflowStage.DISABLED
    if actor_type == AccountType.ENGINEER:
        return SubjectWorkflow(stage, GeoSubjectPrimaryTask.MANAGE_SUBJECT, (), None, (), ())
    blockers = references.blockers()
    actions = [
        GeoSubjectAction.UPDATE,
        GeoSubjectAction.DISABLE if is_active else GeoSubjectAction.ENABLE,
        GeoSubjectAction.CREATE_ALIAS,
        GeoSubjectAction.CREATE_DOMAIN,
    ]
    if not blockers:
        actions.append(GeoSubjectAction.DELETE)
    return SubjectWorkflow(
        stage,
        GeoSubjectPrimaryTask.MANAGE_SUBJECT if is_active else GeoSubjectPrimaryTask.ENABLE_SUBJECT,
        tuple(actions),
        blockers,
        (GeoSubjectAliasAction.UPDATE, GeoSubjectAliasAction.DELETE),
        (GeoSubjectDomainAction.DELETE,),
    )


def require_subject_identity(subject_type: GeoSubjectType, product_id: UUID | None) -> None:
    kind = GeoSubjectType(subject_type)
    if (kind == GeoSubjectType.OWN_PRODUCT) != (product_id is not None):
        raise ValueError("只有 OWN_PRODUCT 必须且可以绑定 Product")


def require_subject_parent(
    subject_type: GeoSubjectType,
    *,
    subject_id: UUID | None,
    parent_id: UUID | None,
    parent_type: GeoSubjectType | None,
) -> None:
    """不存在的父级由调用服务报 404；传入的必须是真实已加载父身份。"""
    kind = GeoSubjectType(subject_type)
    if (parent_id is None) != (parent_type is None):
        raise ValueError("父级 ID 与真实类型必须同时提供")
    if parent_id is None:
        return
    assert parent_type is not None
    parent_kind = GeoSubjectType(parent_type)
    expected = {
        GeoSubjectType.OWN_PRODUCT: GeoSubjectType.OWN_BRAND,
        GeoSubjectType.COMPETITOR_PRODUCT: GeoSubjectType.COMPETITOR_BRAND,
    }.get(kind)
    if subject_id == parent_id or parent_kind != expected:
        message = "监测对象的父级类型不合法或指向自身"
        raise AppError(
            "GEO_SUBJECT_PARENT_INVALID",
            message,
            409,
            {
                "errors": [
                    {
                        "loc": ["body", "parent_subject_id"],
                        "msg": message,
                        "type": "geo_subject_parent_invalid",
                    }
                ]
            },
        )


@dataclass(frozen=True)
class AliasCandidate:
    subject_id: UUID
    alias: str
    is_active: bool


class AliasAmbiguityError(ValueError):
    """字典候选歧义，不是新增 HTTP 错误码或回答分析结果。"""

    def __init__(self, subject_ids: tuple[UUID, ...]) -> None:
        super().__init__("别名对应多个监测对象，必须人工复核")
        self.subject_ids = subject_ids


def alias_subject_candidates(alias: str, candidates: Iterable[AliasCandidate]) -> tuple[UUID, ...]:
    """只比较完整字典键，不识别回答子串、不猜测语言或选中某个对象。"""
    key = catalog_text_key(alias)
    return tuple(
        sorted(
            {
                item.subject_id
                for item in candidates
                if item.is_active and catalog_text_key(item.alias) == key
            },
            key=lambda value: value.int,
        )
    )


def require_unambiguous_alias(subject_ids: tuple[UUID, ...]) -> None:
    unique_ids = tuple(sorted(set(subject_ids), key=lambda value: value.int))
    if len(unique_ids) > 1:
        raise AliasAmbiguityError(unique_ids)
