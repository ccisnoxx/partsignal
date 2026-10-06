"""增加平台 Logo 的未引用保留、幂等删除状态与数据库门禁。"""

import sqlalchemy as sa

from alembic import op

revision = "0028_platform_logo_lifecycle"
down_revision = "0027_audit_user_delete_guard"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """扩展文件生命周期，并初始化既有未引用 Logo 的安全保留期。"""
    op.add_column(
        "file_records",
        sa.Column("cleanup_after", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "file_records",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_check_constraint(
        "ck_file_records_lifecycle_status",
        "file_records",
        "status IN ('PENDING', 'VERIFIED', 'FAILED', 'ABORTED', 'DELETING', 'DELETED')",
    )
    op.create_check_constraint(
        "ck_file_records_deleted_at",
        "file_records",
        "(status = 'DELETED') = (deleted_at IS NOT NULL)",
    )
    op.create_index(
        "ix_file_records_platform_logo_cleanup",
        "file_records",
        ["status", "cleanup_after", "upload_expires_at"],
        postgresql_where=sa.text("category = 'PLATFORM_LOGO'"),
    )
    op.execute(
        """
        UPDATE file_records AS file
        SET cleanup_after = now() + interval '7 days'
        WHERE file.category = 'PLATFORM_LOGO'
          AND file.status = 'VERIFIED'
          AND NOT EXISTS (
            SELECT 1
            FROM platform_profiles AS profile
            WHERE profile.logo_file_id = file.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM publication_attachments AS attachment
            WHERE attachment.file_id = file.id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM geo_observation_attachments AS attachment
            WHERE attachment.file_id = file.id
          );

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
          IF OLD.status <> NEW.status
             AND NOT (
               (OLD.status = 'PENDING'
                 AND NEW.status IN ('VERIFIED', 'FAILED', 'ABORTED', 'DELETING'))
               OR (OLD.status IN ('VERIFIED', 'FAILED', 'ABORTED')
                 AND NEW.status = 'DELETING')
               OR (OLD.status = 'DELETING' AND NEW.status = 'DELETED')
             ) THEN
            RAISE EXCEPTION 'invalid file transition' USING ERRCODE = '55000';
          END IF;
          IF NEW.status = 'DELETING'
             AND OLD.status <> 'DELETING'
             AND (
               EXISTS (SELECT 1 FROM platform_profiles WHERE logo_file_id = NEW.id)
               OR EXISTS (SELECT 1 FROM publication_attachments WHERE file_id = NEW.id)
               OR EXISTS (SELECT 1 FROM geo_observation_attachments WHERE file_id = NEW.id)
             ) THEN
            RAISE EXCEPTION 'referenced file cannot be deleted' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_require_verified_file() RETURNS trigger AS $$
        BEGIN
          PERFORM 1
          FROM file_records
          WHERE id = NEW.file_id
            AND status = 'VERIFIED'
          FOR KEY SHARE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'only verified files may be linked' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_require_platform_logo_file() RETURNS trigger AS $$
        BEGIN
          IF NEW.logo_file_id IS NULL THEN
            RETURN NEW;
          END IF;
          PERFORM 1
          FROM file_records
          WHERE id = NEW.logo_file_id
            AND status = 'VERIFIED'
            AND category = 'PLATFORM_LOGO'
            AND access_level = 'PUBLIC'
          FOR KEY SHARE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'platform logo must be a verified public platform logo'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER platform_profiles_require_logo_file
        BEFORE INSERT OR UPDATE OF logo_file_id ON platform_profiles
        FOR EACH ROW EXECUTE FUNCTION partsignal_require_platform_logo_file();

        UPDATE platform_profiles
        SET logo_file_id = logo_file_id
        WHERE logo_file_id IS NOT NULL;
        """
    )


def downgrade() -> None:
    """对象已进入删除阶段时拒绝丢弃生命周期状态。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM file_records
            WHERE status IN ('DELETING', 'DELETED')
          ) THEN
            RAISE EXCEPTION 'platform logo deletion has started; downgrade is forbidden'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;

        DROP TRIGGER platform_profiles_require_logo_file ON platform_profiles;
        DROP FUNCTION partsignal_require_platform_logo_file();

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
          IF NOT (
               OLD.status = 'PENDING'
               AND NEW.status IN ('PENDING', 'VERIFIED', 'FAILED', 'ABORTED')
             )
             AND OLD.status <> NEW.status THEN
            RAISE EXCEPTION 'invalid file transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.drop_index("ix_file_records_platform_logo_cleanup", table_name="file_records")
    op.drop_constraint("ck_file_records_deleted_at", "file_records", type_="check")
    op.drop_constraint("ck_file_records_lifecycle_status", "file_records", type_="check")
    op.drop_column("file_records", "deleted_at")
    op.drop_column("file_records", "cleanup_after")
