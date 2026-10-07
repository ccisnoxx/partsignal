"""GEO 测试语料的唯一离线校验入口，不承载业务分析或 API 模型。"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from jsonschema import Draft202012Validator, FormatChecker

FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures" / "geo_analysis"
VERSION_ROOT = FIXTURE_ROOT / "v1"
_URL = re.compile(r"https?://[^\s<>\]\)\"']+", re.IGNORECASE)
_HOST = re.compile(r"(?:[a-z0-9-]+\.)*geo-fixture-[a-z0-9-]+\.test", re.ASCII)
_SENSITIVE = re.compile(
    r"\b(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|"
    r"access[_-]?key|client[_-]?secret|password|session[_-]?token)\s*[:=]|"
    r"\bbearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|\bAKIA[A-Z0-9]{16}\b|"
    r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----",
    re.IGNORECASE,
)


class GeoFixtureError(ValueError):
    """只包含规则和位置，不回显可能敏感的语料值。"""


def _require(condition: bool, location: str, rule: str) -> None:
    if not condition:
        raise GeoFixtureError(f"GEO fixture 校验失败：{location}：{rule}")


def _validate_url(value: str, location: str) -> None:
    try:
        parts = urlsplit(value)
        valid = (
            parts.scheme == "https"
            and parts.hostname is not None
            and _HOST.fullmatch(parts.hostname) is not None
            and parts.netloc == parts.hostname
            and not parts.query
            and not parts.fragment
            and "\\" not in value
        )
    except ValueError:
        valid = False
    _require(valid, location, "URL 必须是无凭据、端口和 query 的 fixture HTTPS .test 地址")


def _scan_strings(value: Any, location: str) -> None:
    if isinstance(value, dict):
        for index, child in enumerate(value.values()):
            # 不使用未经校验的字段名，避免错误路径回显敏感值。
            _scan_strings(child, f"{location}/field[{index}]")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _scan_strings(child, f"{location}/[{index}]")
    elif isinstance(value, str):
        _require(not _SENSITIVE.search(value), location, "禁止敏感凭据或会话标记")
        for match in _URL.finditer(value):
            _validate_url(match.group(), location)


def _index(rows: list[dict[str, Any]], location: str) -> dict[str, dict[str, Any]]:
    result = {row["id"]: row for row in rows}
    _require(len(result) == len(rows), location, "ID 必须唯一")
    return result


def validate_geo_fixtures(bundle: dict[str, Any]) -> None:
    """校验文件合同和证据关系；金标内容由人工审查，不运行分析算法。"""
    schema = json.loads((VERSION_ROOT / "schema.json").read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    error = next(validator.iter_errors(bundle), None)
    if error is not None:
        # jsonschema 的 message/instance 可能包含正文、未知字段或敏感值。
        path = "/".join(str(part) for part in error.absolute_path) or "root"
        raise GeoFixtureError(f"GEO fixture 格式错误：{path}：{error.validator}")
    _scan_strings(bundle, "root")
    corpus, gold = bundle["corpus"], bundle["gold"]
    _require(corpus["dataset_id"] == gold["dataset_id"], "gold", "必须引用同一数据集")
    products = _index(corpus["products"], "products")
    subjects = _index(corpus["subjects"], "subjects")
    facts = _index(corpus["fact_versions"], "fact_versions")
    questions = _index(corpus["questions"], "questions")
    answers = _index(corpus["answers"], "answers")
    citations = _index(corpus["citations"], "citations")
    cases = _index(gold["cases"], "gold/cases")
    for subject in subjects.values():
        product_id, parent_id = subject["product_id"], subject["parent_subject_id"]
        own_product = subject["subject_type"] == "OWN_PRODUCT"
        _require(
            (product_id in products) if own_product else (product_id is None),
            "subjects",
            "只有自有产品可引用已有 Product",
        )
        if parent_id is not None:
            expected = {"OWN_PRODUCT": "OWN_BRAND", "COMPETITOR_PRODUCT": "COMPETITOR_BRAND"}
            _require(
                parent_id in subjects
                and subjects[parent_id]["subject_type"] == expected.get(subject["subject_type"]),
                "subjects",
                "品牌父级归属不匹配",
            )
        for domain in subject["domains"]:
            _validate_url(f"https://{domain}/", "subjects/domains")
    for fact in facts.values():
        _require(fact["product_id"] in products, "fact_versions", "产品引用不存在")
    for question in questions.values():
        _require(
            all(identity in subjects for identity in question["subject_ids"]),
            "questions",
            "监测对象引用不存在",
        )
    for answer in answers.values():
        _require(answer["question_id"] in questions, "answers", "问题引用不存在")
    for citation in citations.values():
        _require(citation["answer_id"] in answers, "citations", "回答引用不存在")
        _validate_url(citation["url"], "citations/url")
    for answer_id in answers:
        positions = [c["position"] for c in citations.values() if c["answer_id"] == answer_id]
        _require(positions == list(range(1, len(positions) + 1)), "citations", "引用顺序须连续")
    covered_answers: set[str] = set()
    for case in cases.values():
        answer_id = case["answer_id"]
        _require(answer_id in answers, "gold/cases", "回答引用不存在")
        _require(answer_id not in covered_answers, "gold/cases", "同一回答只能有一份 v1 金标")
        covered_answers.add(answer_id)
        text = answers[answer_id]["text"]
        scope = questions[answers[answer_id]["question_id"]]["subject_ids"]
        expected = case["expected"]
        for mention in expected["mentions"]:
            _require(
                all(identity in scope for identity in mention["subject_ids"]),
                "gold/mentions",
                "候选对象必须属于问题快照",
            )
            _require(
                len(mention["subject_ids"]) >= 2 if mention["mentioned"] is None
                else len(mention["subject_ids"]) == 1,
                "gold/mentions",
                "歧义必须保留多个候选，确定结论只能绑定单个对象",
            )
            excerpt = mention["excerpt"]
            _require(excerpt is None or excerpt in text, "gold/mentions", "摘录必须来自原回答")
        for row in [*expected["recommendations"], *expected["claims"]]:
            _require(row["subject_id"] in scope, "gold", "对象必须属于问题快照")
            _require(row["excerpt"] in text, "gold", "摘录必须来自原回答")
        for claim in expected["claims"]:
            fact_id = claim["fact_version_id"]
            if fact_id is None:
                _require(claim["verdict"] == "UNJUDGEABLE", "gold/claims", "无事实不能给出结论")
            else:
                _require(
                    fact_id in facts
                    and facts[fact_id]["product_id"] == subjects[claim["subject_id"]]["product_id"],
                    "gold/claims",
                    "必须绑定同产品的事实版本",
                )
        gold_citation_ids = [row["citation_id"] for row in expected["citations"]]
        raw_citation_ids = [
            row["id"] for row in citations.values() if row["answer_id"] == answer_id
        ]
        _require(
            gold_citation_ids == raw_citation_ids,
            "gold/citations",
            "金标须按原顺序覆盖全部引用，不增加、删除或去重原始证据",
        )
        for row in expected["citations"]:
            citation_id = row["citation_id"]
            _require(
                citation_id in citations and citations[citation_id]["answer_id"] == answer_id,
                "gold/citations",
                "引用必须来自同一回答",
            )
            _require(
                all(identity in scope for identity in row["subject_ids"]),
                "gold/citations",
                "引用归属对象不存在",
            )
            _validate_url(row["normalized_url"], "gold/citations/normalized_url")
    _require(covered_answers == set(answers), "gold/cases", "每个回答必须有金标")


def load_geo_fixtures(version_root: Path = VERSION_ROOT) -> dict[str, Any]:
    """每次从版本目录读取新对象；缺文件、非法 JSON 或未知版本明确失败。"""
    try:
        bundle = {
            "corpus": json.loads((version_root / "corpus.json").read_text(encoding="utf-8")),
            "gold": json.loads(
                (version_root / "gold" / "analysis.json").read_text(encoding="utf-8")
            ),
        }
    except (OSError, ValueError) as error:
        raise GeoFixtureError("GEO fixture 无法读取：版本目录缺文件或 JSON 无效") from error
    validate_geo_fixtures(bundle)
    return bundle
