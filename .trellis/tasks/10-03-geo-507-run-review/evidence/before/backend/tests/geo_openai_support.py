"""真实 GEO API adapter 的本地测试装配，不读取生产凭据或业务数据库。"""

from dataclasses import replace
from uuid import uuid4

from app.collectors.openai_compatible import OpenAICompatibleGeoCollector
from app.schemas.geo_surfaces import GeoSurfaceKind
from tests.geo_collector_contract import test_secret
from tests.unit.test_geo_collector_suite import make_request as fixture_request


def make_request():
    request = fixture_request()
    return replace(
        request,
        profile=replace(
            request.profile,
            adapter_key="openai-compatible-chat",
            adapter_version="1",
            ai_channel_id=uuid4(),
            ai_model_id=uuid4(),
        ),
        engine_surface=replace(request.engine_surface, surface_kind=GeoSurfaceKind.MODEL_API),
    )


def configuration(request, **changes):
    config = {
        "channel_id": request.profile.ai_channel_id,
        "model_id": request.profile.ai_model_id,
        "protocol_type": "openai-compatible-chat-completions",
        "base_url": "https://provider.test/v1",
        "provider_model": "geo-fixture-model",
        "api_key": "test-credential",
    }
    return {**config, **changes}


def make_collector(provider, request, **changes):
    secrets = tuple(test_secret(kind) for kind in ("api", "header", "cookie"))
    collector = OpenAICompatibleGeoCollector(
        **configuration(
            request,
            base_url=provider.base_url + "/v1",
            api_key=secrets[0],
            headers={
                "X-GEO-Attempt-ID": str(request.run_id),
            },
            sensitive_headers={
                "X-Custom-Secret": secrets[1],
                "Cookie": secrets[2],
            },
            allow_local_http=True,
            environment="test",
            **changes,
        )
    )
    return collector, secrets
