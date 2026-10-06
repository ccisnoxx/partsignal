"""704真实PG/HTTP：复用领域服务、原子回执、历史来源和恢复边界。"""

from copy import deepcopy
from hashlib import sha256
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select

from app.models.configuration import PlatformProfile, PlatformType
from app.models.content import ContentTask, ContentVersion
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunitySource
from app.models.identity import User
from app.models.publication import PlatformAccount
from tests.integration.test_geo_opportunity_workbench import (
    PATH,
    analysis_engine,
    answer_database,
    api,
    detail,
    harness,
    opportunity,
    overview_api,
    plan_database,
    review_api,
    run_database,
)
from tests.integration.test_publication_workflow import _complete_publication

pytestmark = pytest.mark.integration
__all__ = [
    "analysis_engine",
    "answer_database",
    "api",
    "harness",
    "overview_api",
    "plan_database",
    "review_api",
    "run_database",
]


def ready(api):
    case, filters, correction, identity = opportunity(api)
    value = detail(api, identity)["opportunity"]
    response = api.engineer.post(
        f"{PATH}/{identity}/acknowledge", json={"expected_revision": value["revision"]}
    )
    assert response.status_code == 200, response.text
    with api.harness.factory.begin() as db:
        actor = db.get(User, api.engineer_id)
        kind = PlatformType(name="虚构行动平台", slug=f"g704-{uuid4()}", created_by=actor.id)
        db.add(kind)
        db.flush()
        profile = PlatformProfile(
            name="虚构社区",
            slug=f"g704-{uuid4()}",
            platform_type_id=kind.id,
            allowed_domains=["community.example.invalid"],
        )
        db.add(profile)
        db.flush()
        profile_id = profile.id
    return (
        case,
        filters,
        correction,
        identity,
        {
            "expected_revision": response.json()["revision"],
            "product_id": str(case.input["subjects"][1]["product_id"]),
            "fact_version_id": str(case.facts[0]),
            "platform_profile_id": str(profile_id),
        },
    )


def post(api, identity, suffix, payload, key=None):
    return api.engineer.post(
        f"{PATH}/{identity}/actions/{suffix}",
        json=payload,
        headers={"Idempotency-Key": key or str(uuid4()), "X-Request-ID": "geo704-integration"},
    )


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def publish_task(api, task_id, fact_id):
    """准备人工批准稿；完成状态由实际发布领域服务产生。"""
    with api.harness.factory() as db:
        actor = db.get(User, api.engineer_id)
        task = db.get(ContentTask, UUID(str(task_id)))
        content = ContentVersion(
            task_id=task.id,
            fact_version_id=UUID(str(fact_id)),
            version=1,
            source_type="HUMAN",
            title="虚构行动内容",
            summary="虚构摘要",
            body_markdown="# 虚构公开内容",
            tags=[],
            content_hash=sha256(str(task.id).encode()).hexdigest(),
            status="APPROVED",
            quality_issues=[],
            change_summary="虚构人工批准稿",
            created_by=actor.id,
        )
        account = PlatformAccount(
            platform_profile_id=task.platform_profile_id,
            label="虚构账号",
            account_identifier=str(uuid4()),
        )
        db.add_all([content, account])
        db.flush()
        task.current_content_version_id = content.id
        db.commit()
        work = _complete_publication(
            db, {"user": actor, "content": content, "account": account}, suffix=f"geo704-{uuid4()}"
        )
        return work.id


def citation_opportunity(api, identity):
    """行动测试夹具：复用真实来源，单独建立引用丢失机会；规则评估另有702覆盖。"""
    with api.harness.factory.begin() as db:
        original = db.get(GeoOpportunity, UUID(identity))
        trigger = deepcopy(original.trigger_snapshot)
        trigger["rule_code"] = "OWN_CITATION_LOST"
        new = GeoOpportunity(
            identity_key=sha256(str(uuid4()).encode()).hexdigest(),
            rule_code="OWN_CITATION_LOST",
            priority=original.priority,
            status="OPEN",
            trigger_snapshot=trigger,
            source_date_from=original.source_date_from,
            source_date_to=original.source_date_to,
            subject_id=original.subject_id,
            query_topic_id=original.query_topic_id,
            prompt_variant_id=original.prompt_variant_id,
            collection_profile_id=original.collection_profile_id,
            engine_surface_id=original.engine_surface_id,
            batch_id=original.batch_id,
        )
        db.add(new)
        db.flush()
        for source in db.scalars(
            select(GeoOpportunitySource).where(GeoOpportunitySource.opportunity_id == original.id)
        ):
            db.add(
                GeoOpportunitySource(
                    opportunity_id=new.id,
                    run_id=source.run_id,
                    analysis_revision_id=source.analysis_revision_id,
                    review_id=source.review_id,
                    source_role=source.source_role,
                )
            )
        new_id = str(new.id)
    response = api.engineer.post(f"{PATH}/{new_id}/acknowledge", json={"expected_revision": 1})
    assert response.status_code == 200, response.text
    return new_id
