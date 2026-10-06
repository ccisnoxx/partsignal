"""创建身份与冻结主体引用；不保存第二套执行状态。"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base


class GeoBatchCreationRequest(Base):
    __tablename__ = "geo_batch_creation_requests"
    __table_args__ = (
        UniqueConstraint("batch_id", name="uq_geo_batch_creation_requests_batch"),
        CheckConstraint(
            "identity_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'",
            name=conv("ck_geo_batch_creation_requests_hashes"),
        ),
    )

    identity_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_observation_batches.id",
            name="fk_geo_batch_creation_requests_batch",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )


class GeoBatchSubject(Base):
    __tablename__ = "geo_batch_subjects"
    __table_args__ = (
        CheckConstraint(
            "role IN ('PRIMARY','COMPETITOR','REFERENCE')", name=conv("ck_geo_batch_subjects_role")
        ),
        Index("ix_geo_batch_subjects_subject", "subject_id", "batch_id"),
    )

    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_observation_batches.id", name="fk_geo_batch_subjects_batch", ondelete="RESTRICT"
        ),
        primary_key=True,
    )
    subject_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("geo_subjects.id", name="fk_geo_batch_subjects_subject", ondelete="RESTRICT"),
        primary_key=True,
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)
