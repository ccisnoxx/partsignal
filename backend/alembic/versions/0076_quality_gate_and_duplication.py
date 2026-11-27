"""Slice 3B：新增双层内容质量检查异步语义核查表 content_quality_check_jobs。"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "0076_quality_gate_duplication"
down_revision = "0075_prompt_versioning_v4"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.execute((SQL_DIR / "0076_quality_gate_and_duplication.sql").read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            RAISE EXCEPTION 'downgrade 0076_quality_gate_duplication is forbidden to protect semantic quality check history'
                USING ERRCODE = '55000';
        END
        $$;
        """
    )
