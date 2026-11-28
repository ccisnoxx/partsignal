"""Slice 1C：三类问题、固定核心计划、历史补录、实际改问与引用分级归因。"""

from pathlib import Path

from alembic import op

revision = "0082_manual_monitoring_links"
down_revision = "0081_articles_publications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    sql_path = Path(__file__).resolve().parents[1] / "sql" / "0082_manual_monitoring_links.sql"
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            RAISE EXCEPTION 'downgrade 0082_manual_monitoring_links is forbidden (forward-only ledger)'
                USING ERRCODE = '55000';
        END $$;
        """
    )
