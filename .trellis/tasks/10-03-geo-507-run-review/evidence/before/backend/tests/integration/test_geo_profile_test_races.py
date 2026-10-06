"""有真实网络请求的 PG 交错：重复命令、旧依赖和后来的测试预留。"""

# ruff: noqa: F811
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from uuid import UUID

import pytest
from sqlalchemy import text

from app.errors import AppError
from app.services import geo_profile_tests
from tests.integration.geo_profile_test_support import api_profile, https_provider  # noqa: F401
from tests.integration.geo_surface_management_support import (  # noqa: F401
    PROFILES,
    actor,
    surface_api,
    surface_engine,
)

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("interleaving", ["duplicate", "model", "header", "new-test"])
def test_inflight_completion_cannot_overwrite_current_intent(
    surface_api, https_provider, monkeypatch, interleaving
):
    profile, channel, model, call_id = api_profile(surface_api, monkeypatch)
    pid = UUID(profile["summary"]["id"])
    received, release = Event(), Event()
    factory = geo_profile_tests.OpenAICompatibleClient
    count_lock = Lock()
    calls = 0

    class PausedClient:
        def test_connection(self, **arguments):
            nonlocal calls
            with count_lock:
                calls += 1
                first = calls == 1
            content = factory().test_connection(**arguments)
            if first:
                received.set()
                assert release.wait(10), "交错测试未释放网络完成"
            return content

    monkeypatch.setattr(
        geo_profile_tests, "OpenAICompatibleClient", lambda **kwargs: PausedClient()
    )

    def run():
        with surface_api.factory() as db:
            return geo_profile_tests.test_profile(
                db=db,
                actor=actor(db, surface_api),
                profile_id=pid,
                expected_revision=0,
                request_id="geo403-race-request",
            )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(run)
        try:
            assert received.wait(10), "固定诊断没有到达真实 fake HTTPS"
            if interleaving == "duplicate":
                duplicate = surface_api.admin.post(
                    f"{PROFILES}/{pid}/test", json={"expected_revision": 0}
                )
                assert duplicate.status_code == 409
            elif interleaving == "new-test":
                newer = surface_api.admin.post(
                    f"{PROFILES}/{pid}/test", json={"expected_revision": 1}
                )
                assert newer.status_code == 200, newer.text
                assert newer.json()["summary"]["last_test_status"] == "PASSED"
            else:
                with surface_api.factory() as db:
                    if interleaving == "model":
                        db.execute(
                            text(
                                "UPDATE ai_models SET model_id='new-model',revision=revision+1 "
                                "WHERE id=:id"
                            ),
                            {"id": model.id},
                        )
                    else:
                        db.execute(
                            text(
                                "UPDATE ai_channel_headers SET plain_value='new-header' "
                                "WHERE channel_id=:id"
                            ),
                            {"id": channel.id},
                        )
                    db.commit()
        finally:
            release.set()
        if interleaving == "duplicate":
            assert future.result(timeout=10).summary.last_test_status == "PASSED"
        else:
            with pytest.raises(AppError) as failure:
                future.result(timeout=10)
            assert failure.value.code == "REVISION_CONFLICT"
    current = surface_api.admin.get(f"{PROFILES}/{pid}").json()
    assert current["summary"]["is_active"] is False
    assert current["summary"]["last_test_status"] == (
        "PASSED" if interleaving in {"duplicate", "new-test"} else "UNTESTED"
    )
    assert https_provider.state.snapshot(UUID(call_id))["count"] == (
        2 if interleaving == "new-test" else 1
    )
