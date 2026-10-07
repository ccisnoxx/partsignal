"""关闭开关验收的独立前置图；配置为虚构 fixture，Run 仍由应用服务创建并排队。"""

from __future__ import annotations

import json
import os
from base64 import b64decode
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from tests.geo_e2e_runtime import assemble


def seed_closed_run() -> dict[str, object]:
    assemble()
    from sqlalchemy import select

    import app.models  # noqa: F401
    from app.config import settings
    from app.db import SessionLocal
    from app.models.ai_generation import AIChannel, AIModel
    from app.models.configuration import QueryTopic
    from app.models.geo_catalog import GeoSubject
    from app.models.geo_prompt_variants import GeoPromptVariant
    from app.models.geo_runs import GeoObservationRun
    from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
    from app.models.identity import User
    from app.schemas.common import RevisionRequest
    from app.schemas.geo_batch_creation import GeoAdHocBatchCreate
    from app.services import ai_configuration, geo_batches, geo_profile_tests, geo_surface_commands
    from app.services.credentials import CredentialCipher
    from tests.geo_e2e_environment import PROVIDER_API_URL

    identity = uuid4()
    prompt_text = f"GEO408 SUCCESS {identity}"
    with SessionLocal() as db:
        # 单独 fixture actor，不修改 UI 登录账号或它的首次改密事实。
        actor = User(
            username=f"geo408-fixture-{identity.hex}",
            display_name="GEO408 虚构前置管理员",
            password_hash="unused-fixture-account",
            account_type="ADMIN",
            is_active=True,
            must_change_password=False,
            revision=0,
        )
        db.add(actor)
        db.flush()
        channel_id = uuid4()
        channel = AIChannel(
            id=channel_id,
            name="GEO408 虚构前置渠道",
            description="独占测试库回环 fixture",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url=PROVIDER_API_URL,
            timeout_seconds=10,
            is_enabled=False,
            revision=0,
            api_key_ciphertext=CredentialCipher(settings.ai_credential_encryption_key).encrypt(
                "geo408-fictional-fixture-credential",
                associated_data=f"ai_channel:{channel_id}:api_key",
            ),
            api_key_updated_at=datetime.now(UTC),
            created_by=actor.id,
        )
        db.add(channel)
        db.flush()
        model = AIModel(
            channel_id=channel.id,
            display_name="GEO408 虚构前置模型",
            model_id="geo-fixture-model",
            request_parameters={},
            is_enabled=False,
            test_status="UNTESTED",
            revision=0,
            created_by=actor.id,
        )
        topic = QueryTopic(canonical_question=prompt_text, intent_type="REPLACEMENT", variants=[])
        subject = GeoSubject(
            subject_type="OWN_BRAND",
            canonical_name=f"GEO408 {identity}",
            normalized_name=f"geo408 {identity}",
            display_name="GEO408 虚构品牌",
            is_active=True,
            created_by=actor.id,
        )
        surface = GeoEngineSurface(
            name="GEO408 虚构前置观测面",
            slug=f"geo408-{identity.hex}",
            surface_kind="MODEL_API",
            provider_brand="CUSTOM",
            compliance_status="APPROVED",
            is_active=True,
            capabilities={
                "answer_text": True,
                "citations": True,
                "web_search_signal": False,
                "model_version": True,
                "usage": True,
                "cost": True,
            },
            created_by=actor.id,
        )
        db.add_all([model, topic, subject, surface])
        db.flush()
        prompt = GeoPromptVariant(
            query_topic_id=topic.id,
            prompt_text=prompt_text,
            mention_mode="UNBRANDED",
            language_code="zh-hans",
            region_code="CN",
            priority="CORE",
            created_by=actor.id,
        )
        profile = GeoCollectionProfile(
            engine_surface_id=surface.id,
            name="GEO408 虚构前置配置",
            collection_mode="API",
            adapter_key="openai-compatible-chat",
            ai_channel_id=channel.id,
            ai_model_id=model.id,
            language_code="zh-hans",
            region_code="CN",
            login_state="NOT_APPLICABLE",
            web_search_policy="UNKNOWN",
            settings_json={},
            is_active=False,
            revision=0,
            created_by=actor.id,
        )
        db.add_all([prompt, profile])
        db.commit()
        common = {"db": db, "actor": actor, "request_id": f"geo408-fixture-{identity}"}
        ai_configuration.test_ai_model(
            **common, model_id=model.id, payload=RevisionRequest(expected_revision=model.revision)
        )
        if model.test_status != "PASSED":
            raise RuntimeError("GEO408 前置模型真实诊断未通过")
        ai_configuration.set_model_enabled(
            **common,
            model_id=model.id,
            payload=RevisionRequest(expected_revision=model.revision),
            enabled=True,
        )
        ai_configuration.set_channel_enabled(
            **common,
            channel_id=channel.id,
            payload=RevisionRequest(expected_revision=channel.revision),
            enabled=True,
        )
        tested = geo_profile_tests.test_profile(
            **common, profile_id=profile.id, expected_revision=profile.revision
        )
        if tested.summary.last_test_status != "PASSED":
            raise RuntimeError("GEO408 前置 Profile 真实诊断未通过")
        geo_surface_commands.set_profile_active(
            **common,
            profile_id=profile.id,
            expected_revision=tested.summary.revision,
            is_active=True,
        )
        configuration = {
            "name": "GEO408 关闭开关前置批次",
            "description": "虚构数据，不代表生产外发授权",
            "subjects": [{"subject_id": str(subject.id), "role": "PRIMARY"}],
            "prompt_variant_ids": [str(prompt.id)],
            "collection_profile_ids": [str(profile.id)],
            "repeat_count": 1,
        }
        receipt = geo_batches.create_manual_batch(
            **common,
            payload=GeoAdHocBatchCreate(source="AD_HOC", configuration=configuration),
            idempotency_key=f"geo408-closed-{identity}",
        )
        run = db.scalar(
            select(GeoObservationRun).where(GeoObservationRun.batch_id == receipt.batch_id)
        )
        if run is None or run.status != "PENDING" or run.dispatch_attempt_count != 1:
            raise RuntimeError("GEO408 关闭开关前置 Run 未真实创建并投递")
        # dispatch 已持久化元数据，Redis 还必须实际含该稳定 Run UUID 消息。
        from redis import Redis

        with Redis.from_url(settings.redis_url) as broker:
            messages = [json.loads(message) for message in broker.lrange("celery", 0, -1)]
        if not any(
            message.get("headers", {}).get("task") == "partsignal.collect_geo_run"
            and json.loads(b64decode(message["body"]))[0] == [str(run.id)]
            for message in messages
        ):
            raise RuntimeError("GEO408 关闭开关前置队列缺少真实稳定 Run UUID 消息")
        return {
            "run_id": str(run.id),
            "batch_id": str(receipt.batch_id),
            "profile_id": str(profile.id),
            "configuration": configuration,
        }


def main() -> None:
    destination = Path(os.environ["PARTSIGNAL_E2E_GEO_FIXTURE_FILE"])
    if not destination.parent.is_dir():
        raise ValueError("GEO408 fixture 文件必须位于本轮已创建的临时目录")
    payload = seed_closed_run()
    with destination.open("x", encoding="utf-8") as output:
        json.dump(payload, output, ensure_ascii=False)
        output.write("\n")


if __name__ == "__main__":
    main()
