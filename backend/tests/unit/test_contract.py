"""冻结 OpenAPI 与运行时路由的契约测试。"""

import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.db import get_db
from app.deps import get_current_session
from app.main import app
from app.security import hash_token
from app.tools.contract_check import check


def test_runtime_openapi_matches_frozen_operations() -> None:
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    assert check(contract) == []


def test_live_health_does_not_require_external_dependencies() -> None:
    response = TestClient(app).get("/api/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": None}


@pytest.mark.parametrize(
    ("account_type", "headers", "expected_status", "expected_code"),
    [
        (
            "ENGINEER",
            {"X-CSRF-Token": "contract-test-csrf-token-more-than-32-characters"},
            403,
            "PERMISSION_DENIED",
        ),
        ("ADMIN", {}, 422, "VALIDATION_ERROR"),
        (
            "ADMIN",
            {"X-CSRF-Token": "wrong-contract-test-csrf-token-more-than-32-chars"},
            403,
            "CSRF_INVALID",
        ),
    ],
)
def test_query_topic_delete_rejects_non_admin_and_missing_csrf(
    account_type: str,
    headers: dict[str, str],
    expected_status: int,
    expected_code: str,
) -> None:
    """删除问题的权限和 CSRF 必须在进入业务命令前拒绝。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type=account_type),
        csrf_hash=hash_token(csrf_token),
    )
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).delete(
            f"/api/v1/query-topics/{uuid.uuid4()}?expected_revision=0",
            headers=headers,
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == expected_status
    assert response.json()["error"]["code"] == expected_code


def test_query_topic_delete_rejects_anonymous_request() -> None:
    """匿名请求必须在访问删除命令前返回统一认证错误。"""
    app.dependency_overrides[get_db] = lambda: object()
    try:
        response = TestClient(app).delete(
            f"/api/v1/query-topics/{uuid.uuid4()}?expected_revision=0",
            headers={"X-CSRF-Token": "contract-test-csrf-token-more-than-32-characters"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


@pytest.mark.parametrize(
    ("path", "tags"),
    [
        ("/api/v1/content-tasks/{id}/manual-versions", []),
        ("/api/v1/content-tasks/{id}/manual-versions", ["   "]),
        ("/api/v1/content-versions/{id}/revisions", []),
        ("/api/v1/content-versions/{id}/revisions", ["   "]),
    ],
)
def test_content_revision_routes_reject_invalid_tags(path: str, tags: list[str]) -> None:
    """绕过前端时，两个内容写入入口仍返回带字段位置的 422。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type="ENGINEER"),
        csrf_hash=hash_token(csrf_token),
    )
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).post(
            path.format(id=uuid.uuid4()),
            headers={"X-CSRF-Token": csrf_token},
            json={
                "title": "标题",
                "summary": "摘要",
                "body_markdown": "正文",
                "tags": tags,
                "change_summary": "人工校对",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    payload = response.json()["error"]
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(issue["loc"][:2] == ["body", "tags"] for issue in payload["details"]["errors"])


def test_content_draft_update_rejects_empty_tags_before_business_command() -> None:
    """人工草稿原地保存继续使用内容标签请求边界。"""
    csrf_token = "contract-test-csrf-token-more-than-32-characters"
    current_session = SimpleNamespace(
        user=SimpleNamespace(account_type="ENGINEER"),
        csrf_hash=hash_token(csrf_token),
    )
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_session] = lambda: current_session
    try:
        response = TestClient(app).put(
            f"/api/v1/content-versions/{uuid.uuid4()}",
            headers={"X-CSRF-Token": csrf_token},
            json={
                "expected_revision": 0,
                "title": "标题",
                "summary": "摘要",
                "body_markdown": "正文",
                "tags": [],
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422
    payload = response.json()["error"]
    assert payload["code"] == "VALIDATION_ERROR"
    assert any(issue["loc"][:2] == ["body", "tags"] for issue in payload["details"]["errors"])
