"""确定性 identity 和唯一状态转换政策；不执行后续任务的状态命令。"""

import json
from dataclasses import asdict
from datetime import UTC, datetime
from hashlib import sha256

from app.errors import AppError
from app.models.identity import User
from app.schemas.geo_opportunities import GeoOpportunityActionType as ActionType
from app.schemas.geo_opportunities import GeoOpportunityStatus as Status
from app.schemas.geo_opportunity_workbench import (
    GeoOpportunityAction,
    GeoOpportunityWorkflow,
    GeoOpportunityWorkflowStage,
)
from app.schemas.geo_rules import GeoRuleCode
from app.services.geo_opportunity_types import OpportunityScope

OPEN_STATUSES = (Status.OPEN, Status.ACKNOWLEDGED, Status.IN_PROGRESS)
CONTENT_RULES = frozenset(
    {
        GeoRuleCode.TOPIC_COVERAGE_GAP,
        GeoRuleCode.COMPETITOR_SURGE,
        GeoRuleCode.VISIBILITY_DROP,
        GeoRuleCode.RECOMMENDATION_DROP,
        GeoRuleCode.CRITICAL_FACT_ERROR,
        GeoRuleCode.REPEATED_FACT_ERROR,
    }
)
FACT_RULES = frozenset({GeoRuleCode.CRITICAL_FACT_ERROR, GeoRuleCode.REPEATED_FACT_ERROR})
TRANSITIONS = {
    Status.OPEN: frozenset({Status.ACKNOWLEDGED, Status.DISMISSED}),
    Status.ACKNOWLEDGED: frozenset({Status.IN_PROGRESS, Status.DISMISSED}),
    Status.IN_PROGRESS: frozenset({Status.RESOLVED, Status.DISMISSED}),
    Status.RESOLVED: frozenset(),
    Status.DISMISSED: frozenset(),
}


def identity_key(
    rule: GeoRuleCode, scope: OpportunityScope, date_from: datetime, date_to: datetime
) -> str:
    if any(v.utcoffset() is None for v in (date_from, date_to)) or date_from >= date_to:
        raise ValueError("机会 identity 需要合法带时区半开窗口")
    value = [
        1,
        rule.value,
        asdict(scope),
        date_from.astimezone(UTC).isoformat(),
        date_to.astimezone(UTC).isoformat(),
    ]
    return sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


def assert_transition(before: Status, after: Status, *, reason: str | None = None) -> None:
    if after not in TRANSITIONS[before]:
        raise AppError("INVALID_STATE_TRANSITION", "机会状态不允许此转换", 409)
    if after in {Status.RESOLVED, Status.DISMISSED} and not (reason and reason.strip()):
        raise AppError("VALIDATION_ERROR", "关闭机会必须填写非空原因", 422)


RULE_PRESENTATION = {
    GeoRuleCode.VISIBILITY_DROP: (
        "可见率下降",
        "对比同环境的前后窗口，主体提及比例下降达到规则阈值。",
    ),
    GeoRuleCode.RECOMMENDATION_DROP: (
        "推荐率下降",
        "对比同环境的前后窗口，主体推荐比例下降达到规则阈值。",
    ),
    GeoRuleCode.COMPETITOR_SURGE: ("竞品曝光增长", "竞品在同环境可见率增加达到规则阈值。"),
    GeoRuleCode.TOPIC_COVERAGE_GAP: ("主题覆盖缺口", "核心主题在有效样本中未覆盖主体。"),
    GeoRuleCode.OWN_CITATION_LOST: ("自有引用丢失", "同环境基线存在的自有来源引用在当前窗口丢失。"),
    GeoRuleCode.CRITICAL_FACT_ERROR: ("严重事实错误", "证据分析发现达到规则严重性门槛的错误声明。"),
    GeoRuleCode.REPEATED_FACT_ERROR: (
        "重复事实错误",
        "相同声明错误在规则要求的不同运行中重复出现。",
    ),
    GeoRuleCode.UNSTABLE_RESULT: ("结果不稳定", "同环境重复运行的观测结果差异达到规则阈值。"),
    GeoRuleCode.DATA_QUALITY_PROBLEM: (
        "数据质量问题",
        "有效分析或复核资格不足，触发数据质量规则。",
    ),
    GeoRuleCode.RUN_FAILURE: ("运行失败", "观测运行的失败比例达到规则阈值。"),
}


def workflow(status: Status, actor: User) -> GeoOpportunityWorkflow:
    """投影已实现的命令；复测恢复从来不会自动关闭机会。"""
    eligible = (
        actor.is_active
        and not actor.must_change_password
        and actor.account_type in {"ADMIN", "ENGINEER"}
    )
    actions = []
    if eligible:
        if Status.ACKNOWLEDGED in TRANSITIONS[status]:
            actions.append(GeoOpportunityAction.ACKNOWLEDGE)
        if Status.DISMISSED in TRANSITIONS[status]:
            actions.append(GeoOpportunityAction.DISMISS)
        if status == Status.IN_PROGRESS:
            actions.extend((GeoOpportunityAction.RESOLVE, GeoOpportunityAction.CONTINUE))
    return GeoOpportunityWorkflow(
        workflow_stage=GeoOpportunityWorkflowStage(status if status in OPEN_STATUSES else "CLOSED"),
        primary_task="ACKNOWLEDGE"
        if GeoOpportunityAction.ACKNOWLEDGE in actions
        else "VIEW_EVIDENCE",
        available_actions=actions,
    )


def action_types(status: Status, rule: GeoRuleCode, actor: User) -> list[ActionType]:
    """704的创建资格；治理/补测/解决机会不在本次边界内。"""
    if (
        status not in {Status.ACKNOWLEDGED, Status.IN_PROGRESS}
        or not actor.is_active
        or actor.must_change_password
        or actor.account_type not in {"ADMIN", "ENGINEER"}
    ):
        return []
    result = []
    if rule in FACT_RULES:
        result.append(ActionType.FACT_REVISION)
    if rule in CONTENT_RULES:
        result.append(ActionType.CONTENT_TASK)
    if rule == GeoRuleCode.OWN_CITATION_LOST:
        result.append(ActionType.PUBLICATION_REPAIR)
    return result
