"""创建平台账号、人工发布记录和状态事件。"""

from alembic import op
from app.migration_schema_v1 import Base

revision = "0006_publication"
down_revision = "0005_content_review"
branch_labels = None
depends_on = None

TABLES = ["platform_accounts", "publication_records", "publication_status_events"]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind, tables=[Base.metadata.tables[name] for name in TABLES])
    op.create_index("ix_publication_records_status", "publication_records", ["status"])
    op.execute(
        """
        CREATE TRIGGER publication_status_events_append_only
        BEFORE UPDATE OR DELETE ON publication_status_events
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();

        CREATE OR REPLACE FUNCTION partsignal_guard_publication() RETURNS trigger AS $$
        BEGIN
          IF NEW.content_version_id IS DISTINCT FROM OLD.content_version_id
             OR NEW.platform_account_id IS DISTINCT FROM OLD.platform_account_id
             OR NEW.section_url IS DISTINCT FROM OLD.section_url
             OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'publication binding is immutable' USING ERRCODE = '55000';
          END IF;
          IF OLD.status IN ('PUBLISHED', 'VERIFIED', 'REJECTED', 'REMOVED', 'VERIFICATION_FAILED')
             AND (NEW.actual_title IS DISTINCT FROM OLD.actual_title
               OR NEW.final_url IS DISTINCT FROM OLD.final_url
               OR NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
            RAISE EXCEPTION 'published fields are immutable' USING ERRCODE = '55000';
          END IF;
          IF NOT (
            (OLD.status = 'PENDING_MANUAL_PUBLISH' AND NEW.status IN ('PENDING_MANUAL_PUBLISH', 'PLATFORM_REVIEW', 'REJECTED')) OR
            (OLD.status = 'PLATFORM_REVIEW' AND NEW.status IN ('PLATFORM_REVIEW', 'PUBLISHED', 'REJECTED')) OR
            (OLD.status = 'PUBLISHED' AND NEW.status IN ('PUBLISHED', 'VERIFIED', 'REMOVED', 'VERIFICATION_FAILED')) OR
            (OLD.status = 'VERIFIED' AND NEW.status IN ('VERIFIED', 'REMOVED', 'VERIFICATION_FAILED')) OR
            (OLD.status = NEW.status)
          ) THEN
            RAISE EXCEPTION 'invalid publication transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER publication_records_guard
        BEFORE UPDATE ON publication_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication();

        CREATE OR REPLACE FUNCTION partsignal_validate_publication_insert() RETURNS trigger AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM content_versions cv
            JOIN fact_versions fv ON fv.id = cv.fact_version_id
            WHERE cv.id = NEW.content_version_id
              AND cv.status = 'APPROVED'
              AND fv.status = 'APPROVED'
          ) THEN
            RAISE EXCEPTION 'publication requires approved content and fact' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER publication_records_validate_insert
        BEFORE INSERT ON publication_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_publication_insert();
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP FUNCTION IF EXISTS partsignal_validate_publication_insert() CASCADE")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_publication() CASCADE")
    for name in reversed(TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
