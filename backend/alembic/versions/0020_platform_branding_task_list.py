"""为具体平台增加官网与单一来源 Logo。"""

import sqlalchemy as sa

from alembic import op

revision = "0020_platform_branding_task_list"
down_revision = "0019_product_driven_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """增加可选品牌字段，并由数据库禁止同时保存两类 Logo。"""
    op.add_column("platform_profiles", sa.Column("website_url", sa.Text(), nullable=True))
    op.add_column("platform_profiles", sa.Column("logo_file_id", sa.Uuid(), nullable=True))
    op.add_column("platform_profiles", sa.Column("logo_external_url", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_platform_profiles_logo_file_id_file_records",
        "platform_profiles",
        "file_records",
        ["logo_file_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_platform_profiles_logo_single_source",
        "platform_profiles",
        "logo_file_id IS NULL OR logo_external_url IS NULL",
    )


def downgrade() -> None:
    """存在平台品牌数据时拒绝降级，避免静默丢失。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM platform_profiles
            WHERE website_url IS NOT NULL
               OR logo_file_id IS NOT NULL
               OR logo_external_url IS NOT NULL
          ) THEN
            RAISE EXCEPTION 'platform branding data exists; downgrade is forbidden'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )
    op.drop_constraint(
        "ck_platform_profiles_logo_single_source", "platform_profiles", type_="check"
    )
    op.drop_constraint(
        "fk_platform_profiles_logo_file_id_file_records",
        "platform_profiles",
        type_="foreignkey",
    )
    op.drop_column("platform_profiles", "logo_external_url")
    op.drop_column("platform_profiles", "logo_file_id")
    op.drop_column("platform_profiles", "website_url")
