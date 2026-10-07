"""连接诊断只豁免旧 Profile 资格，不能越过开关、合规或能力。"""

from dataclasses import replace
from uuid import uuid4

import pytest

from app.collectors.registry import CollectorCapability as Capability
from app.collectors.registry import ProfileBlockerCode as Code
from app.collectors.registry import collector_registry
from app.schemas.geo_surfaces import GeoCollectionMode as Mode
from app.schemas.geo_surfaces import GeoProfileTestStatus as Status
from app.schemas.geo_surfaces import GeoWebSearchPolicy as Search
from app.services.geo_collector_eligibility import evaluate_profile
from tests.unit.test_geo_collector_registry import SWITCHES, model, profile, surface


def test_real_diagnostic_registration_is_not_approved_collection():
    s = surface()
    p = profile(
        s,
        Mode.API,
        adapter_key="openai-compatible-chat",
        ai_channel_id=uuid4(),
        ai_model_id=uuid4(),
        is_active=False,
        last_test_status=Status.UNTESTED,
        last_tested_at=None,
    )
    result = evaluate_profile(p, s, switches=SWITCHES, model=model(p), connection_test=True)
    assert result.eligible and result.capabilities == {Capability.ANSWER_TEXT}
    collection = evaluate_profile(p, s, switches=SWITCHES, model=model(p))
    assert {b.code for b in collection.blockers} == {
        Code.PROFILE_DISABLED,
        Code.PROFILE_NOT_TESTED,
        Code.ADAPTER_NOT_APPROVED,
    }
    assert collector_registry.resolve(p.adapter_key).approved is False
    blocked = evaluate_profile(
        replace(p, web_search_policy=Search.REQUIRED),
        s,
        switches=SWITCHES,
        model=model(p),
        connection_test=True,
    )
    assert {b.code for b in blocked.blockers} == {
        Code.SEARCH_POLICY_UNSUPPORTED,
        Code.CAPABILITY_UNSUPPORTED,
    }


@pytest.mark.parametrize(
    "gate,code",
    [
        ("api", Code.API_COLLECTION_DISABLED),
        ("monitoring", Code.MONITORING_DISABLED),
        ("model", Code.MODEL_NOT_TESTED),
        ("surface", Code.SURFACE_DISABLED),
    ],
)
def test_diagnostic_requires_current_egress_gates(gate, code):
    s = surface(is_active=gate != "surface")
    p = profile(
        s,
        Mode.API,
        adapter_key="openai-compatible-chat",
        ai_channel_id=uuid4(),
        ai_model_id=uuid4(),
    )
    switches = replace(
        SWITCHES, api_collection_enabled=gate != "api", monitoring_enabled=gate != "monitoring"
    )
    result = evaluate_profile(
        p,
        s,
        switches=switches,
        model=model(p, test_status="UNTESTED" if gate == "model" else "PASSED"),
        connection_test=True,
    )
    assert {b.code for b in result.blockers} == {code}
