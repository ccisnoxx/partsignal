"""补齐内容任务列表的稳定更新时间与排序索引。"""

import sqlalchemy as sa

from alembic import op

revision = "0041_content_task_list"
down_revision = "0040_content_draft_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """回填现有任务时间，并建立列表筛选排序索引。"""
    op.add_column(
        "content_tasks",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("UPDATE content_tasks SET updated_at = created_at")
    op.alter_column(
        "content_tasks",
        "updated_at",
        nullable=False,
        server_default=sa.func.now(),
    )
    op.create_index(
        "ix_content_tasks_archived_at_updated_at",
        "content_tasks",
        ["archived_at", "updated_at", "id"],
    )


def downgrade() -> None:
    """移除只用于列表读模型的时间列与索引。"""
    op.drop_index("ix_content_tasks_archived_at_updated_at", table_name="content_tasks")
    op.drop_column("content_tasks", "updated_at")
