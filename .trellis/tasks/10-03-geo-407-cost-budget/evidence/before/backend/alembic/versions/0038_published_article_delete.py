"""允许受控删除无 GEO 引用的发布成果聚合。"""

from alembic import op

revision = "0038_published_article_delete"
down_revision = "0037_simplify_deletion_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """安装成果删除上下文、GEO 最终门禁和归档开放任务约束。"""
    op.drop_constraint(
        "ck_content_tasks_archive_completed",
        "content_tasks",
        type_="check",
    )
    op.create_check_constraint(
        "ck_content_tasks_archive_state",
        "content_tasks",
        "archived_at IS NULL OR status IN ('OPEN', 'COMPLETED')",
    )
    op.execute(
        """
        CREATE FUNCTION partsignal_publication_delete_allowed(target_work_id uuid)
        RETURNS boolean AS $$
        DECLARE
          source_task_id uuid;
        BEGIN
          IF current_setting('partsignal.published_article_delete_id', true)
             = target_work_id::text THEN
            RETURN true;
          END IF;
          SELECT content_task_id INTO source_task_id
            FROM publication_works
           WHERE id = target_work_id;
          RETURN COALESCE(
            source_task_id IS NOT NULL
              AND current_setting('partsignal.content_task_delete_id', true)
                  = source_task_id::text,
            false
          );
        END;
        $$ LANGUAGE plpgsql;

        CREATE FUNCTION partsignal_guard_publication_delete() RETURNS trigger AS $$
        DECLARE
          target_work_id uuid;
          article_delete_context boolean;
        BEGIN
          IF TG_TABLE_NAME IN ('publication_works', 'published_articles') THEN
            target_work_id := (to_jsonb(OLD)->>'id')::uuid;
          ELSIF TG_TABLE_NAME = 'published_content_issues' THEN
            target_work_id := (to_jsonb(OLD)->>'published_article_id')::uuid;
          ELSE
            target_work_id := (to_jsonb(OLD)->>'publication_work_id')::uuid;
          END IF;

          IF NOT partsignal_publication_delete_allowed(target_work_id) THEN
            RAISE EXCEPTION '发布历史只能通过受控聚合删除命令删除'
              USING ERRCODE = '55000';
          END IF;

          article_delete_context :=
            current_setting('partsignal.published_article_delete_id', true)
              = target_work_id::text;
          IF TG_TABLE_NAME = 'published_articles' AND article_delete_context AND (
            EXISTS (
              SELECT 1 FROM geo_observation_publications
               WHERE published_article_id = target_work_id
            ) OR EXISTS (
              SELECT 1 FROM geo_observation_citations
               WHERE published_article_id = target_work_id
            ) OR EXISTS (
              SELECT 1 FROM content_task_geo_sources
               WHERE published_article_id = target_work_id
            )
          ) THEN
            RAISE EXCEPTION '存在 GEO 下游引用的发布成果不可删除'
              USING ERRCODE = '55000';
          END IF;
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER publication_works_delete_guard
        BEFORE DELETE ON publication_works
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_delete();
        CREATE TRIGGER publication_work_events_delete_guard
        BEFORE DELETE ON publication_work_events
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_delete();
        CREATE TRIGGER publication_verifications_delete_guard
        BEFORE DELETE ON publication_verifications
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_delete();
        CREATE TRIGGER published_articles_delete_guard
        BEFORE DELETE ON published_articles
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_delete();
        CREATE TRIGGER published_content_issues_delete_guard
        BEFORE DELETE ON published_content_issues
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_delete();
        CREATE TRIGGER publication_attachments_delete_guard
        BEFORE DELETE ON publication_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_delete();
        """
    )


def downgrade() -> None:
    """永久删除不可逆，降级必须恢复迁移前备份。"""
    op.execute(
        """
        DO $$
        BEGIN
          RAISE EXCEPTION '0038 无法安全降级，请恢复迁移前备份'
            USING ERRCODE = '55000';
        END;
        $$;
        """
    )
