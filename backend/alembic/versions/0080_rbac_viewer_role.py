"""Slice 1A：新增领导只读角色 VIEWER，建立三级 RBAC 数据库约束。"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "0080_rbac_viewer_role"
down_revision = "0079_unified_cost_accounting"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.execute((SQL_DIR / "0080_rbac_viewer_role.sql").read_text(encoding="utf-8"))


def downgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            RAISE EXCEPTION 'downgrade 0080_rbac_viewer_role is forbidden to protect VIEWER user role history'
                USING ERRCODE = '55000';
        END
        $$;
        """
    )
