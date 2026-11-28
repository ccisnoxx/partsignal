"""Slice 3D：SSRF 安全校验、公开 HTML 解析与三档健康分类单元测试。"""

from __future__ import annotations

import pytest

from app.services.page_health_checks import classify_public_page_health
from app.services.page_health_fetcher import (
    PageFetchResult,
    _build_pinned_request_url,
    _decode_html_bytes,
    _is_supported_text_content_type,
    parse_public_html,
    validate_public_http_url,
)


@pytest.mark.parametrize(
    "bad_url",
    [
        "http://127.0.0.1/admin",
        "http://localhost/secret",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.8/internal",
        "http://100.64.0.1/cgnat",
        "http://[::1]/loopback",
        "http://[::ffff:127.0.0.1]/mapped",
        "https://[64:ff9b::a9fe:a9fe]/nat64-metadata",
        "https://[2001::1]/teredo",
        "https://[2002:c0a8:0101::1]/sixtofour",
        "https://user:pass@example.com/page",
        "https://example.com:8080/internal-port",
        "https://example.com:5432/pg",
        "ftp://example.com/file",
        "file:///etc/passwd",
    ],
)
def test_ssrf_blocks_non_public_targets_and_ports(bad_url: str) -> None:
    with pytest.raises(ValueError) as exc:
        validate_public_http_url(bad_url, resolve_host=lambda _h, _p: ["93.184.216.34"])
    assert str(exc.value) == "SSRF_BLOCKED"


def test_ssrf_blocks_dns_resolving_to_private_or_mixed_ip() -> None:
    with pytest.raises(ValueError) as exc:
        validate_public_http_url(
            "https://rebind.example.com/article",
            resolve_host=lambda _h, _p: ["93.184.216.34", "192.168.1.10"],
        )
    assert str(exc.value) == "SSRF_BLOCKED"

    url, host, port, pinned = validate_public_http_url(
        "https://zhuanlan.zhihu.com/p/12345",
        resolve_host=lambda _h, _p: ["93.184.216.34"],
    )
    assert url == "https://zhuanlan.zhihu.com/p/12345"
    assert host == "zhuanlan.zhihu.com"
    assert port == 443
    assert pinned == "93.184.216.34"


def test_parse_public_html_and_three_tier_classification() -> None:
    html = (
        "<html><head>"
        "<title>TPS5430 工业降压芯片选型指南 - 知乎</title>"
        '<meta name="robots" content="index, follow" />'
        '<link rel="canonical" href="https://zhuanlan.zhihu.com/p/123" />'
        "<script>var hidden = 'should not appear';</script>"
        "</head><body>"
        "<p>在工业 24V 电源设计中，TPS5430 支持 5.5V-36V 输入电压与 3A 连续输出电流，"
        "需结合板级温升与电感饱和电流余量完成实验室验证，切勿未经验证直接替代原厂器件。</p>"
        "</body></html>"
    )
    title, body_text, has_noindex, canonical, waf = parse_public_html(
        html, final_url="https://zhuanlan.zhihu.com/p/123"
    )
    assert title == "TPS5430 工业降压芯片选型指南 - 知乎"
    assert "should not appear" not in body_text
    assert has_noindex is False
    assert canonical == "https://zhuanlan.zhihu.com/p/123"
    assert waf is False

    healthy = classify_public_page_health(
        PageFetchResult(
            checked_url="https://zhuanlan.zhihu.com/p/123",
            final_url="https://zhuanlan.zhihu.com/p/123",
            http_status=200,
            page_title=title,
            body_text=body_text,
            has_noindex=has_noindex,
            canonical_url=canonical,
        ),
        expected_title="TPS5430 工业降压芯片选型指南",
        expected_body_text=body_text,
        allowed_domains=["zhihu.com"],
    )
    assert healthy.status == "HEALTHY"
    assert healthy.title_matches is True
    assert healthy.canonical_matches is True

    # 403/429/5xx/WAF/SSRF 全部归入 FETCH_BLOCKED（仅告警，绝不自动建单）
    for blocked_res in (
        PageFetchResult(checked_url="https://zhuanlan.zhihu.com/p/123", http_status=403),
        PageFetchResult(checked_url="https://zhuanlan.zhihu.com/p/123", http_status=429),
        PageFetchResult(checked_url="https://zhuanlan.zhihu.com/p/123", http_status=503),
        PageFetchResult(
            checked_url="https://zhuanlan.zhihu.com/p/123",
            http_status=200,
            waf_or_login_blocked=True,
        ),
        PageFetchResult(
            checked_url="https://zhuanlan.zhihu.com/p/123", fetch_error_code="SSRF_BLOCKED"
        ),
    ):
        cls = classify_public_page_health(
            blocked_res,
            expected_title="TPS5430",
            expected_body_text=body_text,
            allowed_domains=["zhihu.com"],
        )
        assert cls.status == "FETCH_BLOCKED"

    # 404 / noindex / canonical 劫持 / 正文剧变 -> CONFIRMED_ANOMALY
    gone = classify_public_page_health(
        PageFetchResult(checked_url="https://zhuanlan.zhihu.com/p/123", http_status=404),
        expected_title="TPS5430",
        expected_body_text=body_text,
        allowed_domains=["zhihu.com"],
    )
    assert gone.status == "CONFIRMED_ANOMALY"
    assert "HTTP_GONE_OR_NOT_FOUND" in gone.anomaly_reasons

    hijacked = classify_public_page_health(
        PageFetchResult(
            checked_url="https://zhuanlan.zhihu.com/p/123",
            final_url="https://zhuanlan.zhihu.com/p/123",
            http_status=200,
            page_title="完全无关的广告落地页",
            body_text="欢迎选购夏季新款运动鞋限时折扣全场包邮满减优惠券点击立即领取" * 5,
            has_noindex=True,
            canonical_url="https://hijack.evil.example/spam",
        ),
        expected_title="TPS5430 工业降压芯片选型指南",
        expected_body_text=body_text,
        allowed_domains=["zhihu.com"],
    )
    assert hijacked.status == "CONFIRMED_ANOMALY"
    assert set(hijacked.anomaly_reasons) >= {
        "META_OR_HEADER_NOINDEX",
        "CANONICAL_DOMAIN_MISMATCH",
        "BODY_SEVERELY_CHANGED",
    }


def test_fetcher_hardening_edges() -> None:
    # P1-1: 非文本 charset 回退 UTF-8 不抛 LookupError，二进制 Content-Type 拒绝
    assert _decode_html_bytes(b"TPS5430", "rot_13") == "TPS5430"
    assert _is_supported_text_content_type("text/html; charset=utf-8") is True
    assert _is_supported_text_content_type("application/pdf") is False

    # P2-1: 合法相对路径 canonical 正确基于 final_url 解析
    _, _, _, rel_canonical, _ = parse_public_html(
        '<html><head><link rel="canonical" href="tps5430.html" /></head><body>正文</body></html>',
        final_url="https://zhuanlan.zhihu.com/p/123",
    )
    assert rel_canonical == "https://zhuanlan.zhihu.com/p/tps5430.html"

    # P2-2: IPv6 字面量 Host 头带方括号且尾随点主机名与 SNI 一致
    pinned_url, host_hdr = _build_pinned_request_url(
        "https://[2606:2800:220:1:248:1893:25c8:1946]/p/1",
        "2606:2800:220:1:248:1893:25c8:1946",
        "2606:2800:220:1:248:1893:25c8:1946",
        443,
    )
    assert host_hdr == "[2606:2800:220:1:248:1893:25c8:1946]"
    assert pinned_url.startswith("https://[2606:2800:220:1:248:1893:25c8:1946]:443/")

    # P2-4: 正常长技术文章含导航栏“请先登录”不被误判为登录墙；极短登录拦截页正常识别
    long_body = "工业 24V 电源 TPS5430 选型详解与实测数据分析。" * 25
    long_html = (
        f"<html><title>TPS5430 指南</title>"
        f"<body><nav>请先登录</nav><article>{long_body}</article></body></html>"
    )
    _, _, _, _, long_waf = parse_public_html(
        long_html,
        final_url="https://zhuanlan.zhihu.com/p/123",
    )
    assert long_waf is False
    _, _, _, _, short_waf = parse_public_html(
        "<html><title>安全验证</title><body>请先登录后查看完整内容</body></html>",
        final_url="https://zhuanlan.zhihu.com/p/123",
    )
    assert short_waf is True
