"""Slice 3A：PlatformPrompt 不可变版本化、平台显式绑定版本与 GenerationJob 版本归因。"""

from pathlib import Path

from alembic import op

revision = "0075_prompt_versioning_v4"
down_revision = "0074_assignments_sla_inbox"
branch_labels = None
depends_on = None

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"


def upgrade() -> None:
    sql = (SQL_DIR / "0075_prompt_versioning_and_brief_v4.sql").read_text(encoding="utf-8")
    op.execute(sql)


def downgrade() -> None:
    op.execute(
        "DO $$ BEGIN "
        "RAISE EXCEPTION '0075_prompt_versioning_v4 禁止降级删除 Prompt 版本历史与绑定关系' "
        "USING ERRCODE = '55000'; "
        "END $$;"
    )
