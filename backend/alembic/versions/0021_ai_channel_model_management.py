"""补齐 AI 渠道身份字段与使用统计索引。"""

import sqlalchemy as sa

from alembic import op

revision = "0021_ai_channel_model_management"
down_revision = "0020_platform_branding_task_list"
branch_labels = None
depends_on = None

PROTOCOL_TYPE = "openai-compatible-chat-completions"


def upgrade() -> None:
    """回填可证明的协议值，不根据历史名称或地址猜测供应商品牌。"""
    op.add_column(
        "ai_channels",
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
    )
    op.add_column(
        "ai_channels",
        sa.Column(
            "protocol_type",
            sa.String(length=64),
            nullable=False,
            server_default=PROTOCOL_TYPE,
        ),
    )
    op.add_column(
        "ai_channels",
        sa.Column(
            "provider_brand",
            sa.String(length=32),
            nullable=False,
            server_default="CUSTOM",
        ),
    )
    op.alter_column("ai_channels", "description", server_default=None)
    op.alter_column("ai_channels", "protocol_type", server_default=None)
    op.alter_column("ai_channels", "provider_brand", server_default=None)
    op.create_check_constraint(
        "ck_ai_channels_protocol_type",
        "ai_channels",
        f"protocol_type IN ('{PROTOCOL_TYPE}')",
    )
    op.create_check_constraint(
        "ck_ai_channels_provider_brand",
        "ai_channels",
        "provider_brand IN "
        "('OPENAI', 'ANTHROPIC', 'GOOGLE', 'AZURE_OPENAI', 'ZHIPU', 'QWEN', 'CUSTOM')",
    )
    op.create_index(
        "ix_generation_jobs_ai_channel_created_at",
        "generation_jobs",
        ["ai_channel_id", "created_at"],
    )


def downgrade() -> None:
    """存在迁移默认值之外的渠道身份数据时拒绝静默丢失。"""
    op.execute(
        f"""
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM ai_channels
            WHERE description <> ''
               OR protocol_type <> '{PROTOCOL_TYPE}'
               OR provider_brand <> 'CUSTOM'
          ) THEN
            RAISE EXCEPTION 'AI channel identity data exists; downgrade is forbidden'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )
    op.drop_index("ix_generation_jobs_ai_channel_created_at", table_name="generation_jobs")
    op.drop_constraint("ck_ai_channels_provider_brand", "ai_channels", type_="check")
    op.drop_constraint("ck_ai_channels_protocol_type", "ai_channels", type_="check")
    op.drop_column("ai_channels", "provider_brand")
    op.drop_column("ai_channels", "protocol_type")
    op.drop_column("ai_channels", "description")
