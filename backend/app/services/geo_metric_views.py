"""趋势与覆盖的冻结内部合同；窗口、门槛和不可用状态均由服务端拥有。"""

from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum


class ComparisonReason(StrEnum):
    MISSING_WINDOW = "MISSING_WINDOW"
    MIXED_DIMENSIONS = "MIXED_DIMENSIONS"
    COMPETITOR_SET_CHANGED = "COMPETITOR_SET_CHANGED"
    DIMENSIONS_CHANGED = "DIMENSIONS_CHANGED"
    FORMULA_CHANGED = "FORMULA_CHANGED"
    NO_DENOMINATOR = "NO_DENOMINATOR"
    INSUFFICIENT_SAMPLE = "INSUFFICIENT_SAMPLE"


@dataclass(frozen=True)
class MetricWindow:
    date_from: datetime
    date_to: datetime

    def __post_init__(self) -> None:
        if any(value.utcoffset() is None for value in (self.date_from, self.date_to)):
            raise ValueError("指标窗口必须包含时区")
        if self.date_from >= self.date_to:
            raise ValueError("指标窗口必须满足 date_from < date_to")
        object.__setattr__(self, "date_from", self.date_from.astimezone(UTC))
        object.__setattr__(self, "date_to", self.date_to.astimezone(UTC))

    @property
    def previous(self) -> "MetricWindow":
        return MetricWindow(self.date_from - (self.date_to - self.date_from), self.date_from)

    @property
    def key(self) -> str:
        return f"{self.date_from.isoformat()}/{self.date_to.isoformat()}"


@dataclass(frozen=True)
class MetricComparison:
    change_points: float | None
    relative_change: float | None
    unavailable_reasons: tuple[ComparisonReason, ...]
    changed_dimensions: tuple[str, ...]
    version_warnings: tuple[str, ...]
    minimum_run_count: int


@dataclass(frozen=True)
class CoveragePolicy:
    target_rate: float = 0.6

    def __post_init__(self) -> None:
        if not 0 < self.target_rate <= 1:
            raise ValueError("覆盖目标必须满足 0 < target_rate <= 1")
