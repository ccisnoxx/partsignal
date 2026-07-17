"""增加全局自然化 Prompt，并让现有 AI 作业承载自然化修订。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0017_content_humanization"
down_revision = "0016_fact_review_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """创建未配置的单例 Prompt，并扩展现有生成作业。"""
    op.create_table(
        "content_humanization_prompts",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("template_markdown", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column("updated_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("id = 1", name="ck_content_humanization_prompts_singleton"),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.add_column(
        "generation_jobs",
        sa.Column("job_type", sa.String(length=24), server_default="GENERATE", nullable=False),
    )
    op.add_column(
        "generation_jobs",
        sa.Column("source_content_version_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_generation_jobs_source_content_version_id_content_versions",
        "generation_jobs",
        "content_versions",
        ["source_content_version_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_generation_jobs_job_type",
        "generation_jobs",
        "job_type IN ('GENERATE', 'HUMANIZE')",
    )
    op.create_check_constraint(
        "ck_generation_jobs_job_type_source",
        "generation_jobs",
        "(job_type = 'GENERATE' AND source_content_version_id IS NULL) OR "
        "(job_type = 'HUMANIZE' AND source_content_version_id IS NOT NULL)",
    )
    op.create_index(
        "uq_generation_jobs_active_humanization_source",
        "generation_jobs",
        ["source_content_version_id"],
        unique=True,
        postgresql_where=sa.text("job_type = 'HUMANIZE' AND status IN ('PENDING', 'RUNNING')"),
    )
    op.alter_column("generation_jobs", "job_type", server_default=None)


def downgrade() -> None:
    """仅在尚无自然化历史时移除扩展，避免破坏不可变追溯。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM generation_jobs WHERE job_type = 'HUMANIZE') THEN
            RAISE EXCEPTION 'content humanization history exists; downgrade is forbidden'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )
    op.drop_index("uq_generation_jobs_active_humanization_source", table_name="generation_jobs")
    op.drop_constraint("ck_generation_jobs_job_type_source", "generation_jobs", type_="check")
    op.drop_constraint("ck_generation_jobs_job_type", "generation_jobs", type_="check")
    op.drop_constraint(
        "fk_generation_jobs_source_content_version_id_content_versions",
        "generation_jobs",
        type_="foreignkey",
    )
    op.drop_column("generation_jobs", "source_content_version_id")
    op.drop_column("generation_jobs", "job_type")
    op.drop_table("content_humanization_prompts")
