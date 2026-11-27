"""Slice 2B：新增内容策划层 ContentCampaign、QueryTopic 增强与不可变 ContentBriefSnapshot。"""

from pathlib import Path

from alembic import op

revision = "0072_content_planning_layer"
down_revision = "0071_product_fact_ops_metadata"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout='5s'")
    op.execute("SET LOCAL statement_timeout='120s'")
    op.execute(
        (Path(__file__).parents[1] / "sql/0072_content_planning_layer.sql").read_text()
    )


def downgrade() -> None:
    op.execute(
        """DO $$ BEGIN RAISE EXCEPTION '0072内容策划层与Brief快照须保留；采用前向修复或迁移前备份' USING ERRCODE='55000'; END $$"""
    )
