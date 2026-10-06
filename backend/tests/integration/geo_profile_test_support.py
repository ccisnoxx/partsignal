"""真实 TLS fake provider 与生产 pinned transport；仅测试层路由至 loopback。"""

import json
import socket
import ssl
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import cast
from uuid import uuid4

import pytest

from app.config import settings
from app.geo_fake_server import GeoFakeServer
from app.models.ai_generation import AIChannel, AIChannelHeader, AIModel
from app.services import geo_profile_tests
from app.services.credentials import CredentialCipher
from app.services.openai_client import OpenAICompatibleClient
from app.services.pinned_http import PinnedHTTPTransport
from tests.integration.geo_surface_management_support import SurfaceAPI
from tests.integration.test_ai_egress_https import PeerOverrideSocket, write_local_ca

HOST = "geo-provider.test"
PUBLIC_IP = "93.184.216.34"


@pytest.fixture
def https_provider(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[GeoFakeServer]:
    ca, certificate, key = write_local_ca(tmp_path, HOST)
    server = GeoFakeServer()
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.02})
    thread.start()
    client_context = ssl.create_default_context(cafile=str(ca))

    def connector(address, timeout):
        return cast(
            socket.socket,
            PeerOverrideSocket(
                socket.create_connection(("127.0.0.1", server.server_port), timeout), PUBLIC_IP
            ),
        )

    server.test_request_bodies = []

    class TestDeadlineTransport(PinnedHTTPTransport):
        def request(self, **kwargs):
            # 测试截止更严格以缩短 timeout 场景；地址/peer/TLS/发送/解析保持生产实现。
            if kwargs.get("body") is not None:
                server.test_request_bodies.append(json.loads(kwargs["body"]))
            kwargs["timeout_seconds"] = min(kwargs["timeout_seconds"], 1)
            return super().request(**kwargs)

    transport = TestDeadlineTransport(
        allow_local_http=False,
        resolver=lambda host, port, **kwargs: [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (PUBLIC_IP, port))
        ],
        connector=connector,
        tls_wrapper=lambda connection, host: client_context.wrap_socket(
            connection, server_hostname=host
        ),
    )
    monkeypatch.setattr(
        geo_profile_tests,
        "OpenAICompatibleClient",
        lambda **kwargs: OpenAICompatibleClient(allow_local_http=False, transport=transport),
    )
    server.test_transport = transport
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()


def api_profile(
    api: SurfaceAPI, monkeypatch: pytest.MonkeyPatch, *, model_parameters: dict | None = None
) -> tuple[dict, AIChannel, AIModel, str]:
    monkeypatch.setattr(settings, "geo_api_collection_enabled", True)
    monkeypatch.setattr(settings, "ai_credential_encryption_key", "A" * 43 + "=")
    call_id = str(uuid4())
    with api.factory() as db:
        channel_id = uuid4()
        channel = AIChannel(
            id=channel_id,
            name="虚构诊断渠道",
            description="本地 TLS 替身",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url=f"https://{HOST}/v1",
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
