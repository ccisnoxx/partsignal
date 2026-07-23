"""平台规则工作台投影的纯业务规则测试。"""

import pytest

from app.services.projections import _platform_version_actions


@pytest.mark.parametrize(
    ("status", "reference_count", "expected"),
    [
        ("DRAFT", 0, ["EDIT", "ACTIVATE", "RETIRE", "DELETE"]),
        ("DRAFT", 1, ["EDIT", "ACTIVATE", "RETIRE"]),
        ("ACTIVE", 0, ["DELETE"]),
        ("ACTIVE", 1, []),
        ("RETIRED", 0, ["DELETE"]),
        ("RETIRED", 1, []),
    ],
)
def test_platform_version_actions(
    status: str, reference_count: int, expected: list[str]
) -> None:
    """动作矩阵只由版本状态和实时引用数决定。"""
    assert _platform_version_actions(status, reference_count) == expected
