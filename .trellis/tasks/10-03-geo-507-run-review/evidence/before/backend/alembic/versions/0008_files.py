"""创建文件生命周期、附件关联并补加证据文件外键。"""

from alembic import op
from app.migration_schema_v1 import Base

revision = "0008_files"
down_revision = "0007_geo_observation"
branch_labels = None
depends_on = None

TABLES = ["file_records", "publication_attachments", "geo_observation_attachments"]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.tables["file_records"].create(bind)
    op.create_foreign_key(
        "fk_evidences_file_record_id_file_records",
        "evidences",
        "file_records",
        ["file_record_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    Base.metadata.create_all(
        bind,
        tables=[
            Base.metadata.tables["publication_attachments"],
            Base.metadata.tables["geo_observation_attachments"],
        ],
    )
    op.create_index("ix_file_records_status", "file_records", ["status"])
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_file_record() RETURNS trigger AS $$
        BEGIN
          IF NEW.category IS DISTINCT FROM OLD.category
             OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
             OR NEW.object_key IS DISTINCT FROM OLD.object_key
             OR NEW.content_type IS DISTINCT FROM OLD.content_type
             OR NEW.size IS DISTINCT FROM OLD.size
             OR NEW.sha256 IS DISTINCT FROM OLD.sha256
             OR NEW.access_level IS DISTINCT FROM OLD.access_level
             OR NEW.uploader_id IS DISTINCT FROM OLD.uploader_id
             OR NEW.upload_expires_at IS DISTINCT FROM OLD.upload_expires_at
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'file metadata is immutable' USING ERRCODE = '55000';
          END IF;
          IF NOT (OLD.status = 'PENDING' AND NEW.status IN ('PENDING', 'VERIFIED', 'FAILED', 'ABORTED'))
             AND OLD.status <> NEW.status THEN
            RAISE EXCEPTION 'invalid file transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER file_records_guard
        BEFORE UPDATE ON file_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_file_record();

        CREATE OR REPLACE FUNCTION partsignal_require_verified_file() RETURNS trigger AS $$
        DECLARE target_file uuid;
        BEGIN
          IF TG_TABLE_NAME = 'evidences' THEN
            target_file := NEW.file_record_id;
            IF target_file IS NULL THEN RETURN NEW; END IF;
          ELSE
            target_file := NEW.file_id;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM file_records WHERE id = target_file AND status = 'VERIFIED') THEN
            RAISE EXCEPTION 'only verified files may be linked' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER evidences_verified_file
        BEFORE INSERT OR UPDATE OF file_record_id ON evidences
        FOR EACH ROW EXECUTE FUNCTION partsignal_require_verified_file();
        CREATE TRIGGER publication_attachments_verified_file
        BEFORE INSERT OR UPDATE ON publication_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_require_verified_file();
        CREATE TRIGGER geo_observation_attachments_verified_file
        BEFORE INSERT OR UPDATE ON geo_observation_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_require_verified_file();

        CREATE TRIGGER publication_attachments_append_only
        BEFORE UPDATE OR DELETE ON publication_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        CREATE TRIGGER geo_observation_attachments_append_only
        BEFORE UPDATE OR DELETE ON geo_observation_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP FUNCTION IF EXISTS partsignal_require_verified_file() CASCADE")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_file_record() CASCADE")
    op.drop_constraint("fk_evidences_file_record_id_file_records", "evidences", type_="foreignkey")
    for name in reversed(TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
