"""共享 HTTP 校验错误不得返回被拒绝的秘密值或动态判别输入。"""

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from app.errors import validation_error_handler
from app.schemas.geo_surfaces import GeoCollectionProfileCreate
from tests.unit.test_geo_surface_contract import profile_payload


@pytest.mark.parametrize(
    "location", ["extra", "settings", "discriminator", "unknown-key", "unknown-settings-key"]
)
def test_validation_failure_retains_location_and_type_without_secret_values(location: str) -> None:
    app = FastAPI()
    app.add_exception_handler(RequestValidationError, validation_error_handler)

    @app.post("/configuration")
    def configuration(payload: GeoCollectionProfileCreate) -> None:
        raise AssertionError("非法配置不得进入业务命令")

    marker = "fictional-sensitive-marker-205"
    payload = profile_payload()
    if location == "extra":
        payload["api_key"] = marker
    elif location == "settings":
        payload["settings"]["headers"] = {"Authorization": marker}
    elif location == "unknown-key":
        payload[marker] = None
    elif location == "unknown-settings-key":
        payload["settings"][marker] = None
    else:
        payload["collection_mode"] = marker
    response = TestClient(app).post("/configuration", json=payload)
    assert response.status_code == 422 and marker not in response.text
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    errors = response.json()["error"]["details"]["errors"]
    assert errors and all(set(item) == {"loc", "msg", "type"} for item in errors)
    assert all(item["msg"] == "请求字段不符合接口契约" for item in errors)


def test_declared_field_validation_preserves_contract_location() -> None:
    app = FastAPI()
    app.add_exception_handler(RequestValidationError, validation_error_handler)

    @app.post("/configuration")
    def configuration(payload: GeoCollectionProfileCreate) -> None:
        raise AssertionError("非法配置不得进入业务命令")

    payload = profile_payload()
    payload["settings"]["require_screenshot"] = "fictional-sensitive-marker-205"
    response = TestClient(app).post("/configuration", json=payload)
    assert response.status_code == 422
    assert "fictional-sensitive-marker-205" not in response.text
    assert response.json()["error"]["details"]["errors"][0]["loc"] == [
        "body", "MANUAL", "settings", "require_screenshot"
    ]
