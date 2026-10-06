"""引用归属的冻结输入、DNS 标签边界和规则证据；不访问引用目标。"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

from app.schemas.geo_analysis import GeoCitationCorrection, GeoSourceCategory
from app.schemas.geo_answers import GeoAnswerCitationOut
from app.schemas.geo_catalog import GeoSubjectDomainRelationType, GeoSubjectType
from app.schemas.geo_runs import GeoRunSubjectSnapshot
from app.services.geo_catalog_normalization import (
    normalize_catalog_hostname,
    require_catalog_hostname,
)

CITATION_RULE_VERSION = "geo-citations-v1"
CITATION_OWNERSHIP_AMBIGUOUS = "CITATION_OWNERSHIP_AMBIGUOUS"
CITATION_SOURCE_AMBIGUOUS = "CITATION_SOURCE_AMBIGUOUS"


@dataclass(frozen=True)
class SourceCategoryRule:
    hostname: str = field(repr=False)
    source_category: GeoSourceCategory


@dataclass(frozen=True)
class SourceCategoryRules:
    version: str
    entries: tuple[SourceCategoryRule, ...] = field(repr=False)


def freeze_source_categories(
    version: str, entries: Sequence[tuple[str, GeoSourceCategory]]
) -> SourceCategoryRules:
    """第三方类别必须显式登记及版本化；不靠 URL/标题或真实网站硬编码猜测。"""
    if not 1 <= len(version) <= 100 or not version.strip() or "\x00" in version:
        raise ValueError("来源规则必须有有效版本")
    rules = []
    for hostname, category in entries:
        try:
            category = GeoSourceCategory(category)
        except ValueError as error:
            raise ValueError("来源规则类别无效") from error
        if category in {GeoSourceCategory.OWNED, GeoSourceCategory.COMPETITOR}:
            raise ValueError("自有和竞品来源必须依据监测对象域名")
        rules.append(SourceCategoryRule(normalize_catalog_hostname(hostname), category))
    if len({rule.hostname for rule in rules}) != len(rules):
        raise ValueError("来源规则的规范主机名不能重复")
    return SourceCategoryRules(version, tuple(sorted(rules, key=lambda rule: rule.hostname)))


@dataclass(frozen=True)
class SubjectDomain:
    subject_id: UUID
    revision: int
    subject_type: GeoSubjectType
    hostname: str = field(repr=False)
    relation_type: GeoSubjectDomainRelationType


@dataclass(frozen=True)
class CitationRuleSnapshot:
    subject_ids: tuple[UUID, ...]
    domains: tuple[SubjectDomain, ...] = field(repr=False)
    source_categories: SourceCategoryRules | None


def freeze_subject_domains(
    subjects: Sequence[GeoRunSubjectSnapshot],
    *,
    source_categories: SourceCategoryRules | None = None,
) -> CitationRuleSnapshot:
    """复制分析输入字典；共享域名保留全部对象，不重读当前 Catalog 或父品牌。"""
    ids = tuple(sorted(subject.id for subject in subjects))
    if not ids or len(set(ids)) != len(ids):
        raise ValueError("引用快照必须包含唯一监测对象")
    domains = []
    for subject in sorted(subjects, key=lambda item: item.id):
        try:
            subject_type = GeoSubjectType(subject.subject_type)
        except ValueError as error:
            raise ValueError("引用快照对象类型无效") from error
        if len({domain.hostname for domain in subject.domains}) != len(subject.domains):
            raise ValueError("同一对象的规范主机名不能重复")
        for domain in sorted(subject.domains, key=lambda item: item.hostname):
            try:
                relation_type = GeoSubjectDomainRelationType(domain.relation_type)
            except ValueError as error:
                raise ValueError("引用快照域名关系无效") from error
            domains.append(
                SubjectDomain(
                    subject.id,
                    subject.revision,
                    subject_type,
                    require_catalog_hostname(domain.hostname),
                    relation_type,
                )
            )
    return CitationRuleSnapshot(ids, tuple(domains), source_categories)


@dataclass(frozen=True)
class CitationEvidence:
    citation_id: UUID
    answer_snapshot_id: UUID
    hostname: str = field(repr=False)
    position: int
    occurrences: tuple[int, ...]


def freeze_citations(citations: Sequence[GeoAnswerCitationOut]) -> tuple[CitationEvidence, ...]:
    """引用身份沿用原始证据；只转换，不重新去重、提取或改写 URL。"""
    if len(citations) > 1000 or len({row.id for row in citations}) != len(citations):
        raise ValueError("引用集合最多1000项且身份不能重复")
    if len({row.answer_snapshot_id for row in citations}) > 1:
        raise ValueError("引用集合必须属于同一回答")
    if len({row.normalized_url for row in citations}) != len(citations):
        raise ValueError("引用集合包含重复规范 URL")
    positions = [position for row in citations for position in row.occurrences]
    if len(set(positions)) != len(positions):
        raise ValueError("引用集合的原始位置不能重叠")
    result = []
    for row in sorted(citations, key=lambda item: item.position):
        # DTO 可变；在转换边界检查身份仍与原 URL 一致，不能信任后来被改写的 hostname。
        try:
            row = GeoAnswerCitationOut.model_validate(row.model_dump())
        except ValueError:
            raise ValueError("引用规范身份或原始位置无效") from None
        result.append(
            CitationEvidence(
                row.id, row.answer_snapshot_id, row.hostname, row.position, tuple(row.occurrences)
            )
        )
    return tuple(result)


@dataclass(frozen=True)
class CitationMatch:
    hostname: str = field(repr=False)
    source_category: GeoSourceCategory
    subject_id: UUID | None
    subject_revision: int | None
    relation_type: GeoSubjectDomainRelationType | None
    match_kind: Literal["EXACT", "SUBDOMAIN"]


def _domain_category(domain: SubjectDomain) -> GeoSourceCategory:
    if domain.relation_type == GeoSubjectDomainRelationType.DISTRIBUTOR:
        return GeoSourceCategory.DISTRIBUTOR
    if domain.relation_type == GeoSubjectDomainRelationType.OTHER:
        return GeoSourceCategory.OTHER
    if domain.subject_type in {GeoSubjectType.OWN_BRAND, GeoSubjectType.OWN_PRODUCT}:
        return GeoSourceCategory.OWNED
    if domain.subject_type in {GeoSubjectType.COMPETITOR_BRAND, GeoSubjectType.COMPETITOR_PRODUCT}:
        return GeoSourceCategory.COMPETITOR
    # 参考型号不证明属于公司或竞品，不能把 OFFICIAL 直接转成 OWNED。
    return GeoSourceCategory.UNKNOWN


def match_citation_hostname(
    hostname: str, snapshot: CitationRuleSnapshot
) -> tuple[CitationMatch, ...]:
    """匹配精确 hostname 及其点分子域；长度/父子/角色都不能消歧。"""
    matches = []
    for domain in snapshot.domains:
        if hostname == domain.hostname or hostname.endswith("." + domain.hostname):
            matches.append(
                CitationMatch(
                    domain.hostname,
                    _domain_category(domain),
                    domain.subject_id,
                    domain.revision,
                    domain.relation_type,
                    "EXACT" if hostname == domain.hostname else "SUBDOMAIN",
                )
            )
    if snapshot.source_categories is not None:
        for rule in snapshot.source_categories.entries:
            if hostname == rule.hostname or hostname.endswith("." + rule.hostname):
                matches.append(
                    CitationMatch(
                        rule.hostname,
                        rule.source_category,
                        None,
                        None,
                        None,
                        "EXACT" if hostname == rule.hostname else "SUBDOMAIN",
                    )
                )
    return tuple(matches)


@dataclass(frozen=True)
class CitationClassification:
    evidence: CitationEvidence
    source_category: GeoSourceCategory
    subject_id: UUID | None
    candidate_subject_ids: tuple[UUID, ...]
    matches: tuple[CitationMatch, ...] = field(repr=False)
    ambiguity_reasons: tuple[str, ...]


@dataclass(frozen=True)
class CitationAnalysis:
    rule_set_version: str
    source_category_version: str | None
    subject_ids: tuple[UUID, ...]
    citations: tuple[CitationClassification, ...]
    review_required_reasons: tuple[str, ...]


@dataclass(frozen=True)
class ReviewedCitationClassification:
    machine: CitationClassification
    source_category: GeoSourceCategory
    subject_id: UUID | None
    corrected: bool


def project_citation_corrections(
    machine: CitationAnalysis, corrections: Sequence[GeoCitationCorrection]
) -> tuple[ReviewedCitationClassification, ...]:
    """投影已选定复核的修正值；current revision/复核选择与写入由后续命令拥有。"""
    by_id = {row.evidence.citation_id: row for row in machine.citations}
    overrides = {row.citation_id: row for row in corrections}
    if len(overrides) != len(corrections):
        raise ValueError("引用修正目标不能重复")
    if not overrides.keys() <= by_id.keys() or any(
        row.subject_id is not None and row.subject_id not in machine.subject_ids
        for row in corrections
    ):
        raise ValueError("引用修正必须属于本回答与监测范围")
    return tuple(
        ReviewedCitationClassification(
            row,
            overrides[row.evidence.citation_id].source_category
            if row.evidence.citation_id in overrides
            else row.source_category,
            overrides[row.evidence.citation_id].subject_id
            if row.evidence.citation_id in overrides
            else row.subject_id,
            row.evidence.citation_id in overrides,
        )
        for row in machine.citations
    )
