"""Profile 诊断使用官方 SDK 与真实回环 HTTP fake provider。"""

from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.config import settings
from app.geo_fake_server import GeoFakeServer, running_geo_fake
from app.models.ai_generation import AIChannel, AIChannelHeader, AIModel
from app.services import geo_profile_tests
from app.services.ai_provider import AIProvider
from app.services.credentials import CredentialCipher
from tests.integration.geo_surface_management_support import SurfaceAPI


@pytest.fixture
def profile_provider(monkeypatch: pytest.MonkeyPatch) -> Iterator[GeoFakeServer]:
    monkeypatch.setattr(settings, "ai_allow_local_http", True)

    class TestDeadlineProvider(AIProvider):
        def test_connection(self, **arguments):
            # 仅缩短测试截止；实际序列化、网络调用和错误映射仍由 SDK 完成。
            arguments["timeout_seconds"] = min(arguments["timeout_seconds"], 1)
            return super().test_connection(**arguments)

    monkeypatch.setattr(geo_profile_tests, "AIProvider", TestDeadlineProvider)
    with running_geo_fake() as server:
        yield server


def api_profile(
    api: SurfaceAPI, monkeypatch: pytest.MonkeyPatch, provider: GeoFakeServer,
    *, model_parameters: dict | None = None
) -> tuple[dict, AIChannel, AIModel, str]:
    monkeypatch.setattr(settings, "geo_api_collection_enabled", True)
    monkeypatch.setattr(settings, "ai_credential_encryption_key", "A" * 43 + "=")
    call_id = str(uuid4())
    with api.factory() as db:
        channel_id = uuid4()
        channel = AIChannel(
            id=channel_id,
            name="虚构诊断渠道",
            description="本地 HTTP 替身",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url=provider.base_url + "/v1",
            api_key_ciphertext=CredentialCipher(settings.ai_credential_encryption_key).encrypt(
                "fake-secret-never-persist-plaintext",
                associated_data=f"ai_channel:{channel_id}:api_key",
            ),
            api_key_updated_at=datetime.now(UTC),
            timeout_seconds=10,
            is_enabled=True,
            revision=0,
            created_by=api.admin_id,
        )
        db.add(channel)
        db.flush()
        model = AIModel(
            channel_id=channel.id,
            display_name="虚构模型",
            model_id="fake-model",
            request_parameters=model_parameters or {},
            is_enabled=True,
            test_status="PASSED",
            last_tested_at=datetime.now(UTC),
            revision=0,
            created_by=api.admin_id,
        )
        db.add(model)
        db.add(
            AIChannelHeader(
                channel_id=channel.id,
                name="X-GEO-Attempt-ID",
                normalized_name="x-geo-attempt-id",
                is_sensitive=False,
                plain_value=call_id,
            )
        )
        db.commit()
    surface = api.surface(surface_kind="MODEL_API", compliance_status="APPROVED")
    sid = surface["summary"]["id"]
    enabled = api.admin.post(
        f"/api/v1/geo/engine-surfaces/{sid}/enable", json={"expected_revision": 0}
    )
    assert enabled.status_code == 200, enabled.text
    profile = api.profile(
        surface,
        "API",
        adapter_key="openai-compatible-chat",
        ai_channel_id=str(channel.id),
        ai_model_id=str(model.id),
    )
    return profile, channel, model, call_id
