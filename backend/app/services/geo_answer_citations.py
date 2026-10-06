"""引用采集事实的去重和位置保留；归属判定留分析 revision。"""

from dataclasses import dataclass

from app.geo_citation_urls import normalize_citation_url
from app.schemas.geo_answers import GeoAnswerCitationInput


@dataclass(frozen=True)
class AnswerCitation:
    original_url: str
    normalized_url: str
    hostname: str
    position: int
    occurrences: tuple[int, ...]
    title: str | None
    extraction_source: str


def prepare_answer_citations(values: list[GeoAnswerCitationInput]) -> tuple[AnswerCitation, ...]:
    """按实际位置排序；同规范 URL 只保留首次采集元数据及全部位置。"""
    if len(values) > 1000 or len({v.position for v in values}) != len(values):
        raise ValueError("引用最多 1000 项且实际位置不能重复")
    groups: dict[str, list[GeoAnswerCitationInput]] = {}
    for value in sorted(values, key=lambda v: v.position):
        key = normalize_citation_url(value.original_url).normalized_url
        groups.setdefault(key, []).append(value)
    result = []
    for key, group in groups.items():
        first = group[0]
        result.append(
            AnswerCitation(
                original_url=first.original_url,
                normalized_url=key,
                hostname=normalize_citation_url(first.original_url).hostname,
                position=first.position,
                occurrences=tuple(v.position for v in group),
                title=first.title,
                extraction_source=first.extraction_source,
            )
        )
    return tuple(result)
