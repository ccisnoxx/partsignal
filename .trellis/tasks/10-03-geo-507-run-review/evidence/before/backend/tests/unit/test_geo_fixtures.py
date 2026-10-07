"""共享 GEO 文件合同、证据关系、隐私边界与最小加载测试。"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from geo_fixtures import VERSION_ROOT, GeoFixtureError, load_geo_fixtures, validate_geo_fixtures


def test_load_shared_corpus_and_gold_without_losing_evidence() -> None:
    bundle = load_geo_fixtures()
    corpus, gold = bundle["corpus"], bundle["gold"]
    assert corpus["fixture_version"] == gold["fixture_version"] == "1.0.0"
    assert all(fact["classification"] == "PUBLIC" for fact in corpus["fact_versions"])
    answers = {answer["id"]: answer for answer in corpus["answers"]}
    cases = {case["id"]: case for case in gold["cases"]}
    assert answers["answer-exact-model"]["web_search_observed"] is None
    assert [
        citation["position"]
        for citation in corpus["citations"]
        if citation["answer_id"] == "answer-exact-model"
    ] == [1, 2]
    expected = cases["gold-unordered-recommendation"]["expected"]
    assert [row["rank"] for row in expected["recommendations"]] == [None, None]
    assert expected["review_required_reasons"] == ["unreliable_rank"]
    assert cases["gold-insufficient-facts"]["expected"]["claims"][0]["verdict"] == "UNJUDGEABLE"
    assert cases["gold-ambiguous-brand"]["expected"]["mentions"][0]["mentioned"] is None
    assert {case["category"] for case in gold["cases"]} >= {
        "exact_model", "model_suffix", "case_and_hyphen", "ambiguous_alias",
        "negated_mention", "listed_without_recommendation", "ordered_recommendation",
        "unordered_recommendation", "conditional_replacement", "parameter_conflict",
        "insufficient_facts", "prompt_injection", "mixed_language",
    }


def test_loads_are_independent() -> None:
    first, second = load_geo_fixtures(), load_geo_fixtures()
    first["corpus"]["answers"][0]["text"] = "局部测试修改"
    first["gold"]["cases"].clear()
    assert second == load_geo_fixtures()


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("corpus", "fixture_version"), "2.0.0"),
        (("gold", "gold_version"), "2.0.0"),
        (("corpus", "synthetic"), False),
        (("corpus", "fact_versions", 0, "classification"), "INTERNAL"),
        (("corpus", "answers", 0, "text"), "  "),
        (("corpus", "answers", 0, "captured_at"), "2026-01-15"),
        (("corpus", "answers", 0, "question_id"), "question-missing"),
        (("corpus", "products", 1, "id"), "product-base"),
        (("gold", "cases", 0, "expected", "mentions", 0, "excerpt"), "不在原回答中"),
        (("gold", "cases", 0, "expected", "claims", 0, "fact_version_id"), "fact-suffix-v1"),
        (("gold", "cases", 0, "expected", "claims", 0, "fact_version_id"), None),
        (("gold", "cases", 0, "expected", "citations", 0, "citation_id"), "citation-media"),
        (("gold", "cases", 0, "expected", "citations"), []),
        (("corpus", "citations", 1, "position"), 1),
    ],
)
def test_rejects_format_drift_and_broken_evidence(path: tuple[Any, ...], value: Any) -> None:
    bundle = load_geo_fixtures()
    owner = bundle
    for key in path[:-1]:
        owner = owner[key]
    owner[path[-1]] = value
    with pytest.raises(GeoFixtureError):
        validate_geo_fixtures(bundle)


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/fixture",
        "http://geo-fixture-owned.test/fixture",
        "https://geo-fixture-owned.test:443/fixture",
        "https://user@geo-fixture-owned.test/fixture",
        "https://geo-fixture-owned.test/fixture?token=fixture-marker",
        "https://geo-fixture-owned.test.evil.test/fixture",
        "file:///tmp/fixture",
    ],
)
def test_rejects_non_fixture_urls_without_echoing_them(url: str) -> None:
    bundle = load_geo_fixtures()
    bundle["corpus"]["citations"][0]["url"] = url
    with pytest.raises(GeoFixtureError) as error:
        validate_geo_fixtures(bundle)
    assert url not in str(error.value)


@pytest.mark.parametrize("marker", ["Authorization: fixture-marker", "Cookie: fixture-marker"])
def test_scans_prose_and_markdown_without_echoing_sensitive_markers(marker: str) -> None:
    bundle = load_geo_fixtures()
    bundle["corpus"]["fact_versions"][0]["markdown"] += "\n" + marker
    with pytest.raises(GeoFixtureError) as error:
        validate_geo_fixtures(bundle)
    assert marker not in str(error.value)


def test_rejects_extra_fields_missing_gold_and_bad_json(tmp_path: Path) -> None:
    bundle = load_geo_fixtures()
    bundle["corpus"]["answers"][0]["unexpected-sensitive-field"] = "fixture-marker"
    with pytest.raises(GeoFixtureError) as error:
        validate_geo_fixtures(bundle)
    assert "fixture-marker" not in str(error.value)
    assert "unexpected-sensitive-field" not in str(error.value)
    bundle = load_geo_fixtures()
    bundle["gold"]["cases"].pop()
    with pytest.raises(GeoFixtureError):
        validate_geo_fixtures(bundle)
    with pytest.raises(GeoFixtureError):
        load_geo_fixtures(tmp_path)
    (tmp_path / "corpus.json").write_text("{", encoding="utf-8")
    with pytest.raises(GeoFixtureError):
        load_geo_fixtures(tmp_path)


def test_cli_loads_from_a_different_working_directory(tmp_path: Path) -> None:
    repo = VERSION_ROOT.parents[4]
    result = subprocess.run(
        [sys.executable, str(repo / "deploy" / "scripts" / "check-geo-fixtures.py")],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "外部调用=0" in result.stdout
    assert "GEOFX-731Q" not in result.stdout
