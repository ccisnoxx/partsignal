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
