"""冻结 OpenAPI 与运行时路由的契约测试。"""

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.tools.contract_check import check


def test_runtime_openapi_matches_frozen_operations() -> None:
    contract = Path(__file__).resolve().parents[3] / "contracts" / "openapi.yaml"
    assert check(contract) == []


def test_live_health_does_not_require_external_dependencies() -> None:
    response = TestClient(app).get("/api/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": None}
