"""为生成输入增加显式数据分级与责任人记录。"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0012_ai_data_classification"
down_revision = "0011_generation_reliability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """只扩展可空字段，历史任务必须人工分级后才能出站。"""
    op.add_column(
        "content_tasks",
        sa.Column("generation_data_classification", sa.String(length=16), nullable=True),
    )
    op.add_column(
        "content_tasks",
        sa.Column(
            "generation_data_classified_by",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.add_column(
        "content_tasks",
        sa.Column(
            "generation_data_classified_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_content_tasks_generation_data_classified_by_users",
        "content_tasks",
        "users",
        ["generation_data_classified_by"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_content_tasks_generation_data_classification",
        "content_tasks",
        "generation_data_classification IS NULL OR "
        "generation_data_classification IN ('PUBLIC', 'INTERNAL', 'RESTRICTED')",
    )
    op.create_check_constraint(
        "ck_content_tasks_generation_data_classification_complete",
        "content_tasks",
        "(generation_data_classification IS NULL "
        "AND generation_data_classified_by IS NULL "
        "AND generation_data_classified_at IS NULL) OR "
        "(generation_data_classification IS NOT NULL "
        "AND generation_data_classified_by IS NOT NULL "
        "AND generation_data_classified_at IS NOT NULL)",
    )


def downgrade() -> None:
    """移除分级元数据，不改写任务 Prompt 或生成历史。"""
    op.drop_constraint(
        "ck_content_tasks_generation_data_classification_complete",
        "content_tasks",
        type_="check",
    )
    op.drop_constraint(
        "ck_content_tasks_generation_data_classification",
        "content_tasks",
        type_="check",
    )
    op.drop_constraint(
        "fk_content_tasks_generation_data_classified_by_users",
        "content_tasks",
        type_="foreignkey",
    )
    op.drop_column("content_tasks", "generation_data_classified_at")
    op.drop_column("content_tasks", "generation_data_classified_by")
    op.drop_column("content_tasks", "generation_data_classification")
