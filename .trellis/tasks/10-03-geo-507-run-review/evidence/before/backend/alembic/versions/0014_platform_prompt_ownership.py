"""将当前 Prompt 所有权从平台类型迁移到具体平台。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0014_platform_prompt_ownership"
down_revision = "0013_publication_closure"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """为同类型的每个具体平台复制一份当前 Prompt，并移除孤立 Prompt。"""
    op.create_table(
        "platform_prompts_new",
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
        INSERT INTO platform_prompts_new (
          platform_profile_id, template_markdown, revision, updated_by, created_at, updated_at
        )
        SELECT profile.id, prompt.template_markdown, prompt.revision,
               prompt.updated_by, prompt.created_at, prompt.updated_at
        FROM platform_prompts prompt
        JOIN platform_profiles profile ON profile.platform_type_id = prompt.platform_type_id
        """
    )
    op.drop_table("platform_prompts")
    op.rename_table("platform_prompts_new", "platform_prompts")


def downgrade() -> None:
    """平台 Prompt 可能已分化，降级必须恢复迁移前数据库备份。"""
    raise RuntimeError("0014 不支持有损降级，请恢复迁移前 PostgreSQL 备份")
