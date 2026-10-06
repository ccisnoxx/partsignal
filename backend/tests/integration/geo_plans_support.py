"""Plan API 使用真实PostgreSQL与虚构主数据，不创建回答级运行。"""

from collections.abc import Iterator
from dataclasses import dataclass
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, create_engine

from app.config import settings
from app.models.geo_catalog import GeoSubject
from app.models.geo_prompt_variants import GeoPromptVariant
from app.models.geo_surfaces import GeoCollectionProfile, GeoEngineSurface
from tests.integration.geo_questions_support import QuestionsAPI
from tests.integration.geo_questions_support import questions_api as questions_api
from tests.integration.test_migrations import run_alembic, temporary_database

PREFIX = "/api/v1/geo/monitoring-plans"


@pytest.fixture(scope="module")
def questions_engine() -> Iterator[Engine]:
    with temporary_database("partsignal_geo208") as (url, env, backend_dir):
        run_alembic(env, backend_dir, "head")
        engine = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1))
        try:
            yield engine
        finally:
            engine.dispose()


@dataclass
class PlansAPI:
    api: QuestionsAPI
    subject: UUID
    prompt: UUID
    profile: UUID
    surface: UUID
    name: str

    def payload(self, **values: object) -> dict:
        return {
            "name": self.name,
            "description": "虚构内部说明，不进入审计",
            "subjects": [{"subject_id": str(self.subject), "role": "PRIMARY"}],
            "prompt_variant_ids": [str(self.prompt)],
            "collection_profile_ids": [str(self.profile)],
            **values,
        }

    def create(self, **values: object) -> dict:
        result = self.api.engineer.post(PREFIX, json=self.payload(**values))
        assert result.status_code == 201, result.text
        return result.json()

    def action(self, plan: dict, action: str, **values: object):
        return self.api.engineer.post(
            f"{PREFIX}/{plan['id']}/{action}",
            json={"expected_revision": plan["revision"], **values},
        )


@pytest.fixture
def plans_api(questions_api: QuestionsAPI, monkeypatch: pytest.MonkeyPatch) -> PlansAPI:
    monkeypatch.setattr(settings, "geo_monitoring_enabled", True)
    with questions_api.factory() as db:
        subject = GeoSubject(
            subject_type="OWN_BRAND",
            canonical_name="虚构Plan品牌",
            normalized_name="虚构plan品牌",
            display_name="虚构Plan品牌",
            is_active=True,
            created_by=questions_api.admin_id,
        )
        prompt = GeoPromptVariant(
            query_topic_id=questions_api.topic,
            prompt_text="虚构Plan问题",
            mention_mode="UNBRANDED",
            language_code="zh-hans",
            region_code="CN",
            priority="CORE",
            created_by=questions_api.engineer_id,
        )
        surface = GeoEngineSurface(
            name="虚构人工平台",
            slug=f"plan-{uuid4()}",
            surface_kind="MANUAL_SITE",
            provider_brand="CUSTOM",
            is_active=True,
            created_by=questions_api.admin_id,
            capabilities={
                "answer_text": True,
                "citations": False,
                "web_search_signal": False,
                "model_version": False,
                "usage": False,
                "cost": False,
            },
        )
        db.add_all([subject, prompt, surface])
        db.flush()
        profile = GeoCollectionProfile(
            engine_surface_id=surface.id,
            name="虚构人工配置",
            collection_mode="MANUAL",
            adapter_key="manual",
            language_code="zh-hans",
            region_code="CN",
            login_state="ANONYMOUS",
            web_search_policy="UNKNOWN",
            settings_json={},
            is_active=True,
            created_by=questions_api.admin_id,
        )
        db.add(profile)
        db.commit()
        return PlansAPI(
            questions_api, subject.id, prompt.id, profile.id, surface.id, f"虚构计划-{uuid4()}"
        )
