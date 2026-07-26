"""补齐发布账号修订约束，并阻止同平台规范化账号标识重复。"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0026_publication_account_dedup"
down_revision = "0025_markdown_facts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """在不猜测保留对象的前提下校验并收紧发布账号。"""
    op.execute("LOCK TABLE platform_accounts IN ACCESS EXCLUSIVE MODE")
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM platform_accounts WHERE length(btrim(label)) = 0) THEN
            RAISE EXCEPTION '0026 检测到空业务标签，请人工修复 platform_accounts 后重试'
              USING ERRCODE = '55000';
          END IF;
          IF EXISTS (
            SELECT 1 FROM platform_accounts WHERE length(btrim(account_identifier)) = 0
          ) THEN
            RAISE EXCEPTION '0026 检测到空运营账号标识，请人工修复 platform_accounts 后重试'
              USING ERRCODE = '55000';
          END IF;
          IF EXISTS (
            SELECT 1
            FROM platform_accounts
            GROUP BY platform_profile_id, lower(btrim(account_identifier))
            HAVING count(*) > 1
          ) THEN
            RAISE EXCEPTION '0026 检测到同平台重复运营账号标识，请人工处理后重试'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        UPDATE platform_accounts
        SET label = btrim(label), account_identifier = btrim(account_identifier);
        """
    )
    op.add_column(
        "platform_accounts",
        sa.Column("revision", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_platform_accounts_revision_nonnegative"),
        "platform_accounts",
        "revision >= 0",
    )
    op.create_check_constraint(
        op.f("ck_platform_accounts_label_nonblank"),
        "platform_accounts",
        "length(btrim(label)) > 0",
    )
    op.create_check_constraint(
        op.f("ck_platform_accounts_identifier_nonblank"),
        "platform_accounts",
        "length(btrim(account_identifier)) > 0",
    )
    op.execute(
        """
        CREATE UNIQUE INDEX uq_platform_accounts_profile_identifier_normalized
        ON platform_accounts (platform_profile_id, lower(btrim(account_identifier)))
        """
    )


def downgrade() -> None:
    """移除本 revision 新增的可变账号约束，不删除账号或发布历史。"""
    op.drop_index(
        "uq_platform_accounts_profile_identifier_normalized",
        table_name="platform_accounts",
    )
    op.drop_constraint(
        op.f("ck_platform_accounts_identifier_nonblank"),
        "platform_accounts",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_platform_accounts_label_nonblank"),
        "platform_accounts",
        type_="check",
    )
    op.drop_constraint(
        op.f("ck_platform_accounts_revision_nonnegative"),
        "platform_accounts",
        type_="check",
    )
    op.drop_column("platform_accounts", "revision")
