"""Slice 3A：Prompt 不可变版本化、平台显式版本绑定与按版本效果统计契约。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import ContractModel
from app.schemas.configuration import PlatformPromptBoundPlatform

PromptVersionStatus = Literal["DRAFT", "PUBLISHED", "ARCHIVED"]


class PlatformPromptVersionCreate(ContractModel):
    """创建新 Prompt 版本（草稿或立即发布）。"""

    template_markdown: str = Field(min_length=1)
    change_summary: str = Field(default="", max_length=500)
    publish_immediately: bool = False


class PlatformPromptVersionDraftUpdate(ContractModel):
    """编辑未发布的草稿版本。"""

    expected_revision: int = Field(ge=0)
    template_markdown: str = Field(min_length=1)
    change_summary: str = Field(default="", max_length=500)


class PlatformPromptVersionActionCommand(ContractModel):
    """对不可变 Prompt 版本执行发布、归档或恢复。"""

    expected_revision: int = Field(ge=0)


class PlatformPromptVersionMetrics(ContractModel):
    """基于 PostgreSQL 源事实实时聚合的单版本效果指标。"""

    generation_job_count: int = Field(ge=0)
    succeeded_job_count: int = Field(ge=0)
    first_pass_review_total: int = Field(ge=0)
    first_pass_approved_count: int = Field(ge=0)
    first_pass_approval_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    avg_human_revisions: float | None = Field(default=None, ge=0.0)
    published_article_count: int = Field(ge=0)
    geo_observation_count: int = Field(ge=0)
    geo_mention_rate: float | None = Field(default=None, ge=0.0, le=1.0)
    geo_citation_rate: float | None = Field(default=None, ge=0.0, le=1.0)


class PlatformPromptVersionOut(ContractModel):
    """单个不可变 Prompt 版本详情与实时指标。"""

    id: uuid.UUID
    prompt_id: uuid.UUID
    version: int = Field(ge=1)
    status: PromptVersionStatus
    template_markdown: str
    template_sha256: str
    change_summary: str
    revision: int = Field(ge=0)
    published_at: datetime | None
    published_by: uuid.UUID | None
    created_by: uuid.UUID
    created_at: datetime
    updated_at: datetime
    bound_platform_count: int = Field(ge=0)
    bound_platforms: list[PlatformPromptBoundPlatform]
    available_actions: list[Literal["UPDATE_DRAFT", "PUBLISH", "ARCHIVE", "RESTORE"]]
    metrics: PlatformPromptVersionMetrics


class PlatformPromptVersionList(ContractModel):
    """指定 Prompt 主模板的全部版本与按版本聚合指标。"""

    prompt_id: uuid.UUID
    prompt_name: str
    latest_published_version_id: uuid.UUID | None
    items: list[PlatformPromptVersionOut]


class PlatformPromptVersionOption(ContractModel):
    """供平台切换或回滚绑定的已发布 Prompt 版本选项。"""

    id: uuid.UUID
    prompt_id: uuid.UUID
    prompt_name: str
    version: int = Field(ge=1)
    change_summary: str
    published_at: datetime | None
    is_current: bool


class PlatformPromptBindingOut(ContractModel):
    """单个平台当前的 Prompt 版本绑定与可回滚选项。"""

    platform_profile_id: uuid.UUID
    platform_revision: int = Field(ge=0)
    platform_prompt_id: uuid.UUID | None
    platform_prompt_name: str | None
    bound_version: PlatformPromptVersionOption | None
    available_versions: list[PlatformPromptVersionOption]


class PlatformPromptVersionBindCommand(ContractModel):
    """显式切换或回滚平台绑定的已发布 Prompt 版本。"""

    expected_revision: int = Field(ge=0)
    platform_prompt_version_id: uuid.UUID
