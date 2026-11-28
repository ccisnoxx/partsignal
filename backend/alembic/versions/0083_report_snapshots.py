"""Slice 1D：新增不可变冻结周/月报快照表 geo_report_snapshots 与修订链。"""

from pathlib import Path

from alembic import op

revision = "0083_report_snapshots"
down_revision = "0082_manual_monitoring_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    sql_path = Path(__file__).resolve().parents[1] / "sql" / "0083_report_snapshots.sql"
    op.execute(sql_path.read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            RAISE EXCEPTION 'downgrade 0083_report_snapshots is forbidden (frozen report history)'
                USING ERRCODE = '55000';
        END $$;
        """
    )
