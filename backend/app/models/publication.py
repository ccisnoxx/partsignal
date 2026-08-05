"""发布账号、发布工作、核验、发布成果与内容问题 ORM 映射。"""

from __future__ import annotations

import uuid
from datetime import datetime

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
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.base import new_uuid


class PlatformAccount(Base):
    """不含凭据的平台运营账号标识。"""

    __tablename__ = "platform_accounts"
    __table_args__ = (
        CheckConstraint("revision >= 0", name="revision_nonnegative"),
        CheckConstraint("length(btrim(label)) > 0", name="label_nonblank"),
        CheckConstraint(
            "length(btrim(account_identifier)) > 0",
            name="identifier_nonblank",
        ),
        Index(
            "ix_platform_accounts_platform_profile_active",
            "platform_profile_id",
            "is_active",
        ),
        Index(
            "uq_platform_accounts_profile_identifier_normalized",
            "platform_profile_id",
            text("lower(btrim(account_identifier))"),
            unique=True,
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    platform_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_profiles.id", ondelete="RESTRICT"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    account_identifier: Mapped[str] = mapped_column(String(200), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class PublicationWork(Base):
    """从已批准内容到首次核验成功或显式关闭的一次发布工作。"""

    __tablename__ = "publication_works"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_publication_works_idempotency_key"),
        UniqueConstraint("content_task_id", name="uq_publication_works_content_task_id"),
        CheckConstraint(
            "status IN ('PREPARING', 'PLATFORM_REVIEW', 'AWAITING_VERIFICATION', "
            "'ACTION_REQUIRED', 'COMPLETED', 'CLOSED')",
            name="status_valid",
        ),
        CheckConstraint("revision >= 0", name="revision_nonnegative"),
        CheckConstraint(
            "(status IN ('AWAITING_VERIFICATION', 'ACTION_REQUIRED', 'COMPLETED') "
            "AND actual_title IS NOT NULL AND length(btrim(actual_title)) > 0 "
            "AND final_url IS NOT NULL AND published_at IS NOT NULL) OR "
            "(status IN ('PREPARING', 'PLATFORM_REVIEW', 'CLOSED'))",
            name="result_complete",
        ),
        CheckConstraint(
            "(status = 'CLOSED' AND close_reason IS NOT NULL "
            "AND length(btrim(close_comment)) > 0 AND closed_by IS NOT NULL "
            "AND closed_at IS NOT NULL) OR "
            "(status <> 'CLOSED' AND close_reason IS NULL AND close_comment IS NULL "
            "AND closed_by IS NULL AND closed_at IS NULL)",
            name="close_complete",
        ),
        CheckConstraint(
            "close_reason IS NULL OR close_reason IN "
            "('PLATFORM_REJECTED', 'BUSINESS_CANCELLED', 'OTHER')",
            name="close_reason_valid",
        ),
        Index(
            "uq_publication_works_active_platform_hash",
            "platform_profile_id",
            "content_hash",
            unique=True,
            postgresql_where=text("status <> 'CLOSED'"),
        ),
        Index("ix_publication_works_status_updated_at", "status", "updated_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    content_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_tasks.id", ondelete="RESTRICT"), nullable=False
    )
    content_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT"), nullable=False
    )
    platform_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_profiles.id", ondelete="RESTRICT"), nullable=False
    )
    platform_account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_accounts.id", ondelete="RESTRICT"), nullable=False
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    actual_title: Mapped[str | None] = mapped_column(Text)
    final_url: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="PREPARING")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    close_reason: Mapped[str | None] = mapped_column(String(40))
    close_comment: Mapped[str | None] = mapped_column(Text)
    closed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class PublicationWorkEvent(Base):
    """发布工作状态和资料变化的追加式历史。"""

    __tablename__ = "publication_work_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    publication_work_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("publication_works.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(40))
    to_status: Mapped[str] = mapped_column(String(40), nullable=False)
    from_content_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT")
    )
    to_content_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT")
    )
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PublicationVerification(Base):
    """一次首次核验尝试及当时发布结果的不可变快照。"""

    __tablename__ = "publication_verifications"
    __table_args__ = (
        CheckConstraint("outcome IN ('PASSED', 'FAILED')", name="outcome_valid"),
        CheckConstraint(
            "outcome = 'PASSED' OR length(btrim(comment)) > 0",
            name="failed_comment_nonblank",
        ),
        Index(
            "uq_publication_verifications_one_passed",
            "publication_work_id",
            unique=True,
            postgresql_where=text("outcome = 'PASSED'"),
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    publication_work_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("publication_works.id", ondelete="RESTRICT"), nullable=False
    )
    content_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT"), nullable=False
    )
    outcome: Mapped[str] = mapped_column(String(16), nullable=False)
    actual_title_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    final_url_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    published_at_snapshot: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PublishedArticle(Base):
    """首次核验成功后形成的只读公开文章身份。"""

    __tablename__ = "published_articles"
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("publication_works.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    verification_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("publication_verifications.id", ondelete="RESTRICT"),
        unique=True,
        nullable=False,
    )


class PublishedContentIssue(Base):
    """发布成果形成后出现的页面或内容问题。"""

    __tablename__ = "published_content_issues"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('PAGE_UNAVAILABLE', 'CONTENT_CHANGED', 'OTHER')",
            name="kind_valid",
        ),
        CheckConstraint("status IN ('OPEN', 'RESOLVED')", name="status_valid"),
        CheckConstraint("revision >= 0", name="revision_nonnegative"),
        CheckConstraint("length(btrim(description)) > 0", name="description_nonblank"),
        CheckConstraint(
            "(status = 'OPEN' AND resolved_at IS NULL AND resolved_by IS NULL "
            "AND resolution_outcome IS NULL AND resolution_comment IS NULL) OR "
            "(status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL "
            "AND resolution_outcome IN ('RESTORED', 'RETIRED') "
            "AND length(btrim(resolution_comment)) > 0)",
            name="resolution_complete",
        ),
        Index(
            "uq_published_content_issues_one_open",
            "published_article_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
        ),
        Index("ix_published_content_issues_status_opened_at", "status", "opened_at"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    published_article_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("published_articles.id", ondelete="RESTRICT"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="OPEN")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    opened_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    opened_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_outcome: Mapped[str | None] = mapped_column(String(20))
    resolution_comment: Mapped[str | None] = mapped_column(Text)


class PublicationAttachment(Base):
    """发布工作与已验证操作截图的追加式关联。"""

    __tablename__ = "publication_attachments"
    publication_work_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("publication_works.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("file_records.id", ondelete="RESTRICT"), primary_key=True
    )
