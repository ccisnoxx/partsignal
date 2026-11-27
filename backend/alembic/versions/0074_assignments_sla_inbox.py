"""Slice 2D：在 5 个主聚合新增统一任务分派、SLA 列与终态冻结守卫。"""

from pathlib import Path

from alembic import op

revision = "0074_assignments_sla_inbox"
down_revision = "0073_content_task_batch_planning"
branch_labels = None
depends_on = None

SQL_PATH = Path(__file__).resolve().parents[1] / "sql" / "0074_assignments_sla_inbox.sql"


def upgrade() -> None:
    """纯加法新增分派与 SLA 列及部分索引，更新非终态可变/终态冻结触发器。"""
    op.execute("SET LOCAL lock_timeout='5s'")
    op.execute("SET LOCAL statement_timeout='120s'")
    op.execute(SQL_PATH.read_text(encoding="utf-8"))


def downgrade() -> None:
    """禁止破坏性降级销毁任务分派与 SLA 治理记录；恢复请走迁移前备份或前向修复。"""
    op.execute(
        "DO $$ BEGIN "
        "RAISE EXCEPTION '0074_assignments_sla_inbox downgrade is forbidden to protect "
        "assignment and SLA history' USING ERRCODE = '55000'; "
        "END $$;"
    )
