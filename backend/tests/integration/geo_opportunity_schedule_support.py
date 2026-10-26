"""AUTO-02复用真实PG/HTTP分析与机会夹具；只创建虚构观测。"""

from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import settings
from app.main import app
from app.models.geo_opportunity_evaluation import GeoOpportunityEvaluationRun
from app.models.geo_opportunity_schedule import GeoOpportunityScheduleWindow
from app.models.identity import SessionRecord, User
from app.security import hash_token
from app.services import geo_opportunity_scheduler as service
from app.services import geo_rules
from tests.integration.geo_reviews_support import CSRF
from tests.integration.test_geo_manual_opportunity_evaluation import (
    analysis_engine as analysis_engine,
)
from tests.integration.test_geo_manual_opportunity_evaluation import (
    answer_database as answer_database,
)
from tests.integration.test_geo_manual_opportunity_evaluation import (
    api as api,
)
from tests.integration.test_geo_manual_opportunity_evaluation import (
    harness as harness,
)
from tests.integration.test_geo_manual_opportunity_evaluation import (
    overview_api as overview_api,
)
from tests.integration.test_geo_manual_opportunity_evaluation import (
    plan_database as plan_database,
)
from tests.integration.test_geo_manual_opportunity_evaluation import (
    prepared as prepared,
)
from tests.integration.test_geo_manual_opportunity_evaluation import (
    review_api as review_api,
)
from tests.integration.test_geo_manual_opportunity_evaluation import (
    run_database as run_database,
)

PATH = "/api/v1/geo/opportunities/evaluation-schedule"


def configuration(api, filters=None, **patch):
    with api.harness.factory() as db:
        version = geo_rules.get_rules(db).revision
    return {
        "scope": "FILTERED" if filters else "ALL",
        "subject_ids": [str(v) for v in filters.subject_ids] if filters else [],
        "engine_surface_ids": [],
        "collection_profile_ids": [],
        "collection_modes": ["MANUAL"],
        "rule_set_revision": version,
        "interval_hours": 1,
        "lookback_days": 7,
        **patch,
    }


def active(api, filters=None, *, client=None, **patch):
    writer = client or api.admin
    old = api.admin.get(PATH).json()
    if old["status"] == "ACTIVE":
        response = api.admin.post(PATH + "/pause", json={"expected_revision": old["revision"]})
        assert response.status_code == 200, response.text
        old = response.json()
    response = writer.put(
        PATH,
        json={
            "expected_revision": old["revision"],
            "configuration": configuration(api, filters, **patch),
        },
    )
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["status"] in {"DISABLED", "PAUSED"} and saved["next_run_at"] is None
    operation = "activate" if saved["status"] == "DISABLED" else "resume"
    response = writer.post(PATH + "/" + operation, json={"expected_revision": saved["revision"]})
    assert response.status_code == 200, response.text
    return response.json()


def execute(api, value, *, now=None):
    due = datetime.fromisoformat(value["next_run_at"])
    with api.harness.factory() as db:
        return service.execute_due_evaluation(db, now=now or due + timedelta(seconds=1))


def windows(api, revision):
    with api.harness.factory() as db:
        return list(
            db.scalars(
                select(GeoOpportunityScheduleWindow)
                .where(GeoOpportunityScheduleWindow.configuration_revision == revision)
                .order_by(GeoOpportunityScheduleWindow.scheduled_for)
            )
        )


def receipts(api):
    with api.harness.factory() as db:
        return db.scalar(select(func.count()).select_from(GeoOpportunityEvaluationRun))


@contextmanager
def another_admin(api):
    token = "auto02-session-" + str(uuid4())
    with api.harness.factory.begin() as db:
        user = User(
            username="auto02-" + str(uuid4()),
            display_name="虚构自动评估授权人",
            password_hash="unused",
            account_type="ADMIN",
            is_active=True,
            must_change_password=False,
            revision=0,
        )
        db.add(user)
        db.flush()
        db.add(
            SessionRecord(
                user_id=user.id,
                token_hash=hash_token(token),
                csrf_hash=hash_token(CSRF),
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        identity = user.id
    with TestClient(app) as client:
        client.cookies.set(settings.session_cookie_name, token)
        client.headers["X-CSRF-Token"] = CSRF
        yield client, identity
