"""分析输入/结果、追加复核与限定 current pointer；不回填历史证据。"""

from pathlib import Path

from alembic import op

revision = "0054_geo_analysis_contract"
down_revision = "0053_geo_collection_admission"
branch_labels = None
depends_on = None


def upgrade() -> None:
    root = Path(__file__).resolve().parents[1] / "sql"
    for name in (
        "0054_geo_analysis_validation.sql",
        "0054_geo_analysis_tables.sql",
        "0054_geo_analysis_guards.sql",
        "0054_geo_current_analysis.sql",
        "0054_geo_review_guards.sql",
    ):
        op.execute((root / name).read_text())


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0054 分析与复核历史必须保留；停止分析写入并前向修复'
            USING ERRCODE='55000';
    END $$;""")
