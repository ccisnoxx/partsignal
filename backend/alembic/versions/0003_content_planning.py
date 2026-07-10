"""创建目标问题、平台规则版本和内容任务。"""

from alembic import op
from app.migration_schema_v1 import Base

revision = "0003_content_planning"
down_revision = "0002_product_facts"
branch_labels = None
depends_on = None

TABLES = ["query_topics", "platform_profiles", "platform_profile_versions", "content_tasks"]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind, tables=[Base.metadata.tables[name] for name in TABLES])
    op.create_index(
        "uq_platform_profile_versions_one_active",
        "platform_profile_versions",
        ["platform_profile_id"],
        unique=True,
        postgresql_where="status = 'ACTIVE'",
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_platform_version() RETURNS trigger AS $$
        BEGIN
          IF NEW.platform_profile_id IS DISTINCT FROM OLD.platform_profile_id
             OR NEW.version IS DISTINCT FROM OLD.version
             OR NEW.rules IS DISTINCT FROM OLD.rules
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'platform profile version payload is immutable' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER platform_profile_versions_guard
        BEFORE UPDATE ON platform_profile_versions
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_platform_version();

        CREATE OR REPLACE FUNCTION partsignal_validate_content_task() RETURNS trigger AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM fact_versions
            WHERE id = NEW.fact_version_id AND product_id = NEW.product_id AND status = 'APPROVED'
          ) THEN
            RAISE EXCEPTION 'content task requires approved fact version' USING ERRCODE = '23514';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM platform_profile_versions
            WHERE id = NEW.platform_profile_version_id AND status = 'ACTIVE'
          ) THEN
            RAISE EXCEPTION 'content task requires active platform version' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER content_tasks_validate_insert
        BEFORE INSERT ON content_tasks
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_content_task();
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP FUNCTION IF EXISTS partsignal_validate_content_task() CASCADE")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_platform_version() CASCADE")
    for name in reversed(TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
