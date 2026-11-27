"""Slice 2D 单元测试：统一任务分派、SLA 校验边界与 OpenAPI 契约。"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from app.schemas.work_assignment import (
    ContentRequestChangesHandoffCommand,
    ContentReviewHandoffCommand,
    WorkAssignmentUpdate,
)


def test_work_assignment_update_validates_timezone_and_blocked_reason() -> None:
    # 无时区 due_at 必须拒绝
    with pytest.raises(ValidationError):
        WorkAssignmentUpdate(expected_revision=0, due_at=datetime(2026, 12, 1, 10, 0))

    # 空白 blocked_reason 归一为 None；超 500 字拒绝
    normalized = WorkAssignmentUpdate(
        expected_revision=1,
        due_at=datetime(2026, 12, 1, 10, 0, tzinfo=UTC),
        blocked_reason="   ",
    )
    assert normalized.blocked_reason is None

    with pytest.raises(ValidationError):
        WorkAssignmentUpdate(expected_revision=0, blocked_reason="x" * 501)


def test_content_review_handoff_commands_accept_optional_next_assignee() -> None:
    submit = ContentReviewHandoffCommand(expected_revision=0, comment="")
    assert submit.next_assignee_id is None
    reject = ContentRequestChangesHandoffCommand(expected_revision=1, comment="请补充引脚说明")
    assert reject.next_assignee_id is None


def test_openapi_contains_slice_2d_assignment_and_inbox_operations() -> None:
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    doc = yaml.safe_load(contract.read_text(encoding="utf-8"))
    paths = doc["paths"]
    assert paths["/api/v1/workbench/inbox"]["get"]["operationId"] == "getWorkbenchInbox"
    assert paths["/api/v1/workbench/assignees"]["get"]["operationId"] == "listWorkbenchAssignees"
    assert paths["/api/v1/work-assignments/{target_type}/{target_id}"]["get"]["operationId"] == (
        "getWorkAssignment"
    )
    for path, expected_op in (
        ("/api/v1/fact-versions/{fact_version_id}/assignment", "updateFactVersionAssignment"),
        ("/api/v1/content-tasks/{content_task_id}/assignment", "updateContentTaskAssignment"),
        (
            "/api/v1/publication-works/{publication_work_id}/assignment",
            "updatePublicationWorkAssignment",
        ),
        (
            "/api/v1/published-content-issues/{issue_id}/assignment",
            "updatePublishedContentIssueAssignment",
        ),
        (
            "/api/v1/geo/opportunities/{opportunity_id}/assignment",
            "updateGeoOpportunityAssignment",
        ),
    ):
        assert paths[path]["patch"]["operationId"] == expected_op
