"""记录内容版本自身的真实更新时间。"""

import sqlalchemy as sa

from alembic import op

revision = "0042_content_version_detail"
down_revision = "0041_content_task_list"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """保留旧版本未知时间，并只为后续写入设置默认值。"""
    op.add_column(
        "content_versions",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column(
        "content_versions",
        "updated_at",
        server_default=sa.func.now(),
    )


def downgrade() -> None:
    """移除内容版本更新时间。"""
    op.drop_column("content_versions", "updated_at")
