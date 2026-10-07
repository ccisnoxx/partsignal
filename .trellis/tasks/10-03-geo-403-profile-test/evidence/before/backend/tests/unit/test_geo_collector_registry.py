"""GEO-204 纯配置合同，不提供或调用任何采集实现。"""

from dataclasses import FrozenInstanceError, replace
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.collectors.registry import (
    CollectionProfileSnapshot,
    CollectorRegistration,
    CollectorRegistry,
    EngineSurfaceSnapshot,
    ModelQualification,
    UnknownCollectorAdapter,
    collector_registry,
    surface_capabilities,
)
from app.collectors.registry import (
    CollectorCapability as Capability,
)
from app.collectors.registry import (
    ProfileBlockerCode as Code,
)
from app.schemas.geo_surfaces import (
    GeoCollectionMode as Mode,
)
from app.schemas.geo_surfaces import (
    GeoComplianceStatus as Compliance,
)
from app.schemas.geo_surfaces import (
    GeoProfileLoginState as Login,
)
from app.schemas.geo_surfaces import (
    GeoProfileTestStatus as ProfileTestState,
)
from app.schemas.geo_surfaces import (
    GeoSurfaceKind as Kind,
)
from app.schemas.geo_surfaces import (
    GeoWebSearchPolicy as Search,
)
from app.services.geo_collector_eligibility import (
    GeoRuntimeSwitches,
    ProfileIneligible,
    evaluate_profile,
)

NOW = datetime(2026, 10, 2, tzinfo=UTC)
SWITCHES = GeoRuntimeSwitches("test", True, True, True)


def surface(**patch: Any) -> EngineSurfaceSnapshot:
    return EngineSurfaceSnapshot(
        **{
            "id": uuid4(),
            "revision": 3,
            "surface_kind": Kind.MODEL_API,
            "compliance_status": Compliance.APPROVED,
            "capabilities": frozenset(Capability),
            "is_active": True,
            **patch,
        }
    )


def profile(
    s: EngineSurfaceSnapshot, mode: Mode = Mode.MANUAL, **patch: Any
) -> CollectionProfileSnapshot:
    return CollectionProfileSnapshot(
        **{
            "id": uuid4(),
            "engine_surface_id": s.id,
            "revision": 7,
            "name": "虚构配置",
            "collection_mode": mode,
            "adapter_key": "manual" if mode == Mode.MANUAL else "test-api",
            "ai_channel_id": None,
            "ai_model_id": None,
            "language_code": "zh-hans",
            "region_code": "CN",
            "login_state": Login.NOT_APPLICABLE if mode == Mode.API else Login.ANONYMOUS,
            "web_search_policy": Search.UNKNOWN,
            "settings": (),
            "is_active": True,
            "last_test_status": ProfileTestState.PASSED,
            "last_tested_at": NOW,
            **patch,
        }
    )


def registration(mode: Mode = Mode.API, **patch: Any) -> CollectorRegistration:
    """无 I/O 的测试元数据，明确不登记到生产 Registry。"""
    return CollectorRegistration(
        **{
            "key": "test-api",
            "version": "test-v1",
            "collection_mode": mode,
            "capabilities": frozenset(Capability),
            "surface_kinds": frozenset(Kind),
            "login_states": frozenset(Login),
            "web_search_policies": frozenset(Search),
            "environments": frozenset({"test"}),
            "approved": True,
            **patch,
        }
    )


def model(p: CollectionProfileSnapshot, **patch: Any) -> ModelQualification:
    assert p.ai_model_id is not None and p.ai_channel_id is not None
    return ModelQualification(
        **{
            "id": p.ai_model_id,
            "channel_id": p.ai_channel_id,
            "is_enabled": True,
            "channel_is_enabled": True,
            "test_status": "PASSED",
            "credential_configured": True,
            "protocol_type": "openai-compatible-chat-completions",
            **patch,
        }
    )


def codes(result: Any) -> set[Code]:
    return {item.code for item in result.blockers}


def test_only_manual_is_registered_and_keys_are_exact() -> None:
    assert collector_registry.resolve("manual").collection_mode == Mode.MANUAL
    for key in ("unknown", "Manual", "manual ", "openai-compatible-chat", "browser-chatgpt"):
        with pytest.raises(UnknownCollectorAdapter):
            collector_registry.resolve(key)
        with pytest.raises(UnknownCollectorAdapter):
            collector_registry.capabilities(key)


def test_unknown_registry_validation_and_guard_never_fall_back() -> None:
    s = surface()
    p = profile(s, Mode.API, adapter_key="not-registered-secret-marker")
    with pytest.raises(UnknownCollectorAdapter) as captured:
        collector_registry.validate_profile(p)
    assert "secret-marker" not in str(captured.value)
    result = evaluate_profile(p, s, switches=SWITCHES)
    assert codes(result) == {Code.ADAPTER_UNKNOWN}
    assert result.adapter_version is None and result.capabilities == frozenset()
    with pytest.raises(ProfileIneligible) as rejected:
        result.require_eligible()
    assert rejected.value.eligibility is result
    assert "secret-marker" not in str(rejected.value)


def test_duplicate_registration_is_rejected_and_metadata_is_immutable() -> None:
    a = registration()
    with pytest.raises(ValueError, match="重复注册"):
        CollectorRegistry([a, a])
    values = {Capability.ANSWER_TEXT}
    copied = registration(capabilities=values)
    values.add(Capability.COST)
    assert copied.capabilities == frozenset({Capability.ANSWER_TEXT})
    with pytest.raises(FrozenInstanceError):
        copied.approved = False  # type: ignore[misc]
    entries = [a]
    registry = CollectorRegistry(entries)
    entries.clear()
    assert registry.resolve(a.key) is a


@pytest.mark.parametrize(
    "patch",
    [
        {"key": "Bad-Key"},
        {"version": " "},
        {"capabilities": frozenset()},
        {"capabilities": {Capability.ANSWER_TEXT, "invented"}},
        {"collection_mode": Mode.BROWSER, "model_protocol": "test-protocol"},
    ],
)
def test_invalid_registration_fails_explicitly(patch: dict[str, Any]) -> None:
    with pytest.raises(ValueError):
        registration(**patch)


@pytest.mark.parametrize(
    "change",
    [
        {"citations": 1},
        {"answer_text": False},
        {"extra": False},
        {"cost": None},
    ],
)
def test_capabilities_use_closed_surface_contract(change: dict[str, Any]) -> None:
    value = {item.value: True for item in Capability}
    with pytest.raises(ValidationError):
        surface_capabilities({**value, **change})


def test_manual_works_without_auto_switches_compliance_or_connection_test() -> None:
    s = surface(compliance_status=Compliance.REJECTED)
    p = profile(s, last_test_status=ProfileTestState.UNTESTED, last_tested_at=None)
    preview = evaluate_profile(p, s, switches=GeoRuntimeSwitches("production", True, False, False))
    assert preview.eligible
    preview.require_eligible()
    assert preview.profile_revision == 7 and preview.surface_revision == 3
    assert preview.adapter_version == "1"
    assert preview.capabilities == frozenset(
        {
            Capability.ANSWER_TEXT,
            Capability.CITATIONS,
            Capability.WEB_SEARCH_SIGNAL,
            Capability.MODEL_VERSION,
        }
    )


@pytest.mark.parametrize(
    "patch,code",
    [
        ({"is_active": False}, Code.PROFILE_DISABLED),
        ({"engine_surface_id": uuid4()}, Code.CONFIGURATION_INVALID),
    ],
)
def test_profile_current_facts_gate_manual(patch: dict[str, Any], code: Code) -> None:
    s = surface()
    result = evaluate_profile(profile(s, **patch), s, switches=SWITCHES)
    assert code in codes(result)


def test_parent_switch_and_disabled_surface_gate_new_manual_qualification() -> None:
    s = surface(is_active=False)
    result = evaluate_profile(
        profile(s), s, switches=GeoRuntimeSwitches("test", False, False, False)
    )
    assert codes(result) == {Code.MONITORING_DISABLED, Code.SURFACE_DISABLED}


@pytest.mark.parametrize(
    "mode,code",
    [
        (Mode.API, Code.API_COLLECTION_DISABLED),
        (Mode.BROWSER, Code.BROWSER_COLLECTION_DISABLED),
    ],
)
def test_automatic_mode_checks_own_switch_and_parent(mode: Mode, code: Code) -> None:
    s = surface()
    registry = CollectorRegistry([registration(mode)])
    result = evaluate_profile(
        profile(s, mode),
        s,
        registry=registry,
        switches=GeoRuntimeSwitches("test", False, False, False),
    )
    assert codes(result) == {Code.MONITORING_DISABLED, code}


@pytest.mark.parametrize("mode", [Mode.API, Mode.BROWSER])
@pytest.mark.parametrize(
    "compliance", [Compliance.NOT_REVIEWED, Compliance.REJECTED, Compliance.SUSPENDED]
)
def test_every_automatic_mode_requires_approved_surface(mode: Mode, compliance: Compliance) -> None:
    s = surface(compliance_status=compliance)
    result = evaluate_profile(
        profile(s, mode), s, switches=SWITCHES, registry=CollectorRegistry([registration(mode)])
    )
    assert codes(result) == {Code.COMPLIANCE_NOT_APPROVED}


@pytest.mark.parametrize("mode", [Mode.API, Mode.BROWSER])
@pytest.mark.parametrize(
    "status,tested",
    [
        (ProfileTestState.UNTESTED, None),
        (ProfileTestState.FAILED, NOW),
        (ProfileTestState.PASSED, None),
    ],
)
def test_automatic_profiles_require_real_passed_test(
    mode: Mode, status: ProfileTestState, tested: datetime | None
) -> None:
    s = surface()
    result = evaluate_profile(
        profile(s, mode, last_test_status=status, last_tested_at=tested),
        s,
        switches=SWITCHES,
        registry=CollectorRegistry([registration(mode)]),
    )
    assert codes(result) == {Code.PROFILE_NOT_TESTED}


@pytest.mark.parametrize(
    "patch,code",
    [
        ({"approved": False}, Code.ADAPTER_NOT_APPROVED),
        ({"environments": frozenset({"development"})}, Code.ENVIRONMENT_UNSUPPORTED),
        ({"collection_mode": Mode.BROWSER}, Code.MODE_UNSUPPORTED),
        ({"surface_kinds": frozenset({Kind.CONSUMER_UI})}, Code.SURFACE_UNSUPPORTED),
        ({"languages": frozenset({"en"})}, Code.LANGUAGE_UNSUPPORTED),
        ({"regions": frozenset({"US"})}, Code.REGION_UNSUPPORTED),
        ({"login_states": frozenset({Login.AUTHENTICATED})}, Code.LOGIN_UNSUPPORTED),
        (
            {"web_search_policies": frozenset({Search.NOT_APPLICABLE})},
            Code.SEARCH_POLICY_UNSUPPORTED,
        ),
    ],
)
def test_adapter_constraints_are_shared_blockers(patch: dict[str, Any], code: Code) -> None:
    s = surface()
    result = evaluate_profile(
        profile(s, Mode.API),
        s,
        switches=SWITCHES,
        registry=CollectorRegistry([registration(**patch)]),
    )
    assert codes(result) == {code}


@pytest.mark.parametrize(
    "mode,settings",
    [
        (Mode.MANUAL, (("Cookie", "fake-sensitive-marker"),)),
        (Mode.API, (("temperature", True),)),
        (Mode.API, (("max_output_tokens", 65537),)),
        (Mode.BROWSER, (("answer_timeout_seconds", 601),)),
    ],
)
def test_validate_profile_reuses_mode_settings_and_does_not_echo_values(
    mode: Mode,
    settings: Any,
) -> None:
    s = surface()
    p = profile(s, mode, settings=settings)
    registry = (
        collector_registry if mode == Mode.MANUAL else CollectorRegistry([registration(mode)])
    )
    result = evaluate_profile(p, s, switches=SWITCHES, registry=registry)
    assert codes(result) == {Code.CONFIGURATION_INVALID}
    assert "fake-sensitive-marker" not in repr(result)


@pytest.mark.parametrize("limit_owner", ["adapter", "surface"])
def test_required_capabilities_use_intersection_and_never_fake_support(limit_owner: str) -> None:
    caps = frozenset({Capability.ANSWER_TEXT})
    s = surface(capabilities=caps) if limit_owner == "surface" else surface()
    a = registration(capabilities=caps) if limit_owner == "adapter" else registration()
    result = evaluate_profile(
        profile(s, Mode.API),
        s,
        switches=SWITCHES,
        registry=CollectorRegistry([a]),
        required_capabilities=frozenset({Capability.CITATIONS, Capability.COST}),
    )
    assert result.capabilities == caps
    assert {b.field for b in result.blockers} == {"capabilities.citations", "capabilities.cost"}
    with pytest.raises(ProfileIneligible):
        result.require_eligible()


def test_required_search_needs_observable_signal_and_unknown_capability_fails() -> None:
    s = surface(capabilities=frozenset({Capability.ANSWER_TEXT}))
    p = profile(s, Mode.API, web_search_policy=Search.REQUIRED)
    registry = CollectorRegistry([registration()])
    result = evaluate_profile(p, s, switches=SWITCHES, registry=registry)
    assert {b.field for b in result.blockers} == {"capabilities.web_search_signal"}
    with pytest.raises(ValueError):
        evaluate_profile(
            p,
            s,
            switches=SWITCHES,
            registry=registry,
            required_capabilities=frozenset({"invented"}),
        )  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "patch,code",
    [
        ({"id": uuid4()}, Code.MODEL_BINDING_INVALID),
        ({"channel_id": uuid4()}, Code.MODEL_BINDING_INVALID),
        ({"is_enabled": False}, Code.MODEL_DISABLED),
        ({"channel_is_enabled": False}, Code.CHANNEL_DISABLED),
        ({"test_status": "UNTESTED"}, Code.MODEL_NOT_TESTED),
        ({"test_status": "FAILED"}, Code.MODEL_NOT_TESTED),
        ({"credential_configured": False}, Code.CREDENTIAL_NOT_CONFIGURED),
        ({"protocol_type": "another-protocol"}, Code.PROTOCOL_UNSUPPORTED),
    ],
)
def test_current_bound_model_qualification(patch: dict[str, Any], code: Code) -> None:
    s = surface()
    p = profile(s, Mode.API, ai_model_id=uuid4(), ai_channel_id=uuid4())
    registry = CollectorRegistry(
        [registration(model_protocol="openai-compatible-chat-completions")]
    )
    assert evaluate_profile(p, s, switches=SWITCHES, registry=registry, model=model(p)).eligible
    result = evaluate_profile(p, s, switches=SWITCHES, registry=registry, model=model(p, **patch))
    assert codes(result) == {code}


def test_deleted_or_missing_model_does_not_reuse_passed_profile_or_other_adapter() -> None:
    s = surface()
    p = profile(s, Mode.API, ai_model_id=uuid4(), ai_channel_id=uuid4())
    registry = CollectorRegistry(
        [
            registration(model_protocol="openai-compatible-chat-completions"),
            registration(key="test-adapter-only"),
        ]
    )
    assert codes(evaluate_profile(p, s, switches=SWITCHES, registry=registry)) == {
        Code.MODEL_BINDING_INVALID,
    }
    unbound = replace(p, ai_channel_id=None, ai_model_id=None)
    assert codes(evaluate_profile(unbound, s, switches=SWITCHES, registry=registry)) == {
        Code.MODEL_BINDING_REQUIRED,
    }
    adapter_only = replace(unbound, adapter_key="test-adapter-only")
    assert evaluate_profile(adapter_only, s, switches=SWITCHES, registry=registry).eligible
    assert codes(
        evaluate_profile(
            replace(p, adapter_key="test-adapter-only"), s, switches=SWITCHES, registry=registry
        )
    ) == {
        Code.MODEL_BINDING_UNSUPPORTED,
    }
