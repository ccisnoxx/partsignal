"""GEO-505：同产品事实资格与只读装配；事务和落库由调用者拥有。"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.product_facts import FactVersion
from app.schemas.geo_catalog import GeoSubjectType
from app.schemas.geo_runs import GeoRunSubjectSnapshot
from app.schemas.product_facts import Confidentiality, FactVersionStatus


@dataclass(frozen=True)
class FactCandidate:
    """持久化列转为内部值；不得传入可编辑 Product 工作区。"""

    id: UUID
    product_id: UUID
    version: int
    status: FactVersionStatus
    classification: Confidentiality
    body_markdown: str = field(repr=False)


@dataclass(frozen=True)
class SubjectFact:
    subject_id: UUID
    product_id: UUID
    subject_revision: int
    fact: FactCandidate | None = field(repr=False)


@dataclass(frozen=True)
class FactAssembly:
    subjects: tuple[SubjectFact, ...] = field(repr=False)

    def __post_init__(self) -> None:
        if len({row.subject_id for row in self.subjects}) != len(self.subjects):
            raise ValueError("事实装配对象不能重复")
        for row in self.subjects:
            if row.fact is not None and (
                not eligible_fact(row.fact) or row.fact.product_id != row.product_id
            ):
                raise ValueError("事实装配必须使用同产品非空 APPROVED 版本")


def eligible_fact(fact: FactCandidate) -> bool:
    return (
        fact.status == FactVersionStatus.APPROVED
        and fact.version > 0
        and bool(fact.body_markdown.strip())
        and "\x00" not in fact.body_markdown
    )


def freeze_fact_versions(
    subjects: Sequence[GeoRunSubjectSnapshot], candidates: Sequence[FactCandidate]
) -> FactAssembly:
    """冻结每个自有产品的最高合格 version；缺事实保持空，不借用父级或竞品。"""
    if not subjects or len({row.id for row in subjects}) != len(subjects):
        raise ValueError("事实装配必须包含唯一监测对象")
    if len({row.id for row in candidates}) != len(candidates):
        raise ValueError("事实候选不能重复")
    qualifying: dict[UUID, FactCandidate] = {}
    versions: set[tuple[UUID, int]] = set()
    for fact in candidates:
        if not eligible_fact(fact):
            continue
        key = (fact.product_id, fact.version)
        if key in versions:
            raise ValueError("同产品事实版本号不能重复")
        versions.add(key)
        previous = qualifying.get(fact.product_id)
        if previous is None or fact.version > previous.version:
            qualifying[fact.product_id] = fact
    return FactAssembly(
        tuple(
            SubjectFact(row.id, row.product_id, row.revision, qualifying.get(row.product_id))
            for row in sorted(subjects, key=lambda row: row.id)
            if row.subject_type == GeoSubjectType.OWN_PRODUCT and row.product_id is not None
        )
    )


def assemble_fact_versions(db: Session, subjects: Sequence[GeoRunSubjectSnapshot]) -> FactAssembly:
    """一次列查询绕开 identity-map；不 flush、commit、开事务或取得业务行锁。

    选择与后续绑定必须处于调用者的一致读事务；0054 在写入边界强制重验资格。
    单独调用该阶段不意味着已经创建 AnalysisRevision 或锁住事实生命周期。
    """
    product_ids = {
        row.product_id for row in subjects if row.subject_type == GeoSubjectType.OWN_PRODUCT
    }
    if not product_ids:
        return freeze_fact_versions(subjects, ())
    with db.no_autoflush:
        rows = db.execute(
            select(
                FactVersion.id,
                FactVersion.product_id,
                FactVersion.version,
                FactVersion.status,
                FactVersion.classification,
                FactVersion.body_markdown,
            ).where(
                FactVersion.product_id.in_(product_ids),
                FactVersion.status == "APPROVED",
            )
        ).all()
    candidates = tuple(
        FactCandidate(
            row.id,
            row.product_id,
            row.version,
            FactVersionStatus(row.status),
            Confidentiality(row.classification),
            row.body_markdown,
        )
        for row in rows
    )
    return freeze_fact_versions(subjects, candidates)
