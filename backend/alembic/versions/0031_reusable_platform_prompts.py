"""把平台私有 Prompt 收敛为可复用模板和平台当前绑定。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0031_reusable_platform_prompts"
down_revision = "0030_publication_record_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """逐条保留旧 Prompt，并让具体平台显式回绑对应模板。"""
    op.create_table(
        "platform_prompts_new",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("template_markdown", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "updated_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey(
                "users.id",
                name="fk_platform_prompt_templates_updated_by_users",
                ondelete="RESTRICT",
            ),
            nullable=False,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name="pk_platform_prompt_templates"),
        sa.UniqueConstraint("name", name="uq_platform_prompt_templates_name"),
    )
    op.add_column(
        "platform_profiles",
        sa.Column("platform_prompt_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_platform_profiles_platform_prompt_id",
        "platform_profiles",
        "platform_prompts_new",
        ["platform_prompt_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.execute(
        """
        INSERT INTO platform_prompts_new (
          id, name, template_markdown, revision, updated_by, created_at, updated_at
        )
        SELECT prompt.platform_profile_id,
               profile.name || '（' || profile.slug || '）',
               prompt.template_markdown,
               prompt.revision,
               prompt.updated_by,
               prompt.created_at,
               prompt.updated_at
        FROM platform_prompts prompt
        JOIN platform_profiles profile ON profile.id = prompt.platform_profile_id
        """
    )
    op.execute(
        """
        UPDATE platform_profiles profile
        SET platform_prompt_id = prompt.platform_profile_id
        FROM platform_prompts prompt
        WHERE profile.id = prompt.platform_profile_id
        """
    )
    op.execute(
        """
        DO $$
        DECLARE
          old_count bigint;
          new_count bigint;
          mismatch_count bigint;
        BEGIN
          SELECT count(*) INTO old_count FROM platform_prompts;
          SELECT count(*) INTO new_count FROM platform_prompts_new;
          IF old_count <> new_count THEN
            RAISE EXCEPTION '平台 Prompt 迁移数量不一致: old=%, new=%',
              old_count, new_count USING ERRCODE = '55000';
          END IF;

          SELECT count(*) INTO mismatch_count
          FROM platform_prompts old_prompt
          JOIN platform_prompts_new new_prompt ON new_prompt.id = old_prompt.platform_profile_id
          JOIN platform_profiles profile ON profile.id = old_prompt.platform_profile_id
          WHERE new_prompt.template_markdown IS DISTINCT FROM old_prompt.template_markdown
             OR new_prompt.revision IS DISTINCT FROM old_prompt.revision
             OR new_prompt.updated_by IS DISTINCT FROM old_prompt.updated_by
             OR new_prompt.created_at IS DISTINCT FROM old_prompt.created_at
             OR new_prompt.updated_at IS DISTINCT FROM old_prompt.updated_at
             OR profile.platform_prompt_id IS DISTINCT FROM new_prompt.id;
          IF mismatch_count <> 0 THEN
            RAISE EXCEPTION '平台 Prompt 迁移内容或绑定不一致: %',
              mismatch_count USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )
    op.drop_table("platform_prompts")
    op.rename_table("platform_prompts_new", "platform_prompts")


def downgrade() -> None:
    """仅在新模型仍能无损表达为一平台一 Prompt 时恢复旧结构。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT prompt.id
            FROM platform_prompts prompt
            LEFT JOIN platform_profiles profile
              ON profile.platform_prompt_id = prompt.id
            GROUP BY prompt.id
            HAVING count(profile.id) <> 1
          ) THEN
            RAISE EXCEPTION 'Prompt 已共享或未绑定，无法无损降级'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )
    op.create_table(
        "platform_prompts_legacy",
        sa.Column(
            "platform_profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("platform_profiles.id", ondelete="CASCADE"),
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
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.execute(
        """
        INSERT INTO platform_prompts_legacy (
          platform_profile_id, template_markdown, revision, updated_by, created_at, updated_at
        )
        SELECT profile.id, prompt.template_markdown, prompt.revision,
               prompt.updated_by, prompt.created_at, prompt.updated_at
        FROM platform_profiles profile
        JOIN platform_prompts prompt ON prompt.id = profile.platform_prompt_id
        """
    )
    op.drop_constraint(
        "fk_platform_profiles_platform_prompt_id",
        "platform_profiles",
        type_="foreignkey",
    )
    op.drop_column("platform_profiles", "platform_prompt_id")
    op.drop_table("platform_prompts")
    op.rename_table("platform_prompts_legacy", "platform_prompts")
