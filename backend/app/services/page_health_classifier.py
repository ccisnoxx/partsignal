"""Slice 3D：公开页面健康检查三档分类器（HEALTHY / FETCH_BLOCKED / CONFIRMED_ANOMALY）。"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas.page_health import PublicPageHealthStatus
from app.services.content_duplication import compute_content_similarity
from app.services.page_health_fetcher import PageFetchResult
from app.services.publication import domain_allowed

BODY_ANOMALY_MIN_CHARS = 80
BODY_SIMILARITY_ANOMALY_THRESHOLD = 0.25


@dataclass(frozen=True, slots=True)
class HealthClassification:
    """三档公开页面健康分类结论（绝不把抓取受阻误判为确认异常）。"""

    status: PublicPageHealthStatus
    title_matches: bool | None
    body_similarity: float | None
    canonical_matches: bool | None
    anomaly_reasons: list[str]
    fetch_error_code: str | None


def classify_public_page_health(
    fetch_result: PageFetchResult,
    *,
    expected_title: str,
    expected_body_text: str,
    allowed_domains: list[str],
) -> HealthClassification:
    """执行三档分类：FETCH_BLOCKED 仅告警绝不自动建单；CONFIRMED_ANOMALY 才计入异常阈值。"""
    if fetch_result.fetch_error_code is not None:
        return HealthClassification(
            status="FETCH_BLOCKED",
            title_matches=None,
            body_similarity=None,
            canonical_matches=None,
            anomaly_reasons=[],
            fetch_error_code=fetch_result.fetch_error_code,
        )

    code = fetch_result.http_status
    if code is None:
        return HealthClassification(
            status="FETCH_BLOCKED",
            title_matches=None,
            body_similarity=None,
            canonical_matches=None,
            anomaly_reasons=[],
            fetch_error_code="HTTP_STATUS_MISSING",
        )

    if code in {401, 403, 429} or code >= 500 or code < 200:
        return HealthClassification(
            status="FETCH_BLOCKED",
            title_matches=None,
            body_similarity=None,
            canonical_matches=None,
            anomaly_reasons=[],
            fetch_error_code=f"HTTP_{code}",
        )

    if code in {404, 410}:
        return HealthClassification(
            status="CONFIRMED_ANOMALY",
            title_matches=None,
            body_similarity=None,
            canonical_matches=None,
            anomaly_reasons=["HTTP_GONE_OR_NOT_FOUND"],
            fetch_error_code=None,
        )

    if not (200 <= code <= 299):
        return HealthClassification(
            status="FETCH_BLOCKED",
            title_matches=None,
            body_similarity=None,
            canonical_matches=None,
            anomaly_reasons=[],
            fetch_error_code=f"HTTP_{code}",
        )

    if fetch_result.waf_or_login_blocked:
        return HealthClassification(
            status="FETCH_BLOCKED",
            title_matches=None,
            body_similarity=None,
            canonical_matches=None,
            anomaly_reasons=[],
            fetch_error_code="WAF_OR_LOGIN_WALL",
        )

    reasons: list[str] = []
    if fetch_result.has_noindex:
        reasons.append("META_OR_HEADER_NOINDEX")

    canonical_matches: bool | None = None
    if fetch_result.canonical_url:
        if allowed_domains:
            canonical_matches = domain_allowed(fetch_result.canonical_url, allowed_domains)
            if not canonical_matches:
                reasons.append("CANONICAL_DOMAIN_MISMATCH")
        else:
            canonical_matches = True

    title_matches: bool | None = None
    if fetch_result.page_title and expected_title.strip():
        title_matches = (
            expected_title.strip().casefold() in fetch_result.page_title.strip().casefold()
        )

    body_similarity: float | None = None
    if expected_body_text.strip() and len(fetch_result.body_text.strip()) >= BODY_ANOMALY_MIN_CHARS:
        body_similarity = round(
            max(
                0.0,
                min(1.0, compute_content_similarity(expected_body_text, fetch_result.body_text)),
            ),
            4,
        )
        if body_similarity < BODY_SIMILARITY_ANOMALY_THRESHOLD:
            reasons.append("BODY_SEVERELY_CHANGED")

    if reasons:
        return HealthClassification(
            status="CONFIRMED_ANOMALY",
            title_matches=title_matches,
            body_similarity=body_similarity,
            canonical_matches=canonical_matches,
            anomaly_reasons=reasons,
            fetch_error_code=None,
        )
    return HealthClassification(
        status="HEALTHY",
        title_matches=title_matches,
        body_similarity=body_similarity,
        canonical_matches=canonical_matches,
        anomaly_reasons=[],
        fetch_error_code=None,
    )
