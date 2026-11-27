"""Slice 3C：发布包链接/图片提取与字符数统计单元测试。"""

from __future__ import annotations

from app.services.publication_package import (
    compute_character_stats,
    extract_markdown_images,
    extract_markdown_links,
)
from app.services.publication_queries import render_markdown


def test_extract_links_images_and_stats() -> None:
    md = (
        "# TPS5430 选型指南\n\n"
        "查看[官方数据手册](https://example.com/ds.pdf)和[非法链接](javascript:alert(1))"
        "与[协议相对](//evil.example/phish)。\n\n"
        "```python\n"
        "# 代码块里的注释不应计为标题\n"
        "# [示例链接](https://ignored.example/x)\n"
        "```\n\n"
        "![原理图](https://example.com/sch.png)\n"
        "![](https://example.com/no-alt.png)\n"
        "![](//evil.example/bad.png)\n"
        "![合法站内图](/static/ok.png)\n"
        "![控制字符图](/static/\x00bad.png)\n"
    )
    links = extract_markdown_links(md)
    assert len(links) == 3
    assert links[0].is_valid is True
    assert links[1].is_valid is False
    assert links[2].is_valid is False

    images = extract_markdown_images(md)
    assert len(images) == 5
    assert images[0].missing_alt is False and images[0].is_valid_src is True
    assert images[1].missing_alt is True and images[1].is_valid_src is True
    assert images[2].missing_alt is True and images[2].is_valid_src is False
    assert images[3].missing_alt is False and images[3].is_valid_src is True
    assert images[4].missing_alt is False and images[4].is_valid_src is False

    stats = compute_character_stats(md, "TPS5430 选型指南 查看官方数据手册")
    assert stats.heading_count == 1
    assert stats.paragraph_count == 2
    assert stats.estimated_read_minutes >= 1

    safe_html, _ = render_markdown(
        "[安全](https://example.com/ok) [相对协议](//evil.example/x) [脚本](javascript:alert(1))"
    )
    assert 'href="https://example.com/ok"' in safe_html
    assert "//evil.example" not in safe_html
    assert "javascript:" not in safe_html
