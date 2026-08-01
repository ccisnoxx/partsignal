"""事实与内容审核状态机的纯资格投影。"""

from __future__ import annotations

from typing import Literal

from app.models.content import ContentVersion
from app.models.product_facts import FactVersion

FactAction = Literal["submit", "approve", "request-changes", "retire"]
ContentAction = Literal["submit-review", "approve", "request-changes"]
FactReviewAction = Literal["SUBMIT", "APPROVE", "REQUEST_CHANGES", "RETIRE"]
ContentReviewAction = Literal["SUBMIT_REVIEW", "APPROVE", "REQUEST_CHANGES"]

FACT_TRANSITIONS: dict[FactAction, tuple[frozenset[str], str]] = {
    "submit": (frozenset({"DRAFT", "CHANGES_REQUESTED"}), "PENDING_REVIEW"),
    "approve": (frozenset({"PENDING_REVIEW"}), "APPROVED"),
    "request-changes": (frozenset({"PENDING_REVIEW"}), "CHANGES_REQUESTED"),
    "retire": (frozenset({"APPROVED"}), "RETIRED"),
}
FACT_REVIEW_ACTIONS: dict[FactAction, FactReviewAction] = {
    "submit": "SUBMIT",
    "approve": "APPROVE",
    "request-changes": "REQUEST_CHANGES",
    "retire": "RETIRE",
}
CONTENT_TRANSITIONS: dict[ContentAction, tuple[frozenset[str], str]] = {
    "submit-review": (frozenset({"DRAFT", "CHANGES_REQUESTED"}), "PENDING_REVIEW"),
    "approve": (frozenset({"PENDING_REVIEW"}), "APPROVED"),
    "request-changes": (frozenset({"PENDING_REVIEW"}), "CHANGES_REQUESTED"),
}
CONTENT_REVIEW_ACTIONS: dict[ContentAction, ContentReviewAction] = {
    "submit-review": "SUBMIT_REVIEW",
    "approve": "APPROVE",
    "request-changes": "REQUEST_CHANGES",
}


def fact_review_actions(fact: FactVersion) -> list[FactReviewAction]:
    """按事实版本当前状态返回可执行审核动作。"""
    return [
        FACT_REVIEW_ACTIONS[action]
        for action, (sources, _target) in FACT_TRANSITIONS.items()
        if fact.status in sources
    ]


def content_review_actions(
    content: ContentVersion,
    fact: FactVersion,
) -> list[ContentReviewAction]:
    """按内容状态、质量阻断和事实状态返回审核动作。"""
    blocking = any(issue.get("severity") == "BLOCKING" for issue in content.quality_issues)
    actions = [
        CONTENT_REVIEW_ACTIONS[action]
        for action, (sources, _target) in CONTENT_TRANSITIONS.items()
        if content.status in sources
    ]
    if blocking:
        actions = [action for action in actions if action == "REQUEST_CHANGES"]
    if fact.status != "APPROVED":
        actions = [action for action in actions if action != "APPROVE"]
    return actions
