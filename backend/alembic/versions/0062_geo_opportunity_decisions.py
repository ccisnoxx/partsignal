"""GEO-706：加法保存显式处理和不可变比较证据，不回填历史。"""

from pathlib import Path

from alembic import op

revision = "0062_geo_opportunity_decisions"
down_revision = "0061_geo_retests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.get_bind().exec_driver_sql(
        (Path(__file__).resolve().parents[1] / "sql" / "0062_geo_opportunity_decisions.sql").read_text()
    )


def downgrade() -> None:
    raise RuntimeError("0062处理历史不可破坏性降级；请恢复迁移前备份或使用前向修复迁移")
