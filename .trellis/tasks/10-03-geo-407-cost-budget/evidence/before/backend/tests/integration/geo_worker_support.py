"""GEO-405 虚构 PUBLIC 输入与已批准测试配置；不改变生产默认门禁。"""

from dataclasses import dataclass, replace
from datetime import UTC, datetime
from types import MappingProxyType
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.collectors.registry import collector_registry
from app.config import settings
from app.geo_fake_server import GeoFakeServer
from app.models.ai_generation import AIChannel, AIChannelHeader, AIModel
from app.models.geo_runs import GeoObservationRun
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from app.services import geo_batch_snapshots, geo_dispatch, geo_runs
from app.services.credentials import CredentialCipher
from tests.integration.geo_plans_support import PlansAPI


@dataclass
class WorkerGraph:
    api: PlansAPI
    profile: UUID
    channel: UUID
    call_id: UUID

    def create(self, *, budget: str | None = None, repeat_count: int = 1) -> UUID:
        value = self.api.payload(
            collection_profile_ids=[str(self.profile)],
            budget_limit=budget,
            repeat_count=repeat_count,
        )
        response = self.api.api.engineer.post(
            "/api/v1/geo/observation-batches",
            json={"source": "AD_HOC", "configuration": value},
            headers={"Idempotency-Key": f"geo405-{uuid4()}"},
        )
        assert response.status_code == 201, response.text
        with self.api.api.factory() as db:
            return db.scalar(
                select(GeoObservationRun.id).where(
                    GeoObservationRun.batch_id == UUID(response.json()["batch_id"])
                )
            )


@pytest.fixture
def worker_graph(
    plans_api: PlansAPI, monkeypatch: pytest.MonkeyPatch, local_provider: GeoFakeServer
):
    from app.worker import collect_geo_run

    monkeypatch.setattr(settings, "geo_api_collection_enabled", True)
    monkeypatch.setattr(settings, "ai_allow_local_http", True)
    monkeypatch.setattr(settings, "ai_credential_encryption_key", "A" * 43 + "=")
    monkeypatch.setattr(geo_runs, "SessionLocal", plans_api.api.factory)
    monkeypatch.setattr(geo_dispatch, "SessionLocal", plans_api.api.factory)
    registration = replace(collector_registry.resolve("openai-compatible-chat"), approved=True)
    monkeypatch.setattr(
        collector_registry,
        "_entries",
        MappingProxyType(
            {
                "manual": collector_registry.resolve("manual"),
                registration.key: registration,
            }
        ),
    )
    original = geo_batch_snapshots.BatchInputs.input_for

    def public_input(self, prompt_id, profile_id):
        value = original(self, prompt_id, profile_id)
        value["data_classification"] = "PUBLIC"  # 仅虚构测试资料。
        return value

    monkeypatch.setattr(geo_batch_snapshots.BatchInputs, "input_for", public_input)

    def unavailable(_run_id):
        raise ConnectionError("虚构 Broker 离线")

    monkeypatch.setattr(collect_geo_run, "delay", unavailable)
    call_id, channel_id = uuid4(), uuid4()
    with plans_api.api.factory() as db:
        channel = AIChannel(
            id=channel_id,
            name=f"虚构渠道-{channel_id}",
            description="本地模拟站",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url=local_provider.base_url + "/v1",
            api_key_updated_at=datetime.now(UTC),
            api_key_ciphertext=CredentialCipher(settings.ai_credential_encryption_key).encrypt(
                "geo405-fake-secret", associated_data=f"ai_channel:{channel_id}:api_key"
            ),
            timeout_seconds=10,
            is_enabled=True,
            revision=0,
            created_by=plans_api.api.admin_id,
        )
        db.add(channel)
        db.flush()
        model = AIModel(
            channel_id=channel.id,
            display_name="虚构模型",
            model_id="fake-model",
            request_parameters={},
            is_enabled=True,
            test_status="PASSED",
            last_tested_at=datetime.now(UTC),
            revision=0,
            created_by=plans_api.api.admin_id,
        )
        surface = GeoEngineSurface(
            name="虚构 API",
            slug=f"geo405-{uuid4()}",
            surface_kind="MODEL_API",
            provider_brand="CUSTOM",
            compliance_status="APPROVED",
            is_active=True,
            created_by=plans_api.api.admin_id,
            capabilities={
                "answer_text": True,
                "citations": False,
                "web_search_signal": False,
                "model_version": False,
                "usage": False,
                "cost": False,
            },
        )
        db.add_all(
            [
                model,
                surface,
                AIChannelHeader(
                    channel_id=channel.id,
                    name="X-GEO-Attempt-ID",
                    normalized_name="x-geo-attempt-id",
                    is_sensitive=False,
                    plain_value=str(call_id),
                ),
            ]
        )
        db.flush()
        profile = GeoCollectionProfile(
            engine_surface_id=surface.id,
            name="虚构已批准测试配置",
            collection_mode="API",
            adapter_key="openai-compatible-chat",
            ai_channel_id=channel.id,
            ai_model_id=model.id,
            language_code="zh-hans",
            region_code="CN",
            login_state="NOT_APPLICABLE",
            web_search_policy="UNKNOWN",
            settings_json={},
            is_active=True,
            last_test_status="PASSED",
            last_tested_at=datetime.now(UTC),
            created_by=plans_api.api.admin_id,
        )
        db.add(profile)
        db.commit()
    yield WorkerGraph(plans_api, profile.id, channel_id, call_id)
    from app.services.geo_run_lifecycle import fail_run, lock_run, refresh_batch

    with plans_api.api.factory.begin() as db:
        identities = list(
            db.scalars(
                select(GeoObservationRun.id).where(
                    GeoObservationRun.collection_profile_id == profile.id,
                    GeoObservationRun.status.in_(["PENDING", "RUNNING"]),
                )
            )
        )
        for identity in identities:
            batch, run = lock_run(db, identity)
            now = datetime.now(UTC)
            fail_run(db, run, now=now, code="WORKER_LOST", summary="虚构测试数据结束")
            refresh_batch(db, batch, now)
