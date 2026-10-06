"""只读计划矩阵及估价覆盖；不创建 Batch/Run，不调用外部 Collector。"""

import re
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from decimal import Decimal, localcontext
from typing import cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.collectors.registry import (
    CollectorCapability,
    CollectorRegistry,
    ProfileBlockerCode,
    collector_registry,
)
from app.config import Settings, settings
from app.models.geo_catalog import GeoSubject
from app.models.geo_prompt_variants import GeoPromptVariant
from app.schemas.geo_monitoring_plans import GeoMonitoringPlanConfiguration
from app.schemas.geo_plan_preview import (
    GeoEstimatedCostCoverage,
    GeoKnownCostTotal,
    GeoMonitoringPlanPreview,
    GeoPlanBlockerCode,
    GeoPlanEstimatedCost,
    GeoPlanPreviewBlocker,
    GeoPlanPreviewWarning,
    GeoPlanWarningCode,
)
from app.schemas.geo_surfaces import GeoCollectionMode
from app.services.geo_collection_profiles import ProfileFacts, load_profile_facts
from app.services.geo_collector_eligibility import GeoRuntimeSwitches, evaluate_profile


@dataclass(frozen=True)
class PlanMatrixSelection:
    subject_ids: tuple[UUID, ...]
    prompt_variant_ids: tuple[UUID, ...]
    collection_profile_ids: tuple[UUID, ...]
    repeat_count: int
    budget_limit: Decimal | None

    def __post_init__(self) -> None:
        for ids in (self.subject_ids, self.prompt_variant_ids, self.collection_profile_ids):
            if not ids or len(ids) != len(set(ids)):
                raise ValueError("矩阵每个选择集合必须非空且资源唯一")
        for name in ("subject_ids", "prompt_variant_ids", "collection_profile_ids"):
            object.__setattr__(self, name, tuple(sorted(getattr(self, name))))
        if type(self.repeat_count) is not int or not 1 <= self.repeat_count <= 10:
            raise ValueError("矩阵重复次数必须为1到10的整数")
        if self.budget_limit is not None:
            if not isinstance(self.budget_limit, Decimal):
                raise ValueError("内部矩阵预算必须为 Decimal 或空")
            # 与配置入口共用数值范围，内部调用也不能绕过聚合输入合同。
            from pydantic import TypeAdapter

            from app.schemas.geo_monitoring_plans import PlanBudget

            TypeAdapter(PlanBudget).validate_python(self.budget_limit)

    @classmethod
    def from_configuration(cls, value: GeoMonitoringPlanConfiguration) -> "PlanMatrixSelection":
        """协议输入已经校验 PRIMARY/唯一性/范围，复制并规范顺序以隔离表单状态。"""
        return cls(
            tuple(sorted(item.subject_id for item in value.subjects)),
            tuple(sorted(value.prompt_variant_ids)),
            tuple(sorted(value.collection_profile_ids)),
            value.repeat_count,
            value.budget_limit,
        )


@dataclass(frozen=True)
class PromptFacts:
    id: UUID
    revision: int
    is_active: bool
    language_code: str
    region_code: str
    prompt_text: str = field(repr=False)


@dataclass(frozen=True)
class CellCostEstimate:
    """一格的服务端估价；None 表示未知，明确零仍需明确币种。"""

    value: Decimal
    currency: str

    def __post_init__(self) -> None:
        if (
            not isinstance(self.value, Decimal)
            or not self.value.is_finite()
            or self.value < 0
            or self.value > Decimal("99999999.999999")
            or cast(int, self.value.as_tuple().exponent) < -6
        ):
            raise ValueError("单格估价必须为有限非负 Decimal，最多8位整数和6位小数")
        if re.fullmatch(r"[A-Z]{3}", self.currency) is None:
            raise ValueError("估价必须提供明确的三字母大写币种")


CostEstimator = Callable[[PromptFacts, ProfileFacts], CellCostEstimate | None]


@dataclass(frozen=True)
class MatrixIssue[Code]:
    code: Code
    field: str
    resource_id: UUID | None = None
    related_resource_id: UUID | None = None


@dataclass(frozen=True)
class RunMatrixCell:
    prompt_variant_id: UUID
    collection_profile_id: UUID
    repeat_index: int


@dataclass(frozen=True)
class RunMatrix:
    selection: PlanMatrixSelection
    mode_run_counts: tuple[tuple[GeoCollectionMode, int], ...]
    unresolved_run_count: int
    known_run_count: int
    known_costs: tuple[tuple[str, Decimal], ...]
    blockers: tuple[MatrixIssue[GeoPlanBlockerCode | ProfileBlockerCode], ...]
    warnings: tuple[MatrixIssue[GeoPlanWarningCode], ...]

    @property
    def run_count(self) -> int:
        return (
            len(self.selection.prompt_variant_ids)
            * len(self.selection.collection_profile_ids)
            * self.selection.repeat_count
        )

    def cells(self) -> Iterator[RunMatrixCell]:
        """惰性展开请求单元；阻断不静默缩减用户矩阵，消费方必须先检查资格。"""
        for prompt_id in self.selection.prompt_variant_ids:
            for profile_id in self.selection.collection_profile_ids:
                for index in range(1, self.selection.repeat_count + 1):
                    yield RunMatrixCell(prompt_id, profile_id, index)

    def preview(self) -> GeoMonitoringPlanPreview:
        counts = dict(self.mode_run_counts)
        unknown = self.run_count - self.known_run_count
        coverage = (
            GeoEstimatedCostCoverage.NONE
            if not self.known_run_count
            else GeoEstimatedCostCoverage.PARTIAL
            if unknown
            else GeoEstimatedCostCoverage.COMPLETE
        )
        currency, value = self.known_costs[0] if len(self.known_costs) == 1 else (None, None)
        return GeoMonitoringPlanPreview(
            prompt_count=len(self.selection.prompt_variant_ids),
            profile_count=len(self.selection.collection_profile_ids),
            repeat_count=self.selection.repeat_count,
            run_count=self.run_count,
            manual_run_count=counts[GeoCollectionMode.MANUAL],
            api_run_count=counts[GeoCollectionMode.API],
            browser_run_count=counts[GeoCollectionMode.BROWSER],
            unresolved_run_count=self.unresolved_run_count,
            estimated_cost=GeoPlanEstimatedCost(
                value=value,
                currency=currency,
                coverage=coverage,
                known_run_count=self.known_run_count,
                unknown_run_count=unknown,
                known_costs=[GeoKnownCostTotal(currency=c, value=v) for c, v in self.known_costs],
            ),
            blockers=[
                GeoPlanPreviewBlocker(
                    code=issue.code,
                    field=issue.field,
                    resource_id=issue.resource_id,
                    related_resource_id=issue.related_resource_id,
                )
                for issue in self.blockers
            ],
            warnings=[
                GeoPlanPreviewWarning(
                    code=issue.code,
                    field=issue.field,
                    resource_id=issue.resource_id,
                    related_resource_id=issue.related_resource_id,
                )
                for issue in self.warnings
            ],
        )


class RunMatrixBuilder:
    def __init__(self, registry: CollectorRegistry = collector_registry) -> None:
        self.registry = registry

    def build(
        self,
        selection: PlanMatrixSelection,
        *,
        subjects: Mapping[UUID, bool],
        prompts: Mapping[UUID, PromptFacts],
        profiles: Mapping[UUID, ProfileFacts],
        switches: GeoRuntimeSwitches,
        required_capabilities: frozenset[CollectorCapability] = frozenset(),
        estimate: CostEstimator | None = None,
    ) -> RunMatrix:
        """输入为已校验选择及同一当前快照；估价只能是内部无 I/O 计算。"""
        blockers: list[MatrixIssue[GeoPlanBlockerCode | ProfileBlockerCode]] = []
        warnings: list[MatrixIssue[GeoPlanWarningCode]] = []
        for subject_id in selection.subject_ids:
            if subject_id not in subjects:
                blockers.append(
                    MatrixIssue(GeoPlanBlockerCode.SUBJECT_NOT_FOUND, "subjects", subject_id)
                )
            elif not subjects[subject_id]:
                blockers.append(
                    MatrixIssue(GeoPlanBlockerCode.SUBJECT_DISABLED, "subjects", subject_id)
                )
        for prompt_id in selection.prompt_variant_ids:
            if prompt_id not in prompts:
                blockers.append(
                    MatrixIssue(
                        GeoPlanBlockerCode.PROMPT_NOT_FOUND, "prompt_variant_ids", prompt_id
                    )
                )
            elif not prompts[prompt_id].is_active:
                blockers.append(
                    MatrixIssue(GeoPlanBlockerCode.PROMPT_DISABLED, "prompt_variant_ids", prompt_id)
                )

        counts = dict.fromkeys(GeoCollectionMode, 0)
        unresolved = 0
        eligible_profiles: set[UUID] = set()
        environments: set[tuple[str, str, str]] = set()
        per_profile = len(selection.prompt_variant_ids) * selection.repeat_count
        for profile_id in selection.collection_profile_ids:
            facts = profiles.get(profile_id)
            if facts is None:
                unresolved += per_profile
                blockers.append(
                    MatrixIssue(
                        GeoPlanBlockerCode.PROFILE_NOT_FOUND, "collection_profile_ids", profile_id
                    )
                )
                continue
            p = facts.profile
            counts[p.collection_mode] += per_profile
            environments.add((p.language_code, p.region_code, p.login_state))
            eligibility = evaluate_profile(
                p,
                facts.surface,
                model=facts.model,
                switches=switches,
                registry=self.registry,
                required_capabilities=required_capabilities,
            )
            blockers.extend(
                MatrixIssue(b.code, "collection_profile_ids." + b.field, profile_id)
                for b in eligibility.blockers
            )
            if eligibility.eligible:
                eligible_profiles.add(profile_id)
            if CollectorCapability.MODEL_VERSION not in eligibility.capabilities:
                warnings.append(
                    MatrixIssue(
                        GeoPlanWarningCode.MODEL_VERSION_UNKNOWN,
                        "collection_profile_ids",
                        profile_id,
                    )
                )
        if sum(count > 0 for count in counts.values()) > 1:
            warnings.append(
                MatrixIssue(GeoPlanWarningCode.MIXED_COLLECTION_MODES, "collection_profile_ids")
            )
        if len(environments) > 1:
            warnings.append(
                MatrixIssue(GeoPlanWarningCode.MIXED_PROFILE_ENVIRONMENTS, "collection_profile_ids")
            )

        known_count = 0
        totals: dict[str, Decimal] = {}
        run_count = per_profile * len(selection.collection_profile_ids)
        # 单格为numeric(14,6)精度，扩大上下文避免大矩阵聚合受默认精度舍入。
        with localcontext() as context:
            context.prec = max(28, 15 + len(str(run_count)))
            for prompt_id in selection.prompt_variant_ids:
                prompt = prompts.get(prompt_id)
                for profile_id in selection.collection_profile_ids:
                    facts = profiles.get(profile_id)
                    if prompt is None or facts is None:
                        continue
                    p = facts.profile
                    if (prompt.language_code, prompt.region_code) != (
                        p.language_code,
                        p.region_code,
                    ):
                        warnings.append(
                            MatrixIssue(
                                GeoPlanWarningCode.PROMPT_PROFILE_ENVIRONMENT_MISMATCH,
                                "prompt_variant_ids",
                                prompt_id,
                                profile_id,
                            )
                        )
                    if (
                        estimate is None
                        or not prompt.is_active
                        or profile_id not in eligible_profiles
                    ):
                        continue
                    cost = estimate(prompt, facts)
                    if cost is not None:
                        known_count += selection.repeat_count
                        totals[cost.currency] = (
                            totals.get(cost.currency, Decimal(0))
                            + cost.value * selection.repeat_count
                        )
        if known_count < run_count:
            code = (
                GeoPlanWarningCode.COST_PARTIAL if known_count else GeoPlanWarningCode.COST_UNKNOWN
            )
            warnings.append(MatrixIssue(code, "estimated_cost"))
            if selection.budget_limit is not None:
                warnings.append(MatrixIssue(GeoPlanWarningCode.BUDGET_UNVERIFIED, "budget_limit"))
        if len(totals) > 1:
            warnings.append(
                MatrixIssue(GeoPlanWarningCode.COST_CURRENCY_MISMATCH, "estimated_cost")
            )
            if selection.budget_limit is not None:
                blockers.append(
                    MatrixIssue(GeoPlanBlockerCode.BUDGET_CURRENCY_MISMATCH, "budget_limit")
                )
        elif (
            totals
            and selection.budget_limit is not None
            and next(iter(totals.values())) > selection.budget_limit
        ):
            blockers.append(MatrixIssue(GeoPlanBlockerCode.BUDGET_EXCEEDED, "budget_limit"))
        return RunMatrix(
            selection,
            tuple(counts.items()),
            unresolved,
            known_count,
            tuple(sorted(totals.items())),
            tuple(blockers),
            tuple(warnings),
        )


def preview_plan(
    db: Session,
    configuration: GeoMonitoringPlanConfiguration,
    *,
    runtime_configuration: Settings = settings,
    registry: CollectorRegistry = collector_registry,
    required_capabilities: frozenset[CollectorCapability] = frozenset(),
    estimate: CostEstimator | None = None,
) -> GeoMonitoringPlanPreview:
    """调用方拥有一致读事务；不提交/回滚/锁行，不把预览当未来发送授权。"""
    if db.connection().get_isolation_level() not in {"REPEATABLE READ", "SERIALIZABLE"}:
        raise ValueError("计划预览必须在 REPEATABLE READ 或 SERIALIZABLE 一致快照中读取")
    selection = PlanMatrixSelection.from_configuration(configuration)
    subjects, prompts, profiles = load_matrix_facts(db, [selection])
    return (
        RunMatrixBuilder(registry)
        .build(
            selection,
            subjects=subjects,
            prompts=prompts,
            profiles=profiles,
            switches=GeoRuntimeSwitches(
                runtime_configuration.environment,
                runtime_configuration.geo_monitoring_enabled,
                runtime_configuration.geo_api_collection_enabled,
                runtime_configuration.geo_browser_collection_enabled,
            ),
            required_capabilities=required_capabilities,
            estimate=estimate,
        )
        .preview()
    )


def load_matrix_facts(
    db: Session, selections: list[PlanMatrixSelection]
) -> tuple[dict[UUID, bool], dict[UUID, PromptFacts], dict[UUID, ProfileFacts]]:
    """读模型批量共享三次查询；命令调用前必须锁定所选资源及资格依赖。"""
    subject_ids = {identity for s in selections for identity in s.subject_ids}
    prompt_ids = {identity for s in selections for identity in s.prompt_variant_ids}
    profile_ids = {identity for s in selections for identity in s.collection_profile_ids}
    subjects = dict(
        db.execute(
            select(GeoSubject.id, GeoSubject.is_active)
            .where(GeoSubject.id.in_(subject_ids))
            .execution_options(autoflush=False)
        )
        .tuples()
        .all()
    )
    rows = db.execute(
        select(
            GeoPromptVariant.id,
            GeoPromptVariant.revision,
            GeoPromptVariant.is_active,
            GeoPromptVariant.language_code,
            GeoPromptVariant.region_code,
            GeoPromptVariant.prompt_text,
        )
        .where(GeoPromptVariant.id.in_(prompt_ids))
        .execution_options(autoflush=False)
    ).all()
    prompts = {row.id: PromptFacts(*row) for row in rows}
    profiles = load_profile_facts(db, tuple(profile_ids))
    return subjects, prompts, profiles
