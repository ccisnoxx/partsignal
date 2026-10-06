"""GEO 终态草稿清理墓碑；不改已提交证据、不回填历史。"""

from pathlib import Path

from alembic import op

revision = "0064_geo_retention"
down_revision = "0063_geo_browser_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    sql_dir = Path(__file__).resolve().parents[1] / "sql"
    op.execute((sql_dir / "0064_geo_retention.sql").read_text())


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0064 清理墓碑不可安全降级；停止清理并保留历史，采用前向修复'
            USING ERRCODE='55000';
    END $$;""")
