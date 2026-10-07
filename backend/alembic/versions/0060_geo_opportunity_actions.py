"""GEO-704：行动来源快照、幂等回执与目标生命周期保护。"""

from pathlib import Path

from alembic import op

revision = "0060_geo_opportunity_actions"
down_revision = "0059_geo_opportunities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.get_bind().exec_driver_sql(
        (
            Path(__file__).resolve().parents[1] / "sql" / "0060_geo_opportunity_actions.sql"
        ).read_text()
    )


def downgrade() -> None:
    raise RuntimeError("0060行动历史不可破坏性降级；请恢复备份或使用前向修复迁移")
