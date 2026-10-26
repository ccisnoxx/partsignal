"""CORE-04：真实PG候选、原三个发布行动、历史范围及无读取写入。"""

from uuid import UUID, uuid4

import pytest
from sqlalchemy import event

from app.main import app
from app.models.content import ContentTask
from app.models.geo_opportunities import GeoOpportunityAction
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.models.publication import PublishedArticle, PublishedContentIssue
from app.schemas.content import ContentTaskCreate
from app.schemas.publication import PublishedContentIssueCreate
from app.services import content_planning, publication, publication_queries
from tests.integration.geo_opportunity_actions_support import (
    citation_opportunity,
    count,
    post,
    publish_task,
    ready,
)
from tests.integration.test_geo_opportunity_workbench import (
    PATH,
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
from tests.integration.test_publication_workflow import _complete_publication, _seed_graph
from tests.unit.test_geo_run_contract import contract as contract
from tests.unit.test_geo_run_contract import validate

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


def published(api):
    _, _, _, initial, payload = ready(api)
    with api.harness.factory() as db:
        task = content_planning.create_content_task(
            db=db,
            payload=ContentTaskCreate(
                **{k: v for k, v in payload.items() if k != "expected_revision"}
            ),
            actor=db.get(User, api.engineer_id),
            request_id="core04-source",
            idempotency_key=str(uuid4()),
        )
        task_id = task.id
    return (
        citation_opportunity(api, initial),
        payload,
        publish_task(api, task_id, payload["fact_version_id"]),
        initial,
    )


def options(api, identity, mode="OPEN_ISSUE", **query):
    result = api.engineer.get(
        f"{PATH}/{identity}/publication-repair-options", params={"mode": mode, **query}
    )
    assert result.status_code == 200, result.text
    assert result.headers["Cache-Control"] == "no-store"
    return result.json()


def counts(api):
    with api.harness.factory() as db:
        return tuple(
            count(db, model)
            for model in (
                ContentTask,
                FactVersion,
                PublishedArticle,
                PublishedContentIssue,
                GeoOpportunityAction,
            )
        )


def test_read_only_snapshot_and_three_original_commands_preserve_publication_history(api, contract):
    identity, payload, article, _ = published(api)
    before = counts(api)
    source_article = api.engineer.get(f"/api/v1/published-articles/{article}").json()
    statements, levels = [], []

    def capture(conn, _cursor, sql, _params, _context, _many):
        statements.append(sql)
        levels.append(conn.get_isolation_level())

    engine = api.harness.factory.kw["bind"]
    event.listen(engine, "before_cursor_execute", capture)
    try:
        read = options(api, identity)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert statements and all(sql.lstrip().startswith("SELECT") for sql in statements)
    assert all(level == "REPEATABLE READ" for level in levels)
    assert counts(api) == before
    for document in (contract, app.openapi()):
        validate(document, "GeoOpportunityPublicationRepairOptions", read)
    assert read["available_action_types"] == ["PUBLICATION_REPAIR"]
    assert read["total"] == 1 and read["candidates"][0]["published_article_id"] == str(article)
    assert read["candidates"][0]["available"] is True
    opened_payload = {
        "mode": "OPEN_ISSUE",
        "expected_revision": read["opportunity_revision"],
        "published_article_id": str(article),
        "kind": "CONTENT_CHANGED",
        "description": "CORE-04 私有问题描述",
    }
    opened = post(api, identity, "publication-repair", opened_payload, "core04-open").json()
    issue_id = opened["action"]["target_id"]
    link_options = options(api, identity, "LINK_ISSUE")
    chosen = link_options["candidates"][0]
    assert chosen["published_content_issue_id"] == issue_id and chosen["available"]
    link_payload = {
        "mode": "LINK_ISSUE",
        "expected_revision": link_options["opportunity_revision"],
        "published_content_issue_id": issue_id,
        "expected_issue_revision": chosen["issue_revision"],
    }
    linked = post(api, identity, "publication-repair", link_payload, "core04-link")
    assert linked.status_code == 200, linked.text
    context_options = options(api, identity, "CREATE_REPAIR", selected_issue_id=issue_id)
    context = context_options["repair_context"]
    assert context["issue"]["id"] == issue_id and context["article"]["id"] == str(article)
    assert payload["fact_version_id"] in {
        item["version"]["id"] for item in context["fact_candidates"]
    }
    repair_payload = link_payload | {
        "mode": "CREATE_REPAIR",
        "expected_revision": context_options["opportunity_revision"],
        "fact_version_id": payload["fact_version_id"],
    }
    repaired = post(api, identity, "publication-repair", repair_payload, "core04-repair")
    assert repaired.status_code == 200, repaired.text
    receipt = repaired.json()
    assert receipt["action"]["target_type"] == "ContentTask"
    assert receipt["action"]["source_snapshot"]["published_article_id"] == str(article)
    assert receipt["action"]["source_snapshot"]["published_content_issue_id"] == issue_id
    for request, key in (
        (opened_payload, "core04-open"),
        (link_payload, "core04-link"),
        (repair_payload, "core04-repair"),
    ):
        replay = post(api, identity, "publication-repair", request, key)
        assert replay.status_code == 200 and replay.json()["replayed"]
    assert counts(api) == (before[0] + 1, before[1], before[2], before[3] + 1, before[4] + 3)
    with api.harness.factory() as db:
        task = db.get(ContentTask, UUID(receipt["action"]["target_id"]))
        assert str(task.product_id) == payload["product_id"]
        assert str(task.platform_profile_id) == payload["platform_profile_id"]
        assert str(task.source_published_content_issue_id) == issue_id
        assert task.status == "OPEN" and task.current_content_version_id is None
        assert db.get(PublishedContentIssue, UUID(issue_id)).status == "OPEN"
    after = api.engineer.get(f"/api/v1/published-articles/{article}").json()
    for field in (
        "source_content",
        "verification",
        "content_hash",
        "actual_title",
        "final_url",
        "events",
    ):
        assert after[field] == source_article[field]
    assert len(detail(api, identity)["actions"]) == 3


def test_scope_pagination_context_and_auth_do_not_expand_to_unrelated_products(api):
    identity, _, article, initial = published(api)
    with api.harness.factory() as db:
        graph = _seed_graph(db, content_hash="f" * 64)
        other = _complete_publication(db, graph, suffix="core04-unrelated")
        issue = publication.open_published_content_issue(
            db=db,
            article_id=other.id,
            payload=PublishedContentIssueCreate(kind="OTHER", description="范围外"),
            actor=db.get(User, api.engineer_id),
            request_id="core04-unrelated",
        )
        other_id, issue_id = other.id, issue.id
        all_articles = publication_queries.list_published_articles(db, page=1, page_size=50)
        assert {str(article), str(other_id)}.issubset({str(item.id) for item in all_articles.items})
    page1 = options(api, identity, page_size=1)
    assert page1["total"] == 1 and len(page1["candidates"]) == 1
    assert options(api, identity, page=2, page_size=1)["candidates"] == []
    assert options(api, identity, "LINK_ISSUE")["total"] == 0
    assert (
        api.engineer.get(
            f"{PATH}/{identity}/publication-repair-options",
            params={"mode": "CREATE_REPAIR", "selected_issue_id": str(issue_id)},
        ).status_code
        == 422
    )
    before = counts(api)
    rejected = post(
        api,
        identity,
        "publication-repair",
        {
            "mode": "LINK_ISSUE",
            "expected_revision": page1["opportunity_revision"],
            "published_content_issue_id": str(issue_id),
            "expected_issue_revision": 0,
        },
    )
    assert rejected.status_code == 422 and counts(api) == before
    assert options(api, initial)["available_action_types"] == []
    assert api.anonymous.get(f"{PATH}/{identity}/publication-repair-options").status_code == 401
    assert api.engineer.get(f"{PATH}/{uuid4()}/publication-repair-options").status_code == 404
    for params in ({"page_size": 51}, {"mode": "INVALID"}, {"selected_issue_id": str(issue_id)}):
        assert (
            api.engineer.get(
                f"{PATH}/{identity}/publication-repair-options", params=params
            ).status_code
            == 422
        )


def test_domain_eligibility_existing_repair_and_retired_article_remain_visible_but_disabled(api):
    identity, payload, article, _ = published(api)
    opened = post(
        api,
        identity,
        "publication-repair",
        {
            "mode": "OPEN_ISSUE",
            "expected_revision": 2,
            "published_article_id": str(article),
            "kind": "OTHER",
            "description": "页面变化",
        },
    ).json()
    issue_id = opened["action"]["target_id"]
    assert options(api, identity)["candidates"][0]["available"] is False
    create = post(
        api,
        identity,
        "publication-repair",
        {
            "mode": "CREATE_REPAIR",
            "expected_revision": 3,
            "published_content_issue_id": issue_id,
            "expected_issue_revision": 0,
            "fact_version_id": payload["fact_version_id"],
        },
    )
    assert create.status_code == 200, create.text
    assert options(api, identity, "CREATE_REPAIR")["candidates"][0]["available"] is False
    assert options(api, identity, "LINK_ISSUE")["candidates"][0]["available"] is True
    resolved = api.engineer.post(
        f"/api/v1/published-content-issues/{issue_id}/resolve",
        json={"expected_revision": 0, "outcome": "RETIRED", "comment": "人工决定退役"},
    )
    assert resolved.status_code == 200, resolved.text
    assert options(api, identity)["candidates"][0]["available"] is False
    assert options(api, identity, "LINK_ISSUE")["candidates"] == []
