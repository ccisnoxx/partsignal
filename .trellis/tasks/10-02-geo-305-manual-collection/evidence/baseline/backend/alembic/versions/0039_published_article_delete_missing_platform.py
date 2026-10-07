"""允许归档任务在删除失效平台的发布成果后转为已取消。"""

from alembic import op

revision = "0039_article_delete_platform"
down_revision = "0038_published_article_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """保持归档标记与内容任务合法终态正交。"""
    op.drop_constraint(
        "ck_content_tasks_archive_state",
        "content_tasks",
        type_="check",
    )
    op.create_check_constraint(
        "ck_content_tasks_archive_state",
        "content_tasks",
        "archived_at IS NULL OR status IN ('OPEN', 'COMPLETED', 'CANCELLED')",
    )


def downgrade() -> None:
    """仅在没有归档已取消任务时恢复 0038 约束。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM content_tasks
             WHERE archived_at IS NOT NULL AND status = 'CANCELLED'
          ) THEN
            RAISE EXCEPTION '0039 无法降级：存在已归档的已取消内容任务'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )
    op.drop_constraint(
        "ck_content_tasks_archive_state",
        "content_tasks",
        type_="check",
    )
    op.create_check_constraint(
        "ck_content_tasks_archive_state",
        "content_tasks",
        "archived_at IS NULL OR status IN ('OPEN', 'COMPLETED')",
    )
