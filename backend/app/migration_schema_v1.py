"""Alembic 0001-0008 使用的冻结 SQLAlchemy 元数据快照。

该模块只保证初始迁移历史可重复，不得被 API、Worker 或新业务代码导入。
后续模型变化必须通过新的 Alembic revision 表达，禁止修改本快照追赶运行时模型。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.db import NAMING_CONVENTION


class Base(DeclarativeBase):
    """仅属于初始迁移历史的独立声明基类。"""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def new_uuid() -> uuid.UUID:
    """生成数据库实体 UUID。"""
    return uuid.uuid4()


class User(Base):
    """内部账号；业务权限由固定角色集合决定。"""

    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    roles: Mapped[list[Role]] = relationship(secondary="user_roles", lazy="selectin")


class Role(Base):
    """固定角色字典。"""

    __tablename__ = "roles"
    name: Mapped[str] = mapped_column(String(64), primary_key=True)


class UserRole(Base):
    """用户与固定角色的多对多关联。"""

    __tablename__ = "user_roles"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    role_name: Mapped[str] = mapped_column(
        String(64), ForeignKey("roles.name", ondelete="RESTRICT"), primary_key=True
    )


class SessionRecord(Base):
    """可撤销的服务端登录会话。"""

    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    user: Mapped[User] = relationship(lazy="joined")


class AuditLog(Base):
    """追加式关键业务审计记录。"""

    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    target_type: Mapped[str] = mapped_column(String(80), nullable=False)
    target_id: Mapped[str] = mapped_column(String(100), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    request_id: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Product(Base):
    """公司产品的稳定身份。"""

    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("normalized_brand", "normalized_part_number"),
        CheckConstraint("revision >= 0", name="revision_nonnegative"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    part_number: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_part_number: Mapped[str] = mapped_column(String(160), nullable=False)
    brand: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_brand: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="ACTIVE")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    facts_revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class ReferencePart(Base):
    """事实工作区中的外部参考型号。"""

    __tablename__ = "reference_parts"
    __table_args__ = (
        UniqueConstraint("product_id", "client_key", name="uq_reference_parts_product_client_key"),
        UniqueConstraint(
            "product_id",
            "normalized_manufacturer",
            "normalized_part_number",
            name="uq_reference_parts_product_identity",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    part_number: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_part_number: Mapped[str] = mapped_column(String(160), nullable=False)
    manufacturer: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_manufacturer: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(160), nullable=False)


class Evidence(Base):
    """事实证据元数据，文件内容由文件模块持有。"""

    __tablename__ = "evidences"
    __table_args__ = (UniqueConstraint("product_id", "client_key"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    source_url: Mapped[str | None] = mapped_column(Text)
    # use_alter 允许 0008 在文件表创建后补加跨里程碑外键。
    file_record_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "file_records.id",
            ondelete="RESTRICT",
            use_alter=True,
            name="fk_evidences_file_record_id_file_records",
        ),
    )
    confidentiality: Mapped[str] = mapped_column(String(32), nullable=False)


class PartParameter(Base):
    """公司产品或一个参考型号的结构化参数。"""

    __tablename__ = "part_parameters"
    __table_args__ = (
        UniqueConstraint("product_id", "client_key"),
        CheckConstraint(
            "(owner_product_id IS NOT NULL)::int + (reference_part_id IS NOT NULL)::int = 1",
            name="exactly_one_owner",
        ),
        CheckConstraint(
            "owner_product_id IS NULL OR owner_product_id = product_id",
            name="product_owner_matches_aggregate",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    owner_product_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE")
    )
    reference_part_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reference_parts.id", ondelete="CASCADE")
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    key: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    value_type: Mapped[str] = mapped_column(String(24), nullable=False)
    min_value: Mapped[float | None] = mapped_column(Float)
    typical_value: Mapped[float | None] = mapped_column(Float)
    max_value: Mapped[float | None] = mapped_column(Float)
    text_value: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str] = mapped_column(String(80), nullable=False)
    test_conditions: Mapped[str] = mapped_column(Text, nullable=False)
    is_critical: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ReplacementRelation(Base):
    """公司产品对参考型号的人工判定替代关系。"""

    __tablename__ = "replacement_relations"
    __table_args__ = (UniqueConstraint("product_id", "client_key"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    reference_part_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reference_parts.id", ondelete="CASCADE"), nullable=False
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    replacement_level: Mapped[str] = mapped_column(String(60), nullable=False)
    conditions: Mapped[str] = mapped_column(Text, nullable=False)
    exclusions: Mapped[str] = mapped_column(Text, nullable=False)


class FactClaim(Base):
    """允许、禁止或强制披露的事实表达。"""

    __tablename__ = "fact_claims"
    __table_args__ = (UniqueConstraint("product_id", "client_key"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    client_key: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)


class ParameterEvidenceLink(Base):
    """参数与证据的关联。"""

    __tablename__ = "parameter_evidence_links"
    parameter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("part_parameters.id", ondelete="CASCADE"), primary_key=True
    )
    evidence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidences.id", ondelete="CASCADE"), primary_key=True
    )


class ReplacementEvidenceLink(Base):
    """替代关系与证据的关联。"""

    __tablename__ = "replacement_evidence_links"
    replacement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("replacement_relations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    evidence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidences.id", ondelete="CASCADE"), primary_key=True
    )


class ClaimEvidenceLink(Base):
    """事实表达与证据的关联。"""

    __tablename__ = "claim_evidence_links"
    claim_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_claims.id", ondelete="CASCADE"), primary_key=True
    )
    evidence_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("evidences.id", ondelete="CASCADE"), primary_key=True
    )


class FactVersion(Base):
    """服务端构造的不可变产品事实快照。"""

    __tablename__ = "fact_versions"
    __table_args__ = (UniqueConstraint("product_id", "version"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    change_summary: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FactReviewRecord(Base):
    """追加式事实审核命令记录。"""

    __tablename__ = "fact_review_records"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    fact_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_versions.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class QueryTopic(Base):
    """供内容任务与 GEO 观测复用的目标问题。"""

    __tablename__ = "query_topics"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    canonical_question: Mapped[str] = mapped_column(Text, nullable=False)
    intent_type: Mapped[str] = mapped_column(String(40), nullable=False)
    variants: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class PlatformProfile(Base):
    """平台稳定身份和允许域名集合。"""

    __tablename__ = "platform_profiles"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    allowed_domains: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)


class PlatformProfileVersion(Base):
    """不可变的平台内容规则版本。"""

    __tablename__ = "platform_profile_versions"
    __table_args__ = (UniqueConstraint("platform_profile_id", "version"),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    platform_profile_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("platform_profiles.id", ondelete="RESTRICT"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    rules: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ContentTask(Base):
    """锁定事实和平台规则版本的内容生产任务。"""

    __tablename__ = "content_tasks"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    query_topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("query_topics.id", ondelete="RESTRICT"), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    fact_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_versions.id", ondelete="RESTRICT"), nullable=False
    )
    platform_profile_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform_profile_versions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    target_audience: Mapped[str] = mapped_column(Text, nullable=False)
    content_angle: Mapped[str] = mapped_column(Text, nullable=False)
    conversion_goal: Mapped[str] = mapped_column(Text, nullable=False)
    desired_format: Mapped[str] = mapped_column(String(120), nullable=False)
    desired_length_min: Mapped[int] = mapped_column(Integer, nullable=False)
    desired_length_max: Mapped[int] = mapped_column(Integer, nullable=False)
    canonical_url: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="OPEN")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GenerationJob(Base):
    """PostgreSQL 权威的异步生成作业。"""

    __tablename__ = "generation_jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    content_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_tasks.id", ondelete="RESTRICT"), nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="PENDING")
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    adapter_name: Mapped[str] = mapped_column(String(80), nullable=False)
    prompt_template_version: Mapped[str] = mapped_column(String(40), nullable=False)
    prompt_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
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
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ContentVersion(Base):
    """正文不可原地编辑的 Markdown 内容版本。"""

    __tablename__ = "content_versions"
    __table_args__ = (
        UniqueConstraint("task_id", "version"),
        UniqueConstraint("source_job_id"),
        Index(
            "uq_content_versions_one_approved_per_task",
            "task_id",
            unique=True,
            postgresql_where="status = 'APPROVED'",
        ),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_tasks.id", ondelete="RESTRICT"), nullable=False
    )
    fact_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("fact_versions.id", ondelete="RESTRICT"), nullable=False
    )
    source_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generation_jobs.id", ondelete="RESTRICT")
    )
    based_on_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT")
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    used_fact_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    used_evidence_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    required_disclosure_ids: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, default=list
    )
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="DRAFT")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    quality_issues: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, default=list
    )
    change_summary: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ContentReviewRecord(Base):
    """追加式内容审核记录。"""

    __tablename__ = "content_review_records"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    content_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_versions.id", ondelete="RESTRICT"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


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


class GeoObservation(Base):
    """追加式单次 GEO 人工观测。"""

    __tablename__ = "geo_observations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    query_topic_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("query_topics.id", ondelete="RESTRICT"), nullable=False
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("products.id", ondelete="RESTRICT"), nullable=False
    )
    actual_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    model_name: Mapped[str] = mapped_column(String(160), nullable=False)
    model_version: Mapped[str | None] = mapped_column(String(160))
    tested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    web_search_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    answer_summary: Mapped[str] = mapped_column(Text, nullable=False)
    mentioned: Mapped[bool] = mapped_column(Boolean, nullable=False)
    recommendation: Mapped[str] = mapped_column(String(32), nullable=False)
    accuracy: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False)
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_observations.id", ondelete="RESTRICT")
    )
    tested_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoObservationCitation(Base):
    """观测回答中的引用来源。"""

    __tablename__ = "geo_observation_citations"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    observation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_observations.id", ondelete="RESTRICT"), nullable=False
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    publication_record_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("publication_records.id", ondelete="RESTRICT")
    )


class GeoObservationPublication(Base):
    """观测与可能产生影响的发布记录关联。"""

    __tablename__ = "geo_observation_publications"
    observation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_observations.id", ondelete="RESTRICT"), primary_key=True
    )
    publication_record_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("publication_records.id", ondelete="RESTRICT"),
        primary_key=True,
    )


class FileRecord(Base):
    """对象上传生命周期与可信元数据。"""

    __tablename__ = "file_records"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    object_key: Mapped[str] = mapped_column(String(500), unique=True, nullable=False)
    content_type: Mapped[str] = mapped_column(String(160), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    access_level: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="PENDING")
    uploader_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    upload_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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


class GeoObservationAttachment(Base):
    """GEO 观测与已验证截图的关联。"""

    __tablename__ = "geo_observation_attachments"
    observation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("geo_observations.id", ondelete="RESTRICT"), primary_key=True
    )
    file_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("file_records.id", ondelete="RESTRICT"), primary_key=True
    )
