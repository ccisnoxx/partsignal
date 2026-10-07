"""加法保存预算预留与发送限速事实，历史 Run 和原始证据保持不变。"""

from pathlib import Path

from alembic import op

revision = "0053_geo_collection_admission"
down_revision = "0052_geo_profile_tests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        (Path(__file__).resolve().parents[1] / "sql/0053_geo_collection_admission.sql").read_text()
    )


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0053 预算与发送历史必须保留；关闭采集并前向修复'
            USING ERRCODE='55000';
    END $$;""")
