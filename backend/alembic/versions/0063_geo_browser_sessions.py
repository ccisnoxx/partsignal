"""GEO-802：仅增加受保护会话引用、撤销事实与审计动作。"""

from pathlib import Path

from alembic import op

revision = "0063_geo_browser_sessions"
down_revision = "0062_geo_opportunity_decisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.get_bind().exec_driver_sql(
        (Path(__file__).resolve().parents[1] / "sql" / "0063_geo_browser_sessions.sql").read_text()
    )


def downgrade() -> None:
    raise RuntimeError("0063会话撤销历史不可破坏性降级；请恢复迁移前备份或前向修复")
