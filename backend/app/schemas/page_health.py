"""Slice 3D：公开页面健康检查平台配置与检查历史 Schema。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import ContractModel

PublicPageHealthStatus = Literal["HEALTHY", "FETCH_BLOCKED", "CONFIRMED_ANOMALY"]


class PlatformHealthCheckSettingsOut(ContractModel):
    """单个平台的公开页面健康检查配置（含乐观并发修订号）。"""

    platform_profile_id: uuid.UUID
    health_check_enabled: bool
    health_check_interval_hours: int = Field(ge=1, le=720)
    health_check_anomaly_threshold: int = Field(ge=1, le=10)
    revision: int = Field(ge=0)


class PlatformHealthCheckSettingsUpdate(ContractModel):
    """管理员按平台更新公开页面健康检查配置的命令载荷。"""

    health_check_enabled: bool
    health_check_interval_hours: int = Field(ge=1, le=720)
    health_check_anomaly_threshold: int = Field(ge=1, le=10)
    expected_revision: int = Field(ge=0)


class PublishedArticleHealthCheckOut(ContractModel):
    """单次不可变公开页面健康检查记录。"""

    id: uuid.UUID
    published_article_id: uuid.UUID
    checked_url: str
    final_url: str | None
    status: PublicPageHealthStatus
    http_status: int | None = Field(default=None, ge=100, le=599)
    redirect_count: int = Field(ge=0)
    redirected: bool
    page_title: str | None
    title_matches: bool | None
    body_similarity: float | None = Field(default=None, ge=0.0, le=1.0)
    has_noindex: bool
    canonical_url: str | None
    canonical_matches: bool | None
    anomaly_reasons: list[str]
    fetch_error_code: str | None
    auto_opened_issue_id: uuid.UUID | None
    triggered_by: uuid.UUID | None
    checked_at: datetime


class PublishedArticleHealthCheckList(ContractModel):
    """发布成果的公开页面健康检查历史与当前连续异常统计。"""

    published_article_id: uuid.UUID
    platform_health_check_enabled: bool
    anomaly_threshold: int = Field(ge=1, le=10)
    consecutive_confirmed_anomalies: int = Field(ge=0)
    latest_status: PublicPageHealthStatus | None
    items: list[PublishedArticleHealthCheckOut]


class PublicPageHealthCheckRunDueRequest(ContractModel):
    """管理员手动触发到期公开页面健康检查巡检的批量上限。"""

    limit: int = Field(default=20, ge=1, le=50)


class PublicPageHealthCheckBatchOut(ContractModel):
    """一次到期巡检批次的汇总统计与逐篇结果。"""

    checked_count: int = Field(ge=0)
    healthy_count: int = Field(ge=0)
    fetch_blocked_count: int = Field(ge=0)
    confirmed_anomaly_count: int = Field(ge=0)
    auto_opened_issue_count: int = Field(ge=0)
    items: list[PublishedArticleHealthCheckOut]
