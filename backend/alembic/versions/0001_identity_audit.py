"""创建身份、会话和审计表。"""

from alembic import op
from app.migration_schema_v1 import Base

revision = "0001_identity_audit"
down_revision = None
branch_labels = None
depends_on = None

TABLES = ["roles", "users", "user_roles", "sessions", "audit_logs"]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind, tables=[Base.metadata.tables[name] for name in TABLES])
    op.bulk_insert(
        Base.metadata.tables["roles"],
        [
            {"name": role}
            for role in [
                "SYSTEM_ADMIN",
                "PRODUCT_EDITOR",
                "PRODUCT_REVIEWER",
                "CONTENT_EDITOR",
                "CONTENT_REVIEWER",
                "ANALYST",
            ]
        ],
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_prevent_change() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER audit_logs_append_only
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    for name in reversed(TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
    op.execute("DROP FUNCTION IF EXISTS partsignal_prevent_change()")
