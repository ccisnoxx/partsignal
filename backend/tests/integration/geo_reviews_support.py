"""复核真实HTTP会话与PG分析夹具，数据均为虚构。"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.config import settings
from app.db import get_db
from app.main import app
from app.models.geo_catalog import GeoSubjectAlias
from app.models.identity import SessionRecord, User
from app.security import hash_token
from app.services import geo_analysis_runs as runs
from app.services.geo_catalog_normalization import catalog_text_key
from tests.integration.geo_analysis_worker_support import AnalysisHarness
from tests.integration.geo_analysis_worker_support import analysis_engine as analysis_engine
from tests.integration.geo_analysis_worker_support import answer_database as answer_database
from tests.integration.geo_analysis_worker_support import harness as harness
from tests.integration.geo_analysis_worker_support import plan_database as plan_database
from tests.integration.geo_analysis_worker_support import run_database as run_database

__all__ = ["analysis_engine", "answer_database", "harness", "plan_database", "run_database"]
CSRF = "geo507-fake-csrf-at-least-32-bytes-long"
RUNS = "/api/v1/geo/observation-runs"


@dataclass
class ReviewAPI:
    harness: AnalysisHarness
    admin: TestClient
    engineer: TestClient
    anonymous: TestClient
    engineer_id: UUID

    def create(self, *, review_required=True, products=1):
        case = self.harness.create(
            products=products,
            answer_text="推荐 GEO501-0，供电电压为 5 V。" if review_required else "虚构资料。",
            citation_urls=("https://example.com/geo507",),
        )
        runs.process_analysis_run(case.run_id)
        return case

    def detail(self, case):
        response = self.engineer.get(f"{RUNS}/{case.run_id}")
        assert response.status_code == 200, response.text
        return response.json()

    def payload(self, case, **patch):
        run = self.harness.run(case.run_id)
        return {
            "analysis_revision_id": str(run.current_analysis_revision_id),
            "expected_run_revision": run.revision,
            "decision": "CONFIRMED",
            "correction_payload": None,
            "comment": "虚构人工确认",
            **patch,
        }

    def submit(self, case, **patch):
        return self.engineer.post(f"{RUNS}/{case.run_id}/review", json=self.payload(case, **patch))

    def reanalyze(self, case):
        # 实际增加字典revision，避免同hash复用被误当作新版本。
        with self.harness.factory.begin() as db:
            subject = case.input["subjects"][0]["id"]
            alias = f"虚构别名-{uuid4()}"
            db.add(
                GeoSubjectAlias(
                    subject_id=subject,
                    alias=alias,
                    normalized_alias=alias,
                    alias_kind="NAME",
                    is_active=True,
                )
            )
            # 原始回答中的虚构产品名保留为当前字典别名，保证重分析仍有同一待复核证据。
            for frozen in case.input["subjects"]:
                key = catalog_text_key(frozen["canonical_name"])
                exists = db.scalar(
                    select(GeoSubjectAlias.id).where(
                        GeoSubjectAlias.subject_id == frozen["id"],
                        GeoSubjectAlias.normalized_alias == key,
                    )
                )
                if exists is None:
                    db.add(
                        GeoSubjectAlias(
                            subject_id=frozen["id"],
                            alias=frozen["canonical_name"],
                            normalized_alias=key,
                            alias_kind="NAME",
                            is_active=True,
                        )
                    )

            db.execute(
                text("UPDATE geo_subjects SET revision=revision+1 WHERE id=:id"), {"id": subject}
            )
        identity = self.harness.reanalyze(case.run_id)
        runs.process_analysis_revision(identity)
        return identity


@pytest.fixture
def review_api(harness):
    with harness.factory.begin() as db:
        admin = db.get(User, harness.database.runs.plan.actor)
        engineer = User(
            username=f"geo507-{uuid4()}",
            display_name="虚构复核员",
            password_hash="unused",
            account_type="ENGINEER",
            is_active=True,
            must_change_password=False,
            revision=0,
        )
        db.add(engineer)
        db.flush()
        tokens = []
        for user in (admin, engineer):
            token = f"geo507-session-{uuid4()}"
            tokens.append(token)
            db.add(
                SessionRecord(
                    user_id=user.id,
                    token_hash=hash_token(token),
                    csrf_hash=hash_token(CSRF),
                    expires_at=datetime.now(UTC) + timedelta(hours=1),
                )
            )
        engineer_id = engineer.id

    def request_db():
        with harness.factory() as db:
            yield db

    app.dependency_overrides[get_db] = request_db
    try:
        with TestClient(app) as admin, TestClient(app) as engineer, TestClient(app) as anonymous:
            for client, token in zip((admin, engineer), tokens, strict=True):
                client.cookies.set(settings.session_cookie_name, token)
                client.headers["X-CSRF-Token"] = CSRF
            yield ReviewAPI(harness, admin, engineer, anonymous, engineer_id)
    finally:
        app.dependency_overrides.pop(get_db, None)
