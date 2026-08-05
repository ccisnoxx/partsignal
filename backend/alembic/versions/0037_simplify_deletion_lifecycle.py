"""收缩任务、配置与审计的删除生命周期。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0037_simplify_deletion_lifecycle"
down_revision = "0036_remove_section_url"
branch_labels = None
depends_on = None


RETAINED_AUDIT_ACTIONS = (
    "user.created",
    "user.updated",
    "user.deleted",
    "user.exported",
    "user.password_changed",
    "user.password_reset",
    "ai_channel.created",
    "ai_channel.updated",
    "ai_channel.deleted",
    "ai_channel.api_key_replaced",
    "ai_channel.enabled",
    "ai_channel.disabled",
    "ai_channel_header.created",
    "ai_channel_header.updated",
    "ai_channel_header.deleted",
    "ai_model.created",
    "ai_model.updated",
    "ai_model.deleted",
    "ai_model.enabled",
    "ai_model.disabled",
    "platform_profile.enabled",
    "platform_profile.disabled",
    "platform_prompt.created",
    "platform_prompt.updated",
    "platform_prompt.deleted",
    "content_humanization_prompt.saved",
    "fact_version.approve",
    "content_version.approve",
    "publication_work.completed",
    "product.deleted",
    "fact_version.deleted",
    "content_task.deleted",
    "content_task.permanently_deleted",
    "platform_type.deleted",
    "platform_profile.deleted",
    "platform_account.deleted",
    "geo_observation.deleted",
)


def _add_snapshots() -> None:
    """从现有强外键确定性回填显示快照。"""
    op.add_column(
        "content_tasks",
        sa.Column("archived_at", sa.DateTime(timezone=True)),
    )
    op.add_column(
        "content_tasks",
        sa.Column("platform_profile_name_snapshot", sa.String(length=160)),
    )
    op.add_column(
        "content_tasks",
        sa.Column("platform_website_url_snapshot", sa.Text()),
    )
    op.add_column(
        "publication_works",
        sa.Column("platform_profile_name_snapshot", sa.String(length=160)),
    )
    op.add_column(
        "publication_works",
        sa.Column("platform_account_label_snapshot", sa.String(length=160)),
    )
    op.add_column(
        "publication_works",
        sa.Column("account_identifier_snapshot", sa.String(length=200)),
    )
    op.execute(
        """
        DROP TRIGGER publication_works_guard ON publication_works;

        UPDATE content_tasks task
           SET platform_profile_name_snapshot = profile.name,
               platform_website_url_snapshot = profile.website_url
          FROM platform_profiles profile
         WHERE profile.id = task.platform_profile_id;

        UPDATE publication_works work
           SET platform_profile_name_snapshot = profile.name,
               platform_account_label_snapshot = account.label,
               account_identifier_snapshot = account.account_identifier
          FROM platform_profiles profile, platform_accounts account
         WHERE profile.id = work.platform_profile_id
           AND account.id = work.platform_account_id;

        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM content_tasks WHERE platform_profile_name_snapshot IS NULL
          ) OR EXISTS (
            SELECT 1 FROM publication_works
             WHERE platform_profile_name_snapshot IS NULL
                OR platform_account_label_snapshot IS NULL
                OR account_identifier_snapshot IS NULL
          ) THEN
            RAISE EXCEPTION '0037 无法确定性回填平台或账号快照'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;

        SET CONSTRAINTS ALL IMMEDIATE;
        """
    )
    op.alter_column("content_tasks", "platform_profile_name_snapshot", nullable=False)
    for column in (
        "platform_profile_name_snapshot",
        "platform_account_label_snapshot",
        "account_identifier_snapshot",
    ):
        op.alter_column("publication_works", column, nullable=False)
    op.create_index(
        "ix_content_tasks_archived_at_created_at",
        "content_tasks",
        ["archived_at", "created_at"],
    )
    op.create_check_constraint(
        "ck_content_tasks_open_requires_platform",
        "content_tasks",
        "status <> 'OPEN' OR platform_profile_id IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_content_tasks_archive_completed",
        "content_tasks",
        "archived_at IS NULL OR status = 'COMPLETED'",
    )
    op.create_check_constraint(
        "ck_publication_works_live_configuration",
        "publication_works",
        "status IN ('COMPLETED', 'CLOSED') OR "
        "(platform_profile_id IS NOT NULL AND platform_account_id IS NOT NULL)",
    )


def _replace_foreign_keys() -> None:
    """让终态历史依赖快照，并禁止平台级联任务。"""
    replacements = (
        (
            "content_tasks",
            "fk_content_tasks_platform_profile_id",
            "platform_profiles",
            ["platform_profile_id"],
            "SET NULL",
        ),
        (
            "content_tasks",
            "fk_content_tasks_published_issue",
            "published_content_issues",
            ["source_published_content_issue_id"],
            "SET NULL",
        ),
        (
            "publication_works",
            "fk_publication_works_platform_profile_id_platform_profiles",
            "platform_profiles",
            ["platform_profile_id"],
            "SET NULL",
        ),
        (
            "publication_works",
            "fk_publication_works_platform_account_id_platform_accounts",
            "platform_accounts",
            ["platform_account_id"],
            "SET NULL",
        ),
        (
            "platform_accounts",
            "fk_platform_accounts_platform_profile_id_platform_profiles",
            "platform_profiles",
            ["platform_profile_id"],
            "CASCADE",
        ),
        (
            "content_task_geo_sources",
            "fk_content_task_geo_sources_article",
            "published_articles",
            ["published_article_id"],
            "SET NULL",
        ),
        (
            "geo_observation_citations",
            "fk_geo_citations_published_article",
            "published_articles",
            ["published_article_id"],
            "SET NULL",
        ),
        (
            "geo_observation_publications",
            "fk_geo_publications_published_article",
            "published_articles",
            ["published_article_id"],
            "CASCADE",
        ),
    )
    for table, name, target, columns, ondelete in replacements:
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(
            name,
            table,
            target,
            columns,
            ["id"],
            ondelete=ondelete,
        )
    op.alter_column(
        "content_tasks",
        "platform_profile_id",
        existing_type=postgresql.UUID(as_uuid=True),
        nullable=True,
    )
    for column in ("platform_profile_id", "platform_account_id"):
        op.alter_column(
            "publication_works",
            column,
            existing_type=postgresql.UUID(as_uuid=True),
            nullable=True,
        )
    op.drop_constraint(
        "ck_content_task_geo_sources_identity",
        "content_task_geo_sources",
        type_="check",
    )


def _replace_history_guards() -> None:
    """继续禁止原地修改，但允许受服务命令控制的整体删除。"""
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_content_task_platform() RETURNS trigger AS $$
        BEGIN
          IF pg_trigger_depth() > 1
             AND OLD.platform_profile_id IS NOT NULL
             AND NEW.platform_profile_id IS NULL
             AND OLD.status <> 'OPEN'
             AND to_jsonb(NEW) - 'platform_profile_id'
                 = to_jsonb(OLD) - 'platform_profile_id' THEN
            RETURN NEW;
          END IF;
          IF NEW.platform_profile_id IS DISTINCT FROM OLD.platform_profile_id THEN
            RAISE EXCEPTION '内容任务平台不可原地修改' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER content_review_records_append_only ON content_review_records;
        CREATE TRIGGER content_review_records_append_only
        BEFORE UPDATE ON content_review_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();

        DROP TRIGGER content_task_geo_sources_append_only ON content_task_geo_sources;
        CREATE OR REPLACE FUNCTION partsignal_guard_content_task_geo_source_update()
        RETURNS trigger AS $$
        BEGIN
          IF pg_trigger_depth() > 1
             AND OLD.published_article_id IS NOT NULL
             AND NEW.published_article_id IS NULL
             AND to_jsonb(NEW) - 'published_article_id'
                 = to_jsonb(OLD) - 'published_article_id' THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'GEO 任务来源不可原地修改' USING ERRCODE = '55000';
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER content_task_geo_sources_append_only
        BEFORE UPDATE ON content_task_geo_sources
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_task_geo_source_update();

        CREATE TRIGGER publication_works_guard
        BEFORE UPDATE ON publication_works
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_work();

        DROP TRIGGER published_content_issues_guard ON published_content_issues;
        CREATE TRIGGER published_content_issues_guard
        BEFORE UPDATE ON published_content_issues
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_published_content_issue();

        DROP TRIGGER publication_work_events_append_only ON publication_work_events;
        CREATE TRIGGER publication_work_events_append_only
        BEFORE UPDATE ON publication_work_events
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        DROP TRIGGER publication_verifications_append_only ON publication_verifications;
        CREATE TRIGGER publication_verifications_append_only
        BEFORE UPDATE ON publication_verifications
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        DROP TRIGGER published_articles_append_only ON published_articles;
        CREATE TRIGGER published_articles_append_only
        BEFORE UPDATE ON published_articles
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        DROP TRIGGER publication_attachments_append_only ON publication_attachments;
        CREATE TRIGGER publication_attachments_append_only
        BEFORE UPDATE ON publication_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();

        CREATE OR REPLACE FUNCTION partsignal_guard_repair_task_source() RETURNS trigger AS $$
        BEGIN
          IF pg_trigger_depth() > 1
             AND OLD.source_published_content_issue_id IS NOT NULL
             AND NEW.source_published_content_issue_id IS NULL
             AND to_jsonb(NEW) - 'source_published_content_issue_id'
                 = to_jsonb(OLD) - 'source_published_content_issue_id' THEN
            RETURN NEW;
          END IF;
          IF NEW.source_published_content_issue_id
             IS DISTINCT FROM OLD.source_published_content_issue_id THEN
            RAISE EXCEPTION '修复任务来源不可原地修改' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_guard_geo_citation_update() RETURNS trigger AS $$
        BEGIN
          IF pg_trigger_depth() > 1
             AND OLD.published_article_id IS NOT NULL
             AND NEW.published_article_id IS NULL
             AND to_jsonb(NEW) - 'published_article_id'
                 = to_jsonb(OLD) - 'published_article_id' THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'GEO 引用不可原地修改' USING ERRCODE = '55000';
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER geo_observations_append_only ON geo_observations;
        CREATE TRIGGER geo_observations_append_only
        BEFORE UPDATE ON geo_observations
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        DROP TRIGGER geo_observation_citations_append_only ON geo_observation_citations;
        CREATE TRIGGER geo_observation_citations_append_only
        BEFORE UPDATE ON geo_observation_citations
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_geo_citation_update();
        DROP TRIGGER geo_observation_publications_append_only ON geo_observation_publications;
        CREATE TRIGGER geo_observation_publications_append_only
        BEFORE UPDATE ON geo_observation_publications
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        DROP TRIGGER geo_observation_attachments_append_only ON geo_observation_attachments;
        CREATE TRIGGER geo_observation_attachments_append_only
        BEFORE UPDATE ON geo_observation_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        """
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_publication_work() RETURNS trigger AS $$
        BEGIN
          IF pg_trigger_depth() > 1
             AND OLD.status IN ('COMPLETED', 'CLOSED')
             AND (NEW.platform_profile_id IS NULL OR
                  NEW.platform_profile_id IS NOT DISTINCT FROM OLD.platform_profile_id)
             AND (NEW.platform_account_id IS NULL OR
                  NEW.platform_account_id IS NOT DISTINCT FROM OLD.platform_account_id)
             AND to_jsonb(NEW) - ARRAY['platform_profile_id', 'platform_account_id']
                 = to_jsonb(OLD) - ARRAY['platform_profile_id', 'platform_account_id'] THEN
            RETURN NEW;
          END IF;
          IF NEW.content_task_id IS DISTINCT FROM OLD.content_task_id
             OR NEW.platform_profile_id IS DISTINCT FROM OLD.platform_profile_id
             OR NEW.platform_profile_name_snapshot
                IS DISTINCT FROM OLD.platform_profile_name_snapshot
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION '发布工作身份不可原地修改' USING ERRCODE = '55000';
          END IF;
          IF OLD.status IN ('COMPLETED', 'CLOSED') AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION '终态发布工作不可原地修改' USING ERRCODE = '55000';
          END IF;
          IF NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION '发布工作 revision 必须恰好递增一次' USING ERRCODE = '55000';
          END IF;
          IF NEW.content_version_id IS DISTINCT FROM OLD.content_version_id
             OR NEW.content_hash IS DISTINCT FROM OLD.content_hash THEN
            IF NEW.status <> OLD.status OR NOT EXISTS (
              SELECT 1 FROM content_versions content
              JOIN content_tasks task ON task.id = content.task_id
               WHERE content.id = NEW.content_version_id
                 AND task.id = OLD.content_task_id
                 AND task.current_content_version_id = content.id
                 AND task.platform_profile_id = OLD.platform_profile_id
                 AND content.status = 'APPROVED'
                 AND content.content_hash = NEW.content_hash
            ) THEN
              RAISE EXCEPTION '发布工作内容版本切换无效'
                USING ERRCODE = '55000';
            END IF;
          END IF;
          IF NEW.platform_account_id IS DISTINCT FROM OLD.platform_account_id
             AND NOT (OLD.status IN ('PREPARING', 'PLATFORM_REVIEW')
                      AND NEW.status IN ('PREPARING', 'PLATFORM_REVIEW')) THEN
            RAISE EXCEPTION '发布准备信息已冻结' USING ERRCODE = '55000';
          END IF;
          IF (NEW.platform_account_label_snapshot
                IS DISTINCT FROM OLD.platform_account_label_snapshot
              OR NEW.account_identifier_snapshot
                IS DISTINCT FROM OLD.account_identifier_snapshot)
             AND NEW.platform_account_id IS NOT DISTINCT FROM OLD.platform_account_id THEN
            RAISE EXCEPTION '只有切换账号时才能更新发布账号快照'
              USING ERRCODE = '55000';
          END IF;
          IF (NEW.actual_title IS DISTINCT FROM OLD.actual_title
              OR NEW.final_url IS DISTINCT FROM OLD.final_url
              OR NEW.published_at IS DISTINCT FROM OLD.published_at)
             AND NOT (OLD.status IN ('PREPARING', 'PLATFORM_REVIEW',
                                     'AWAITING_VERIFICATION', 'ACTION_REQUIRED')
                      AND NEW.status = 'AWAITING_VERIFICATION') THEN
            RAISE EXCEPTION '发布结果变化必须通过结果登记命令'
              USING ERRCODE = '55000';
          END IF;
          IF NOT (
            (OLD.status = 'PREPARING' AND NEW.status IN
              ('PREPARING', 'PLATFORM_REVIEW', 'AWAITING_VERIFICATION', 'CLOSED')) OR
            (OLD.status = 'PLATFORM_REVIEW' AND NEW.status IN
              ('PLATFORM_REVIEW', 'AWAITING_VERIFICATION', 'CLOSED')) OR
            (OLD.status = 'AWAITING_VERIFICATION' AND NEW.status IN
              ('AWAITING_VERIFICATION', 'ACTION_REQUIRED', 'COMPLETED', 'CLOSED')) OR
            (OLD.status = 'ACTION_REQUIRED' AND NEW.status IN
              ('ACTION_REQUIRED', 'AWAITING_VERIFICATION', 'COMPLETED', 'CLOSED'))
          ) THEN
            RAISE EXCEPTION '发布工作状态转换无效' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_prepare_platform_profile_delete()
        RETURNS trigger AS $$
        BEGIN
          UPDATE publication_works
             SET platform_profile_id = NULL,
                 platform_account_id = NULL
           WHERE platform_profile_id = OLD.id
             AND status IN ('COMPLETED', 'CLOSED');
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS platform_profiles_prepare_delete ON platform_profiles;
        CREATE TRIGGER platform_profiles_prepare_delete
        BEFORE DELETE ON platform_profiles
        FOR EACH ROW EXECUTE FUNCTION partsignal_prepare_platform_profile_delete();
        """
    )


def _trim_audit_history() -> None:
    """允许精确删除审计，并一次性清理开发期低价值历史。"""
    op.execute(
        """
        DROP TRIGGER audit_logs_append_only ON audit_logs;
        CREATE TRIGGER audit_logs_append_only
        BEFORE UPDATE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_audit_actor_user_delete();
        """
    )
    bind = op.get_bind()
    bind.execute(
        sa.text(
            "DELETE FROM audit_logs "
            "WHERE outcome <> 'SUCCESS' OR action NOT IN :actions"
        ).bindparams(sa.bindparam("actions", expanding=True)),
        {"actions": RETAINED_AUDIT_ACTIONS},
    )


def upgrade() -> None:
    """安装归档、快照、聚合删除和收缩审计合同。"""
    _add_snapshots()
    _replace_foreign_keys()
    _replace_history_guards()
    _trim_audit_history()


def downgrade() -> None:
    """审计清理和永久删除不可逆，恢复必须使用迁移前备份。"""
    op.execute(
        """
        DO $$
        BEGIN
          RAISE EXCEPTION '0037 无法安全降级，请恢复迁移前备份'
            USING ERRCODE = '55000';
        END;
        $$;
        """
    )
