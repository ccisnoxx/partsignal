"""GEO-702：机会、追加来源/行动/评估及真实 Batch 来源外键。"""

from pathlib import Path

from alembic import op

revision = "0059_geo_opportunities"
down_revision = "0058_geo_rule_configuration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.get_bind().exec_driver_sql(
        (Path(__file__).resolve().parents[1] / "sql" / "0059_geo_opportunities.sql").read_text()
    )


def downgrade() -> None:
    raise RuntimeError("0059机会历史不可破坏性降级；请恢复迁移前备份或使用前向修复迁移")
