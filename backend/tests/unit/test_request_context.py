"""验证请求关联 ID 的 HTTP 边界。"""

import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_request_id_accepts_printable_ascii_boundary() -> None:
    request_id = " " + "a" * 98 + "~"
    response = TestClient(app).get("/api/health/live", headers={"X-Request-ID": request_id})
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == request_id


@pytest.mark.parametrize("request_id", ["", "a" * 101])
def test_request_id_rejects_invalid_length_with_error_envelope(request_id: str) -> None:
    response = TestClient(app).get(
        "/api/health/live",
        headers={"X-Request-ID": request_id},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]


def test_request_id_rejects_non_printable_ascii_with_error_envelope() -> None:
    response = TestClient(app).get(
        "/api/health/live",
        headers={"X-Request-ID": "request-id-\u007f"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert response.json()["error"]["request_id"] == response.headers["X-Request-ID"]
