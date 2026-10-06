"""人工草稿和不可变提交身份；不回填或修改已提交证据。"""

from pathlib import Path

from alembic import op

revision = "0051_geo_manual_collection"
down_revision = "0050_geo_answer_evidence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    sql_dir = Path(__file__).resolve().parents[1] / "sql"
    op.execute((sql_dir / "0051_geo_manual_collection.sql").read_text())


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0051 人工提交身份不可安全降级；保留证据并前向修复'
            USING ERRCODE='55000';
    END $$;""")
