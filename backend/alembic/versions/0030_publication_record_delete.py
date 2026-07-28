"""为从未公开的发布聚合增加事务级受控删除门禁。"""

from alembic import op

revision = "0030_publication_record_delete"
down_revision = "0029_geo_evidence_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """只按事务声明放行未公开状态事件、附件关系和发布记录删除。"""
    op.execute(
        """
        CREATE FUNCTION partsignal_guard_publication_record_delete() RETURNS trigger AS $$
        DECLARE
          target_id uuid;
        BEGIN
          IF TG_OP = 'UPDATE' THEN
            RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
          END IF;

          IF TG_TABLE_NAME = 'publication_records' THEN
            target_id := OLD.id;
          ELSE
            target_id := OLD.publication_id;
          END IF;

          IF current_setting('partsignal.publication_record_delete_id', true)
             IS DISTINCT FROM target_id::text THEN
            RAISE EXCEPTION 'publication record delete target mismatch'
              USING ERRCODE = '55000';
          END IF;
          IF TG_TABLE_NAME = 'publication_status_events' THEN
            IF OLD.status IN ('PUBLISHED', 'VERIFIED') THEN
              RAISE EXCEPTION 'public publication status event cannot be deleted'
                USING ERRCODE = '55000';
            END IF;
          END IF;
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER publication_status_events_append_only ON publication_status_events;
        CREATE TRIGGER publication_status_events_append_only
        BEFORE UPDATE OR DELETE ON publication_status_events
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_record_delete();

        DROP TRIGGER publication_attachments_append_only ON publication_attachments;
        CREATE TRIGGER publication_attachments_append_only
        BEFORE UPDATE OR DELETE ON publication_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_record_delete();

        CREATE TRIGGER publication_records_delete_guard
        BEFORE DELETE ON publication_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_record_delete();
        """
    )


def downgrade() -> None:
    """恢复状态事件和附件追加式门禁，以及发布记录原有的仅更新守卫。"""
    op.execute(
        """
        DROP TRIGGER publication_records_delete_guard ON publication_records;

        DROP TRIGGER publication_status_events_append_only ON publication_status_events;
        CREATE TRIGGER publication_status_events_append_only
        BEFORE UPDATE OR DELETE ON publication_status_events
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();

        DROP TRIGGER publication_attachments_append_only ON publication_attachments;
        CREATE TRIGGER publication_attachments_append_only
        BEFORE UPDATE OR DELETE ON publication_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();

        DROP FUNCTION partsignal_guard_publication_record_delete();
        """
    )
