"""GEO-403 真 HTTP/身份/PG/pinned TLS 诊断及当前资格失效。"""

# ruff: noqa: F811

from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import func, select, text

from app.config import settings
from app.geo_fake_server import FakeMode, FakeScenario
from app.models.geo_runs import GeoObservationBatch, GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile
from app.models.identity import AuditLog
from tests.integration.geo_profile_test_support import api_profile, https_provider  # noqa: F401
from tests.integration.geo_surface_management_support import (  # noqa: F401
    PROFILES,
    SurfaceAPI,
    surface_api,
    surface_engine,
)

pytestmark = pytest.mark.integration


def test_success_does_not_create_business_runs_or_enable(
    surface_api: SurfaceAPI, https_provider, monkeypatch
):
    profile, _, _, call_id = api_profile(surface_api, monkeypatch)
    pid = profile["summary"]["id"]
    with surface_api.factory() as db:
        counts = tuple(
            db.scalar(select(func.count()).select_from(table))
            for table in (GeoObservationBatch, GeoObservationRun)
        )
    result = surface_api.admin.post(f"{PROFILES}/{pid}/test", json={"expected_revision": 0})
    assert result.status_code == 200, result.text
    current = result.json()
    assert current["summary"]["last_test_status"] == "PASSED"
    assert current["summary"]["last_tested_at"] is not None
    assert current["summary"]["revision"] == 2
    assert current["summary"]["is_active"] is False and "ENABLE" not in current["available_actions"]
    assert current["test_error"] is None and current["test_blockers"] == []
    assert {b["code"] for b in current["activation_blockers"]} == {"ADAPTER_NOT_APPROVED"}
    duplicate = surface_api.admin.post(f"{PROFILES}/{pid}/test", json={"expected_revision": 0})
    assert duplicate.status_code == 409
    assert https_provider.state.snapshot(UUID(call_id))["count"] == 1
    with surface_api.factory() as db:
        assert counts == tuple(
            db.scalar(select(func.count()).select_from(table))
            for table in (GeoObservationBatch, GeoObservationRun)
        )
        audit = db.scalar(
            select(AuditLog).where(
                AuditLog.target_id == pid, AuditLog.action == "geo_collection_profile.tested"
            )
        )
        assert audit is not None and audit.details["facts"]["test_status"] == "PASSED"
    engineer = surface_api.engineer.get(f"{PROFILES}/{pid}").json()
    assert engineer["test_error"] is None and engineer["test_blockers"] is None
    assert engineer["configuration"] is None and engineer["available_actions"] == []


@pytest.mark.parametrize(
    "mode,code",
    [
        (FakeMode.AUTH_401, "AI_PROVIDER_ERROR"),
        (FakeMode.RATE_LIMIT, "AI_PROVIDER_ERROR"),
        (FakeMode.REDIRECT, "AI_REDIRECT_FORBIDDEN"),
        (FakeMode.TIMEOUT, "AI_PROVIDER_TIMEOUT"),
        (FakeMode.DISCONNECT, "AI_PROVIDER_UNAVAILABLE"),
        (FakeMode.OVERSIZE, "AI_RESPONSE_TOO_LARGE"),
        (FakeMode.OVERSIZE_CHUNKED, "AI_RESPONSE_TOO_LARGE"),
        (FakeMode.INVALID_JSON, "AI_RESPONSE_INVALID"),
        (FakeMode.EMPTY_ANSWER, "AI_RESPONSE_INVALID"),
    ],
)
def test_provider_failure_safe_result_and_no_retry(
    surface_api, https_provider, monkeypatch, mode, code
):
    profile, _, _, call_id = api_profile(surface_api, monkeypatch)
    https_provider.state.configure(
        UUID(call_id), FakeScenario(mode=mode, echo_sensitive=True, delay_seconds=5.0)
    )
    response = surface_api.admin.post(
        f"{PROFILES}/{profile['summary']['id']}/test", json={"expected_revision": 0}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["summary"]["last_test_status"] == "FAILED"
    assert result["summary"]["is_active"] is False
    assert result["test_error"]["code"] == code
    assert "fake-secret" not in response.text and "Bearer" not in response.text
    assert https_provider.state.snapshot(UUID(call_id))["count"] == 1
    assert https_provider.state.snapshot(UUID(call_id))["redirect_hits"] == 0


@pytest.mark.parametrize("gate", ["permission", "csrf", "switch", "search", "compliance"])
def test_blocked_before_egress(surface_api, https_provider, monkeypatch, gate):
    profile, _, _, call_id = api_profile(surface_api, monkeypatch)
    pid = profile["summary"]["id"]
    client = surface_api.admin
    if gate == "permission":
        client = surface_api.engineer
    elif gate == "csrf":
        client.headers.pop("X-CSRF-Token")
    elif gate == "switch":
        monkeypatch.setattr(settings, "geo_api_collection_enabled", False)
    elif gate == "search":
        with surface_api.factory() as db:
            db.execute(
                text(
                    "UPDATE geo_collection_profiles SET web_search_policy='REQUIRED', "
                    "revision=revision+1 WHERE id=:id"
                ),
                {"id": pid},
            )
            db.commit()
    elif gate == "compliance":
        with surface_api.factory() as db:
            db.execute(
                text(
                    "UPDATE geo_engine_surfaces SET compliance_status='SUSPENDED', "
                    "revision=revision+1 WHERE id=:id"
                ),
                {"id": profile["summary"]["engine_surface_id"]},
            )
            db.commit()
    response = client.post(
        f"{PROFILES}/{pid}/test", json={"expected_revision": 1 if gate == "search" else 0}
    )
    assert response.status_code == {"permission": 403, "csrf": 422}.get(gate, 409), response.text
    assert https_provider.state.snapshot(UUID(call_id))["count"] == 0


@pytest.mark.parametrize(
    "dependency", ["profile", "channel", "model", "surface", "header", "delete"]
)
def test_dependency_change_invalidates_current_test(
    surface_api, https_provider, monkeypatch, dependency
):
    profile, channel, model, _ = api_profile(surface_api, monkeypatch)
    pid = profile["summary"]["id"]
    result = surface_api.admin.post(f"{PROFILES}/{pid}/test", json={"expected_revision": 0})
    assert result.status_code == 200, result.text
    sql, params = {
        "profile": (
            "UPDATE geo_collection_profiles SET region_code='US',revision=revision+1 WHERE id=:id",
            {"id": pid},
        ),
        "channel": (
            "UPDATE ai_channels SET base_url='https://changed.test/v1',revision=revision+1 "
            "WHERE id=:id",
            {"id": channel.id},
        ),
        "model": (
            "UPDATE ai_models SET request_parameters='{}',last_tested_at=:now,revision=revision+1 "
            "WHERE id=:id",
            {"id": model.id, "now": datetime.now(UTC)},
        ),
        "surface": (
            "UPDATE geo_engine_surfaces SET compliance_status='SUSPENDED',revision=revision+1 "
            "WHERE id=:id",
            {"id": profile["summary"]["engine_surface_id"]},
        ),
        "header": (
            "UPDATE ai_channel_headers SET plain_value='changed' WHERE channel_id=:id",
            {"id": channel.id},
        ),
        "delete": ("DELETE FROM ai_models WHERE id=:id", {"id": model.id}),
    }[dependency]
    with surface_api.factory() as db:
        db.execute(text(sql), params)
        db.commit()
        current = db.get(GeoCollectionProfile, UUID(pid))
        assert current.last_test_status == "UNTESTED" and current.last_tested_at is None
        assert current.is_active is False and current.revision == 3
        assert current.test_attempt_id is None and current.last_test_error_code is None
        if dependency == "delete":
            assert current.ai_model_id is None and current.ai_channel_id is None


@pytest.mark.parametrize("failure", ["tls", "dns", "peer"])
def test_security_failures_do_not_send_credentials_or_prompt(
    surface_api, https_provider, monkeypatch, failure
):
    import socket
    import ssl
    from typing import cast

    from tests.integration.test_ai_egress_https import PeerOverrideSocket

    profile, _, _, call_id = api_profile(surface_api, monkeypatch)
    transport = https_provider.test_transport
    if failure == "tls":
        context = ssl.create_default_context()
        monkeypatch.setattr(
            transport,
            "_tls_wrapper",
            lambda connection, host: context.wrap_socket(connection, server_hostname=host),
        )
    elif failure == "dns":
        monkeypatch.setattr(
            transport,
            "_resolver",
            lambda host, port, **kwargs: [
                (
                    socket.AF_INET,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    "",
                    ("93.184.216.34", port),
                ),
                (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", port)),
            ],
        )
    else:
        monkeypatch.setattr(
            transport,
            "_connector",
            lambda address, timeout: cast(
                socket.socket,
                PeerOverrideSocket(
                    socket.create_connection(("127.0.0.1", https_provider.server_port), timeout),
                    "8.8.8.8",
                ),
            ),
        )
    response = surface_api.admin.post(
        f"{PROFILES}/{profile['summary']['id']}/test", json={"expected_revision": 0}
    )
    assert response.status_code == 200, response.text
    assert response.json()["summary"]["last_test_status"] == "FAILED"
    assert response.json()["test_error"]["code"] == (
        "AI_PROVIDER_UNAVAILABLE" if failure == "tls" else "AI_URL_FORBIDDEN"
    )
    assert https_provider.state.snapshot(UUID(call_id))["count"] == 0


@pytest.mark.parametrize("parameters", [{}, {"max_tokens": 32}, {"max_completion_tokens": 32}])
def test_diagnostic_respects_the_tested_model_output_parameter(
    surface_api, https_provider, monkeypatch, parameters
):
    profile, _, _, call_id = api_profile(surface_api, monkeypatch, model_parameters=parameters)
    response = surface_api.admin.post(
        f"{PROFILES}/{profile['summary']['id']}/test", json={"expected_revision": 0}
    )
    assert response.status_code == 200, response.text
    assert response.json()["summary"]["last_test_status"] == "PASSED"
    assert https_provider.test_request_bodies == [
        {
            "model": "fake-model",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": False,
            **parameters,
        }
    ]
    assert https_provider.state.snapshot(UUID(call_id))["count"] == 1
