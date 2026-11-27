"""Slice 3D：新增平台公开页面健康检查配置与不可变检查历史表 published_article_health_checks。"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "0077_public_page_health_checks"
down_revision = "0076_quality_gate_duplication"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.execute((SQL_DIR / "0077_public_page_health_checks.sql").read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            RAISE EXCEPTION 'downgrade 0077_public_page_health_checks is forbidden to protect public page health check history'
                USING ERRCODE = '55000';
        END
        $$;
        """
    )
