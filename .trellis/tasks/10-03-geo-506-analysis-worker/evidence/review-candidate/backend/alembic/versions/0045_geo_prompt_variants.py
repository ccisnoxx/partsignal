"""仅新增问题变体，冻结规范化及历史锁存，不回填旧问题数组。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0045_geo_prompt_variants"
down_revision = "0044_geo_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 固定 UTF8 编码；convert_to 是 STABLE，使用冻结的固定编码函数建立生成列合同。
    op.execute("""
        DO $$ BEGIN
            IF current_setting('server_encoding') <> 'UTF8' THEN
                RAISE EXCEPTION 'GEO PromptVariant 要求 UTF8 数据库';
            END IF;
        END $$;
        CREATE FUNCTION geo_prompt_text_hash(value text) RETURNS text
        LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
        BEGIN
            RETURN encode(sha256(convert_to(value, 'UTF8')), 'hex');
        END $$;
        CREATE FUNCTION geo_normalize_prompt_text(value text) RETURNS text
        LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
            SELECT btrim(regexp_replace(normalize(value, NFKC),
                '[' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)
                || chr(28) || chr(29) || chr(30) || chr(31) || chr(32)
                || chr(133) || chr(160) || chr(5760) || chr(8192) || chr(8193)
                || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198)
                || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232)
                || chr(8233) || chr(8239) || chr(8287) || chr(12288) || ']+',
                ' ', 'g'))
        $$;
    """)
    op.create_table(
        "geo_prompt_variants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("query_topic_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("prompt_text", sa.Text(), nullable=False),
        sa.Column(
            "normalized_hash",
            sa.String(64),
            sa.Computed("geo_prompt_text_hash(prompt_text)", persisted=True),
            nullable=False,
        ),
        sa.Column("mention_mode", sa.String(16), nullable=False),
        sa.Column("language_code", sa.String(16), nullable=False),
        sa.Column("region_code", sa.String(16), nullable=False),
        sa.Column("priority", sa.String(16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("revision", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("first_referenced_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_geo_prompt_variants")),
        sa.ForeignKeyConstraint(
            ["query_topic_id"],
            ["query_topics.id"],
            name=op.f("fk_geo_prompt_variants_topic"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name=op.f("fk_geo_prompt_variants_creator"),
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint(
            "query_topic_id",
            "normalized_hash",
            "mention_mode",
            "language_code",
            "region_code",
            name=op.f("uq_geo_prompt_variants_identity"),
        ),
        sa.CheckConstraint(
            "length(prompt_text) BETWEEN 1 AND 8000 "
            "AND prompt_text = geo_normalize_prompt_text(prompt_text)",
            name=op.f("ck_geo_prompt_variants_prompt"),
        ),
        sa.CheckConstraint(
            "mention_mode IN ('BRANDED', 'UNBRANDED')",
            name=op.f("ck_geo_prompt_variants_mention_mode"),
        ),
        sa.CheckConstraint(
            "length(language_code) BETWEEN 2 AND 16 "
            "AND language_code ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$'",
            name=op.f("ck_geo_prompt_variants_language"),
        ),
        sa.CheckConstraint(
            "region_code ~ '^[A-Z]{2}$' AND length(region_code) = 2",
            name=op.f("ck_geo_prompt_variants_region"),
        ),
        sa.CheckConstraint(
            "priority IN ('CORE', 'STANDARD', 'EXPLORATORY')",
            name=op.f("ck_geo_prompt_variants_priority"),
        ),
        sa.CheckConstraint(
            "revision >= 0", name=op.f("ck_geo_prompt_variants_revision_nonnegative")
        ),
        sa.CheckConstraint(
            "first_referenced_at IS NULL OR first_referenced_at >= created_at",
            name=op.f("ck_geo_prompt_variants_reference_time"),
        ),
    )
    op.create_index(
        "ix_geo_prompt_variants_topic_active",
        "geo_prompt_variants",
        ["query_topic_id", "is_active"],
    )
    op.create_index("ix_geo_prompt_variants_created_by", "geo_prompt_variants", ["created_by"])
    op.execute("""
        CREATE FUNCTION geo_guard_prompt_variant() RETURNS trigger
        LANGUAGE plpgsql AS $$
        DECLARE semantics_changed boolean; changed boolean;
        BEGIN
            IF TG_OP = 'INSERT' THEN
                IF NEW.revision <> 0 OR NEW.first_referenced_at IS NOT NULL THEN
                    RAISE EXCEPTION '变体必须从未引用的 revision 0 创建'
                        USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_initial';
                END IF;
                RETURN NEW;
            END IF;
            IF TG_OP = 'DELETE' THEN
                IF OLD.first_referenced_at IS NOT NULL THEN
                    RAISE EXCEPTION '已引用变体只能停用'
                        USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_history';
                END IF;
                RETURN OLD;
            END IF;
            IF ROW(NEW.id, NEW.query_topic_id, NEW.created_by, NEW.created_at)
                IS DISTINCT FROM ROW(OLD.id, OLD.query_topic_id, OLD.created_by, OLD.created_at) THEN
                RAISE EXCEPTION '变体归属与创建身份不可变'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_identity';
            END IF;
            semantics_changed := ROW(NEW.prompt_text, NEW.mention_mode, NEW.language_code,
                                     NEW.region_code, NEW.priority)
                IS DISTINCT FROM ROW(OLD.prompt_text, OLD.mention_mode, OLD.language_code,
                                     OLD.region_code, OLD.priority);
            IF OLD.first_referenced_at IS NOT NULL AND
                (semantics_changed OR NEW.first_referenced_at IS DISTINCT FROM OLD.first_referenced_at
                 OR (NOT OLD.is_active AND NEW.is_active)) THEN
                RAISE EXCEPTION '已引用变体只能停用'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_history';
            END IF;
            IF OLD.first_referenced_at IS NULL AND NEW.first_referenced_at IS NOT NULL
                AND (semantics_changed OR NOT OLD.is_active OR NOT NEW.is_active) THEN
                RAISE EXCEPTION '引用锁存必须保持正在运行的原始语义'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_history';
            END IF;
            changed := semantics_changed OR NEW.is_active IS DISTINCT FROM OLD.is_active
                OR NEW.first_referenced_at IS DISTINCT FROM OLD.first_referenced_at;
            IF NEW.revision <> OLD.revision + (CASE WHEN changed THEN 1 ELSE 0 END) THEN
                RAISE EXCEPTION '有效变更 revision 必须恰好递增一次'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_revision_step';
            END IF;
            IF (NOT changed AND NEW.updated_at IS DISTINCT FROM OLD.updated_at)
                OR NEW.updated_at < OLD.updated_at THEN
                RAISE EXCEPTION '更新时间必须保持单调且 no-op 不改写'
                    USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_updated_at';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER geo_prompt_variant_guard BEFORE INSERT OR UPDATE OR DELETE
            ON geo_prompt_variants FOR EACH ROW EXECUTE FUNCTION geo_guard_prompt_variant();
    """)


def downgrade() -> None:
    # 历史引用不可抹除；失败保持 revision 和全部数据，由前向修复恢复。
    op.execute("""
        DO $$ BEGIN
            RAISE EXCEPTION '0045 GEO PromptVariant 无法安全降级；保留历史并使用前向修复'
                USING ERRCODE = '55000';
        END $$;
    """)
