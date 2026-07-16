"""允许按修订号编辑平台规则草稿，并继续冻结已激活或退役正文。"""

from alembic import op

revision = "0015_platform_rule_draft_editing"
down_revision = "0014_platform_prompt_ownership"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """仅放开更新前后均为 DRAFT 的规则正文。"""
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_platform_version() RETURNS trigger AS $$
        BEGIN
          IF NEW.platform_profile_id IS DISTINCT FROM OLD.platform_profile_id
             OR NEW.version IS DISTINCT FROM OLD.version
             OR NEW.created_at IS DISTINCT FROM OLD.created_at
             OR (
               NEW.rules IS DISTINCT FROM OLD.rules
               AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'DRAFT')
             ) THEN
            RAISE EXCEPTION 'platform profile version payload is immutable' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    """恢复所有状态下规则正文均不可更新的旧门禁。"""
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
        """
    )
