"""AI 配置与生成作业 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.base import new_uuid


class AIChannel(Base):
    """OpenAI-compatible 渠道及其加密凭据状态。"""

    __tablename__ = "ai_channels"
    __table_args__ = (
        CheckConstraint("timeout_seconds BETWEEN 10 AND 600", name="ck_ai_channels_timeout"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    base_url: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    headers: Mapped[list[AIChannelHeader]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class AIChannelHeader(Base):
    """渠道级普通或敏感 HTTP Header。"""

    __tablename__ = "ai_channel_headers"
    __table_args__ = (
        UniqueConstraint("channel_id", "normalized_name"),
        CheckConstraint(
            "(plain_value IS NOT NULL)::int + (encrypted_value IS NOT NULL)::int = 1",
            name="ck_ai_channel_headers_exactly_one_value",
        ),
        CheckConstraint(
            "(is_sensitive AND encrypted_value IS NOT NULL AND plain_value IS NULL) OR "
            "(NOT is_sensitive AND plain_value IS NOT NULL AND encrypted_value IS NULL)",
            name="ck_ai_channel_headers_sensitivity_matches_storage",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_channels.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(160), nullable=False)
    is_sensitive: Mapped[bool] = mapped_column(Boolean, nullable=False)
    plain_value: Mapped[str | None] = mapped_column(Text)
    encrypted_value: Mapped[str | None] = mapped_column(Text)


class AIModel(Base):
    """渠道下可选择且必须先测试的模型配置。"""

    __tablename__ = "ai_models"
    __table_args__ = (
        UniqueConstraint("channel_id", "model_id"),
        CheckConstraint(
            "test_status IN ('UNTESTED', 'PASSED', 'FAILED')",
            name="ck_ai_models_test_status",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    channel_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_channels.id", ondelete="CASCADE"), nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    model_id: Mapped[str] = mapped_column(String(300), nullable=False)
    request_parameters: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    test_status: Mapped[str] = mapped_column(String(24), nullable=False, default="UNTESTED")
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_test_error_summary: Mapped[str | None] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class GenerationJob(Base):
    """PostgreSQL 权威的异步生成作业。"""

    __tablename__ = "generation_jobs"
    __table_args__ = (
        CheckConstraint(
            "response_duration_ms IS NULL OR response_duration_ms >= 0",
            name="ck_generation_jobs_response_duration_nonnegative",
        ),
        CheckConstraint(
            "prompt_tokens IS NULL OR prompt_tokens >= 0",
            name="ck_generation_jobs_prompt_tokens_nonnegative",
        ),
        CheckConstraint(
            "completion_tokens IS NULL OR completion_tokens >= 0",
            name="ck_generation_jobs_completion_tokens_nonnegative",
        ),
        CheckConstraint(
            "total_tokens IS NULL OR total_tokens >= 0",
            name="ck_generation_jobs_total_tokens_nonnegative",
        ),
        CheckConstraint(
            "dispatch_attempt_count >= 0",
            name="ck_generation_jobs_dispatch_attempt_count_nonnegative",
        ),
        Index(
            "ix_generation_jobs_pending_dispatch_due",
            text("COALESCE(last_dispatch_attempt_at, created_at)"),
            postgresql_where=text("status = 'PENDING'"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    content_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_tasks.id", ondelete="RESTRICT"), nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="PENDING")
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    ai_channel_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_channels.id", ondelete="SET NULL")
    )
    ai_model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_models.id", ondelete="SET NULL")
    )
    adapter_name: Mapped[str] = mapped_column(String(80), nullable=False)
    prompt_template_version: Mapped[str] = mapped_column(String(40), nullable=False)
    prompt_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_dispatch_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatch_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    content_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "content_versions.id",
            ondelete="RESTRICT",
            use_alter=True,
            name="fk_generation_jobs_content_version_id_content_versions",
        ),
    )
    retry_of_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generation_jobs.id", ondelete="RESTRICT")
    )
    error_code: Mapped[str | None] = mapped_column(String(80))
    error_summary: Mapped[str | None] = mapped_column(Text)
    provider_request_id: Mapped[str | None] = mapped_column(Text)
    response_duration_ms: Mapped[int | None] = mapped_column(Integer)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
