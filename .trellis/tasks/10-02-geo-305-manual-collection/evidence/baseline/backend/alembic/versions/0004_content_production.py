"""创建 PostgreSQL 权威生成作业和不可变 Markdown 内容版本。"""

from alembic import op
from app.migration_schema_v1 import Base

revision = "0004_content_production"
down_revision = "0003_content_planning"
branch_labels = None
depends_on = None

TABLES = ["generation_jobs", "content_versions"]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind, tables=[Base.metadata.tables[name] for name in TABLES])
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_content_version() RETURNS trigger AS $$
        BEGIN
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
             OR NEW.used_fact_ids IS DISTINCT FROM OLD.used_fact_ids
             OR NEW.used_evidence_ids IS DISTINCT FROM OLD.used_evidence_ids
             OR NEW.required_disclosure_ids IS DISTINCT FROM OLD.required_disclosure_ids
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
            (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'SUPERSEDED')) OR
            (OLD.status = NEW.status)
          ) THEN
            RAISE EXCEPTION 'invalid content version transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER content_versions_guard
        BEFORE UPDATE ON content_versions
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_version();
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_content_version() CASCADE")
    op.drop_constraint(
        "fk_generation_jobs_content_version_id_content_versions",
        "generation_jobs",
        type_="foreignkey",
    )
    for name in reversed(TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
