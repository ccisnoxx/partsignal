"""AUTO-01日历窗口：沿Celery字段语义，UTC身份与DST明确。"""

from datetime import datetime

import pytest

from app.services.geo_schedule_clock import next_window


@pytest.mark.parametrize(
    "expression,zone,after,expected",
    [
        ("0 9 * * *", "Asia/Shanghai", "2026-10-25T00:59:59+00:00", "2026-10-25T01:00:00+00:00"),
        ("0 9 * * *", "Asia/Shanghai", "2026-10-25T01:00:00+00:00", "2026-10-26T01:00:00+00:00"),
        ("*/15 * * * *", "UTC", "2026-10-25T01:00:01+00:00", "2026-10-25T01:15:00+00:00"),
        ("0 0 29 2 *", "UTC", "2026-01-01T00:00:00+00:00", "2028-02-29T00:00:00+00:00"),
        ("0 0 1 * mon", "UTC", "2026-10-25T00:00:00+00:00", "2027-02-01T00:00:00+00:00"),
        (
            "30 2 * * *",
            "America/New_York",
            "2026-03-07T08:00:00+00:00",
            "2026-03-09T06:30:00+00:00",
        ),
        (
            "30 1 * * *",
            "America/New_York",
            "2026-11-01T04:00:00+00:00",
            "2026-11-01T05:30:00+00:00",
        ),
        (
            "30 1 * * *",
            "America/New_York",
            "2026-11-01T05:30:00+00:00",
            "2026-11-02T06:30:00+00:00",
        ),
        (
            "30 1 * * *",
            "America/New_York",
            "2026-11-01T06:00:00+00:00",
            "2026-11-02T06:30:00+00:00",
        ),
    ],
)
def test_calendar_windows(expression, zone, after, expected):
    assert next_window(expression, zone, datetime.fromisoformat(after)) == datetime.fromisoformat(
        expected
    )


def test_impossible_date_is_not_a_success_schedule():
    with pytest.raises(ValueError, match="没有可执行日期"):
        next_window("0 0 31 2 *", "UTC", datetime.fromisoformat("2026-01-01T00:00:00+00:00"))


def test_beat_dispatches_database_due_scan_without_external_payload(monkeypatch):
    from app import worker

    entry = worker.celery_app.conf.beat_schedule["create-due-geo-plan-batches"]
    assert entry["task"] == "partsignal.create_due_geo_plan_batches"
    called = []
    monkeypatch.setattr(worker, "create_due_plan_batches", lambda: called.append(True))
    worker.create_due_geo_plan_batches.run()
    assert called == [True]
