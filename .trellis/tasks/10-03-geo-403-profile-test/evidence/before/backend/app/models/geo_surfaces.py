"""GEO 观测配置，不拥有凭据、运行资格或 Collector 生命周期。"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.schema import conv

from app.db import Base
from app.models.base import new_uuid


class GeoEngineSurface(Base):
    __tablename__ = "geo_engine_surfaces"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_geo_engine_surfaces_slug"),
        CheckConstraint(
            "geo_configuration_text_valid(name)", name=conv("ck_geo_engine_surfaces_name")
        ),
        CheckConstraint(
            "slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'", name=conv("ck_geo_engine_surfaces_slug")
        ),
        CheckConstraint(
            "surface_kind IN ('CONSUMER_UI','MODEL_API','SEARCH_API','MANUAL_SITE')",
            name=conv("ck_geo_engine_surfaces_kind"),
        ),
        CheckConstraint(
            "provider_brand IN "
            "('OPENAI','ANTHROPIC','GOOGLE','AZURE_OPENAI','ZHIPU','QWEN','CUSTOM')",
            name=conv("ck_geo_engine_surfaces_provider"),
        ),
        CheckConstraint(
            "website_url IS NULL OR (length(website_url) BETWEEN 1 AND 2083 "
            "AND website_url ~ '^https?://[^[:space:]/?#@]+(/[^[:space:]?#]*)?$')",
            name=conv("ck_geo_engine_surfaces_website"),
        ),
        CheckConstraint(
            "compliance_status IN ('NOT_REVIEWED','APPROVED','REJECTED','SUSPENDED')",
            name=conv("ck_geo_engine_surfaces_compliance"),
        ),
        CheckConstraint(
            "geo_surface_capabilities_valid(capabilities)",
            name=conv("ck_geo_engine_surfaces_capabilities"),
        ),
        CheckConstraint("revision >= 0", name=conv("ck_geo_engine_surfaces_revision")),
        CheckConstraint(
            "first_referenced_at IS NULL OR first_referenced_at >= created_at",
            name=conv("ck_geo_engine_surfaces_reference_time"),
        ),
        Index("ix_geo_engine_surfaces_active_name", "is_active", "name", "id"),
        Index("ix_geo_engine_surfaces_creator", "created_by"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    surface_kind: Mapped[str] = mapped_column(String(24), nullable=False)
    provider_brand: Mapped[str] = mapped_column(String(40), nullable=False)
    website_url: Mapped[str | None] = mapped_column(Text)
    compliance_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="NOT_REVIEWED", server_default="NOT_REVIEWED"
    )
    capabilities: Mapped[dict[str, bool]] = mapped_column(JSONB, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    first_referenced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_engine_surfaces_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class GeoCollectionProfile(Base):
    __tablename__ = "geo_collection_profiles"
    __table_args__ = (
        UniqueConstraint(
            "engine_surface_id", "name", name="uq_geo_collection_profiles_surface_name"
        ),
        ForeignKeyConstraint(
            ["ai_model_id", "ai_channel_id"],
            ["ai_models.id", "ai_models.channel_id"],
            name="fk_geo_collection_profiles_model_channel",
            match="FULL",
            ondelete="SET NULL",
            onupdate="RESTRICT",
        ),
        CheckConstraint(
            "geo_configuration_text_valid(name)", name=conv("ck_geo_collection_profiles_name")
        ),
        CheckConstraint(
            "collection_mode IN ('MANUAL','API','BROWSER')",
            name=conv("ck_geo_collection_profiles_mode"),
        ),
        CheckConstraint(
            "adapter_key ~ '^[a-z][a-z0-9_-]*$' "
            "AND (collection_mode <> 'MANUAL' OR adapter_key = 'manual')",
            name=conv("ck_geo_collection_profiles_adapter"),
        ),
        CheckConstraint(
            "collection_mode = 'API' OR (ai_channel_id IS NULL AND ai_model_id IS NULL)",
            name=conv("ck_geo_collection_profiles_model_mode"),
        ),
        CheckConstraint(
            "length(language_code) BETWEEN 2 AND 16 "
            "AND language_code ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$'",
            name=conv("ck_geo_collection_profiles_language"),
        ),
        CheckConstraint(
            "length(region_code) = 2 AND region_code ~ '^[A-Z]{2}$'",
            name=conv("ck_geo_collection_profiles_region"),
        ),
        CheckConstraint(
            "(collection_mode = 'API' AND login_state = 'NOT_APPLICABLE') OR "
            "(collection_mode IN ('MANUAL','BROWSER') "
            "AND login_state IN ('ANONYMOUS','AUTHENTICATED'))",
            name=conv("ck_geo_collection_profiles_login"),
        ),
        CheckConstraint(
            "web_search_policy IN ('UNKNOWN','REQUESTED','REQUIRED','NOT_APPLICABLE')",
            name=conv("ck_geo_collection_profiles_search"),
        ),
        CheckConstraint(
            "geo_profile_settings_valid(collection_mode, settings_json)",
            name=conv("ck_geo_collection_profiles_settings"),
        ),
        CheckConstraint(
            "(last_test_status = 'UNTESTED' AND last_tested_at IS NULL) OR "
            "(last_test_status IN ('PASSED','FAILED') AND last_tested_at IS NOT NULL)",
            name=conv("ck_geo_collection_profiles_test"),
        ),
        CheckConstraint("revision >= 0", name=conv("ck_geo_collection_profiles_revision")),
        Index("ix_geo_collection_profiles_surface_active", "engine_surface_id", "is_active"),
        Index("ix_geo_collection_profiles_model", "ai_model_id", "ai_channel_id"),
        Index("ix_geo_collection_profiles_creator", "created_by"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid)
    engine_surface_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(
            "geo_engine_surfaces.id", name="fk_geo_collection_profiles_surface", ondelete="RESTRICT"
        ),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    collection_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    adapter_key: Mapped[str] = mapped_column(String(100), nullable=False)
    ai_channel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    ai_model_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    language_code: Mapped[str] = mapped_column(String(16), nullable=False)
    region_code: Mapped[str] = mapped_column(String(16), nullable=False)
    login_state: Mapped[str] = mapped_column(String(24), nullable=False)
    web_search_policy: Mapped[str] = mapped_column(String(24), nullable=False)
    settings_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    last_test_status: Mapped[str] = mapped_column(
        String(16), nullable=False, default="UNTESTED", server_default="UNTESTED"
    )
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revision: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_geo_collection_profiles_creator", ondelete="RESTRICT"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
