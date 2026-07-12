"""发布、状态事件、异常待办与附件 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import new_uuid


class PlatformAccount(Base):
    """不含凭据的平台运营账号标识。"""

    __tablename__ = "platform_accounts"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    platform_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_profiles.id", ondelete="RESTRICT"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    account_identifier: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class PublicationRecord(Base):
    """永久绑定内容版本的人工发布记录。"""

    __tablename__ = "publication_records"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    content_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT"), nullable=False
    )
    platform_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    section_url: Mapped[str] = mapped_column(Text, nullable=False)
    actual_title: Mapped[str | None] = mapped_column(Text)
    final_url: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PublicationStatusEvent(Base):
    """发布状态变化的追加式历史。"""

    __tablename__ = "publication_status_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    publication_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("publication_records.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PublicationAttention(Base):
    """发布失效后唯一、可显式处置的业务待办。"""

    __tablename__ = "publication_attentions"
    __table_args__ = (
        CheckConstraint(
            "trigger_status IN ('REMOVED', 'VERIFICATION_FAILED')",
            name="ck_publication_attentions_trigger_status",
        ),
        CheckConstraint(
            "status IN ('OPEN', 'RESOLVED')",
            name="ck_publication_attentions_status",
        ),
        CheckConstraint(
            "revision >= 0",
            name="ck_publication_attentions_revision_nonnegative",
        ),
        CheckConstraint(
            "(status = 'OPEN' AND resolved_at IS NULL AND resolved_by IS NULL "
            "AND resolution_comment IS NULL) OR "
            "(status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL "
            "AND length(btrim(resolution_comment)) > 0)",
            name="ck_publication_attentions_resolution_complete",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    publication_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("publication_records.id", ondelete="RESTRICT"),
        unique=True,
        nullable=False,
    )
    trigger_status: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="OPEN")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    resolution_comment: Mapped[str | None] = mapped_column(Text)


class PublicationAttachment(Base):
    """发布记录与已验证文件的关联。"""

    __tablename__ = "publication_attachments"
    publication_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("publication_records.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("file_records.id", ondelete="RESTRICT"), primary_key=True
    )
