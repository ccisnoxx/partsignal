"""只允许受约束用户删除把匹配审计操作者置空。"""

from alembic import op

revision = "0027_audit_user_delete_guard"
down_revision = "0026_publication_account_dedup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """以事务本地目标 UUID 限定审计外键的唯一合法更新。"""
    op.execute(
        """
        DROP TRIGGER audit_logs_append_only ON audit_logs;

        CREATE FUNCTION partsignal_guard_audit_actor_user_delete() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'UPDATE'
             AND pg_trigger_depth() > 1
             AND OLD.actor_id IS NOT NULL
             AND NEW.actor_id IS NULL
             AND current_setting('partsignal.user_delete_id', true) = OLD.actor_id::text
             AND to_jsonb(NEW) - 'actor_id' = to_jsonb(OLD) - 'actor_id' THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER audit_logs_append_only
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_audit_actor_user_delete();
        """
    )


def downgrade() -> None:
    """恢复审计表无例外的通用追加式门禁。"""
    op.execute(
        """
        DROP TRIGGER audit_logs_append_only ON audit_logs;
        DROP FUNCTION partsignal_guard_audit_actor_user_delete();

        CREATE TRIGGER audit_logs_append_only
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        """
    )
