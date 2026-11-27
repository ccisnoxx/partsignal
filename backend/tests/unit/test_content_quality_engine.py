"""Slice 3B：Layer 1 确定性质量规则、工程数值提取与相似度算法单元测试。"""

from __future__ import annotations

from app.services.content_duplication import compute_content_similarity, split_markdown_paragraphs
from app.services.content_quality import (
    _extract_humanization_claims,
    _levenshtein_is_one,
    _parse_restriction_phrases,
    extract_technical_specs,
)


def test_extract_technical_specs_supports_ranges_and_units() -> None:
    specs = extract_technical_specs(
        "输入电压范围 4.5-36V，连续输出电流 3A，开关频率 500kHz，工作结温 125℃。"
    )
    assert ("4.5", "V") in specs
    assert ("36", "V") in specs
    assert ("3", "A") in specs
    assert ("500", "kHz") in specs
    assert ("125", "°C") in specs
    assert ("48", "V") not in specs


def test_levenshtein_and_restriction_phrase_parsing() -> None:
    assert _levenshtein_is_one("tps5430", "tps5431") is True
    assert _levenshtein_is_one("tps5430", "tps5430") is False
    assert _levenshtein_is_one("tps5430", "tps5499") is False
    phrases = _parse_restriction_phrases("禁止承诺免测试直接替换；严禁宣称车规级认证")
    assert "免测试直接替换" in phrases
    assert "车规级认证" in phrases


def test_humanization_claim_extraction_catches_new_percent_and_cert() -> None:
    src = _extract_humanization_claims("支持 5.5V-36V 输入，典型输出 3A。")
    humanized = _extract_humanization_claims(
        "支持 5.5V-36V 输入，典型输出 3A，效率高达 96%，已通过 AEC-Q100 认证。"
    )
    assert humanized - src == {"96%", "AEC-Q100"}


def test_similarity_and_paragraph_splitting() -> None:
    left = "国产降压芯片在工业 24V 电源场景中需要重点核对输入电压裕量、连续输出电流与封装热阻。"
    paraphrase = (
        "在工业 24V 电源场景选型国产降压芯片时，"
        "应重点核对输入电压裕量与封装热阻及连续输出电流。"
    )
    different = "本文介绍高速光耦隔离驱动器在逆变器门极驱动中的共模抑制比选型建议。"
    assert compute_content_similarity(left, paraphrase) >= 0.55
    assert compute_content_similarity(left, different) < 0.30
    paragraphs = split_markdown_paragraphs(
        "# 标题\n\n短段落\n\n"
        "这是一个超过二十四个字符的完整业务段落，用于验证段落拆分逻辑。\n\n"
        "```text\ncode\n```"
    )
    assert len(paragraphs) == 1
    assert "完整业务段落" in paragraphs[0]
