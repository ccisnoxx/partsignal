"""验证 GEO 洞察筛选不会绕过整次观测的数据完整性。"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy.orm import Session

from app.errors import AppError
from app.models.content import ContentTask, ContentTaskGeoSource
from app.models.identity import User
from app.models.product_facts import FactVersion
from app.models.publication import PublicationWork, PublishedArticle
from app.schemas.geo_files import (
    GeoInsightCoverageCounts,
    GeoInsightDeclineBasis,
    GeoInsightDecliningContent,
    GeoInsightQuestionCoverage,
    GeoInsightRateValue,
    GeoOptimizationContentTaskCreate,
)
from app.services import geo_observation
from app.services.geo_observation import (
    GeoInsightFilters,
    _complete_geo_insight_scope,
    _content_rankings,
    _GeoInsightRow,
    _recommendations,
    create_geo_optimization_content_task,
)


def _insight_row(
    *,
    observation_id: uuid.UUID,
    published_article_id: uuid.UUID,
    complete: bool,
    accuracy: str | None = None,
) -> _GeoInsightRow:
    return _GeoInsightRow(
        observation_id=observation_id,
        tested_at=datetime(2026, 7, 20, tzinfo=UTC),
        query_topic_id=uuid.UUID("30000000-0000-4000-8000-000000000001"),
        product_id=uuid.UUID("20000000-0000-4000-8000-000000000001"),
        geo_platform="DeepSeek",
        published_article_id=published_article_id,
        title="测试内容",
        published_at=datetime(2026, 6, 1, tzinfo=UTC),
        content_platform_id=uuid.UUID("10000000-0000-4000-8000-000000000001"),
        content_platform="工程师社区",
        discovered=True if complete else None,
        mentioned=False if complete else None,
        accuracy=accuracy,
    )


def test_content_filter_still_excludes_an_observation_with_an_incomplete_relation() -> None:
    """选中完整文章时，同次观测的另一篇缺失事实仍应排除整次观测。"""
    observation_id = uuid.uuid4()
    selected_publication_id = uuid.uuid4()
    rows = [
        _insight_row(
            observation_id=observation_id,
            published_article_id=selected_publication_id,
            complete=True,
        ),
        _insight_row(
            observation_id=observation_id,
            published_article_id=uuid.uuid4(),
            complete=False,
        ),
    ]

    scoped, excluded_observations, excluded_relations = _complete_geo_insight_scope(
        rows,
        GeoInsightFilters(published_article_id=selected_publication_id),
    )

    assert scoped == []
    assert excluded_observations == 1
    assert excluded_relations == 2


def test_unknown_accuracy_does_not_create_a_false_decline() -> None:
    """准确率没有可判断分母时，不得补零并生成内容或平台下降建议。"""
    publication_id = uuid.uuid4()
    current = [
        _insight_row(
            observation_id=uuid.uuid4(),
            published_article_id=publication_id,
            complete=True,
        )
        for _ in range(3)
    ]
    previous = [
        _insight_row(
            observation_id=uuid.uuid4(),
            published_article_id=publication_id,
            complete=True,
            accuracy="ACCURATE",
        )
        for _ in range(3)
    ]
    unavailable = []
    current_date = datetime(2026, 7, 20, tzinfo=UTC).date()
    rankings = _content_rankings(
        current,
        previous,
        [],
        current_from=current_date,
        current_to=current_date,
        unavailable=unavailable,
    )
    coverage = GeoInsightQuestionCoverage(
        by_status=GeoInsightCoverageCounts(
            stable=0,
            occasional=0,
            uncovered=0,
            insufficient_data=0,
        ),
        matrix=[],
    )

    assert rankings.declining == []
    assert not {
        item.rule_code for item in _recommendations(current, previous, rankings, coverage)
    } & {"CONTENT_PERFORMANCE_DECLINE", "GEO_PLATFORM_PERFORMANCE_DECLINE"}


def test_best_content_does_not_rank_unknown_accuracy_as_zero() -> None:
    """有判断的零准确率仍应排在准确性未知之前，未知值不能参与数值比较。"""
    unknown_id = uuid.UUID(int=1)
    judged_id = uuid.UUID(int=2)
    rows = [
        *[
            _insight_row(
                observation_id=uuid.uuid4(),
                published_article_id=unknown_id,
                complete=True,
            )
            for _ in range(3)
        ],
        *[
            _insight_row(
                observation_id=uuid.uuid4(),
                published_article_id=judged_id,
                complete=True,
                accuracy="INCORRECT",
            )
            for _ in range(3)
        ],
    ]
    current_date = datetime(2026, 7, 20, tzinfo=UTC).date()

    rankings = _content_rankings(
        rows,
        [],
        [],
        current_from=current_date,
        current_to=current_date,
        unavailable=[],
    )

    assert [item.published_article_id for item in rankings.best] == [judged_id, unknown_id]


class _GeoCommandSession:
    """为优化任务命令保留精确所有者读取与原子写入语义。"""

    def __init__(self, rows: dict[type[object], object]) -> None:
        self.rows = rows
        self.added: list[object] = []
        self.committed = False

    def get(self, model: type[object], _identity: object) -> object | None:
        return self.rows.get(model)

    def scalar(self, _statement: object) -> None:
        return None

    def add(self, value: object) -> None:
        self.added.append(value)

    def commit(self) -> None:
        self.committed = True


def test_geo_optimization_recomputes_and_freezes_authoritative_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """客户端只提交异常身份，来源指标必须来自服务端当前洞察。"""
    article_id = uuid.uuid4()
    task_id = uuid.uuid4()
    product_id = uuid.uuid4()
    platform_id = uuid.uuid4()
    fact_id = uuid.uuid4()
    actor_id = uuid.uuid4()
    rate = GeoInsightRateValue(numerator=1, denominator=3, value=1 / 3)
    decline = GeoInsightDecliningContent(
        published_article_id=article_id,
        product_id=product_id,
        content_platform_id=platform_id,
        title="下降内容",
        content_platform="工程师社区",
        observation_count=3,
        discovery_rate=rate,
        mention_rate=rate,
        accuracy_rate=rate,
        primary_task="CREATE_OPTIMIZATION_TASK",
        basis=[
            GeoInsightDeclineBasis(
                metric="mention_rate",
                current_value=1 / 3,
                previous_value=1.0,
                decline=2 / 3,
            )
        ],
    )
    insights = SimpleNamespace(
        content_rankings=SimpleNamespace(declining=[decline], long_unmentioned=[]),
        question_coverage=SimpleNamespace(matrix=[]),
    )
    source_task = SimpleNamespace(product_id=product_id, platform_profile_id=platform_id)
    session = _GeoCommandSession(
        {
            PublishedArticle: SimpleNamespace(id=article_id),
            PublicationWork: SimpleNamespace(content_task_id=uuid.uuid4()),
            ContentTask: source_task,
            FactVersion: SimpleNamespace(
                id=fact_id,
                product_id=product_id,
                status="APPROVED",
            ),
        }
    )
    created_task = SimpleNamespace(id=task_id)
    monkeypatch.setattr(geo_observation, "get_geo_insights", lambda *_args, **_kwargs: insights)
    monkeypatch.setattr(
        geo_observation,
        "create_content_task",
        lambda **_kwargs: created_task,
    )

    result = create_geo_optimization_content_task(
        db=cast(Session, session),
        payload=GeoOptimizationContentTaskCreate(
            rule_code="CONTENT_DECLINE",
            date_from=date(2026, 7, 1),
            date_to=date(2026, 7, 31),
            published_article_id=article_id,
            product_id=product_id,
            platform_profile_id=platform_id,
            fact_version_id=fact_id,
        ),
        actor=cast(User, SimpleNamespace(id=actor_id)),
        request_id="geo-optimization",
        idempotency_key="geo-optimization-key",
    )

    assert result is created_task
    source = next(item for item in session.added if isinstance(item, ContentTaskGeoSource))
    assert source.content_task_id == task_id
    assert source.basis_snapshot["rule_code"] == "CONTENT_DECLINE"
    assert source.basis_snapshot["item"]["published_article_id"] == str(article_id)
    assert session.committed


def test_geo_optimization_rejects_stale_client_anomaly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """复算后不再可见的异常必须显式失败，不接受客户端指标兜底。"""
    monkeypatch.setattr(
        geo_observation,
        "get_geo_insights",
        lambda *_args, **_kwargs: SimpleNamespace(
            content_rankings=SimpleNamespace(declining=[], long_unmentioned=[]),
            question_coverage=SimpleNamespace(matrix=[]),
        ),
    )
    with pytest.raises(AppError) as captured:
        create_geo_optimization_content_task(
            db=cast(Session, object()),
            payload=GeoOptimizationContentTaskCreate(
                rule_code="CONTENT_DECLINE",
                date_from=date(2026, 7, 1),
                date_to=date(2026, 7, 31),
                published_article_id=uuid.uuid4(),
                product_id=uuid.uuid4(),
                platform_profile_id=uuid.uuid4(),
                fact_version_id=uuid.uuid4(),
            ),
            actor=cast(Any, SimpleNamespace(id=uuid.uuid4())),
            request_id="geo-stale",
            idempotency_key="geo-stale-key",
        )

    assert captured.value.code == "GEO_INSIGHT_STALE"
