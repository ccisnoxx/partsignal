import json, os
from pathlib import Path
import pytest
from sqlalchemy import text
import app
rows = {}
EXPECTED = "0070_geo_citation_observation"
def pytest_runtest_call(item):
    api = item.funcargs["plans_api"].api
    with api.engine.connect() as connection:
        head = connection.scalar(text("SELECT version_num FROM alembic_version"))
        version = connection.scalar(text("SHOW server_version"))
    assert head == EXPECTED, head
    source = str(Path(app.__file__).resolve())
    assert source.startswith(str(Path(os.environ["CANDIDATE_SOURCE"]).resolve()) + "/backend/"), source
    rows[item.nodeid] = {"schema_head": head, "postgresql_version": version, "app_source_is_candidate": True}
@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    rows.setdefault(item.nodeid, {})[report.when] = report.outcome
    if report.failed:
        rows[item.nodeid]["failure"] = str(report.longrepr)
def pytest_sessionfinish(session, exitstatus):
    Path(os.environ["CANDIDATE_RACE_RESULTS"]).write_text(json.dumps({"exit_code": int(exitstatus), "cases": rows}, ensure_ascii=False, indent=2) + "\n")
