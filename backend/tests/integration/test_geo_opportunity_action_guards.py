"""704数据库最终归属防线与旧行动删除合同的真实PG反例。"""

from copy import deepcopy
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.errors import AppError
from app.models.geo_opportunities import GeoOpportunity, GeoOpportunityAction
from app.models.identity import User
from app.models.publication import PublicationWork
from app.schemas.content import ContentTaskCreate, ContentTaskPermanentDeleteRequest
from app.schemas.publication import (
    PublishedArticlePermanentDeleteRequest,
    PublishedContentIssueCreate,
)
from app.services import content_planning, publication
from app.services.publication_queries import published_article_deletion_blockers
from tests.integration.geo_opportunity_actions_support import (
    citation_opportunity,
    post,
    publish_task,
    ready,
)
from tests.integration.test_geo_opportunity_workbench import (
    analysis_engine,
    answer_database,
    api,
    detail,
    harness,
    overview_api,
    plan_database,
    review_api,
    run_database,
)

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


def context(api):
    _, _, _, identity, payload = ready(api)
    with api.harness.factory() as db:
        task = content_planning.create_content_task(
            db=db,
            payload=ContentTaskCreate(
                **{k: v for k, v in payload.items() if k != "expected_revision"}
            ),
            actor=db.get(User, api.engineer_id),
            request_id="geo704-original",
            idempotency_key=str(uuid4()),
        )
        task_id = task.id
    article_id = publish_task(api, task_id, payload["fact_version_id"])
    identity = citation_opportunity(api, identity)
    return identity, payload, task_id, article_id


@pytest.mark.parametrize(
    "field", ["product_id", "query_topic_id", "fact_version_id", "platform_profile_id"]
)
def test_direct_sql_issue_snapshot_identity_mismatch_rolls_back(api, field):
    identity, _, _, article_id = context(api)
    result = post(
        api,
        identity,
        "publication-repair",
        {
            "mode": "OPEN_ISSUE",
            "expected_revision": 2,
            "published_article_id": str(article_id),
            "kind": "CONTENT_CHANGED",
            "description": "虚构发布问题",
        },
    )
    assert result.status_code == 200, result.text
    receipt = result.json()
    with api.harness.factory() as db:
        opportunity = db.get(GeoOpportunity, UUID(identity))
        snapshot = deepcopy(receipt["action"]["source_snapshot"])
        snapshot["opportunity_revision"] = opportunity.revision
        snapshot[field] = str(uuid4())
        opportunity.revision += 1
        db.flush()
        db.add(
            GeoOpportunityAction(
                opportunity_id=opportunity.id,
                action_type="PUBLICATION_REPAIR",
                target_type="PublishedContentIssue",
                target_id=UUID(receipt["action"]["target_id"]),
                status_snapshot="OPEN",
                created_by=api.engineer_id,
                source_snapshot=snapshot,
                request_key_sha256="a" * 64,
                request_sha256="b" * 64,
                opportunity_revision_after=opportunity.revision,
            )
        )
        with pytest.raises(IntegrityError) as blocked:
            db.flush()
        assert blocked.value.orig.sqlstate == "23514"
        assert blocked.value.orig.diag.constraint_name == "ck_geo_opportunity_action_target_owner"
        db.rollback()
        assert db.get(GeoOpportunity, UUID(identity)).revision == receipt["opportunity_revision"]
        assert (
            len(
                list(
                    db.scalars(
                        select(GeoOpportunityAction).where(
                            GeoOpportunityAction.opportunity_id == UUID(identity)
                        )
                    )
                )
            )
            == 1
        )


def test_legacy_null_snapshot_issue_target_blocks_preview_and_delete_with_409(api):
    identity, _, _, article_id = context(api)
    with api.harness.factory() as db:
        issue = publication.open_published_content_issue(
            db=db,
            article_id=article_id,
            payload=PublishedContentIssueCreate(kind="CONTENT_CHANGED", description="旧行动问题"),
            actor=db.get(User, api.engineer_id),
            request_id="geo704-legacy",
        )
        # 0059实际可保存的形状，0060加法迁移的保留另由迁移测试验证。
        db.add(
            GeoOpportunityAction(
                opportunity_id=UUID(identity),
                action_type="OTHER",
                target_type="PublishedContentIssue",
                target_id=issue.id,
                status_snapshot="OPEN",
                created_by=api.engineer_id,
            )
        )
        db.commit()
        blockers = published_article_deletion_blockers(db, [article_id])[article_id]
        assert [(b.type, b.count) for b in blockers] == [("GEO_OPPORTUNITY_ACTION", 1)]
        for command in [
            lambda: publication.preview_published_article_permanent_deletion(
                db=db, article_id=article_id
            ),
            lambda: publication.permanently_delete_published_article(
                db=db,
                article_id=article_id,
                payload=PublishedArticlePermanentDeleteRequest(
                    expected_revision=db.get(PublicationWork, article_id).revision,
                    confirmation_text="永久删除",
                ),
                actor=db.get(User, api.harness.database.runs.plan.actor),
                request_id="geo704-legacy-delete",
            ),
        ]:
            with pytest.raises(AppError) as blocked:
                command()
            assert (
                blocked.value.code == "PUBLISHED_ARTICLE_IN_USE"
                and blocked.value.status_code == 409
            )
            db.rollback()
    assert detail(api, identity)["actions"][0]["source_snapshot"] is None


def test_publication_aggregate_permanent_deletion_retains_issue_action_snapshot(api):
    identity, _, task_id, article_id = context(api)
    result = post(
        api,
        identity,
        "publication-repair",
        {
            "mode": "OPEN_ISSUE",
            "expected_revision": 2,
            "published_article_id": str(article_id),
            "kind": "CONTENT_CHANGED",
            "description": "虚构问题",
        },
    )
    assert result.status_code == 200, result.text
    snapshot = result.json()["action"]["source_snapshot"]
    with api.harness.factory() as db:
        from app.models.content import ContentTask

        task = db.get(ContentTask, task_id)
        task = publication.archive_content_task(
            db=db, task_id=task_id, expected_revision=task.revision
        )
        publication.permanently_delete_content_task(
            db=db,
            task_id=task_id,
            payload=ContentTaskPermanentDeleteRequest(
                expected_revision=task.revision, confirmation_text="永久删除"
            ),
            actor=db.get(User, api.harness.database.runs.plan.actor),
            request_id="geo704-issue-root-delete",
        )
    value = detail(api, identity)
    assert value["opportunity"]["status"] == "IN_PROGRESS"
    assert value["actions"][0]["target_available"] is False
    assert value["actions"][0]["source_snapshot"] == snapshot
