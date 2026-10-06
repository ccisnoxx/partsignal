"""702 纯规则输入/输出合同；协议和持久化转换由应用服务拥有。"""

from dataclasses import dataclass
from uuid import UUID

from app.schemas.geo_rules import GeoRuleCode


@dataclass(frozen=True)
class OpportunityScope:
    subject_id: UUID | None
    query_topic_id: UUID | None
    prompt_variant_id: UUID | None
    collection_profile_id: UUID | None
    engine_surface_id: UUID | None
    batch_id: UUID | None = None
    # 完整同口径分层的确定性指纹，不包含时间窗口或本次阈值。
    environment_key: str = ""


@dataclass(frozen=True)
class OpportunitySource:
    run_id: UUID
    analysis_revision_id: UUID | None
    review_id: UUID | None
    source_role: str = "TRIGGER"


@dataclass(frozen=True)
class RuleEvaluation:
    rule_code: GeoRuleCode
    scope: OpportunityScope
    priority: str
    triggered: bool
    value: float | None
    threshold: float | None
    numerator: int
    denominator: int
    unavailable_reasons: tuple[str, ...]
    sources: tuple[OpportunitySource, ...]
    # 仅白名单的指标、维度、事件ID/错误指纹和样本信息；不包含答案/事实正文/URL。
    details_json: str
