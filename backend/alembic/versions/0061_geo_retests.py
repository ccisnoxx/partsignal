"""GEO-705：严格复测冻结基线、幂等回执和提交时矩阵验证。"""

from pathlib import Path

from alembic import op

revision = "0061_geo_retests"
down_revision = "0060_geo_opportunity_actions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.get_bind().exec_driver_sql(
        (Path(__file__).resolve().parents[1] / "sql" / "0061_geo_retests.sql").read_text()
    )


def downgrade() -> None:
    raise RuntimeError("0061复测历史不可破坏性降级；请恢复迁移前备份或使用前向修复迁移")
