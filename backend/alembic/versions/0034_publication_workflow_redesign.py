"""以发布工作、首次核验成果和发布后内容问题替换旧发布记录。"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0034_publication_redesign"
down_revision = "0033_task_owned_history_delete"
branch_labels = None
depends_on = None


def _assert_legacy_publication_data_empty() -> None:
    """旧语义无法可靠映射，存在业务数据时使用 PostgreSQL 55000 阻断。"""
    op.execute(
        """
        DO $$
        DECLARE
          blockers text := '';
          row_count bigint;
        BEGIN
          SELECT count(*) INTO row_count FROM publication_records;
          IF row_count > 0 THEN blockers := blockers || format('publication_records=%s; ', row_count); END IF;
          SELECT count(*) INTO row_count FROM publication_status_events;
          IF row_count > 0 THEN blockers := blockers || format('publication_status_events=%s; ', row_count); END IF;
          SELECT count(*) INTO row_count FROM publication_attentions;
          IF row_count > 0 THEN blockers := blockers || format('publication_attentions=%s; ', row_count); END IF;
          SELECT count(*) INTO row_count FROM publication_attachments;
          IF row_count > 0 THEN blockers := blockers || format('publication_attachments=%s; ', row_count); END IF;
          SELECT count(*) INTO row_count FROM geo_observation_publications;
          IF row_count > 0 THEN blockers := blockers || format('geo_observation_publications=%s; ', row_count); END IF;
          SELECT count(*) INTO row_count FROM geo_observation_citations
           WHERE publication_record_id IS NOT NULL;
          IF row_count > 0 THEN blockers := blockers || format('geo_observation_citations=%s; ', row_count); END IF;
          SELECT count(*) INTO row_count FROM content_tasks
           WHERE source_publication_attention_id IS NOT NULL;
          IF row_count > 0 THEN blockers := blockers || format('content_task_repair_sources=%s; ', row_count); END IF;
          IF blockers <> '' THEN
            RAISE EXCEPTION '0034 需要先完成已批准的环境重置：%', blockers
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )


def _create_tables() -> None:
    op.create_table(
        "publication_works",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("content_version_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform_profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform_account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("section_url", sa.Text(), nullable=False),
        sa.Column("actual_title", sa.Text()),
        sa.Column("final_url", sa.Text()),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("close_reason", sa.String(length=40)),
        sa.Column("close_comment", sa.Text()),
        sa.Column("closed_by", postgresql.UUID(as_uuid=True)),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "status IN ('PREPARING', 'PLATFORM_REVIEW', 'AWAITING_VERIFICATION', "
            "'ACTION_REQUIRED', 'COMPLETED', 'CLOSED')",
            name="ck_publication_works_status_valid",
        ),
        sa.CheckConstraint("revision >= 0", name="ck_publication_works_revision_nonnegative"),
        sa.CheckConstraint(
            "(status IN ('AWAITING_VERIFICATION', 'ACTION_REQUIRED', 'COMPLETED') "
            "AND actual_title IS NOT NULL AND length(btrim(actual_title)) > 0 "
            "AND final_url IS NOT NULL AND published_at IS NOT NULL) OR "
            "status IN ('PREPARING', 'PLATFORM_REVIEW', 'CLOSED')",
            name="ck_publication_works_result_complete",
        ),
        sa.CheckConstraint(
            "(status = 'CLOSED' AND close_reason IS NOT NULL "
            "AND length(btrim(close_comment)) > 0 AND closed_by IS NOT NULL "
            "AND closed_at IS NOT NULL) OR "
            "(status <> 'CLOSED' AND close_reason IS NULL AND close_comment IS NULL "
            "AND closed_by IS NULL AND closed_at IS NULL)",
            name="ck_publication_works_close_complete",
        ),
        sa.CheckConstraint(
            "close_reason IS NULL OR close_reason IN "
            "('PLATFORM_REJECTED', 'BUSINESS_CANCELLED', 'OTHER')",
            name="ck_publication_works_close_reason_valid",
        ),
        sa.ForeignKeyConstraint(
            ["content_version_id"],
            ["content_versions.id"],
            name="fk_publication_works_content_version_id_content_versions",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["platform_profile_id"],
            ["platform_profiles.id"],
            name="fk_publication_works_platform_profile_id_platform_profiles",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["platform_account_id"],
            ["platform_accounts.id"],
            name="fk_publication_works_platform_account_id_platform_accounts",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["closed_by"],
            ["users.id"],
            name="fk_publication_works_closed_by_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_publication_works_created_by_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_publication_works"),
        sa.UniqueConstraint(
            "idempotency_key",
            name="uq_publication_works_idempotency_key",
        ),
        sa.UniqueConstraint(
            "content_version_id",
            name="uq_publication_works_content_version_id",
        ),
    )
    op.create_index(
        "uq_publication_works_active_platform_hash",
        "publication_works",
        ["platform_profile_id", "content_hash"],
        unique=True,
        postgresql_where=sa.text("status <> 'CLOSED'"),
    )
    op.create_index(
        "ix_publication_works_status_updated_at",
        "publication_works",
        ["status", "updated_at"],
    )
    op.create_table(
        "publication_work_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("publication_work_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("from_status", sa.String(length=40)),
        sa.Column("to_status", sa.String(length=40), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["publication_work_id"],
            ["publication_works.id"],
            name="fk_publication_work_events_work",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name="fk_publication_work_events_actor_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_publication_work_events"),
    )
    op.create_table(
        "publication_verifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("publication_work_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("outcome", sa.String(length=16), nullable=False),
        sa.Column("actual_title_snapshot", sa.Text(), nullable=False),
        sa.Column("final_url_snapshot", sa.Text(), nullable=False),
        sa.Column("published_at_snapshot", sa.DateTime(timezone=True), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "outcome IN ('PASSED', 'FAILED')",
            name="ck_publication_verifications_outcome_valid",
        ),
        sa.CheckConstraint(
            "outcome = 'PASSED' OR length(btrim(comment)) > 0",
            name="ck_publication_verifications_failed_comment_nonblank",
        ),
        sa.ForeignKeyConstraint(
            ["publication_work_id"],
            ["publication_works.id"],
            name="fk_publication_verifications_work",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_id"],
            ["users.id"],
            name="fk_publication_verifications_actor_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_publication_verifications"),
    )
    op.create_index(
        "uq_publication_verifications_one_passed",
        "publication_verifications",
        ["publication_work_id"],
        unique=True,
        postgresql_where=sa.text("outcome = 'PASSED'"),
    )
    op.create_table(
        "published_articles",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("verification_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["id"],
            ["publication_works.id"],
            name="fk_published_articles_id_publication_works",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["verification_id"],
            ["publication_verifications.id"],
            name="fk_published_articles_verification_id_publication_verifications",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_published_articles"),
        sa.UniqueConstraint(
            "verification_id",
            name="uq_published_articles_verification_id",
        ),
    )
    op.create_table(
        "published_content_issues",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("published_article_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("opened_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("resolved_by", postgresql.UUID(as_uuid=True)),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("resolution_outcome", sa.String(length=20)),
        sa.Column("resolution_comment", sa.Text()),
        sa.CheckConstraint(
            "kind IN ('PAGE_UNAVAILABLE', 'CONTENT_CHANGED', 'OTHER')",
            name="ck_published_content_issues_kind_valid",
        ),
        sa.CheckConstraint(
            "status IN ('OPEN', 'RESOLVED')",
            name="ck_published_content_issues_status_valid",
        ),
        sa.CheckConstraint(
            "revision >= 0",
            name="ck_published_content_issues_revision_nonnegative",
        ),
        sa.CheckConstraint(
            "length(btrim(description)) > 0",
            name="ck_published_content_issues_description_nonblank",
        ),
        sa.CheckConstraint(
            "(status = 'OPEN' AND resolved_at IS NULL AND resolved_by IS NULL "
            "AND resolution_outcome IS NULL AND resolution_comment IS NULL) OR "
            "(status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL "
            "AND resolution_outcome IN ('RESTORED', 'RETIRED') "
            "AND length(btrim(resolution_comment)) > 0)",
            name="ck_published_content_issues_resolution_complete",
        ),
        sa.ForeignKeyConstraint(
            ["published_article_id"],
            ["published_articles.id"],
            name="fk_published_content_issues_article",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["opened_by"],
            ["users.id"],
            name="fk_published_content_issues_opened_by_users",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["resolved_by"],
            ["users.id"],
            name="fk_published_content_issues_resolved_by_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_published_content_issues"),
    )
    op.create_index(
        "uq_published_content_issues_one_open",
        "published_content_issues",
        ["published_article_id"],
        unique=True,
        postgresql_where=sa.text("status = 'OPEN'"),
    )
    op.create_index(
        "ix_published_content_issues_status_opened_at",
        "published_content_issues",
        ["status", "opened_at"],
    )
    op.create_table(
        "publication_attachments",
        sa.Column("publication_work_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("file_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["publication_work_id"],
            ["publication_works.id"],
            name="fk_publication_attachments_work",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["file_id"],
            ["file_records.id"],
            name="fk_publication_attachments_file_id_file_records",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "publication_work_id",
            "file_id",
            name="pk_publication_attachments",
        ),
    )


def _create_guards() -> None:
    op.execute(
        """
        CREATE FUNCTION partsignal_validate_publication_work_insert() RETURNS trigger AS $$
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

        CREATE TRIGGER publication_works_validate_insert
        BEFORE INSERT ON publication_works
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_publication_work_insert();

        CREATE FUNCTION partsignal_guard_publication_work() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'publication work history is append-only' USING ERRCODE = '55000';
          END IF;
          IF NEW.content_version_id IS DISTINCT FROM OLD.content_version_id
             OR NEW.platform_profile_id IS DISTINCT FROM OLD.platform_profile_id
             OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
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

        CREATE TRIGGER publication_works_guard
        BEFORE UPDATE OR DELETE ON publication_works
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_work();

        CREATE FUNCTION partsignal_validate_publication_verification() RETURNS trigger AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM publication_works work
             WHERE work.id = NEW.publication_work_id
               AND work.status IN ('AWAITING_VERIFICATION', 'ACTION_REQUIRED')
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

        CREATE TRIGGER publication_verifications_validate_insert
        BEFORE INSERT ON publication_verifications
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_publication_verification();

        CREATE FUNCTION partsignal_validate_publication_completion() RETURNS trigger AS $$
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
            JOIN content_versions content ON content.id = work.content_version_id
            JOIN content_tasks task ON task.id = content.task_id
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
             WHERE article.id = target_id
               AND verification.publication_work_id = target_id
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

        CREATE CONSTRAINT TRIGGER publication_works_completion_guard
        AFTER INSERT OR UPDATE OR DELETE ON publication_works
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_publication_completion();
        CREATE CONSTRAINT TRIGGER published_articles_completion_guard
        AFTER INSERT OR UPDATE OR DELETE ON published_articles
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_publication_completion();
        CREATE CONSTRAINT TRIGGER publication_verifications_completion_guard
        AFTER INSERT OR UPDATE OR DELETE ON publication_verifications
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_publication_completion();

        CREATE FUNCTION partsignal_guard_published_content_issue() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'published content issue history is append-only'
              USING ERRCODE = '55000';
          END IF;
          IF NEW.published_article_id IS DISTINCT FROM OLD.published_article_id
             OR NEW.kind IS DISTINCT FROM OLD.kind
             OR NEW.description IS DISTINCT FROM OLD.description
             OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
             OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
            RAISE EXCEPTION 'published content issue binding is immutable'
              USING ERRCODE = '55000';
          END IF;
          IF OLD.status <> 'OPEN' OR NEW.status <> 'RESOLVED'
             OR NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION 'invalid published content issue transition'
              USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER published_content_issues_guard
        BEFORE UPDATE OR DELETE ON published_content_issues
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_published_content_issue();

        CREATE FUNCTION partsignal_validate_published_content_issue_insert() RETURNS trigger AS $$
        BEGIN
          IF NEW.status <> 'OPEN' OR NEW.revision <> 0
             OR NEW.resolved_by IS NOT NULL OR NEW.resolved_at IS NOT NULL
             OR NEW.resolution_outcome IS NOT NULL OR NEW.resolution_comment IS NOT NULL THEN
            RAISE EXCEPTION 'published content issue must start open' USING ERRCODE = '23514';
          END IF;
          IF EXISTS (
            SELECT 1 FROM published_content_issues issue
             WHERE issue.published_article_id = NEW.published_article_id
               AND issue.resolution_outcome = 'RETIRED'
          ) THEN
            RAISE EXCEPTION 'retired article cannot open another issue' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER published_content_issues_validate_insert
        BEFORE INSERT ON published_content_issues
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_published_content_issue_insert();

        CREATE FUNCTION partsignal_guard_repair_task_source() RETURNS trigger AS $$
        BEGIN
          IF NEW.source_published_content_issue_id
             IS DISTINCT FROM OLD.source_published_content_issue_id THEN
            RAISE EXCEPTION 'repair task source is immutable' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER content_tasks_repair_source_guard
        BEFORE UPDATE ON content_tasks
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_repair_task_source();

        CREATE TRIGGER publication_work_events_append_only
        BEFORE UPDATE OR DELETE ON publication_work_events
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        CREATE TRIGGER publication_verifications_append_only
        BEFORE UPDATE OR DELETE ON publication_verifications
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        CREATE TRIGGER published_articles_append_only
        BEFORE UPDATE OR DELETE ON published_articles
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        CREATE TRIGGER publication_attachments_append_only
        BEFORE UPDATE OR DELETE ON publication_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
        CREATE TRIGGER publication_attachments_verified_file
        BEFORE INSERT OR UPDATE ON publication_attachments
        FOR EACH ROW EXECUTE FUNCTION partsignal_require_verified_file();
        """
    )


def _replace_geo_guard() -> None:
    op.execute(
        """
        CREATE FUNCTION partsignal_guard_geo_article_result() RETURNS trigger AS $$
        DECLARE
          target_kind text;
          target_product uuid;
          article_product uuid;
        BEGIN
          SELECT observation_kind, product_id
            INTO target_kind, target_product
            FROM geo_observations
           WHERE id = NEW.observation_id;
          IF target_kind = 'LEGACY_MODEL_RESULT' THEN
            IF NEW.discovered IS NOT NULL OR NEW.mentioned IS NOT NULL
               OR NEW.accuracy IS NOT NULL THEN
              RAISE EXCEPTION 'legacy GEO publication cannot have article result'
                USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
          END IF;
          IF target_kind <> 'MANUAL_ARTICLE_SEARCH'
             OR NEW.discovered IS NULL OR NEW.mentioned IS NULL THEN
            RAISE EXCEPTION 'manual GEO observation requires independent article facts'
              USING ERRCODE = '23514';
          END IF;
          SELECT task.product_id INTO article_product
            FROM published_articles article
            JOIN publication_works work ON work.id = article.id
            JOIN content_versions content ON content.id = work.content_version_id
            JOIN content_tasks task ON task.id = content.task_id
           WHERE article.id = NEW.published_article_id
             AND NOT EXISTS (
               SELECT 1 FROM published_content_issues issue
                WHERE issue.published_article_id = article.id
                  AND (issue.status = 'OPEN' OR issue.resolution_outcome = 'RETIRED')
             );
          IF article_product IS DISTINCT FROM target_product THEN
            RAISE EXCEPTION 'invalid published article for manual GEO observation'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER geo_observation_publications_article_result_guard
        BEFORE INSERT ON geo_observation_publications
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_geo_article_result();
        """
    )


def upgrade() -> None:
    """在空旧发布数据前提下原子切换发布、修复来源与 GEO 文章身份。"""
    _assert_legacy_publication_data_empty()
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_geo_article_result() CASCADE")
    op.execute("DROP TRIGGER content_tasks_repair_source_guard ON content_tasks")
    op.execute("DROP FUNCTION partsignal_guard_repair_task_source()")

    op.drop_constraint(
        "fk_geo_observation_citations_publication_record_id_publ_07f5",
        "geo_observation_citations",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_geo_observation_publications_publication_record_id_p_22ac",
        "geo_observation_publications",
        type_="foreignkey",
    )
    op.drop_constraint(
        "uq_content_tasks_source_publication_attention_id",
        "content_tasks",
        type_="unique",
    )
    op.drop_constraint(
        "fk_content_tasks_source_publication_attention_id",
        "content_tasks",
        type_="foreignkey",
    )
    op.alter_column(
        "geo_observation_citations",
        "publication_record_id",
        new_column_name="published_article_id",
    )
    op.alter_column(
        "geo_observation_publications",
        "publication_record_id",
        new_column_name="published_article_id",
    )
    op.alter_column(
        "content_tasks",
        "source_publication_attention_id",
        new_column_name="source_published_content_issue_id",
    )

    op.drop_table("publication_attachments")
    op.drop_table("publication_attentions")
    op.drop_table("publication_status_events")
    op.drop_table("publication_records")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_publication_record_delete()")
    op.execute("DROP FUNCTION IF EXISTS partsignal_validate_publication_attention_insert()")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_publication_attention()")
    op.execute("DROP FUNCTION IF EXISTS partsignal_validate_publication_insert()")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_publication()")

    _create_tables()
    op.create_foreign_key(
        "fk_content_tasks_published_issue",
        "content_tasks",
        "published_content_issues",
        ["source_published_content_issue_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_content_tasks_source_published_content_issue_id",
        "content_tasks",
        ["source_published_content_issue_id"],
    )
    op.create_foreign_key(
        "fk_geo_citations_published_article",
        "geo_observation_citations",
        "published_articles",
        ["published_article_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_geo_publications_published_article",
        "geo_observation_publications",
        "published_articles",
        ["published_article_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    _create_guards()
    _replace_geo_guard()


def downgrade() -> None:
    """新旧发布语义不能无损逆向映射，必须恢复迁移前备份。"""
    op.execute(
        """
        DO $$
        BEGIN
          RAISE EXCEPTION '0034 无法安全降级，请恢复迁移前备份'
            USING ERRCODE = '55000';
        END;
        $$;
        """
    )
