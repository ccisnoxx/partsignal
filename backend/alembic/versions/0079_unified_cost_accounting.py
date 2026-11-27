"""Slice 4B：新增 AI 模型可选单价、生成/语义质检冻结成本列与运营费用台账表 operating_cost_entries。"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "0079_unified_cost_accounting"
down_revision = "0078_geo_interventions"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.execute((SQL_DIR / "0079_unified_cost_accounting.sql").read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            RAISE EXCEPTION 'downgrade 0079_unified_cost_accounting is forbidden to protect frozen AI cost and ledger history'
                USING ERRCODE = '55000';
        END
        $$;
        """
    )
