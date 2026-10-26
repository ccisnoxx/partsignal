"""后台入口接线：扫描参数仅来自数据库配置。"""


def test_beat_dispatches_periodic_opportunity_scan(monkeypatch):
    from app import worker

    entry = worker.celery_app.conf.beat_schedule["evaluate-due-geo-opportunities"]
    assert entry["task"] == "partsignal.evaluate_due_geo_opportunities"
    calls = []
    monkeypatch.setattr(worker, "evaluate_due_opportunities", lambda: calls.append(True))
    worker.evaluate_due_geo_opportunities.run()
    assert calls == [True]
