"""真实健康边界的故障模拟：进程存在不能掩盖失联、PG或Broker故障。"""

import json
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import geo_ops_health as health
from app.worker import celery_app


@pytest.fixture
def healthy_component(monkeypatch, tmp_path):
    now = datetime.now(UTC)
    engine = Mock()
    db = Mock()
    db.__enter__ = Mock(return_value=db)
    db.__exit__ = Mock(return_value=False)
    db.get.return_value = SimpleNamespace(last_success_at=now)
    db.scalar.return_value = now
    monkeypatch.setattr(health, "observability_engine", lambda: engine)
    monkeypatch.setattr(health, "Session", lambda **kwargs: db)
    redis = Mock()
    redis.__enter__ = Mock(return_value=redis)
    redis.__exit__ = Mock(return_value=False)
    redis.ping.return_value = True
    monkeypatch.setattr(health.Redis, "from_url", lambda *a, **k: redis)
    monkeypatch.setattr(health.os, "kill", lambda *a: None)
    monkeypatch.setattr(health, "Path", lambda name: tmp_path / Path(name).name)
    monkeypatch.setattr(health, "monotonic", lambda: 100.0)
    inspector = Mock()
    inspector.ping.return_value = {f"celery@{health.socket.gethostname()}": {"ok": "pong"}}
    monkeypatch.setattr(celery_app.control, "inspect", lambda **kwargs: inspector)
    for component, pidfile in (("worker", "worker"), ("scheduler", "beat")):
        (tmp_path / f"partsignal-{pidfile}.pid").write_text("4321")
        health.heartbeat_file(component).write_text(json.dumps({"pid": 4321, "monotonic": 100.0}))
    return db, redis, inspector


@pytest.mark.parametrize("component", ["worker", "scheduler"])
def test_live_component_requires_recent_local_and_database_heartbeat(healthy_component, component):
    assert health.component_health(component)["status"] == "ok"
    health.heartbeat_file(component).write_text(json.dumps({"pid": 4321, "monotonic": 9.0}))
    result = health.component_health(component)
    assert result["status"] == "unhealthy"
    assert result["checks"]["observed_heartbeat"] is True
    assert result["checks"]["local_heartbeat"] is False


@pytest.mark.parametrize("failed", ["postgres", "redis", "celery_ping"])
def test_dependency_failure_is_unhealthy_and_does_not_expose_exception(healthy_component, failed):
    db, redis, inspector = healthy_component
    target = {"postgres": db.execute, "redis": redis.ping, "celery_ping": inspector.ping}[failed]
    target.side_effect = RuntimeError("GEO902-secret-token-cookie-private-query")
    result = health.component_health("worker")
    assert result["status"] == "unhealthy" and result["checks"][failed] is False
    assert "secret" not in json.dumps(result)


def test_publish_failure_is_counted_without_exception_body(monkeypatch, caplog):
    outcomes = []
    monkeypatch.setattr(health, "record_operation", lambda *a, **k: outcomes.append(k))
    scheduler = object.__new__(health.GeoHealthScheduler)
    scheduler.apply_async = Mock(side_effect=RuntimeError("GEO902-secret-broker-url"))
    scheduler.apply_entry(SimpleNamespace(name="existing-task"))
    assert outcomes[0]["succeeded"] is False
    assert "GEO902-secret" not in caplog.text
    assert json.loads(caplog.records[-1].message)["error_code"] == "BROKER_UNAVAILABLE"


def test_tick_records_actual_loop_and_preserves_existing_celery_dispatch(monkeypatch):
    calls = []
    monkeypatch.setattr(health.PersistentScheduler, "tick", lambda *a, **k: 300.0)
    monkeypatch.setattr(health, "record_operation", lambda *a, **k: calls.append(a[0]) or True)
    monkeypatch.setattr(health, "_local_heartbeat", lambda component: calls.append(component))
    scheduler = object.__new__(health.GeoHealthScheduler)
    assert scheduler.tick() == 30.0
    assert scheduler.tick() == 30.0
    assert calls == ["scheduler_tick", "scheduler"]


def test_connection_retry_and_tick_producer_failure_scrub_real_celery_boundary(monkeypatch, caplog):
    secret = "GEO902-secret-broker-connection-canary"
    scheduler = object.__new__(health.GeoHealthScheduler)
    scheduler.app = SimpleNamespace(conf=SimpleNamespace(broker_connection_max_retries=3))
    retries = []

    class Connection:
        def ensure_connection(self, handler, maximum):
            retries.append(maximum)
            handler(ConnectionError(secret), 1)
            raise ConnectionError(secret)

    scheduler.__dict__["connection"] = Connection()
    monkeypatch.setattr(health.PersistentScheduler, "tick", lambda self: self._ensure_connected())
    monkeypatch.setattr(health, "record_operation", lambda *a, **k: retries.append(k["succeeded"]))
    with pytest.raises(RuntimeError) as error:
        scheduler.tick()
    assert retries == [3, False]
    assert secret not in caplog.text and secret not in str(error.value)
    assert error.value.__suppress_context__
