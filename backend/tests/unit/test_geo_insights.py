"""验证 GEO 洞察筛选不会绕过整次观测的数据完整性。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.schemas.geo_files import GeoInsightCoverageCounts, GeoInsightQuestionCoverage
from app.services.geo_observation import (
    GeoInsightFilters,
    _complete_geo_insight_scope,
    _content_rankings,
    _GeoInsightRow,
    _recommendations,
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
