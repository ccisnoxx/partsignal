"""Slice 2C：新增批量内容任务规划幂等回执表 content_task_batch_requests。"""

from pathlib import Path

from alembic import op

revision = "0073_content_task_batch_planning"
down_revision = "0072_content_planning_layer"
branch_labels = None
depends_on = None

SQL_PATH = Path(__file__).resolve().parents[1] / "sql" / "0073_content_task_batch_planning.sql"


def upgrade() -> None:
    """纯加法新增不可变批量创建幂等回执表，不修改存量数据。"""
    op.execute("SET LOCAL lock_timeout='5s'")
    op.execute("SET LOCAL statement_timeout='120s'")
    op.execute(SQL_PATH.read_text(encoding="utf-8"))


def downgrade() -> None:
    """禁止破坏性降级销毁批量任务规划幂等回执历史；恢复请走迁移前备份或前向修复。"""
    op.execute(
        "DO $$ BEGIN "
        "RAISE EXCEPTION '0073_content_task_batch_planning downgrade is forbidden to protect "
        "batch planning idempotency history' USING ERRCODE = '55000'; "
        "END $$;"
    )
