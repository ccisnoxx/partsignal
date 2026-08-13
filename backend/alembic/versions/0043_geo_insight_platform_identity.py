"""冻结发布工作的平台 UUID，避免配置删除后 GEO 历史失去身份。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0043_geo_platform_identity"
down_revision = "0042_content_version_detail"
branch_labels = None
depends_on = None


def _replace_publication_work_guard(*, include_snapshot: bool) -> None:
    """按迁移方向替换发布工作更新守卫。"""
    snapshot_identity = """
             OR NEW.platform_profile_id_snapshot
                IS DISTINCT FROM OLD.platform_profile_id_snapshot""" if include_snapshot else ""
    op.execute(
        f"""
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
                IS DISTINCT FROM OLD.platform_profile_name_snapshot{snapshot_identity}
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
        """
    )


def upgrade() -> None:
    """回填可证明的平台身份，并拒绝不可恢复的已发布历史。"""
    op.add_column(
        "publication_works",
        sa.Column(
            "platform_profile_id_snapshot",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.execute("DROP TRIGGER publication_works_guard ON publication_works")
    op.execute(
        "UPDATE publication_works "
        "SET platform_profile_id_snapshot = platform_profile_id "
        "WHERE platform_profile_id IS NOT NULL"
    )
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
              FROM published_articles article
              JOIN publication_works work ON work.id = article.id
             WHERE work.platform_profile_id_snapshot IS NULL
          ) THEN
            RAISE EXCEPTION '已发布成果缺少可恢复的平台 UUID，0043 无法继续'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;

        CREATE FUNCTION partsignal_validate_publication_work_platform_snapshot()
        RETURNS trigger AS $$
        BEGIN
          IF NEW.platform_profile_id_snapshot IS NULL
             OR NEW.platform_profile_id_snapshot
                IS DISTINCT FROM NEW.platform_profile_id THEN
            RAISE EXCEPTION '新发布工作必须冻结当前平台 UUID'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER publication_works_validate_platform_snapshot
        BEFORE INSERT ON publication_works
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_publication_work_platform_snapshot();
        """
    )
    _replace_publication_work_guard(include_snapshot=True)
    op.execute(
        "CREATE TRIGGER publication_works_guard "
        "BEFORE UPDATE ON publication_works "
        "FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_work()"
    )


def downgrade() -> None:
    """只有实时平台身份均仍存在时才允许丢弃冻结 UUID。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM publication_works WHERE platform_profile_id IS NULL
          ) THEN
            RAISE EXCEPTION '冻结平台 UUID 已成为唯一身份，0043 无法安全降级'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;

        DROP TRIGGER publication_works_validate_platform_snapshot ON publication_works;
        DROP FUNCTION partsignal_validate_publication_work_platform_snapshot();
        """
    )
    _replace_publication_work_guard(include_snapshot=False)
    op.drop_column("publication_works", "platform_profile_id_snapshot")
