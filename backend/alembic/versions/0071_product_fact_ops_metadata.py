"""Slice 2A：新增产品事实运营元数据、新鲜度治理与 FactVersion 不可变冻结字段。"""

from pathlib import Path

from alembic import op

revision = "0071_product_fact_ops_metadata"
down_revision = "0070_geo_citation_observation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout='5s'")
    op.execute("SET LOCAL statement_timeout='120s'")
    op.execute(
        (Path(__file__).parents[1] / "sql/0071_product_fact_ops_metadata.sql").read_text()
    )


def downgrade() -> None:
    op.execute(
        """DO $$ BEGIN RAISE EXCEPTION '0071产品事实运营元数据须保留；采用前向修复或迁移前备份' USING ERRCODE='55000'; END $$"""
    )
