"""API Profile 当前诊断资格与依赖失效；不修改业务历史。"""

from pathlib import Path

from alembic import op

revision = "0052_geo_profile_tests"
down_revision = "0051_geo_manual_collection"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute((Path(__file__).resolve().parents[1] / "sql/0052_geo_profile_tests.sql").read_text())


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0052 资格失效不可恢复为旧测试事实；关闭 API 开关并前向修复'
            USING ERRCODE='55000';
    END $$;""")
