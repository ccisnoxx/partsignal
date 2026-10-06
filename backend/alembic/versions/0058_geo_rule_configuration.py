"""GEO-701：当前规则配置和不可变 revision 历史，不回填既有评估。"""

from pathlib import Path

from alembic import op

revision = "0058_geo_rule_configuration"
down_revision = "0057_geo_insight_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.get_bind().exec_driver_sql(
        (
            Path(__file__).resolve().parents[1] / "sql" / "0058_geo_rule_configuration.sql"
        ).read_text()
    )


def downgrade() -> None:
    # 已保存规则可能被历史评估引用；不能降级删除不可变事实。
    raise RuntimeError("GEO规则历史不可破坏性降级；请恢复迁移前备份或使用前向修复迁移")
