"""迁移账号类型、配置中心与真实 AI 生成字段。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0009_config_center"
down_revision = "0008_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """一次性替换旧权限来源并创建配置中心结构。"""
    op.add_column("users", sa.Column("account_type", sa.String(24), nullable=True))
    op.add_column(
        "users",
        sa.Column("must_change_password", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.execute(
        """
        UPDATE users
        SET account_type = CASE
          WHEN EXISTS (
            SELECT 1 FROM user_roles
            WHERE user_roles.user_id = users.id
              AND user_roles.role_name = 'SYSTEM_ADMIN'
          ) THEN 'ADMIN'
          ELSE 'ENGINEER'
        END
        """
    )
    op.alter_column("users", "account_type", nullable=False)
    op.create_check_constraint(
        "ck_users_account_type", "users", "account_type IN ('ADMIN', 'ENGINEER')"
    )
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM users)
             AND NOT EXISTS (
               SELECT 1 FROM users WHERE account_type = 'ADMIN' AND is_active = true
             ) THEN
            RAISE EXCEPTION 'existing users require one active administrator';
          END IF;
        END;
        $$;
        """
    )
    op.drop_table("user_roles")
    op.drop_table("roles")

    op.create_table(
        "platform_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("slug", sa.String(100), nullable=False, unique=True),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "platform_prompts",
        sa.Column(
            "platform_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform_types.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("template_markdown", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "updated_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column(
        "platform_profiles",
        sa.Column("platform_type_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column(
        "platform_profiles", sa.Column("revision", sa.Integer(), server_default="0", nullable=False)
    )
    op.create_foreign_key(
        "fk_platform_profiles_platform_type_id",
        "platform_profiles",
        "platform_types",
        ["platform_type_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.add_column(
        "content_tasks", sa.Column("platform_type_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "content_tasks", sa.Column("platform_type_snapshot", postgresql.JSONB(), nullable=True)
    )
    op.add_column(
        "content_tasks",
        sa.Column("user_prompt_markdown", sa.Text(), server_default="", nullable=False),
    )
    op.create_foreign_key(
        "fk_content_tasks_platform_type_id",
        "content_tasks",
        "platform_types",
        ["platform_type_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_validate_content_task() RETURNS trigger AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM fact_versions
            WHERE id = NEW.fact_version_id AND product_id = NEW.product_id AND status = 'APPROVED'
          ) THEN
            RAISE EXCEPTION 'content task requires approved fact version' USING ERRCODE = '23514';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM platform_profile_versions version
            JOIN platform_profiles profile ON profile.id = version.platform_profile_id
            WHERE version.id = NEW.platform_profile_version_id
              AND version.status = 'ACTIVE'
              AND profile.platform_type_id = NEW.platform_type_id
          ) OR NEW.platform_type_snapshot IS NULL THEN
            RAISE EXCEPTION 'content task requires classified active platform' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE FUNCTION partsignal_guard_content_task_type() RETURNS trigger AS $$
        BEGIN
          IF NEW.platform_type_snapshot IS DISTINCT FROM OLD.platform_type_snapshot
             OR (
               NEW.platform_type_id IS DISTINCT FROM OLD.platform_type_id
               AND NEW.platform_type_id IS NOT NULL
             ) THEN
            RAISE EXCEPTION 'content task platform type is immutable' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER content_tasks_type_guard
        BEFORE UPDATE ON content_tasks
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_task_type();
        """
    )

    op.create_table(
        "ai_channels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("base_url", sa.Text(), nullable=False),
        sa.Column("api_key_ciphertext", sa.Text(), nullable=False),
        sa.Column("api_key_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False),
        sa.Column("is_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("timeout_seconds BETWEEN 10 AND 600", name="ck_ai_channels_timeout"),
    )
    op.create_table(
        "ai_channel_headers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "channel_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ai_channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("normalized_name", sa.String(160), nullable=False),
        sa.Column("is_sensitive", sa.Boolean(), nullable=False),
        sa.Column("plain_value", sa.Text(), nullable=True),
        sa.Column("encrypted_value", sa.Text(), nullable=True),
        sa.UniqueConstraint("channel_id", "normalized_name"),
        sa.CheckConstraint(
            "(plain_value IS NOT NULL)::int + (encrypted_value IS NOT NULL)::int = 1",
            name="ck_ai_channel_headers_exactly_one_value",
        ),
        sa.CheckConstraint(
            "(is_sensitive AND encrypted_value IS NOT NULL AND plain_value IS NULL) OR "
            "(NOT is_sensitive AND plain_value IS NOT NULL AND encrypted_value IS NULL)",
            name="ck_ai_channel_headers_sensitivity_matches_storage",
        ),
    )
    op.create_table(
        "ai_models",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "channel_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("ai_channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("model_id", sa.String(300), nullable=False),
        sa.Column("request_parameters", postgresql.JSONB(), server_default="{}", nullable=False),
        sa.Column("is_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("test_status", sa.String(24), server_default="UNTESTED", nullable=False),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_test_error_summary", sa.Text(), nullable=True),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("channel_id", "model_id"),
        sa.CheckConstraint(
            "test_status IN ('UNTESTED', 'PASSED', 'FAILED')",
            name="ck_ai_models_test_status",
        ),
    )

    for name in ("ai_channel_id", "ai_model_id"):
        op.add_column(
            "generation_jobs", sa.Column(name, postgresql.UUID(as_uuid=True), nullable=True)
        )
    op.create_foreign_key(
        "fk_generation_jobs_ai_channel_id",
        "generation_jobs",
        "ai_channels",
        ["ai_channel_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_generation_jobs_ai_model_id",
        "generation_jobs",
        "ai_models",
        ["ai_model_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column("generation_jobs", sa.Column("provider_request_id", sa.Text()))
    op.add_column("generation_jobs", sa.Column("response_duration_ms", sa.Integer()))
    op.add_column("generation_jobs", sa.Column("prompt_tokens", sa.Integer()))
    op.add_column("generation_jobs", sa.Column("completion_tokens", sa.Integer()))
    op.add_column("generation_jobs", sa.Column("total_tokens", sa.Integer()))
    op.create_check_constraint(
        "ck_generation_jobs_response_duration_nonnegative",
        "generation_jobs",
        "response_duration_ms IS NULL OR response_duration_ms >= 0",
    )
    op.create_check_constraint(
        "ck_generation_jobs_prompt_tokens_nonnegative",
        "generation_jobs",
        "prompt_tokens IS NULL OR prompt_tokens >= 0",
    )
    op.create_check_constraint(
        "ck_generation_jobs_completion_tokens_nonnegative",
        "generation_jobs",
        "completion_tokens IS NULL OR completion_tokens >= 0",
    )
    op.create_check_constraint(
        "ck_generation_jobs_total_tokens_nonnegative",
        "generation_jobs",
        "total_tokens IS NULL OR total_tokens >= 0",
    )

    op.execute("DROP TRIGGER IF EXISTS content_versions_guard ON content_versions")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_content_version()")
    for name in ("used_fact_ids", "used_evidence_ids", "required_disclosure_ids"):
        op.drop_column("content_versions", name)
    op.execute(
        """
        CREATE FUNCTION partsignal_guard_content_version() RETURNS trigger AS $$
        BEGIN
          IF NEW.task_id IS DISTINCT FROM OLD.task_id
             OR NEW.fact_version_id IS DISTINCT FROM OLD.fact_version_id
             OR NEW.source_job_id IS DISTINCT FROM OLD.source_job_id
             OR NEW.based_on_id IS DISTINCT FROM OLD.based_on_id
             OR NEW.version IS DISTINCT FROM OLD.version
             OR NEW.source_type IS DISTINCT FROM OLD.source_type
             OR NEW.title IS DISTINCT FROM OLD.title
             OR NEW.summary IS DISTINCT FROM OLD.summary
             OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
             OR NEW.tags IS DISTINCT FROM OLD.tags
             OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
             OR NEW.quality_issues IS DISTINCT FROM OLD.quality_issues
             OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'content version payload is immutable' USING ERRCODE = '55000';
          END IF;
          IF NOT (
            (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PENDING_REVIEW')) OR
            (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
            (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'SUPERSEDED')) OR
            (OLD.status = NEW.status)
          ) THEN
            RAISE EXCEPTION 'invalid content version transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER content_versions_guard
        BEFORE UPDATE ON content_versions
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_version();
        """
    )


def downgrade() -> None:
    """该迁移包含有损权限映射，只允许从迁移前数据库备份恢复。"""
    raise RuntimeError("0009 包含不可逆数据迁移；请恢复迁移前 PostgreSQL 备份")
