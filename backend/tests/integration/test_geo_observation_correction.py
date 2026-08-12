"""Frontend V2 GEO 更正上下文与追加命令的 PostgreSQL 集成测试。"""

from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.configuration import PlatformProfile
from app.models.content import ContentTask, ContentVersion
from app.models.geo_files import (
    GeoObservation,
    GeoObservationAttachment,
    GeoObservationPublication,
)
from app.models.identity import User
from app.models.product_facts import FactVersion, Product
from app.models.publication import (
    PlatformAccount,
    PublicationWork,
    PublishedContentIssue,
)
from app.schemas.geo_files import GeoArticleResultCreate, GeoObservationCreate
from app.services.geo_observation import (
    create_geo_observation,
    get_geo_observation_correction_context,
)
from tests.integration.test_geo_observation_detail import _evidence, _statement_count
from tests.integration.test_publication_workflow import (
    _complete_publication,
    _seed_graph,
    temporary_database,
)


def _complete_publication_for_product(
    db: Session,
    graph: dict[str, object],
    *,
    suffix: str,
) -> PublicationWork:
    """为同一产品建立一条独立内容主线并完成发布。"""
    actor = graph["user"]
    product = graph["product"]
    fact = graph["fact"]
    profile = graph["profile"]
    account = graph["account"]
    assert isinstance(actor, User)
    assert isinstance(product, Product)
    assert isinstance(fact, FactVersion)
    assert isinstance(profile, PlatformProfile)
    assert isinstance(account, PlatformAccount)
    task = ContentTask(
        product_id=product.id,
        fact_version_id=fact.id,
        platform_profile_id=profile.id,
        platform_profile_name_snapshot=profile.name,
        platform_website_url_snapshot=profile.website_url,
        created_by=actor.id,
    )
    db.add(task)
    db.flush()
    content = ContentVersion(
        task_id=task.id,
        fact_version_id=fact.id,
        version=1,
        source_type="HUMAN",
        title=f"GEO 更正测试文章 {suffix}",
        summary="冻结事实摘要",
        body_markdown="# GEO 更正测试\n\n独立发布主线。",
        tags=["GEO"],
        content_hash=sha256(suffix.encode()).hexdigest(),
        status="APPROVED",
        quality_issues=[],
        change_summary="GEO 更正集成测试",
        created_by=actor.id,
    )
    db.add(content)
    db.flush()
    task.current_content_version_id = content.id
    db.commit()
    return _complete_publication(
        db,
        {**graph, "task": task, "content": content},
        suffix=suffix,
    )


@pytest.mark.integration
def test_geo_correction_context_and_append_preserve_authoritative_chain() -> None:
    """上下文裁决尾节点与候选，POST 只追加新事实和新证据。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="c" * 64)
            actor = graph["user"]
            product = graph["product"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            assert isinstance(product, Product)
            actor.account_type = "ADMIN"

            retained = _complete_publication(db, graph, suffix="geo-correction-retained")
            removed = _complete_publication_for_product(
                db,
                graph,
                suffix="geo-correction-removed",
            )
            original_evidence = _evidence(
                db,
                actor,
                name="geo-correction-original",
                category="OPERATION_SCREENSHOT",
            )
            original = GeoObservation(
                observation_kind="MANUAL_ARTICLE_SEARCH",
                query_topic_id=None,
                product_id=product.id,
                search_platform="Perplexity",
                search_query="追加式更正测试",
                tested_at=datetime(2026, 8, 10, 8, tzinfo=UTC),
                notes="不可变原始记录",
                tested_by=actor.id,
            )
            constraint_definition = db.scalar(
                text(
                    """
                    SELECT pg_get_constraintdef(oid)
                    FROM pg_constraint
                    WHERE conrelid = 'geo_observations'::regclass
                      AND conname = 'ck_geo_observations_kind_fields'
                    """
                )
            )
            assert isinstance(constraint_definition, str)
            # 0022 的 NOT VALID 约束保留迁移前空 Topic；测试临时复现该历史行。
            db.execute(
                text("ALTER TABLE geo_observations DROP CONSTRAINT ck_geo_observations_kind_fields")
            )
            db.add(original)
            db.flush()
            db.add_all(
                [
                    GeoObservationAttachment(
                        observation_id=original.id,
                        file_id=original_evidence.id,
                    ),
                    GeoObservationPublication(
                        observation_id=original.id,
                        published_article_id=retained.id,
                        discovered=True,
                        mentioned=False,
                        accuracy="PARTIAL",
                    ),
                    GeoObservationPublication(
                        observation_id=original.id,
                        published_article_id=removed.id,
                        discovered=False,
                        mentioned=False,
                        accuracy="UNJUDGEABLE",
                    ),
                    PublishedContentIssue(
                        published_article_id=removed.id,
                        kind="CONTENT_CHANGED",
                        description="文章已退出当前 GEO 候选",
                        status="OPEN",
                        opened_by=actor.id,
                    ),
                ]
            )
            db.commit()
            db.execute(
                text(
                    "ALTER TABLE geo_observations "
                    "ADD CONSTRAINT ck_geo_observations_kind_fields "
                    f"{constraint_definition}"
                )
            )
            db.commit()

            added = _complete_publication_for_product(
                db,
                graph,
                suffix="geo-correction-added",
            )
            context = get_geo_observation_correction_context(db, original.id, actor=actor)
            assert context.detail.selected_observation_id == original.id
            assert context.detail.chain_tail_id == original.id
            assert [item.id for item in context.query_topic_options] == [topic.id]
            results = {
                item.published_article_id: item for item in context.correction_article_results
            }
            assert set(results) == {retained.id, added.id}
            assert (
                results[retained.id].discovered,
                results[retained.id].mentioned,
                results[retained.id].accuracy,
            ) == (True, False, "PARTIAL")
            assert (
                results[added.id].discovered,
                results[added.id].mentioned,
                results[added.id].accuracy,
            ) == (None, None, None)
            assert {
                item.published_article_id
                for item in context.detail.correction_history[0].observation.article_results
            } == {retained.id, removed.id}

            unauthorized = SimpleNamespace(id=actor.id, account_type="VIEWER")
            with pytest.raises(AppError, match="没有执行此操作") as forbidden:
                get_geo_observation_correction_context(
                    db,
                    original.id,
                    actor=unauthorized,  # type: ignore[arg-type]
                )
            assert forbidden.value.status_code == 403

            new_evidence = _evidence(
                db,
                actor,
                name="geo-correction-new",
                category="OPERATION_SCREENSHOT",
            )
            payload = GeoObservationCreate(
                product_id=product.id,
                query_topic_id=topic.id,
                search_platform="Perplexity",
                search_query="追加式更正测试",
                tested_at=datetime(2026, 8, 12, 8, tzinfo=UTC),
                article_results=[
                    GeoArticleResultCreate(
                        published_article_id=retained.id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    ),
                    GeoArticleResultCreate(
                        published_article_id=added.id,
                        discovered=False,
                        mentioned=False,
                        accuracy=None,
                    ),
                ],
                attachment_file_ids=[new_evidence.id],
                notes="本次更正原因",
                supersedes_id=context.detail.chain_tail_id,
            )
            correction = create_geo_observation(
                db=db,
                payload=payload,
                actor=actor,
                request_id="geo-correction-success",
            )

            persisted_original = db.get(GeoObservation, original.id)
            assert persisted_original is not None
            assert persisted_original.notes == "不可变原始记录"
            assert correction.supersedes_id == original.id
            assert db.scalars(
                select(GeoObservationAttachment.file_id).where(
                    GeoObservationAttachment.observation_id == correction.id
                )
            ).all() == [new_evidence.id]
            latest = get_geo_observation_correction_context(db, original.id, actor=actor)
            assert latest.detail.chain_tail_id == correction.id
            assert latest.query_topic_options == []
            assert latest.detail.correction_history[0].evidence[0].file.id == original_evidence.id
            assert latest.detail.correction_history[1].evidence[0].file.id == new_evidence.id

            with pytest.raises(AppError, match="已被纠正") as non_tail:
                create_geo_observation(
                    db=db,
                    payload=payload,
                    actor=actor,
                    request_id="geo-correction-non-tail",
                )
            assert non_tail.value.code == "REVISION_CONFLICT"

            duplicate_evidence = payload.model_copy(
                update={
                    "supersedes_id": correction.id,
                    "attachment_file_ids": [original_evidence.id],
                }
            )
            with pytest.raises(AppError, match="不能重复关联") as reused:
                create_geo_observation(
                    db=db,
                    payload=duplicate_evidence,
                    actor=actor,
                    request_id="geo-correction-reused-evidence",
                )
            assert reused.value.status_code == 422

            changed_platform = payload.model_copy(
                update={
                    "supersedes_id": correction.id,
                    "attachment_file_ids": [],
                    "search_platform": "Google",
                }
            )
            with pytest.raises(AppError, match="不能改变") as frozen:
                create_geo_observation(
                    db=db,
                    payload=changed_platform,
                    actor=actor,
                    request_id="geo-correction-frozen-field",
                )
            assert frozen.value.status_code == 422

            _complete_publication_for_product(
                db,
                graph,
                suffix="geo-correction-stale",
            )
            stale_candidates = payload.model_copy(
                update={
                    "supersedes_id": correction.id,
                    "attachment_file_ids": [],
                }
            )
            with pytest.raises(AppError, match="文章集合已变化") as stale:
                create_geo_observation(
                    db=db,
                    payload=stale_candidates,
                    actor=actor,
                    request_id="geo-correction-stale-candidates",
                )
            assert stale.value.code == "GEO_PUBLICATIONS_CHANGED"
            assert db.scalar(select(func.count(GeoObservation.id))) == 2


@pytest.mark.integration
def test_geo_correction_context_rejects_legacy_observation() -> None:
    """旧模型详情即使完整，也不能进入追加式更正工作台。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="b" * 64)
            actor = graph["user"]
            product = graph["product"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            publication = _complete_publication(db, graph, suffix="geo-correction-legacy")
            legacy = GeoObservation(
                observation_kind="LEGACY_MODEL_RESULT",
                query_topic_id=topic.id,
                product_id=product.id,
                actual_prompt="旧模型问题",
                model_name="ChatGPT",
                model_version="legacy",
                tested_at=datetime(2026, 8, 9, 8, tzinfo=UTC),
                web_search_enabled=True,
                answer_summary="旧模型回答",
                mentioned=True,
                recommendation="RECOMMENDED",
                accuracy="ACCURATE",
                notes="",
                tested_by=actor.id,
            )
            db.add(legacy)
            db.flush()
            db.add(
                GeoObservationPublication(
                    observation_id=legacy.id,
                    published_article_id=publication.id,
                    discovered=None,
                    mentioned=None,
                    accuracy=None,
                )
            )
            db.commit()

            with pytest.raises(AppError, match="旧模型 GEO 观测不能追加更正") as error:
                get_geo_observation_correction_context(db, legacy.id, actor=actor)
            assert error.value.code == "INVALID_STATE_TRANSITION"
            assert error.value.status_code == 409


@pytest.mark.integration
def test_geo_correction_context_query_count_is_independent_of_chain_length() -> None:
    """更正上下文沿用批量详情投影，不按历史节点追加查询。"""
    with temporary_database() as database_url:
        engine = create_engine(database_url)
        with Session(engine, expire_on_commit=False) as db:
            graph = _seed_graph(db, content_hash="e" * 64)
            actor = graph["user"]
            product = graph["product"]
            topic = graph["topic"]
            assert isinstance(actor, User)
            actor.account_type = "ADMIN"
            publication = _complete_publication(db, graph, suffix="geo-correction-count")

            chain: list[GeoObservation] = []
            for index in range(5):
                observation = GeoObservation(
                    observation_kind="MANUAL_ARTICLE_SEARCH",
                    query_topic_id=topic.id,
                    product_id=product.id,
                    search_platform="Perplexity",
                    search_query="固定更正上下文查询次数",
                    tested_at=datetime(2026, 8, 8 + index, 8, tzinfo=UTC),
                    notes="",
                    supersedes_id=chain[-1].id if chain else None,
                    tested_by=actor.id,
                )
                db.add(observation)
                db.flush()
                chain.append(observation)
                db.add(
                    GeoObservationPublication(
                        observation_id=observation.id,
                        published_article_id=publication.id,
                        discovered=True,
                        mentioned=True,
                        accuracy="ACCURATE",
                    )
                )
                db.flush()
                if index == 0:
                    one_node_count = _statement_count(
                        engine,
                        lambda: get_geo_observation_correction_context(
                            db,
                            chain[0].id,
                            actor=actor,
                        ),
                    )
            db.commit()

            five_node_count = _statement_count(
                engine,
                lambda: get_geo_observation_correction_context(
                    db,
                    chain[0].id,
                    actor=actor,
                ),
            )
            assert one_node_count == five_node_count
