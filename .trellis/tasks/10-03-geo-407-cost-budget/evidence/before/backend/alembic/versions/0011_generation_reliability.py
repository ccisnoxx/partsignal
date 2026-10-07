"""增加生成作业补投递诊断字段与到期扫描索引。"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0011_generation_reliability"
down_revision = "0010_user_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """以可向后读取的方式扩展生成作业投递元数据。"""
    op.add_column(
        "generation_jobs",
        sa.Column("last_dispatch_attempt_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "generation_jobs",
        sa.Column(
            "dispatch_attempt_count",
            sa.Integer(),
            server_default="0",
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_generation_jobs_dispatch_attempt_count_nonnegative",
        "generation_jobs",
        "dispatch_attempt_count >= 0",
    )
    op.create_index(
        "ix_generation_jobs_pending_dispatch_due",
        "generation_jobs",
        [sa.text("COALESCE(last_dispatch_attempt_at, created_at)")],
        postgresql_where=sa.text("status = 'PENDING'"),
    )


def downgrade() -> None:
    """仅移除可重建的投递诊断元数据，不修改业务作业记录。"""
    op.drop_index("ix_generation_jobs_pending_dispatch_due", table_name="generation_jobs")
    op.drop_constraint(
        "ck_generation_jobs_dispatch_attempt_count_nonnegative",
        "generation_jobs",
        type_="check",
    )
    op.drop_column("generation_jobs", "dispatch_attempt_count")
    op.drop_column("generation_jobs", "last_dispatch_attempt_at")
