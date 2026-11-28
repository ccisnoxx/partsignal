"""Slice 1C 单元测试：URL 抽取、追踪参数剥离、第三方 UGC 域名防误伤与核心基线指标隔离。"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from app.schemas.configuration import IntentType
from app.schemas.geo_runs import GeoRunStatus
from app.services.geo_citation_matching import (
    extract_urls_from_text,
    is_third_party_ugc_host,
    match_url_against_publications,
    strip_tracking_params,
)
from app.services.geo_metric_types import MetricCode, MetricDimensions, MetricRun, MetricScope
from app.services.geo_metrics import metric_eligibility


def _fake_pub(normalized_url: str, hostname: str, title: str = "选型指南") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        normalized_url=normalized_url,
        hostname=hostname,
        actual_title=title,
        platform_name_snapshot="知乎" if "zhihu" in hostname else "官网",
    )


def test_extract_urls_and_strip_tracking_params() -> None:
    text = (
        "参考文章：https://zhuanlan.zhihu.com/p/123456?utm_source=doubao&spm=1.2），"
        "以及 https://docs.partsignal.com/guide/opa2333。"
    )
    urls = extract_urls_from_text(text)
    assert urls == [
        "https://zhuanlan.zhihu.com/p/123456?utm_source=doubao&spm=1.2",
        "https://docs.partsignal.com/guide/opa2333",
    ]
    assert (
        strip_tracking_params("https://zhuanlan.zhihu.com/p/123456?utm_source=doubao&spm=1.2")
        == "https://zhuanlan.zhihu.com/p/123456"
    )
    assert (
        strip_tracking_params("https://mp.weixin.qq.com/s?__biz=MzA=&mid=123&chksm=abc&from=single")
        == "https://mp.weixin.qq.com/s?__biz=MzA%3D&mid=123"
    )


def test_tiered_citation_matching_never_treats_ugc_same_domain_as_owned() -> None:
    assert is_third_party_ugc_host("zhuanlan.zhihu.com") is True
    assert is_third_party_ugc_host("mp.weixin.qq.com") is True
    assert is_third_party_ugc_host("docs.partsignal.com") is False

    zhihu_pub = _fake_pub("https://zhuanlan.zhihu.com/p/1001", "zhuanlan.zhihu.com", "知乎主稿")
    own_pub = _fake_pub("https://docs.partsignal.com/opa", "docs.partsignal.com", "官网选型")
    pubs = [(zhihu_pub, "低功耗运放指南"), (own_pub, "低功耗运放指南")]

    # 1. 精确 URL -> AUTO_EXACT
    exact = match_url_against_publications(
        "https://zhuanlan.zhihu.com/p/1001", "zhuanlan.zhihu.com", pubs  # type: ignore[arg-type]
    )
    assert exact is not None
    assert exact.link_status.value == "AUTO_EXACT"
    assert exact.match_method.value == "EXACT_NORMALIZED_URL"

    # 2. 带追踪参数 URL -> CANDIDATE（绝不自动生效）
    tracked = match_url_against_publications(
        "https://zhuanlan.zhihu.com/p/1001?utm_source=yuanbao",
        "zhuanlan.zhihu.com",
        pubs,  # type: ignore[arg-type]
    )
    assert tracked is not None
    assert tracked.link_status.value == "CANDIDATE"
    assert tracked.match_method.value == "STRIPPED_TRACKING_CANDIDATE"

    # 3. 同一知乎域名下的他人文章 -> 不得产生同域名候选，严禁误伤
    other_zhihu = match_url_against_publications(
        "https://zhuanlan.zhihu.com/p/9999999",
        "zhuanlan.zhihu.com",
        pubs,  # type: ignore[arg-type]
    )
    assert other_zhihu is None

    # 4. 非 UGC 自有域名下的其他页面 -> SAME_DOMAIN_CANDIDATE（仍需人工确认）
    same_own = match_url_against_publications(
        "https://docs.partsignal.com/other-page",
        "docs.partsignal.com",
        pubs,  # type: ignore[arg-type]
    )
    assert same_own is not None
    assert same_own.link_status.value == "CANDIDATE"
    assert same_own.match_method.value == "SAME_DOMAIN_CANDIDATE"


def test_metrics_exclude_brand_model_article_lookup_and_query_modified() -> None:
    sub_id = uuid4()

    def make_run(prompt_category: str, query_modified: bool) -> MetricRun:
        dims = MetricDimensions(
            query_topic_id=uuid4(),
            query_topic_revision=1,
            prompt_variant_id=uuid4(),
            prompt_revision=1,
            collection_profile_id=uuid4(),
            profile_revision=1,
            engine_surface_id=uuid4(),
            surface_revision=1,
            collection_mode="MANUAL",
            language_code="zh-cn",
            region_code="CN",
            login_state="ANONYMOUS",
            mention_mode="UNBRANDED" if prompt_category != "BRAND_MODEL" else "BRANDED",
            intent_type=IntentType.PRODUCT,
            source_model=None,
            source_product=None,
            model_version=None,
            product_version=None,
            rule_set_version="v1",
            analysis_configuration_key="det",
            subject_versions=((sub_id, 1),),
            fact_version_bindings=(),
            window_key=datetime.now(UTC).strftime("%Y-%m-%d"),
            prompt_category=prompt_category,
        )
        return MetricRun(
            run_id=uuid4(),
            batch_id=uuid4(),
            repeat_index=1,
            dimensions=dims,
            status=GeoRunStatus.COMPLETED,
            answer_present=True,
            current_analysis_available=True,
            review_required=False,
            current_review_valid=True,
            integrity_valid=True,
            administrator_excluded=False,
            superseded_attempt=False,
            applicable_subject_ids=frozenset({sub_id}),
            subjects=(),
            citations=(),
            claims=(),
            citation_observation_status=None,
            citation_absence_observable=False,
            citation_classification_complete=True,
            query_modified=query_modified,
        )

    scope = MetricScope(subject_id=sub_id)
    ok = make_run("NATURAL_DEMAND", False)
    assert metric_eligibility(
        ok, metric=MetricCode.NATURAL_VISIBILITY, scope=scope, dimensions=ok.dimensions
    ).eligible

    for bad in (
        make_run("BRAND_MODEL", False),
        make_run("ARTICLE_LOOKUP", False),
        make_run("NATURAL_DEMAND", True),
    ):
        elig = metric_eligibility(
            bad, metric=MetricCode.NATURAL_VISIBILITY, scope=scope, dimensions=bad.dimensions
        )
        assert not elig.eligible
