"""GEO-902：观测失败不改业务结果，日志严格排除自由文本与异常链。"""

import json
import logging
from decimal import Decimal
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.errors import AppError
from app.services import geo_ops_runtime as runtime
from app.services.geo_ops_logging import OpsError, geo_event


def test_safe_event_and_worker_exception_exclude_secret_canaries(monkeypatch, caplog):
    secret = "GEO902-secret-cookie-authorization-provider-payload"
    recorded = []
    monkeypatch.setattr(runtime, "record_operation", lambda *a, **k: recorded.append(k) or False)

    @runtime.observe("collect_task", "COLLECTION", scrub_worker_error=True)
    def failed():
        raise ConnectionError(secret)

    with caplog.at_level(logging.INFO), pytest.raises(RuntimeError) as error:
        failed()
    assert secret not in str(error.value)
    assert error.value.__suppress_context__
    assert recorded[0]["succeeded"] is False
    assert secret not in caplog.text
    payload = json.loads(caplog.records[-1].message)
    assert payload["error_code"] == "OPERATION_FAILED"
    assert set(payload) == {
        "schema_version",
        "component",
        "event",
        "stage",
        "status",
        "error_code",
        "duration_ms",
    }


def test_observation_failure_preserves_success_and_business_rejection(monkeypatch, caplog):
    recorded = []
    monkeypatch.setattr(runtime, "record_operation", lambda *a, **k: recorded.append(k) or False)

    @runtime.observe("batch_build", "BATCH")
    def accepted():
        return "business-receipt"

    @runtime.observe("batch_build", "BATCH")
    def rejected():
        raise AppError("INVALID_STATE_TRANSITION", "业务拒绝", 409)

    with caplog.at_level(logging.INFO):
        assert accepted() == "business-receipt"
        with pytest.raises(AppError) as error:
            rejected()
    assert error.value.status_code == 409
    assert len(recorded) == 1 and recorded[0]["succeeded"] is True
    assert json.loads(caplog.records[-1].message)["status"] == "REJECTED"


def test_connection_creation_failure_is_explicit_and_scrubbed(monkeypatch, caplog):
    def unavailable(*args):
        raise RuntimeError("postgresql://secret-password@private-host/private-data")

    monkeypatch.setattr(runtime, "observability_engine", unavailable)
    assert runtime.record_operation("storage_write", succeeded=False) is False
    assert "secret-password" not in caplog.text
    assert json.loads(caplog.records[-1].message)["error_code"] == "OBSERVABILITY_WRITE_FAILED"


def test_connection_release_failure_preserves_recorded_result(monkeypatch, caplog):
    engine = MagicMock()
    engine.dispose.side_effect = OSError("GEO902-secret-release-error")
    monkeypatch.setattr(runtime, "observability_engine", lambda *a: engine)
    monkeypatch.setattr(runtime, "Session", MagicMock())
    assert runtime.record_operation("batch_build", succeeded=True) is True
    assert "GEO902-secret" not in caplog.text
    assert json.loads(caplog.records[-1].message)["error_code"] == "OBSERVABILITY_WRITE_FAILED"


def test_log_contract_allows_only_stable_fields_and_explicit_money(caplog):
    identity = uuid4()
    with caplog.at_level(logging.INFO):
        geo_event(
            event="collection_finished",
            stage="COLLECTION",
            status="SUCCEEDED",
            run_id=identity,
            cost_amount=Decimal("0.01"),
            cost_currency="USD",
        )
    payload = json.loads(caplog.records[-1].message)
    assert payload["run_id"] == str(identity)
    assert payload["cost_amount"] == "0.01" and payload["cost_currency"] == "USD"
    for values in (
        {"error_code": "secret"},
        {"run_id": "secret"},
        {"duration_ms": -1},
        {"cost_amount": Decimal("NaN"), "cost_currency": "USD"},
        {"cost_amount": Decimal("1"), "cost_currency": "secret"},
        {"event": "secret"},
    ):
        with pytest.raises(ValueError):
            geo_event(
                **dict(event="collection_finished", stage="COLLECTION", status="FAILED", **values)
                if "event" not in values
                else dict(stage="COLLECTION", status="FAILED", **values)
            )
    with pytest.raises(TypeError):
        geo_event(
            event="dispatch_failed",
            stage="COLLECTION",
            status="FAILED",
            error_code=OpsError.BROKER_UNAVAILABLE,
            request_id="secret",
        )


def test_log_sink_failure_cannot_override_committed_receipt_or_business_error(monkeypatch, capsys):
    monkeypatch.setattr(runtime, "record_operation", lambda *a, **k: True)

    class FailedSink(logging.Handler):
        def emit(self, _record):
            raise OSError("GEO902-secret-sink-error")

    logger = logging.getLogger("partsignal.geo.batch")
    handler = FailedSink()
    logger.addHandler(handler)
    old_level = logger.level
    logger.setLevel(logging.INFO)
    try:

        @runtime.observe("batch_build", "BATCH")
        def accepted():
            return "committed-receipt"

        @runtime.observe("batch_build", "BATCH")
        def rejected():
            raise AppError("REVISION_CONFLICT", "原业务拒绝", 409)

        assert accepted() == "committed-receipt"
        with pytest.raises(AppError) as error:
            rejected()
        assert error.value.code == "REVISION_CONFLICT"
    finally:
        logger.removeHandler(handler)
        logger.setLevel(old_level)
    output = capsys.readouterr().err
    assert output.count('"error_code":"LOGGING_UNAVAILABLE"') == 2
    assert "secret" not in output
