"""允许新内容任务直接围绕产品创建，同时保留历史目标问题关联。"""

import sqlalchemy as sa

from alembic import op

revision = "0019_product_driven_tasks"
down_revision = "0018_manual_geo_observation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """只放宽新任务写入，不改写任何历史任务。"""
    op.alter_column(
        "content_tasks",
        "query_topic_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )


def downgrade() -> None:
    """存在产品驱动任务时拒绝恢复必填，避免伪造历史目标问题。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM content_tasks WHERE query_topic_id IS NULL) THEN
            RAISE EXCEPTION 'product-driven content task history exists; downgrade is forbidden'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )
    op.alter_column(
        "content_tasks",
        "query_topic_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )
