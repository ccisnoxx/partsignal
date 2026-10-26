"""MAN-02：新增采集者引用观察事实，历史记录保持 NULL。"""

from pathlib import Path

from alembic import op

revision = "0070_geo_citation_observation"
down_revision = "0069_geo_manual_cancellation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout='5s'")
    op.execute("SET LOCAL statement_timeout='120s'")
    op.execute((Path(__file__).parents[1] / "sql/0070_geo_citation_observation.sql").read_text())


def downgrade() -> None:
    op.execute(
        """DO $$ BEGIN RAISE EXCEPTION '0070引用观察事实须保留；采用前向修复或迁移前备份' USING ERRCODE='55000'; END $$"""
    )
