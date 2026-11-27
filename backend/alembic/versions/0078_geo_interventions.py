"""Slice 4A：新增 GEO R6 之上的干预编排与归因聚合表 geo_interventions。"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "0078_geo_interventions"
down_revision = "0077_public_page_health_checks"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.execute((SQL_DIR / "0078_geo_interventions.sql").read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            RAISE EXCEPTION 'downgrade 0078_geo_interventions is forbidden to protect GEO intervention attribution history'
                USING ERRCODE = '55000';
        END
        $$;
        """
    )
