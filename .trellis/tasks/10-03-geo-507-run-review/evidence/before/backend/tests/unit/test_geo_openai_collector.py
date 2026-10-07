"""GEO-404 真实实现接入 GEO-402 的独立合同套件。"""

from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

import pytest
from pydantic import TypeAdapter

from app.collectors.base import GeoCollector
from app.collectors.contracts import CollectedAnswer
from app.collectors.errors import CollectorError
from app.collectors.openai_compatible import OpenAICompatibleGeoCollector
from app.collectors.registry import CollectionProfileSnapshot
from app.geo_fake_server import FakeMode, FakeScenario, running_geo_fake
from app.schemas.geo_runs import GeoExternalCallState as State
from app.schemas.geo_runs import GeoRunDataClassification
from app.schemas.geo_runs import GeoRunErrorCode as Code
from app.schemas.geo_surfaces import GeoProfileTestStatus
from tests.geo_collector_contract import (
    FAILURE_CASES,
    assert_authorization_rejection,
    assert_collection_case,
    assert_secrets_absent,
)
from tests.geo_network_guard import local_geo_network as local_geo_network
from tests.geo_openai_support import configuration, make_collector, make_request


@pytest.mark.parametrize("mode", [FakeMode.SUCCESS, FakeMode.CITATIONS])
@pytest.mark.parametrize("search", [True, False, None])
def test_real_collector_contract_original_text_metadata_and_secrets(mode, search, capsys, caplog):
    request = make_request()
    with running_geo_fake() as provider:
        collector, secrets = make_collector(provider, request)
        assert isinstance(collector, GeoCollector)
        result = assert_collection_case(
            collector,
            request,
            provider,
            FakeScenario(
                mode=mode,
                answer_text="  完整回答，保留空白和格式。\r\n",
                web_search_observed=search,
                partial_usage=True,
                reported_cost=True,
                echo_sensitive=True,
            ),
            secrets=secrets,
        )
        assert isinstance(result, CollectedAnswer)
        assert result.cost.amount == Decimal("0.001200")
        assert result.raw_payload_bytes is None and result.screenshot_bytes is None
        assert_secrets_absent(
            [TypeAdapter(CollectedAnswer).dump_json(result), caplog.text, *capsys.readouterr()],
            secrets,
        )


@pytest.mark.parametrize("case", FAILURE_CASES, ids=lambda case: case.mode.value)
def test_real_collector_failure_matrix_one_send_and_no_redirect(case, capsys, caplog):
    request = make_request()
    with running_geo_fake() as provider:
        collector, secrets = make_collector(provider, request)
        assert_collection_case(
            collector,
            request,
            provider,
            FakeScenario(mode=case.mode, response_bytes=8193, echo_sensitive=True),
            secrets=secrets,
        )
        assert_secrets_absent([caplog.text, *capsys.readouterr()], secrets)


def test_unknown_cost_search_and_usage_stay_null_and_authorization_failure_blocks_send():
    request = make_request()
    with running_geo_fake() as provider:
        collector, _ = make_collector(provider, request)
        assert collector.estimate(request).cost is None
        assert_authorization_rejection(collector, request, provider)
        result = assert_collection_case(collector, request, provider, FakeScenario())
        assert isinstance(result, CollectedAnswer)
        assert result.cost is result.usage is result.web_search_observed is None


@pytest.mark.parametrize(
    "field", ["adapter_key", "adapter_version", "ai_channel_id", "ai_model_id"]
)
def test_frozen_adapter_and_model_binding_cannot_be_substituted(field):
    request = make_request()
    with running_geo_fake() as provider:
        collector, _ = make_collector(provider, request)
        value = uuid4() if field.startswith("ai_") else "other"
        request = replace(request, profile=replace(request.profile, **{field: value}))
        with pytest.raises(CollectorError) as caught:
            collector.collect(request, before_send=lambda: pytest.fail("不能授权"))
        assert caught.value.failure.code == Code.COLLECTOR_CONFIGURATION_INVALID
        assert caught.value.failure.external_call_state == State.NOT_STARTED
        assert provider.state.snapshot(request.run_id)["count"] == 0


@pytest.mark.parametrize(
    "classification", [GeoRunDataClassification.INTERNAL, GeoRunDataClassification.RESTRICTED]
)
def test_nonpublic_input_has_no_external_authorization(classification):
    request = replace(make_request(), data_classification=classification)
    with running_geo_fake() as provider:
        collector, _ = make_collector(provider, request)
        with pytest.raises(CollectorError) as caught:
            collector.collect(request, before_send=lambda: pytest.fail("不能授权"))
        assert caught.value.failure.code == Code.DATA_CLASSIFICATION_FORBIDDEN
        assert provider.state.snapshot(request.run_id)["count"] == 0


@pytest.mark.parametrize(
    "params",
    [
        {"messages": []},
        {"system": "品牌结论"},
        {"tools": []},
        {"response_format": {"type": "json_object"}},
        {"extra_body": {}},
        {"stream": True},
        {"model": "substitute"},
        {"n": 2},
        {"temperature": True},
        {"temperature": float("nan")},
        {"temperature": 10**1000},
        {"max_tokens": 0},
        {"max_tokens": 1, "max_completion_tokens": 2},
    ],
)
def test_instruction_parameters_and_invalid_numeric_settings_fail_closed(params):
    with pytest.raises(CollectorError) as caught:
        OpenAICompatibleGeoCollector(**configuration(make_request(), request_parameters=params))
    assert caught.value.failure.code == Code.COLLECTOR_CONFIGURATION_INVALID
    assert caught.value.failure.external_call_state == State.NOT_STARTED


@pytest.mark.parametrize(
    "change",
    [
        {"headers": {"Host": "private"}},
        {"headers": {"Authorization": "override"}},
        {"headers": {"x-secret": "line\r\nInjected: yes"}},
        {"headers": {"X-Key": "one", "x-key": "two"}},
        {"api_key": "line\nkey"},
        {"protocol_type": "browser"},
        {"allow_local_http": True, "environment": "production"},
    ],
)
def test_sensitive_headers_protocol_and_production_http_are_rejected(change):
    with pytest.raises(CollectorError):
        OpenAICompatibleGeoCollector(**configuration(make_request(), **change))


def test_profile_validation_and_estimate_are_pure_and_do_not_grant_execution():
    request = make_request()
    profile = request.profile
    collector = OpenAICompatibleGeoCollector(**configuration(request))
    snapshot = CollectionProfileSnapshot(
        **{
            key: getattr(profile, key)
            for key in CollectionProfileSnapshot.__dataclass_fields__
            if hasattr(profile, key)
        },
        is_active=False,
        last_test_status=GeoProfileTestStatus.UNTESTED,
        last_tested_at=None,
    )
    assert collector.validate_profile(snapshot) == ()
    assert collector.validate_profile(replace(snapshot, ai_model_id=uuid4()))
    assert collector.estimate(request).cost is None
    assert collector.registration.approved is False
