"""请求内复用必须保持原有金标、输入守卫和每条引用的规范身份校验。"""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.geo_citation_urls import CitationUrlMemo
from app.schemas.geo_answers import GeoAnswerCitationOut
from app.services.geo_metric_types import MetricCode
from app.services.geo_metrics import calculate_metrics
from tests.unit.geo_metrics_gold import DIMENSIONS, GOLD, SCOPE, gold_runs, observation


def test_batch_metrics_match_independently_counted_gold():
    codes = [MetricCode(row[0]) for row in GOLD if row[0] != "branded_answer"]
    results = calculate_metrics(gold_runs(), metrics=codes, scope=SCOPE, dimensions=DIMENSIONS)
    for code, numerator, denominator, eligible, excluded, unjudgeable in GOLD:
        if code == "branded_answer":
            continue
        result = results[MetricCode(code)]
        assert (result.numerator, result.denominator) == (numerator, denominator)
        assert (result.eligible_run_count, result.excluded_run_count) == (eligible, excluded)
        assert result.unjudgeable_claim_count == unjudgeable


@pytest.mark.parametrize("runs", [[observation(), observation()], [observation(), observation(2,
    run_id=uuid4(), repeat_index=1)]])
def test_batch_metrics_preserve_duplicate_sample_guards(runs):
    with pytest.raises(ValueError):
        calculate_metrics(runs, metrics=[MetricCode.ANSWER_COVERAGE],
                          scope=SCOPE, dimensions=DIMENSIONS)


@pytest.mark.parametrize("patch", [{"hostname": "other.test"}, {"occurrences": [2, 1]},
                                   {"original_url": "https://user:secret@example.test/a"}])
def test_warm_url_memo_cannot_bypass_per_citation_integrity(patch):
    memo = CitationUrlMemo()
    value = {
        "id": uuid4(), "answer_snapshot_id": uuid4(),
        "original_url": "HTTPS://EXAMPLE.TEST:443/a#fragment",
        "normalized_url": "https://example.test/a", "hostname": "example.test",
        "position": 1, "occurrences": [1], "title": None, "extraction_source": "MANUAL",
        "created_at": datetime.now(UTC),
    }
    GeoAnswerCitationOut.model_validate(value, context=memo)
    with pytest.raises(ValidationError):
        GeoAnswerCitationOut.model_validate(value | {"id": uuid4()} | patch, context=memo)
