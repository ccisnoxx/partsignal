"""删除没有稳定业务含义的发布栏目地址。"""

from alembic import op

revision = "0036_remove_section_url"
down_revision = "0035_business_workflow"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """先收敛发布守卫，再删除栏目地址列。"""
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_publication_work() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'publication work history is append-only' USING ERRCODE = '55000';
          END IF;
          IF NEW.content_task_id IS DISTINCT FROM OLD.content_task_id
             OR NEW.platform_profile_id IS DISTINCT FROM OLD.platform_profile_id
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'publication work identity is immutable' USING ERRCODE = '55000';
          END IF;
          IF OLD.status IN ('COMPLETED', 'CLOSED') AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'terminal publication work is immutable' USING ERRCODE = '55000';
          END IF;
          IF NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION 'publication work revision must increment once' USING ERRCODE = '55000';
          END IF;
          IF NEW.content_version_id IS DISTINCT FROM OLD.content_version_id
             OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
            IF NEW.status <> OLD.status OR NOT EXISTS (
              SELECT 1 FROM content_versions content
              JOIN content_tasks task ON task.id = content.task_id
               WHERE content.id = NEW.content_version_id
                 AND task.id = OLD.content_task_id
                 AND task.current_content_version_id = content.id
                 AND task.platform_profile_id = OLD.platform_profile_id
                 AND content.status = 'APPROVED'
                 AND content.content_hash = NEW.content_hash
            ) THEN
              RAISE EXCEPTION 'invalid publication content version switch'
                USING ERRCODE = '55000';
            END IF;
          END IF;
          IF NEW.platform_account_id IS DISTINCT FROM OLD.platform_account_id
             AND NOT (OLD.status IN ('PREPARING', 'PLATFORM_REVIEW')
                      AND NEW.status IN ('PREPARING', 'PLATFORM_REVIEW')) THEN
            RAISE EXCEPTION 'publication preparation is frozen' USING ERRCODE = '55000';
          END IF;
          IF (NEW.actual_title IS DISTINCT FROM OLD.actual_title
              OR NEW.final_url IS DISTINCT FROM OLD.final_url
              OR NEW.published_at IS DISTINCT FROM OLD.published_at)
             AND NOT (OLD.status IN ('PREPARING', 'PLATFORM_REVIEW',
                                     'AWAITING_VERIFICATION', 'ACTION_REQUIRED')
                      AND NEW.status = 'AWAITING_VERIFICATION') THEN
            RAISE EXCEPTION 'publication result change requires registration'
              USING ERRCODE = '55000';
          END IF;
          IF NOT (
            (OLD.status = 'PREPARING' AND NEW.status IN
              ('PREPARING', 'PLATFORM_REVIEW', 'AWAITING_VERIFICATION', 'CLOSED')) OR
            (OLD.status = 'PLATFORM_REVIEW' AND NEW.status IN
              ('PLATFORM_REVIEW', 'AWAITING_VERIFICATION', 'CLOSED')) OR
            (OLD.status = 'AWAITING_VERIFICATION' AND NEW.status IN
              ('AWAITING_VERIFICATION', 'ACTION_REQUIRED', 'COMPLETED', 'CLOSED')) OR
            (OLD.status = 'ACTION_REQUIRED' AND NEW.status IN
              ('ACTION_REQUIRED', 'AWAITING_VERIFICATION', 'COMPLETED', 'CLOSED'))
          ) THEN
            RAISE EXCEPTION 'invalid publication work transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.drop_column("publication_works", "section_url")


def downgrade() -> None:
    """被删除的栏目地址无法确定性恢复，必须使用迁移前备份。"""
    op.execute(
        """
        DO $$
        BEGIN
          RAISE EXCEPTION '0036 无法安全降级，请恢复迁移前备份'
            USING ERRCODE = '55000';
        END;
        $$;
        """
    )
