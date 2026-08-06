"""允许当前人工未审核草稿受控保存和彻底删除。"""

from alembic import op

revision = "0040_content_draft_management"
down_revision = "0039_article_delete_platform"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """收窄人工草稿可变窗口，并保护单版本删除语境。"""
    op.execute(
        """
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
             OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'content version identity is immutable' USING ERRCODE = '55000';
          END IF;

          IF NEW.title IS DISTINCT FROM OLD.title
             OR NEW.summary IS DISTINCT FROM OLD.summary
             OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
             OR NEW.tags IS DISTINCT FROM OLD.tags
             OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
             OR NEW.quality_issues IS DISTINCT FROM OLD.quality_issues THEN
            IF OLD.source_type = 'HUMAN'
               AND OLD.source_job_id IS NULL
               AND OLD.status = 'DRAFT'
               AND NEW.status = 'DRAFT'
               AND NEW.revision = OLD.revision + 1
               AND EXISTS (
                 SELECT 1
                   FROM content_tasks task
                  WHERE task.id = OLD.task_id
                    AND task.status = 'OPEN'
                    AND task.current_content_version_id = OLD.id
               )
               AND NOT EXISTS (
                 SELECT 1
                   FROM content_review_records review
                  WHERE review.content_version_id = OLD.id
               ) THEN
              RETURN NEW;
            END IF;
            RAISE EXCEPTION 'content version payload is immutable' USING ERRCODE = '55000';
          END IF;

          IF NOT (
            (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PENDING_REVIEW', 'ABANDONED')) OR
            (OLD.status = 'PENDING_REVIEW'
             AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
            (OLD.status = 'CHANGES_REQUESTED'
             AND NEW.status IN ('CHANGES_REQUESTED', 'ABANDONED')) OR
            (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'SUPERSEDED')) OR
            (OLD.status = NEW.status)
          ) THEN
            RAISE EXCEPTION 'invalid content version transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE FUNCTION partsignal_guard_content_version_delete() RETURNS trigger AS $$
        BEGIN
          IF current_setting('partsignal.content_task_delete_id', true) = OLD.task_id::text THEN
            RETURN OLD;
          END IF;
          IF current_setting('partsignal.content_version_delete_id', true) = OLD.id::text
             AND OLD.source_type = 'HUMAN'
             AND OLD.source_job_id IS NULL
             AND OLD.status IN ('DRAFT', 'ABANDONED')
             AND NOT EXISTS (
               SELECT 1
                 FROM content_review_records review
                WHERE review.content_version_id = OLD.id
             )
             AND NOT EXISTS (
               SELECT 1
                 FROM content_tasks task
                WHERE task.current_content_version_id = OLD.id
             ) THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION '内容版本只允许由匹配草稿或任务的受控删除事务清理'
            USING ERRCODE = '55000';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER content_versions_delete_guard
        BEFORE DELETE ON content_versions
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_version_delete();
        """
    )


def downgrade() -> None:
    """草稿旧值和已删除正文不可重建，只允许前滚修复。"""
    op.execute(
        """
        DO $$
        BEGIN
          RAISE EXCEPTION '0040 无法安全降级：人工草稿可能已保存或删除'
            USING ERRCODE = '55000';
        END;
        $$;
        """
    )
