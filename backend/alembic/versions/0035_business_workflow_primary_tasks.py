"""建立事实提交、内容单主线、发布版本快照与 GEO 来源合同。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0035_business_workflow"
down_revision = "0034_publication_redesign"
branch_labels = None
depends_on = None


def _assert_deterministic_source_data() -> None:
    """歧义业务数据不能由迁移代替用户选择。"""
    op.execute(
        """
        DO $$
        DECLARE
          blockers text := '';
          row_count bigint;
        BEGIN
          SELECT count(*) INTO row_count FROM fact_versions WHERE status = 'DRAFT';
          IF row_count > 0 THEN
            blockers := blockers || format('fact_versions.DRAFT=%s; ', row_count);
          END IF;

          SELECT count(*) INTO row_count FROM (
            SELECT product_id FROM fact_versions
             WHERE status = 'PENDING_REVIEW'
             GROUP BY product_id HAVING count(*) > 1
          ) duplicated;
          IF row_count > 0 THEN
            blockers := blockers || format('fact_versions.multiple_pending=%s; ', row_count);
          END IF;

          SELECT count(*) INTO row_count FROM (
            SELECT task_id FROM content_versions
             WHERE status = 'PENDING_REVIEW'
             GROUP BY task_id HAVING count(*) > 1
          ) duplicated;
          IF row_count > 0 THEN
            blockers := blockers || format('content_versions.multiple_pending=%s; ', row_count);
          END IF;

          SELECT count(*) INTO row_count FROM (
            SELECT content.task_id
              FROM publication_works work
              JOIN content_versions content ON content.id = work.content_version_id
             GROUP BY content.task_id HAVING count(*) > 1
          ) duplicated;
          IF row_count > 0 THEN
            blockers := blockers || format('publication_works.multiple_per_task=%s; ', row_count);
          END IF;

          IF blockers <> '' THEN
            RAISE EXCEPTION '0035 业务主线存在歧义：%', blockers
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )


def _add_columns_and_backfill() -> None:
    op.add_column(
        "content_tasks",
        sa.Column("current_content_version_id", postgresql.UUID(as_uuid=True)),
    )
    op.execute(
        """
        UPDATE content_tasks task
           SET current_content_version_id = current_version.id
          FROM (
            SELECT DISTINCT ON (task_id) task_id, id
              FROM content_versions
             ORDER BY task_id, version DESC
          ) current_version
         WHERE current_version.task_id = task.id
        """
    )
    op.create_foreign_key(
        "fk_content_tasks_current_content_version_id",
        "content_tasks",
        "content_versions",
        ["current_content_version_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    op.add_column(
        "publication_works",
        sa.Column("content_task_id", postgresql.UUID(as_uuid=True)),
    )
    # 旧门禁把内容版本视为永久身份；迁移完成后由新门禁替换。
    op.execute("DROP TRIGGER publication_works_guard ON publication_works")
    op.execute(
        """
        UPDATE publication_works work
           SET content_task_id = content.task_id
          FROM content_versions content
         WHERE content.id = work.content_version_id
        """
    )
    op.execute("SET CONSTRAINTS ALL IMMEDIATE")
    op.alter_column("publication_works", "content_task_id", nullable=False)
    op.create_foreign_key(
        "fk_publication_works_content_task_id_content_tasks",
        "publication_works",
        "content_tasks",
        ["content_task_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.drop_constraint(
        "uq_publication_works_content_version_id", "publication_works", type_="unique"
    )
    op.create_unique_constraint(
        "uq_publication_works_content_task_id", "publication_works", ["content_task_id"]
    )

    op.add_column(
        "publication_work_events",
        sa.Column("from_content_version_id", postgresql.UUID(as_uuid=True)),
    )
    op.add_column(
        "publication_work_events",
        sa.Column("to_content_version_id", postgresql.UUID(as_uuid=True)),
    )
    for column in ("from_content_version_id", "to_content_version_id"):
        op.create_foreign_key(
            f"fk_publication_work_events_{column}",
            "publication_work_events",
            "content_versions",
            [column],
            ["id"],
            ondelete="RESTRICT",
        )

    op.add_column(
        "publication_verifications",
        sa.Column("content_version_id", postgresql.UUID(as_uuid=True)),
    )
    # 只为冻结现有行的确定性内容版本临时替换追加式触发器。
    op.execute(
        "DROP TRIGGER publication_verifications_append_only ON publication_verifications"
    )
    op.execute(
        """
        UPDATE publication_verifications verification
           SET content_version_id = work.content_version_id
          FROM publication_works work
         WHERE work.id = verification.publication_work_id
        """
    )
    op.execute(
        "CREATE TRIGGER publication_verifications_append_only "
        "BEFORE UPDATE OR DELETE ON publication_verifications "
        "FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change()"
    )
    op.alter_column("publication_verifications", "content_version_id", nullable=False)
    op.create_foreign_key(
        "fk_publication_verifications_content_version_id",
        "publication_verifications",
        "content_versions",
        ["content_version_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def _add_constraints_and_geo_source() -> None:
    op.create_check_constraint(
        "ck_fact_versions_status_business_workflow",
        "fact_versions",
        "status IN ('PENDING_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'RETIRED')",
    )
    op.create_index(
        "uq_fact_versions_one_pending_per_product",
        "fact_versions",
        ["product_id"],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING_REVIEW'"),
    )
    op.create_check_constraint(
        "ck_content_versions_status_business_workflow",
        "content_versions",
        "status IN ('DRAFT', 'PENDING_REVIEW', 'CHANGES_REQUESTED', "
        "'APPROVED', 'SUPERSEDED', 'ABANDONED')",
    )
    op.create_index(
        "uq_content_versions_one_pending_per_task",
        "content_versions",
        ["task_id"],
        unique=True,
        postgresql_where=sa.text("status = 'PENDING_REVIEW'"),
    )

    op.create_table(
        "content_task_geo_sources",
        sa.Column("content_task_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rule_code", sa.String(length=48), nullable=False),
        sa.Column("date_from", sa.Date(), nullable=False),
        sa.Column("date_to", sa.Date(), nullable=False),
        sa.Column("published_article_id", postgresql.UUID(as_uuid=True)),
        sa.Column("query_topic_id", postgresql.UUID(as_uuid=True)),
        sa.Column("geo_platform", sa.String(length=160)),
        sa.Column("basis_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "rule_code IN ('CONTENT_DECLINE', 'LONG_UNMENTIONED', 'QUESTION_COVERAGE_GAP')",
            name="ck_content_task_geo_sources_rule_code",
        ),
        sa.CheckConstraint("date_from <= date_to", name="ck_content_task_geo_sources_period"),
        sa.CheckConstraint(
            "published_article_id IS NOT NULL OR query_topic_id IS NOT NULL",
            name="ck_content_task_geo_sources_identity",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(basis_snapshot) = 'object'",
            name="ck_content_task_geo_sources_snapshot_object",
        ),
        sa.ForeignKeyConstraint(
            ["content_task_id"],
            ["content_tasks.id"],
            name="fk_content_task_geo_sources_task",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["published_article_id"],
            ["published_articles.id"],
            name="fk_content_task_geo_sources_article",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["query_topic_id"],
            ["query_topics.id"],
            name="fk_content_task_geo_sources_topic",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_content_task_geo_sources_actor",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("content_task_id", name="pk_content_task_geo_sources"),
    )


def _replace_fact_and_content_guards() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_guard_fact_version() RETURNS trigger AS $$
        BEGIN
          IF NEW.product_id IS DISTINCT FROM OLD.product_id
             OR NEW.version IS DISTINCT FROM OLD.version
             OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
             OR NEW.classification IS DISTINCT FROM OLD.classification
             OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'fact version payload is immutable' USING ERRCODE = '55000';
          END IF;
          IF NOT (
            (OLD.status = 'PENDING_REVIEW'
             AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
            (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'RETIRED')) OR
            (OLD.status = NEW.status)
          ) THEN
            RAISE EXCEPTION 'invalid fact version transition' USING ERRCODE = '55000';
          END IF;
          IF (OLD.status <> 'PENDING_REVIEW' OR NEW.status <> 'APPROVED')
             AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by
               OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
            RAISE EXCEPTION 'fact approval metadata is immutable' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_guard_content_version() RETURNS trigger AS $$
        BEGIN
          IF current_setting('partsignal.content_task_delete_id', true) = OLD.task_id::text
             AND NEW.source_job_id IS NULL
             AND to_jsonb(NEW) - 'source_job_id' = to_jsonb(OLD) - 'source_job_id' THEN
            RETURN NEW;
          END IF;
          IF NEW.task_id IS DISTINCT FROM OLD.task_id
             OR NEW.fact_version_id IS DISTINCT FROM OLD.fact_version_id
             OR NEW.source_job_id IS DISTINCT FROM OLD.source_job_id
             OR NEW.based_on_id IS DISTINCT FROM OLD.based_on_id
             OR NEW.version IS DISTINCT FROM OLD.version
             OR NEW.source_type IS DISTINCT FROM OLD.source_type
             OR NEW.title IS DISTINCT FROM OLD.title
             OR NEW.summary IS DISTINCT FROM OLD.summary
             OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
             OR NEW.tags IS DISTINCT FROM OLD.tags
             OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
             OR NEW.quality_issues IS DISTINCT FROM OLD.quality_issues
             OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'content version payload is immutable' USING ERRCODE = '55000';
          END IF;
          IF NOT (
            (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PENDING_REVIEW', 'ABANDONED')) OR
            (OLD.status = 'PENDING_REVIEW'
             AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
            (OLD.status = 'CHANGES_REQUESTED'
             AND NEW.status IN ('CHANGES_REQUESTED', 'ABANDONED')) OR
            (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'SUPERSEDED')) OR
            (OLD.status = NEW.status)
          ) THEN
            RAISE EXCEPTION 'invalid content version transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE FUNCTION partsignal_validate_current_content_version() RETURNS trigger AS $$
        BEGIN
          IF NEW.current_content_version_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM content_versions content
             WHERE content.id = NEW.current_content_version_id
               AND content.task_id = NEW.id
          ) THEN
            RAISE EXCEPTION 'current content version must belong to task'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER content_tasks_current_content_version_guard
        BEFORE INSERT OR UPDATE OF current_content_version_id ON content_tasks
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_current_content_version();

        CREATE TRIGGER content_task_geo_sources_append_only
        BEFORE UPDATE OR DELETE ON content_task_geo_sources
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        """
    )


def _replace_publication_guards() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_validate_publication_work_insert() RETURNS trigger AS $$
        BEGIN
          IF NEW.status <> 'PREPARING' OR NEW.revision <> 0
             OR NEW.actual_title IS NOT NULL OR NEW.final_url IS NOT NULL
             OR NEW.published_at IS NOT NULL OR NEW.close_reason IS NOT NULL
             OR NEW.close_comment IS NOT NULL OR NEW.closed_by IS NOT NULL
             OR NEW.closed_at IS NOT NULL THEN
            RAISE EXCEPTION 'publication work must start preparing' USING ERRCODE = '23514';
          END IF;
          IF NOT EXISTS (
            SELECT 1
              FROM content_versions content
              JOIN content_tasks task ON task.id = content.task_id
              JOIN fact_versions fact ON fact.id = content.fact_version_id
              JOIN platform_accounts account ON account.id = NEW.platform_account_id
             WHERE content.id = NEW.content_version_id
               AND task.id = NEW.content_task_id
               AND task.current_content_version_id = content.id
               AND content.status = 'APPROVED'
               AND fact.status = 'APPROVED'
               AND task.status = 'OPEN'
               AND task.platform_profile_id = NEW.platform_profile_id
               AND account.platform_profile_id = NEW.platform_profile_id
               AND content.content_hash = NEW.content_hash
          ) THEN
            RAISE EXCEPTION 'invalid publication work context' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_guard_publication_work() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'publication work history is append-only' USING ERRCODE = '55000';
          END IF;
          IF NEW.content_task_id IS DISTINCT FROM OLD.content_task_id
             OR NEW.platform_profile_id IS DISTINCT FROM OLD.platform_profile_id
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'publication work identity is immutable' USING ERRCODE = '55000';
          END IF;
          IF OLD.status IN ('COMPLETED', 'CLOSED') AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'terminal publication work is immutable' USING ERRCODE = '55000';
          END IF;
          IF NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION 'publication work revision must increment once' USING ERRCODE = '55000';
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
              RAISE EXCEPTION 'invalid publication content version switch'
                USING ERRCODE = '55000';
            END IF;
          END IF;
          IF (NEW.platform_account_id IS DISTINCT FROM OLD.platform_account_id
              OR NEW.section_url IS DISTINCT FROM OLD.section_url)
             AND NOT (OLD.status IN ('PREPARING', 'PLATFORM_REVIEW')
                      AND NEW.status IN ('PREPARING', 'PLATFORM_REVIEW')) THEN
            RAISE EXCEPTION 'publication preparation is frozen' USING ERRCODE = '55000';
          END IF;
          IF (NEW.actual_title IS DISTINCT FROM OLD.actual_title
              OR NEW.final_url IS DISTINCT FROM OLD.final_url
              OR NEW.published_at IS DISTINCT FROM OLD.published_at)
             AND NOT (OLD.status IN ('PREPARING', 'PLATFORM_REVIEW',
                                     'AWAITING_VERIFICATION', 'ACTION_REQUIRED')
                      AND NEW.status = 'AWAITING_VERIFICATION') THEN
            RAISE EXCEPTION 'publication result change requires registration'
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
            RAISE EXCEPTION 'invalid publication work transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_validate_publication_verification() RETURNS trigger AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM publication_works work
             WHERE work.id = NEW.publication_work_id
               AND work.status IN ('AWAITING_VERIFICATION', 'ACTION_REQUIRED')
               AND work.content_version_id = NEW.content_version_id
               AND work.actual_title = NEW.actual_title_snapshot
               AND work.final_url = NEW.final_url_snapshot
               AND work.published_at = NEW.published_at_snapshot
          ) THEN
            RAISE EXCEPTION 'verification snapshot does not match current publication result'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER publication_works_guard
        BEFORE UPDATE OR DELETE ON publication_works
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_work();

        CREATE OR REPLACE FUNCTION partsignal_validate_publication_completion() RETURNS trigger AS $$
        DECLARE
          target_id uuid;
          work_status text;
          task_status text;
          article_count integer;
        BEGIN
          IF TG_TABLE_NAME = 'publication_works' THEN
            target_id := COALESCE(NEW.id, OLD.id);
          ELSIF TG_TABLE_NAME = 'published_articles' THEN
            target_id := COALESCE(NEW.id, OLD.id);
          ELSE
            target_id := COALESCE(NEW.publication_work_id, OLD.publication_work_id);
          END IF;
          SELECT work.status, task.status
            INTO work_status, task_status
            FROM publication_works work
            JOIN content_tasks task ON task.id = work.content_task_id
           WHERE work.id = target_id;
          IF work_status IS NULL THEN RETURN NULL; END IF;
          SELECT count(*) INTO article_count FROM published_articles WHERE id = target_id;
          IF work_status = 'COMPLETED' THEN
            IF article_count <> 1 OR task_status <> 'COMPLETED' THEN
              RAISE EXCEPTION 'completed publication work requires article and completed task'
                USING ERRCODE = '23514';
            END IF;
            IF NOT EXISTS (
              SELECT 1 FROM published_articles article
              JOIN publication_verifications verification
                ON verification.id = article.verification_id
              JOIN publication_works work ON work.id = article.id
             WHERE article.id = target_id
               AND verification.publication_work_id = target_id
               AND verification.content_version_id = work.content_version_id
               AND verification.outcome = 'PASSED'
            ) THEN
              RAISE EXCEPTION 'published article requires matching passed verification'
                USING ERRCODE = '23514';
            END IF;
          ELSIF article_count <> 0 THEN
            RAISE EXCEPTION 'only completed publication work may have an article'
              USING ERRCODE = '23514';
          ELSIF work_status = 'CLOSED' AND task_status <> 'CANCELLED' THEN
            RAISE EXCEPTION 'closed publication work requires cancelled task'
              USING ERRCODE = '23514';
          ELSIF work_status NOT IN ('COMPLETED', 'CLOSED') AND task_status <> 'OPEN' THEN
            RAISE EXCEPTION 'active publication work requires open task' USING ERRCODE = '23514';
          END IF;
          RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def upgrade() -> None:
    """仅确定性回填主线和发布快照，歧义数据原子阻断。"""
    _assert_deterministic_source_data()
    _add_columns_and_backfill()
    _add_constraints_and_geo_source()
    _replace_fact_and_content_guards()
    _replace_publication_guards()


def downgrade() -> None:
    """新状态与历史快照不能无损删除，必须恢复迁移前备份。"""
    op.execute(
        """
        DO $$
        BEGIN
          RAISE EXCEPTION '0035 无法安全降级，请恢复迁移前备份'
            USING ERRCODE = '55000';
        END;
        $$;
        """
    )
