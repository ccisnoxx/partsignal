"""验证请求关联 ID 的 HTTP 边界。"""

from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.main import app


def test_request_id_is_generated_when_header_is_missing() -> None:
    response = TestClient(app).get("/api/health/live")

    assert response.status_code == 200
    generated_request_id = response.headers["X-Request-ID"]
    UUID(generated_request_id)
    assert response.json() == {"status": "ok", "checks": None}


@pytest.mark.parametrize("request_id", ["a", "a" * 100])
def test_request_id_accepts_one_and_one_hundred_printable_ascii_characters(
    request_id: str,
) -> None:
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


@pytest.mark.parametrize("request_id", [b"\xff", b"request-id-\x01"])
def test_request_id_rejects_non_ascii_and_control_bytes_with_error_envelope(
    request_id: bytes,
) -> None:
    response = TestClient(app).get(
        "/api/health/live",
        headers=[(b"X-Request-ID", request_id)],
    )

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["request_id"] == response.headers["X-Request-ID"]


def test_request_id_is_written_on_endpoint_validation_error() -> None:
    request_id = "endpoint-error-1"
    response = TestClient(app).post(
        "/api/v1/auth/login",
        headers={"X-Request-ID": request_id},
        json={},
    )

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["request_id"] == request_id
    assert response.headers["X-Request-ID"] == request_id
