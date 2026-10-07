"""允许受约束删除事实版本时清理其从属审核记录。"""

from alembic import op

revision = "0016_fact_review_cleanup"
down_revision = "0015_platform_rule_draft_editing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """只允许删除事务本地声明的父事实版本审核记录。"""
    op.execute(
        """
        DROP TRIGGER fact_review_records_append_only ON fact_review_records;

        CREATE FUNCTION partsignal_guard_fact_review_record() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE'
             AND current_setting('partsignal.fact_version_delete_id', true)
                 = OLD.fact_version_id::text THEN
            RETURN OLD;
          END IF;
          RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER fact_review_records_append_only
        BEFORE UPDATE OR DELETE ON fact_review_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_fact_review_record();
        """
    )


def downgrade() -> None:
    """恢复事实审核记录原有的通用追加式门禁。"""
    op.execute(
        """
        DROP TRIGGER fact_review_records_append_only ON fact_review_records;
        DROP FUNCTION partsignal_guard_fact_review_record();

        CREATE TRIGGER fact_review_records_append_only
        BEFORE UPDATE OR DELETE ON fact_review_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        """
    )
