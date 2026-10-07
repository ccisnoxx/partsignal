"""受控人工复核发布；历史机器结果与Review不回填、不改写。"""

from pathlib import Path

from alembic import op

revision = "0056_geo_run_review"
down_revision = "0055_geo_analysis_worker"
branch_labels = None
depends_on = None


def upgrade() -> None:
    source = Path(__file__).resolve().parents[1] / "sql" / "0056_geo_run_review.sql"
    op.execute(source.read_text())


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0056人工复核历史必须保留；关闭复核写入口并前向修复'
            USING ERRCODE='55000';
    END $$;""")
