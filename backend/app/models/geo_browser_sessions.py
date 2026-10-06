"""受保护会话的引用与撤销事实；数据库从不接收会话或密文字节。"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoBrowserSession(Base):
    __tablename__ = "geo_browser_sessions"
    __table_args__ = (
        CheckConstraint(
            "cipher_sha256 ~ '^[0-9a-f]{64}$'", name=conv("ck_geo_browser_sessions_digest")
        ),
        CheckConstraint("expires_at > created_at", name=conv("ck_geo_browser_sessions_expiry")),
        CheckConstraint(
            "health IN ('AVAILABLE','EXPIRED','REVOKED','MISSING','UNREADABLE')",
            name=conv("ck_geo_browser_sessions_health"),
        ),
        CheckConstraint(
            "(revoked_at IS NULL AND revoked_by IS NULL AND health <> 'REVOKED' "
            "AND purged_at IS NULL) OR (revoked_at IS NOT NULL AND "
            "revoked_by IS NOT NULL AND health IN ('REVOKED','EXPIRED'))",
            name=conv("ck_geo_browser_sessions_revocation"),
        ),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at",
            name=conv("ck_geo_browser_sessions_revoked_time"),
        ),
        CheckConstraint(
            "purged_at IS NULL OR purged_at >= revoked_at",
            name=conv("ck_geo_browser_sessions_purged_time"),
        ),
        Index(
            "uq_geo_browser_sessions_current_profile",
            "profile_id",
            unique=True,
            postgresql_where=text("revoked_at IS NULL"),
        ),
        Index("ix_geo_browser_sessions_profile_created", "profile_id", "created_at", "id"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_collection_profiles.id",
            name="fk_geo_browser_sessions_profile",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    cipher_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    health: Mapped[str] = mapped_column(String(16), nullable=False)
    last_checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_browser_sessions_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    revoked_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_browser_sessions_revoker", ondelete="RESTRICT"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    purged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
