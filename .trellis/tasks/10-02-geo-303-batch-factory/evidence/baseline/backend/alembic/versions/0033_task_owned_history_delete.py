"""允许受控删除已取消任务自有的未批准生产历史。"""

from alembic import op

revision = "0033_task_owned_history_delete"
down_revision = "0032_content_task_idempotency"
branch_labels = None
depends_on = None


CONTENT_VERSION_GUARD = """
CREATE OR REPLACE FUNCTION partsignal_guard_content_version() RETURNS trigger AS $$
BEGIN
  IF current_setting('partsignal.content_task_delete_id', true) = OLD.task_id::text
     AND NEW.source_job_id IS NULL
     AND to_jsonb(NEW) - 'source_job_id' = to_jsonb(OLD) - 'source_job_id' THEN
    RETURN NEW;
  END IF;
  IF NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.fact_version_id IS DISTINCT FROM OLD.fact_version_id
     OR NEW.source_job_id IS DISTINCT FROM OLD.source_job_id
     OR NEW.based_on_id IS DISTINCT FROM OLD.based_on_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.source_type IS DISTINCT FROM OLD.source_type
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.summary IS DISTINCT FROM OLD.summary
     OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
     OR NEW.tags IS DISTINCT FROM OLD.tags
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.quality_issues IS DISTINCT FROM OLD.quality_issues
     OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'content version payload is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PENDING_REVIEW')) OR
    (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
    (OLD.status = 'CHANGES_REQUESTED' AND NEW.status IN ('CHANGES_REQUESTED', 'PENDING_REVIEW')) OR
    (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'SUPERSEDED')) OR
    (OLD.status = NEW.status)
  ) THEN
    RAISE EXCEPTION 'invalid content version transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
"""


def upgrade() -> None:
    """仅向匹配任务开放断开作业引用和删除审核记录的事务窗口。"""
    op.execute(CONTENT_VERSION_GUARD)
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_content_review_record() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE'
             AND current_setting('partsignal.content_task_delete_id', true) = (
               SELECT task_id::text
               FROM content_versions
               WHERE id = OLD.content_version_id
             ) THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION '内容审核记录只允许由匹配任务的受控删除事务清理'
            USING ERRCODE = '55000';
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER content_review_records_append_only ON content_review_records;
        CREATE TRIGGER content_review_records_append_only
        BEFORE UPDATE OR DELETE ON content_review_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_review_record();
        """
    )


def downgrade() -> None:
    """恢复内容版本完全不可变和审核记录绝对追加式门禁。"""
    op.execute(
        CONTENT_VERSION_GUARD.replace(
            """  IF current_setting('partsignal.content_task_delete_id', true) = OLD.task_id::text
     AND NEW.source_job_id IS NULL
     AND to_jsonb(NEW) - 'source_job_id' = to_jsonb(OLD) - 'source_job_id' THEN
    RETURN NEW;
  END IF;
""",
            "",
        )
    )
    op.execute(
        """
        DROP TRIGGER content_review_records_append_only ON content_review_records;
        CREATE TRIGGER content_review_records_append_only
        BEFORE UPDATE OR DELETE ON content_review_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        DROP FUNCTION partsignal_guard_content_review_record();
        """
    )
