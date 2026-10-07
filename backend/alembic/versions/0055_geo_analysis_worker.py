"""分析执行租约与引用结果；不回填或重写已有 revision。"""

from pathlib import Path

from alembic import op

revision = "0055_geo_analysis_worker"
down_revision = "0054_geo_analysis_contract"
branch_labels = None
depends_on = None


def upgrade() -> None:
    root = Path(__file__).resolve().parents[1] / "sql"
    for name in ("0055_geo_analysis_worker_tables.sql", "0055_geo_analysis_worker_guards.sql"):
        op.execute((root / name).read_text())


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0055 分析执行与引用历史必须保留；停止新 Worker 并前向修复'
            USING ERRCODE='55000';
    END $$;""")
