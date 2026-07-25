"""验证 GEO 洞察筛选不会绕过整次观测的数据完整性。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from app.services.geo_observation import (
    GeoInsightFilters,
    _complete_geo_insight_scope,
    _GeoInsightRow,
)


def _insight_row(
    *,
    observation_id: uuid.UUID,
    publication_record_id: uuid.UUID,
    complete: bool,
) -> _GeoInsightRow:
    return _GeoInsightRow(
        observation_id=observation_id,
        tested_at=datetime(2026, 7, 20, tzinfo=UTC),
        query_topic_id=uuid.UUID("30000000-0000-4000-8000-000000000001"),
        geo_platform="DeepSeek",
        publication_record_id=publication_record_id,
        title="测试内容",
        published_at=datetime(2026, 6, 1, tzinfo=UTC),
        content_platform_id=uuid.UUID("10000000-0000-4000-8000-000000000001"),
        content_platform="工程师社区",
        discovered=True if complete else None,
        mentioned=True if complete else None,
        recommendation_status="RECOMMENDED" if complete else "NOT_RECOMMENDED",
        cited=True if complete else None,
        accuracy="ACCURATE" if complete else None,
    )


def test_content_filter_still_excludes_an_observation_with_an_incomplete_relation() -> None:
    """选中完整文章时，同次观测的另一篇缺失事实仍应排除整次观测。"""
    observation_id = uuid.uuid4()
    selected_publication_id = uuid.uuid4()
    rows = [
        _insight_row(
            observation_id=observation_id,
            publication_record_id=selected_publication_id,
            complete=True,
        ),
        _insight_row(
            observation_id=observation_id,
            publication_record_id=uuid.uuid4(),
            complete=False,
        ),
    ]

    scoped, excluded_observations, excluded_relations = _complete_geo_insight_scope(
        rows,
        GeoInsightFilters(publication_record_id=selected_publication_id),
    )

    assert scoped == []
    assert excluded_observations == 1
    assert excluded_relations == 2
