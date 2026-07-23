"""增加具体平台启停状态与管理聚合索引。"""

import sqlalchemy as sa

from alembic import op

revision = "0023_platform_management"
down_revision = "0022_geo_observation_insights"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """既有平台显式回填为启用，并增加实时聚合所需索引。"""
    op.add_column("platform_profiles", sa.Column("is_active", sa.Boolean(), nullable=True))
    op.execute("UPDATE platform_profiles SET is_active = true")
    op.alter_column("platform_profiles", "is_active", nullable=False)
    op.create_index(
        "ix_content_tasks_platform_profile_version_created_at",
        "content_tasks",
        ["platform_profile_version_id", "created_at"],
    )
    op.create_index(
        "ix_platform_accounts_platform_profile_active",
        "platform_accounts",
        ["platform_profile_id", "is_active"],
    )
    op.create_index(
        "ix_audit_logs_target_created_at",
        "audit_logs",
        ["target_type", "target_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    """移除启停状态会丢失当前停用事实，执行前必须由业务确认。"""
    op.drop_index("ix_audit_logs_target_created_at", table_name="audit_logs")
    op.drop_index(
        "ix_platform_accounts_platform_profile_active",
        table_name="platform_accounts",
    )
    op.drop_index(
        "ix_content_tasks_platform_profile_version_created_at",
        table_name="content_tasks",
    )
    op.drop_column("platform_profiles", "is_active")
