"""为普通内容任务创建增加持久化请求键幂等约束。"""

import sqlalchemy as sa

from alembic import op

revision = "0032_content_task_idempotency"
down_revision = "0031_reusable_platform_prompts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """保留历史空值，只约束新写入的非空请求键唯一。"""
    op.add_column(
        "content_tasks",
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
    )
    op.create_unique_constraint(
        "uq_content_tasks_idempotency_key",
        "content_tasks",
        ["idempotency_key"],
    )


def downgrade() -> None:
    """移除请求键结构，不删除或改写内容任务。"""
    op.drop_constraint(
        "uq_content_tasks_idempotency_key",
        "content_tasks",
        type_="unique",
    )
    op.drop_column("content_tasks", "idempotency_key")
