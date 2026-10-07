"""GEO-607：洞察日期候选索引，不改变历史数据或业务约束。"""

import sqlalchemy as sa

from alembic import op

revision = "0057_geo_insight_indexes"
down_revision = "0056_geo_run_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 事务内创建，锁等待有界；失败整体回滚，部署需预留停写窗口。
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.create_index(
        "ix_geo_runs_insight_created", "geo_observation_runs", [sa.text("created_at DESC"), "id"]
    )


def downgrade() -> None:
    # 仅撤销派生访问路径，保留所有 Run/Answer/Analysis/Review 及指标事实。
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.drop_index("ix_geo_runs_insight_created", table_name="geo_observation_runs")
