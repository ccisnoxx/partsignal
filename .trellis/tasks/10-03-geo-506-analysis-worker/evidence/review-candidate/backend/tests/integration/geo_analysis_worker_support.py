"""分析 Worker 的独立 PostgreSQL 夹具；仅使用虚构答案和批准事实。"""

from dataclasses import dataclass
from uuid import UUID

import psycopg
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.geo_analysis import GeoAnalysisRevision
from app.models.geo_analysis_worker import GeoAnalysisJob
from app.models.geo_runs import GeoObservationRun
from app.models.identity import User
from app.services import geo_analysis_dispatch, geo_analysis_runs, geo_reanalysis
from app.services.geo_analysis_execution import analyze, load_analysis_input
from app.services.geo_reanalysis import ReanalysisReason
from tests.integration.geo_analysis_support import collected_case
from tests.integration.geo_answers_support import AnswerDatabase
from tests.integration.geo_answers_support import answer_database as answer_database
from tests.integration.geo_answers_support import plan_database as plan_database
from tests.integration.geo_answers_support import run_database as run_database


@dataclass
class AnalysisHarness:
    database: AnswerDatabase
    factory: sessionmaker
    ids: list[UUID]

    def create(self, **values):
        with psycopg.connect(self.database.url) as conn:
            case = collected_case(conn, self.database, **values)
        self.ids.append(case.run_id)
        return case

    def run(self, identity):
        with self.factory() as db:
            return db.get(GeoObservationRun, identity)

    def analysis(self, identity):
        with self.factory() as db:
            return db.get(GeoAnalysisRevision, identity)

    def result(self, identity):
        with self.factory() as db:
            value = load_analysis_input(db, db.get(GeoAnalysisRevision, identity))
        return analyze(value)

    def reanalyze(self, run_id, **patch):
        with self.factory() as db:
            actor = db.get(User, self.database.runs.plan.actor)
        return geo_reanalysis.reanalyze_run(
            run_id=run_id,
            actor=actor,
            expected_revision=self.run(run_id).revision,
            reason=ReanalysisReason.RETRY_FAILED,
            request_id="geo506-test",
            sender=lambda _id: None,
            **patch,
        )


@pytest.fixture(scope="module")
def analysis_engine(answer_database):
    engine = create_engine(answer_database.url.replace("postgresql://", "postgresql+psycopg://", 1))
    yield engine
    engine.dispose()


@pytest.fixture
def harness(answer_database, analysis_engine, monkeypatch):
    factory = sessionmaker(analysis_engine, expire_on_commit=False)
    for module in (geo_analysis_runs, geo_analysis_dispatch, geo_reanalysis):
        monkeypatch.setattr(module, "SessionLocal", factory)
    monkeypatch.setattr(settings, "geo_monitoring_enabled", True)
    value = AnalysisHarness(answer_database, factory, [])
    yield value
    # 测试后结束自身待执行数据，不让下一项扫描误消费本项留下的记录。
    for run_id in value.ids:
        geo_analysis_runs.process_analysis_run(run_id)
        with factory() as db:
            ids = list(
                db.scalars(
                    select(GeoAnalysisRevision.id)
                    .join(
                        GeoAnalysisJob,
                        GeoAnalysisJob.analysis_revision_id == GeoAnalysisRevision.id,
                    )
                    .where(
                        GeoAnalysisRevision.run_id == run_id,
                        GeoAnalysisRevision.status == "PENDING",
                        GeoAnalysisJob.claimed_at.is_(None),
                    )
                )
            )
        for identity in ids:
            geo_analysis_runs.process_analysis_revision(identity)
