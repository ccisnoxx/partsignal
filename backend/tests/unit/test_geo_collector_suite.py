"""合同套件自测：正常测试驱动通过，真实重试/重定向/泄漏反例必须被拒绝。"""

from dataclasses import replace
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
from pydantic import TypeAdapter

from app.collectors.base import GeoCollector
from app.collectors.contracts import CollectedAnswer, CollectionRequest
from app.collectors.errors import CollectorError
from app.geo_fake_server import FakeMode, FakeScenario, running_geo_fake
from app.schemas.geo_runs import GeoExternalCallState, GeoRunInputSnapshot
from tests.geo_collector_contract import (
    FAILURE_CASES,
    CollectorContractViolation,
    assert_authorization_rejection,
    assert_collection_case,
    assert_secrets_absent,
    secret_variants,
    test_secret,
)
from tests.geo_fixtures import load_geo_fixtures
from tests.geo_network_guard import local_geo_network as local_geo_network
from tests.geo_reference_collector import ReferenceCollector
from tests.unit.test_geo_run_contract import input_snapshot


def make_request():
    bundle = load_geo_fixtures()["corpus"]
    value = input_snapshot("API")
    value["prompt"]["prompt_text"] = bundle["questions"][0]["text"]
    return CollectionRequest.from_snapshot(
        uuid4(),
        GeoRunInputSnapshot.model_validate(value),
        timeout_seconds=1,
        max_response_bytes=4096,
        budget_remaining=None,
    )


def make_collector(provider, request, cls=ReferenceCollector):
    secrets = tuple(test_secret(kind) for kind in ("api", "header", "cookie"))
    return cls(
        provider,
        key=request.profile.adapter_key,
        version=request.profile.adapter_version,
        secrets=secrets,
    )


@pytest.mark.parametrize("mode", [FakeMode.SUCCESS, FakeMode.CITATIONS])
@pytest.mark.parametrize("search", [True, False, None])
def test_common_suite_success_unknown_partial_and_original_text(
    mode, search, capsys, caplog, tmp_path
):
    request = make_request()
    original = load_geo_fixtures()["corpus"]["answers"][0]["text"]
    scenario = FakeScenario(
        mode=mode,
        answer_text=f"  {original}\r\n",
        web_search_observed=search,
        partial_usage=True,
        reported_cost=True,
        echo_sensitive=True,
    )
    with running_geo_fake() as provider:
        collector = make_collector(provider, request)
        assert isinstance(collector, GeoCollector)
        result = assert_collection_case(
            collector, request, provider, scenario, secrets=collector.secrets
        )
        assert isinstance(result, CollectedAnswer)
        assert result.cost.amount == Decimal("0.001200")
        artifact = tmp_path / "safe-result.json"
        artifact.write_bytes(TypeAdapter(CollectedAnswer).dump_json(result))
        assert_secrets_absent(
            [artifact.read_bytes(), caplog.text, *capsys.readouterr()], collector.secrets
        )


def test_unknown_usage_cost_not_zero():
    request = make_request()
    with running_geo_fake() as provider:
        collector = make_collector(provider, request)
        result = assert_collection_case(collector, request, provider, FakeScenario())
        assert isinstance(result, CollectedAnswer)
        assert result.usage is None and result.cost is None
        assert collector.estimate(request).cost is None
        assert provider.state.snapshot(request.run_id)["count"] == 1


@pytest.mark.parametrize("case", FAILURE_CASES, ids=lambda c: c.mode.value)
def test_common_suite_failure_matrix_and_safe_errors(case, capsys, caplog):
    request = make_request()
    with running_geo_fake() as provider:
        collector = make_collector(provider, request)
        assert_collection_case(
            collector,
            request,
            provider,
            FakeScenario(mode=case.mode, response_bytes=8193, echo_sensitive=True),
            secrets=collector.secrets,
        )
        assert_secrets_absent([caplog.text, *capsys.readouterr()], collector.secrets)


def test_send_authorization_rejection_and_explicit_new_attempt():
    request = make_request()
    with running_geo_fake() as provider:
        collector = make_collector(provider, request)
        assert_authorization_rejection(collector, request, provider)
        assert_collection_case(collector, request, provider, FakeScenario(mode=FakeMode.RATE_LIMIT))
        successor = replace(request, run_id=uuid4())
        assert_collection_case(collector, successor, provider, FakeScenario())
        assert provider.state.snapshot(request.run_id)["count"] == 1
        assert provider.state.snapshot(successor.run_id)["count"] == 1


@pytest.mark.parametrize("patch", ["mode", "key", "version"])
def test_mismatched_registration_is_rejected_before_send(patch):
    request = make_request()
    with running_geo_fake() as provider:
        collector = make_collector(provider, request)
        if patch == "mode":
            snapshot = GeoRunInputSnapshot.model_validate(input_snapshot("MANUAL"))
            request = CollectionRequest.from_snapshot(
                request.run_id,
                snapshot,
                timeout_seconds=1,
                max_response_bytes=4096,
                budget_remaining=None,
            )
        else:
            name = "adapter_key" if patch == "key" else "adapter_version"
            request = replace(request, profile=replace(request.profile, **{name: "other"}))
        with pytest.raises(CollectorError) as caught:
            collector.collect(request, before_send=lambda: pytest.fail("不应授权发送"))
        assert caught.value.failure.external_call_state == GeoExternalCallState.NOT_STARTED
        assert provider.state.snapshot(request.run_id)["count"] == 0


class RetryingCollector(ReferenceCollector):
    def collect(self, request, *, before_send):
        try:
            return super().collect(request, before_send=before_send)
        except CollectorError:
            return super().collect(request, before_send=lambda: None)


class RedirectingCollector(ReferenceCollector):
    def collect(self, request, *, before_send):
        try:
            return super().collect(request, before_send=before_send)
        except CollectorError:
            with httpx.Client(trust_env=False) as client:
                client.get(self.provider.base_url + "/__geo__/redirect-target")
            raise


class LeakingCollector(ReferenceCollector):
    def collect(self, request, *, before_send):
        try:
            return super().collect(request, before_send=before_send)
        except CollectorError as error:
            error.args = (self.secrets[0],)
            raise


@pytest.mark.parametrize(
    "cls,mode,rule",
    [
        (RetryingCollector, FakeMode.RATE_LIMIT, "每 attempt 必须只有一次请求"),
        (RedirectingCollector, FakeMode.REDIRECT, "禁止跟随重定向"),
        (LeakingCollector, FakeMode.RATE_LIMIT, "敏感值外泄"),
    ],
)
def test_suite_rejects_nonconforming_collectors_without_exposing_values(cls, mode, rule):
    request = make_request()
    with running_geo_fake() as provider:
        collector = make_collector(provider, request, cls)
        with pytest.raises(CollectorContractViolation) as violation:
            assert_collection_case(
                collector, request, provider, FakeScenario(mode=mode), secrets=collector.secrets
            )
        assert rule in str(violation.value)
        assert_secrets_absent([str(violation.value)], collector.secrets)


@pytest.mark.parametrize("variant", range(4))
def test_secret_scan_rejects_plain_encoded_and_artifact_leaks(variant, tmp_path):
    secret = test_secret("api") + "/中文"
    value = sorted(secret_variants(secret))[variant]
    artifact = tmp_path / "controlled-leak.txt"
    artifact.write_bytes(value)
    try:
        with pytest.raises(CollectorContractViolation) as violation:
            assert_secrets_absent([artifact.read_bytes()], [secret])
        assert str(violation.value) == "Collector 合同不符合：敏感值外泄"
    finally:
        artifact.unlink()


def test_pure_profile_validation_and_estimate_cannot_call_provider():
    from app.collectors.registry import CollectionProfileSnapshot
    from app.schemas.geo_surfaces import GeoProfileTestStatus

    request = make_request()
    with running_geo_fake() as provider:
        collector = make_collector(provider, request)
        profile = request.profile
        snapshot = CollectionProfileSnapshot(
            **{
                field: getattr(profile, field)
                for field in CollectionProfileSnapshot.__dataclass_fields__
                if hasattr(profile, field)
            },
            is_active=False,
            last_test_status=GeoProfileTestStatus.UNTESTED,
            last_tested_at=None,
        )
        assert collector.validate_profile(snapshot) == ()
        assert collector.validate_profile(replace(snapshot, adapter_key="other"))
        assert collector.estimate(request).cost is None
        assert provider.state.snapshot(request.run_id)["count"] == 0


def test_runner_fails_closed_before_output_on_artifact_secret(monkeypatch, tmp_path, capsys):
    import importlib.util
    import sys
    from pathlib import Path

    path = Path(__file__).resolve().parents[3] / "deploy/scripts/test-geo-collector-contract.py"
    spec = importlib.util.spec_from_file_location("geo_contract_runner", path)
    assert spec is not None and spec.loader is not None
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    secret = test_secret("api")
    artifact = tmp_path / "leak.txt"
    artifact.write_text(secret)
    monkeypatch.setattr(sys, "argv", [str(path), "--scan-root", str(tmp_path)])
    monkeypatch.setattr(runner.pytest, "main", lambda _: 0)
    try:
        assert runner.main() == 1
        output = capsys.readouterr()
        assert "secret scan 未通过" in output.err
        assert_secrets_absent(output, [secret])
    finally:
        artifact.unlink()
