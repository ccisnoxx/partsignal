"""新增 GEO Catalog 三表；冻结本 revision，不读取运行时 ORM。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0044_geo_catalog"
down_revision = "0043_geo_platform_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """仅 expand Catalog，不迁移或改写旧文章观测与产品事实。"""
    op.create_table(
        "geo_subjects",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("subject_type", sa.String(32), nullable=False),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("parent_subject_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("parent_subject_type", sa.String(32), nullable=True),
        sa.Column("canonical_name", sa.String(240), nullable=True),
        sa.Column("normalized_name", sa.String(240), nullable=True),
        sa.Column("display_name", sa.String(240), nullable=True),
        sa.Column("description", sa.Text(), server_default=sa.text("''"), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_geo_subjects")),
        sa.CheckConstraint(
            "subject_type IN ('OWN_BRAND', 'OWN_PRODUCT', 'COMPETITOR_BRAND', "
            "'COMPETITOR_PRODUCT', 'REFERENCE_PART')",
            name=op.f("ck_geo_subjects_type"),
        ),
        sa.CheckConstraint(
            "(subject_type = 'OWN_PRODUCT' AND product_id IS NOT NULL "
            "AND canonical_name IS NULL AND normalized_name IS NULL AND display_name IS NULL) "
            "OR (subject_type <> 'OWN_PRODUCT' AND product_id IS NULL "
            "AND canonical_name IS NOT NULL AND normalized_name IS NOT NULL "
            "AND display_name IS NOT NULL)",
            name=op.f("ck_geo_subjects_product_identity"),
        ),
        sa.CheckConstraint(
            "(canonical_name IS NULL OR (length(btrim(canonical_name)) > 0 "
            "AND length(canonical_name) BETWEEN 1 AND 240)) "
            "AND (normalized_name IS NULL OR (length(btrim(normalized_name)) > 0 "
            "AND length(normalized_name) BETWEEN 1 AND 240)) "
            "AND (display_name IS NULL OR (length(btrim(display_name)) > 0 "
            "AND length(display_name) BETWEEN 1 AND 240)) "
            "AND length(description) <= 4000",
            name=op.f("ck_geo_subjects_names"),
        ),
        sa.CheckConstraint("revision >= 0", name=op.f("ck_geo_subjects_revision_nonnegative")),
        sa.CheckConstraint(
            "(parent_subject_id IS NULL AND parent_subject_type IS NULL) "
            "OR (parent_subject_id IS NOT NULL AND parent_subject_type IS NOT NULL "
            "AND ((subject_type = 'OWN_PRODUCT' AND parent_subject_type = 'OWN_BRAND') "
            "OR (subject_type = 'COMPETITOR_PRODUCT' "
            "AND parent_subject_type = 'COMPETITOR_BRAND')))",
            name=op.f("ck_geo_subjects_parent_type"),
        ),
        sa.CheckConstraint(
            "parent_subject_id IS NULL OR parent_subject_id <> id",
            name=op.f("ck_geo_subjects_parent_not_self"),
        ),
        sa.UniqueConstraint("id", "subject_type", name=op.f("uq_geo_subjects_id_type")),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_geo_subjects_product_id_products"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_geo_subjects_created_by_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["parent_subject_id", "parent_subject_type"],
            ["geo_subjects.id", "geo_subjects.subject_type"],
            name=op.f("fk_geo_subjects_parent_identity"),
            match="FULL",
            ondelete="RESTRICT",
            onupdate="RESTRICT",
        ),
    )
    op.create_index(
        "uq_geo_subjects_active_own_product",
        "geo_subjects",
        ["product_id"],
        unique=True,
        postgresql_where=sa.text("subject_type = 'OWN_PRODUCT' AND is_active"),
    )
    op.create_index(
        "ix_geo_subjects_type_active_name_id",
        "geo_subjects",
        ["subject_type", "is_active", "normalized_name", "id"],
    )
    op.create_index(
        "ix_geo_subjects_product_id",
        "geo_subjects",
        ["product_id"],
        postgresql_where=sa.text("product_id IS NOT NULL"),
    )
    op.create_index("ix_geo_subjects_parent_id", "geo_subjects", ["parent_subject_id"])
    op.create_index("ix_geo_subjects_created_by", "geo_subjects", ["created_by"])
    op.create_index("ix_geo_subjects_updated_id", "geo_subjects", ["updated_at", "id"])

    op.create_table(
        "geo_subject_aliases",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("alias", sa.String(240), nullable=False),
        sa.Column("normalized_alias", sa.String(240), nullable=False),
        sa.Column("alias_kind", sa.String(24), nullable=False),
        sa.Column("language_code", sa.String(16), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_geo_subject_aliases")),
        sa.ForeignKeyConstraint(
            ["subject_id"],
            ["geo_subjects.id"],
            name=op.f("fk_geo_subject_aliases_subject_id_subjects"),
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "subject_id",
            "normalized_alias",
            name=op.f("uq_geo_subject_aliases_subject_normalized"),
        ),
        sa.CheckConstraint(
            "alias_kind IN ('NAME', 'PART_NUMBER', 'ABBREVIATION', 'LEGACY')",
            name=op.f("ck_geo_subject_aliases_kind"),
        ),
        sa.CheckConstraint(
            "length(btrim(alias)) > 0 AND length(alias) BETWEEN 1 AND 240 "
            "AND length(btrim(normalized_alias)) > 0 "
            "AND length(normalized_alias) BETWEEN 1 AND 240",
            name=op.f("ck_geo_subject_aliases_text"),
        ),
        sa.CheckConstraint(
            "language_code IS NULL OR (length(language_code) BETWEEN 2 AND 16 "
            "AND language_code ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$')",
            name=op.f("ck_geo_subject_aliases_language"),
        ),
    )
    op.create_index(
        "ix_geo_subject_aliases_normalized_active",
        "geo_subject_aliases",
        ["normalized_alias", "is_active", "subject_id"],
    )
    op.create_table(
        "geo_subject_domains",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("hostname", sa.String(253), nullable=False),
        sa.Column("relation_type", sa.String(24), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_geo_subject_domains")),
        sa.ForeignKeyConstraint(
            ["subject_id"],
            ["geo_subjects.id"],
            name=op.f("fk_geo_subject_domains_subject_id_subjects"),
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "subject_id", "hostname", name=op.f("uq_geo_subject_domains_subject_hostname")
        ),
        sa.CheckConstraint(
            "relation_type IN ('OWNED', 'OFFICIAL', 'DISTRIBUTOR', 'OTHER')",
            name=op.f("ck_geo_subject_domains_relation"),
        ),
        sa.CheckConstraint(
            "length(hostname) BETWEEN 3 AND 253 "
            "AND hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+"
            "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' "
            "AND hostname !~ '^([0-9]+[.]){3}[0-9]+$'",
            name=op.f("ck_geo_subject_domains_hostname"),
        ),
        sa.CheckConstraint("is_active = true", name=op.f("ck_geo_subject_domains_active")),
    )
    op.create_index(
        "ix_geo_subject_domains_hostname", "geo_subject_domains", ["hostname", "subject_id"]
    )
    op.execute(
        """
        CREATE FUNCTION partsignal_guard_geo_subject_identity() RETURNS trigger AS $$
        BEGIN
          IF NEW.subject_type IS DISTINCT FROM OLD.subject_type
             OR NEW.product_id IS DISTINCT FROM OLD.product_id
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'GEO 监测对象身份与创建信息不可原地修改'
              USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER geo_subjects_identity_guard BEFORE UPDATE ON geo_subjects
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_geo_subject_identity();
        """
    )


def downgrade() -> None:
    """Catalog 仅支持前滚，防止降级误删身份和字典。"""
    op.execute(
        """
        DO $$ BEGIN
          RAISE EXCEPTION '0044 GEO Catalog 无法安全降级；请前滚修复或恢复迁移前 PostgreSQL 备份'
            USING ERRCODE = '55000';
        END $$;
        """
    )
