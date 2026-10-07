"""补齐审计模块、命令结果和安全结果说明。"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0024_audit_outcome"
down_revision = "0023_platform_management"
branch_labels = None
depends_on = None

_ACTION_MODULES = {
    # 身份
    ("user.exported", "UserExport"): "IDENTITY",
    ("user.password_changed", "User"): "IDENTITY",
    ("user.created", "User"): "IDENTITY",
    ("user.updated", "User"): "IDENTITY",
    ("user.password_reset", "User"): "IDENTITY",
    # 产品事实
    ("product.created", "Product"): "PRODUCT_FACTS",
    ("product.updated", "Product"): "PRODUCT_FACTS",
    ("product.deleted", "Product"): "PRODUCT_FACTS",
    ("product_facts.replaced", "Product"): "PRODUCT_FACTS",
    ("fact_version.created", "FactVersion"): "PRODUCT_FACTS",
    ("fact_version.deleted", "FactVersion"): "PRODUCT_FACTS",
    # 内容规划
    ("query_topic.created", "QueryTopic"): "CONTENT_PLANNING",
    ("query_topic.updated", "QueryTopic"): "CONTENT_PLANNING",
    ("platform_profile.created", "PlatformProfile"): "CONFIGURATION",
    ("platform_profile_version.created", "PlatformProfileVersion"): "CONFIGURATION",
    ("platform_profile_version.updated", "PlatformProfileVersion"): "CONFIGURATION",
    ("platform_profile_version.activated", "PlatformProfileVersion"): "CONFIGURATION",
    ("platform_profile_version.retired", "PlatformProfileVersion"): "CONFIGURATION",
    ("content_task.created", "ContentTask"): "CONTENT_PLANNING",
    ("content_task.user_prompt_updated", "ContentTask"): "CONTENT_PLANNING",
    # 内容生产
    ("generation_job.created", "GenerationJob"): "CONTENT_PRODUCTION",
    ("generation_job.retried", "GenerationJob"): "CONTENT_PRODUCTION",
    ("humanization_job.created", "GenerationJob"): "CONTENT_PRODUCTION",
    ("content_version.revised", "ContentVersion"): "CONTENT_PRODUCTION",
    # 内容审核
    ("fact_version.submit", "FactVersion"): "PRODUCT_FACTS",
    ("fact_version.approve", "FactVersion"): "PRODUCT_FACTS",
    ("fact_version.request-changes", "FactVersion"): "PRODUCT_FACTS",
    ("fact_version.retire", "FactVersion"): "PRODUCT_FACTS",
    ("content_version.submit-review", "ContentVersion"): "CONTENT_REVIEW",
    ("content_version.approve", "ContentVersion"): "CONTENT_REVIEW",
    ("content_version.request-changes", "ContentVersion"): "CONTENT_REVIEW",
    # 发布
    ("platform_account.created", "PlatformAccount"): "PUBLICATION",
    ("platform_account.deleted", "PlatformAccount"): "PUBLICATION",
    ("publication.created", "PublicationRecord"): "PUBLICATION",
    ("publication.mark_platform_review", "PublicationRecord"): "PUBLICATION",
    ("publication.mark_published", "PublicationRecord"): "PUBLICATION",
    ("publication.verify", "PublicationRecord"): "PUBLICATION",
    ("publication.reject", "PublicationRecord"): "PUBLICATION",
    ("publication.remove", "PublicationRecord"): "PUBLICATION",
    ("publication.mark_verification_failed", "PublicationRecord"): "PUBLICATION",
    ("content_task.cancelled", "ContentTask"): "CONTENT_PLANNING",
    ("content_task.completed_by_verified_publication", "ContentTask"): "PUBLICATION",
    ("publication_attention.opened", "PublicationAttention"): "PUBLICATION",
    ("publication_attention.repair_task_created", "PublicationAttention"): "PUBLICATION",
    ("publication_attention.resolved", "PublicationAttention"): "PUBLICATION",
    # GEO
    ("geo_observation.created", "GeoObservation"): "GEO_OBSERVATION",
    # 配置中心
    ("platform_profile.enabled", "PlatformProfile"): "CONFIGURATION",
    ("platform_profile.disabled", "PlatformProfile"): "CONFIGURATION",
    ("platform_profile.updated", "PlatformProfile"): "CONFIGURATION",
    ("platform_profile.deleted", "PlatformProfile"): "CONFIGURATION",
    ("platform_type.created", "PlatformType"): "CONFIGURATION",
    ("platform_type.updated", "PlatformType"): "CONFIGURATION",
    ("platform_type.deleted", "PlatformType"): "CONFIGURATION",
    # 0014 之前 Prompt 归属平台类型；迁移后历史对象类型必须保持原值。
    ("platform_prompt.saved", "PlatformType"): "CONFIGURATION",
    ("platform_prompt.deleted", "PlatformType"): "CONFIGURATION",
    ("platform_prompt.saved", "PlatformProfile"): "CONFIGURATION",
    ("platform_prompt.deleted", "PlatformProfile"): "CONFIGURATION",
    ("content_humanization_prompt.saved", "ContentHumanizationPrompt"): "CONFIGURATION",
    ("platform_profile_version.deleted", "PlatformProfileVersion"): "CONFIGURATION",
    ("ai_channel.created", "AIChannel"): "CONFIGURATION",
    ("ai_channel.updated", "AIChannel"): "CONFIGURATION",
    ("ai_channel.deleted", "AIChannel"): "CONFIGURATION",
    ("ai_channel.enabled", "AIChannel"): "CONFIGURATION",
    ("ai_channel.disabled", "AIChannel"): "CONFIGURATION",
    ("ai_channel.api_key_replaced", "AIChannel"): "CONFIGURATION",
    ("ai_channel_header.created", "AIChannel"): "CONFIGURATION",
    ("ai_channel_header.updated", "AIChannel"): "CONFIGURATION",
    ("ai_channel_header.deleted", "AIChannel"): "CONFIGURATION",
    ("ai_channel.models_discovered", "AIChannel"): "CONFIGURATION",
    ("ai_model.created", "AIModel"): "CONFIGURATION",
    ("ai_model.updated", "AIModel"): "CONFIGURATION",
    ("ai_model.deleted", "AIModel"): "CONFIGURATION",
    ("ai_model.enabled", "AIModel"): "CONFIGURATION",
    ("ai_model.disabled", "AIModel"): "CONFIGURATION",
    ("ai_model.tested", "AIModel"): "CONFIGURATION",
    # 文件
    ("file.upload_intent_created", "FileRecord"): "FILE_MANAGEMENT",
    ("file.verified", "FileRecord"): "FILE_MANAGEMENT",
    ("file.aborted", "FileRecord"): "FILE_MANAGEMENT",
}


def upgrade() -> None:
    """验证全部历史动作后精确回填新字段，并保持追加式触发器。"""
    op.add_column("audit_logs", sa.Column("business_module", sa.String(40), nullable=True))
    op.add_column("audit_logs", sa.Column("outcome", sa.String(16), nullable=True))
    op.add_column("audit_logs", sa.Column("result_message", sa.String(500), nullable=True))
    op.add_column("audit_logs", sa.Column("error_code", sa.String(100), nullable=True))
    op.alter_column(
        "audit_logs",
        "target_id",
        existing_type=sa.String(100),
        nullable=True,
    )

    bind = op.get_bind()
    op.execute(
        """
        CREATE TEMPORARY TABLE audit_module_mapping (
            action VARCHAR(120) NOT NULL,
            target_type VARCHAR(80) NOT NULL,
            business_module VARCHAR(40) NOT NULL,
            PRIMARY KEY (action, target_type)
        ) ON COMMIT DROP
        """
    )
    bind.execute(
        sa.text(
            "INSERT INTO audit_module_mapping (action, target_type, business_module) "
            "VALUES (:action, :target_type, :business_module)"
        ),
        [
            {
                "action": action,
                "target_type": target_type,
                "business_module": business_module,
            }
            for (action, target_type), business_module in _ACTION_MODULES.items()
        ],
    )
    unknown = bind.execute(
        sa.text(
            "SELECT audit.action, audit.target_type, count(*) "
            "FROM audit_logs audit "
            "LEFT JOIN audit_module_mapping mapping "
            "ON mapping.action = audit.action AND mapping.target_type = audit.target_type "
            "WHERE mapping.action IS NULL "
            "GROUP BY audit.action, audit.target_type "
            "ORDER BY audit.action, audit.target_type"
        )
    ).fetchall()
    if unknown:
        summary = "、".join(
            f"{action}/{target_type}（{count}）" for action, target_type, count in unknown
        )
        raise RuntimeError(f"存在未分类的历史审计动作：{summary}")

    op.execute("ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only")
    op.execute(
        """
        UPDATE audit_logs audit
        SET business_module = mapping.business_module,
            outcome = CASE
                WHEN audit.action = 'ai_model.tested'
                     AND (
                         audit.details ->> 'test_status' = 'FAILED'
                         OR audit.details ? 'error_code'
                     )
                    THEN 'FAILED'
                WHEN audit.action = 'ai_channel.models_discovered'
                     AND audit.details ? 'error_code'
                    THEN 'FAILED'
                ELSE 'SUCCESS'
            END,
            result_message = CASE
                WHEN audit.action = 'ai_model.tested'
                     AND (
                         audit.details ->> 'test_status' = 'FAILED'
                         OR audit.details ? 'error_code'
                     )
                    THEN 'AI 模型测试失败'
                WHEN audit.action = 'ai_channel.models_discovered'
                     AND audit.details ? 'error_code'
                    THEN 'AI 模型发现失败'
                ELSE '操作已完成'
            END,
            error_code = CASE
                WHEN audit.action = 'ai_model.tested'
                     AND audit.details ->> 'test_status' = 'FAILED'
                    THEN 'AI_MODEL_TEST_FAILED'
                WHEN audit.action IN ('ai_model.tested', 'ai_channel.models_discovered')
                    THEN audit.details ->> 'error_code'
                ELSE NULL
            END
        FROM audit_module_mapping mapping
        WHERE mapping.action = audit.action
          AND mapping.target_type = audit.target_type
        """
    )
    op.execute("ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only")

    op.alter_column("audit_logs", "business_module", nullable=False)
    op.alter_column("audit_logs", "outcome", nullable=False)
    op.alter_column("audit_logs", "result_message", nullable=False)
    op.create_check_constraint(
        "ck_audit_logs_business_module",
        "audit_logs",
        "business_module IN "
        "('IDENTITY', 'PRODUCT_FACTS', 'CONTENT_PLANNING', 'CONTENT_PRODUCTION', "
        "'CONTENT_REVIEW', 'PUBLICATION', 'GEO_OBSERVATION', 'CONFIGURATION', "
        "'FILE_MANAGEMENT')",
    )
    op.create_check_constraint(
        "ck_audit_logs_outcome",
        "audit_logs",
        "outcome IN ('SUCCESS', 'FAILED', 'DENIED')",
    )
    op.create_index(
        "ix_audit_logs_created_id",
        "audit_logs",
        [sa.text("created_at DESC"), sa.text("id DESC")],
    )


def downgrade() -> None:
    """存在空对象标识时拒绝有损降级，否则只移除 0024 字段。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM audit_logs WHERE target_id IS NULL) THEN
            RAISE EXCEPTION 'nullable audit target history exists; downgrade is forbidden'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$
        """
    )
    op.drop_index("ix_audit_logs_created_id", table_name="audit_logs")
    op.drop_constraint("ck_audit_logs_outcome", "audit_logs", type_="check")
    op.drop_constraint("ck_audit_logs_business_module", "audit_logs", type_="check")
    op.alter_column(
        "audit_logs",
        "target_id",
        existing_type=sa.String(100),
        nullable=False,
    )
    op.drop_column("audit_logs", "error_code")
    op.drop_column("audit_logs", "result_message")
    op.drop_column("audit_logs", "outcome")
    op.drop_column("audit_logs", "business_module")
