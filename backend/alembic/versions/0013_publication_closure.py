"""增加发布异常待办、修复任务来源和发布平台一致性门禁。"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0013_publication_closure"
down_revision = "0012_ai_data_classification"
branch_labels = None
depends_on = None


def _preflight_integrity() -> None:
    """迁移前阻断无法安全猜测的旧完成态和跨平台发布。"""
    bind = op.get_bind()
    completed_without_verified = tuple(
        bind.execute(
            sa.text(
                "SELECT content_tasks.id FROM content_tasks "
                "WHERE content_tasks.status = 'COMPLETED' AND NOT EXISTS ("
                "SELECT 1 FROM publication_records "
                "JOIN content_versions ON content_versions.id = publication_records.content_version_id "
                "JOIN publication_status_events ON publication_status_events.publication_id = "
                "publication_records.id "
                "WHERE content_versions.task_id = content_tasks.id "
                "AND publication_status_events.status = 'VERIFIED') "
                "ORDER BY content_tasks.id"
            )
        ).scalars()
    )
    cross_platform = tuple(
        bind.execute(
            sa.text(
                "SELECT publication_records.id FROM publication_records "
                "JOIN content_versions ON content_versions.id = publication_records.content_version_id "
                "JOIN content_tasks ON content_tasks.id = content_versions.task_id "
                "JOIN platform_profile_versions ON platform_profile_versions.id = "
                "content_tasks.platform_profile_version_id "
                "JOIN platform_accounts ON platform_accounts.id = "
                "publication_records.platform_account_id "
                "WHERE platform_accounts.platform_profile_id <> "
                "platform_profile_versions.platform_profile_id "
                "AND publication_records.status NOT IN "
                "('REJECTED', 'REMOVED', 'VERIFICATION_FAILED') "
                "ORDER BY publication_records.id"
            )
        ).scalars()
    )
    if completed_without_verified or cross_platform:
        raise RuntimeError(
            "发布完整性检查失败；请先运行 preflight-integrity 并显式处置记录："
            f"completed_without_verified={[str(item) for item in completed_without_verified]}; "
            f"cross_platform_publications={[str(item) for item in cross_platform]}"
        )


def upgrade() -> None:
    """在历史检查通过后扩展发布闭环状态。"""
    _preflight_integrity()
    op.create_table(
        "publication_attentions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "publication_record_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("publication_records.id", ondelete="RESTRICT"),
            nullable=False,
            unique=True,
        ),
        sa.Column("trigger_status", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="OPEN", nullable=False),
        sa.Column("revision", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "opened_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("resolution_comment", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "trigger_status IN ('REMOVED', 'VERIFICATION_FAILED')",
            name="ck_publication_attentions_trigger_status",
        ),
        sa.CheckConstraint(
            "status IN ('OPEN', 'RESOLVED')",
            name="ck_publication_attentions_status",
        ),
        sa.CheckConstraint(
            "revision >= 0",
            name="ck_publication_attentions_revision_nonnegative",
        ),
        sa.CheckConstraint(
            "(status = 'OPEN' AND resolved_at IS NULL AND resolved_by IS NULL "
            "AND resolution_comment IS NULL) OR "
            "(status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL "
            "AND length(btrim(resolution_comment)) > 0)",
            name="ck_publication_attentions_resolution_complete",
        ),
    )
    op.create_index(
        "ix_publication_attentions_opened_at",
        "publication_attentions",
        ["opened_at"],
        postgresql_where=sa.text("status = 'OPEN'"),
    )
    op.add_column(
        "content_tasks",
        sa.Column(
            "source_publication_attention_id",
            postgresql.UUID(as_uuid=True),
            nullable=True,
        ),
    )
    op.create_foreign_key(
        "fk_content_tasks_source_publication_attention_id",
        "content_tasks",
        "publication_attentions",
        ["source_publication_attention_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_unique_constraint(
        "uq_content_tasks_source_publication_attention_id",
        "content_tasks",
        ["source_publication_attention_id"],
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_validate_publication_insert() RETURNS trigger AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM content_versions cv
            JOIN fact_versions fv ON fv.id = cv.fact_version_id
            WHERE cv.id = NEW.content_version_id
              AND cv.status = 'APPROVED'
              AND fv.status = 'APPROVED'
          ) THEN
            RAISE EXCEPTION 'publication requires approved content and fact' USING ERRCODE = '23514';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM content_versions cv
            JOIN content_tasks ct ON ct.id = cv.task_id
            JOIN platform_profile_versions ppv ON ppv.id = ct.platform_profile_version_id
            JOIN platform_accounts pa ON pa.id = NEW.platform_account_id
            WHERE cv.id = NEW.content_version_id
              AND pa.platform_profile_id = ppv.platform_profile_id
          ) THEN
            RAISE EXCEPTION 'publication account platform does not match content task'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_guard_publication_attention() RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'DELETE' THEN
            RAISE EXCEPTION 'publication attention history is append-only'
              USING ERRCODE = '55000';
          END IF;
          IF NEW.publication_record_id IS DISTINCT FROM OLD.publication_record_id
             OR NEW.trigger_status IS DISTINCT FROM OLD.trigger_status
             OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
            RAISE EXCEPTION 'publication attention binding is immutable' USING ERRCODE = '55000';
          END IF;
          IF OLD.status = 'RESOLVED' AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'resolved publication attention is immutable' USING ERRCODE = '55000';
          END IF;
          IF OLD.status = 'OPEN' AND NEW.status = 'OPEN'
             AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION 'open publication attention changes require a command'
              USING ERRCODE = '55000';
          END IF;
          IF OLD.status = 'OPEN' AND NEW.status = 'RESOLVED'
             AND NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION 'publication attention revision must increment once'
              USING ERRCODE = '55000';
          END IF;
          IF NOT ((OLD.status = 'OPEN' AND NEW.status IN ('OPEN', 'RESOLVED'))
                  OR (OLD.status = 'RESOLVED' AND NEW.status = 'RESOLVED')) THEN
            RAISE EXCEPTION 'invalid publication attention transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER publication_attentions_guard
        BEFORE UPDATE OR DELETE ON publication_attentions
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_attention();

        CREATE OR REPLACE FUNCTION partsignal_validate_publication_attention_insert()
        RETURNS trigger AS $$
        BEGIN
          IF NEW.status <> 'OPEN' OR NEW.revision <> 0
             OR NEW.resolved_at IS NOT NULL OR NEW.resolved_by IS NOT NULL
             OR NEW.resolution_comment IS NOT NULL THEN
            RAISE EXCEPTION 'publication attention must start open'
              USING ERRCODE = '23514';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM publication_records pr
            WHERE pr.id = NEW.publication_record_id
              AND pr.status = NEW.trigger_status
              AND pr.status IN ('REMOVED', 'VERIFICATION_FAILED')
          ) THEN
            RAISE EXCEPTION 'publication attention requires matching terminal publication'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER publication_attentions_validate_insert
        BEFORE INSERT ON publication_attentions
        FOR EACH ROW EXECUTE FUNCTION partsignal_validate_publication_attention_insert();

        CREATE OR REPLACE FUNCTION partsignal_guard_repair_task_source() RETURNS trigger AS $$
        BEGIN
          IF NEW.source_publication_attention_id
             IS DISTINCT FROM OLD.source_publication_attention_id THEN
            RAISE EXCEPTION 'repair task source is immutable' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER content_tasks_repair_source_guard
        BEFORE UPDATE ON content_tasks
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_repair_task_source();

        CREATE OR REPLACE FUNCTION partsignal_guard_fact_version() RETURNS trigger AS $$
        BEGIN
          IF NEW.product_id IS DISTINCT FROM OLD.product_id
             OR NEW.version IS DISTINCT FROM OLD.version
             OR NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json
             OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'fact version payload is immutable' USING ERRCODE = '55000';
          END IF;
          IF NOT (
            (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PENDING_REVIEW')) OR
            (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
            (OLD.status = 'CHANGES_REQUESTED' AND NEW.status IN ('CHANGES_REQUESTED', 'PENDING_REVIEW')) OR
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
            (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PENDING_REVIEW')) OR
            (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
            (OLD.status = 'CHANGES_REQUESTED' AND NEW.status IN ('CHANGES_REQUESTED', 'PENDING_REVIEW')) OR
            (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'SUPERSEDED')) OR
            (OLD.status = NEW.status)
          ) THEN
            RAISE EXCEPTION 'invalid content version transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    """仅允许在尚未产生任何阶段二业务状态时移除扩展结构。"""
    bind = op.get_bind()
    attention_count = bind.scalar(sa.text("SELECT count(*) FROM publication_attentions"))
    repair_count = bind.scalar(
        sa.text(
            "SELECT count(*) FROM content_tasks "
            "WHERE source_publication_attention_id IS NOT NULL"
        )
    )
    if attention_count or repair_count:
        raise RuntimeError("0013 已产生发布异常或修复任务，只允许前滚，禁止降级删除历史")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_repair_task_source() CASCADE")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_publication_attention() CASCADE")
    op.execute(
        "DROP FUNCTION IF EXISTS partsignal_validate_publication_attention_insert() CASCADE"
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION partsignal_validate_publication_insert() RETURNS trigger AS $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM content_versions cv
            JOIN fact_versions fv ON fv.id = cv.fact_version_id
            WHERE cv.id = NEW.content_version_id
              AND cv.status = 'APPROVED'
              AND fv.status = 'APPROVED'
          ) THEN
            RAISE EXCEPTION 'publication requires approved content and fact' USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE OR REPLACE FUNCTION partsignal_guard_fact_version() RETURNS trigger AS $$
        BEGIN
          IF NEW.product_id IS DISTINCT FROM OLD.product_id
             OR NEW.version IS DISTINCT FROM OLD.version
             OR NEW.snapshot_json IS DISTINCT FROM OLD.snapshot_json
             OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
             OR NEW.created_by IS DISTINCT FROM OLD.created_by
             OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'fact version payload is immutable' USING ERRCODE = '55000';
          END IF;
          IF NOT (
            (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PENDING_REVIEW')) OR
            (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
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
            (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'PENDING_REVIEW')) OR
            (OLD.status = 'PENDING_REVIEW' AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
            (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'SUPERSEDED')) OR
            (OLD.status = NEW.status)
          ) THEN
            RAISE EXCEPTION 'invalid content version transition' USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
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
    op.drop_column("content_tasks", "source_publication_attention_id")
    op.drop_index("ix_publication_attentions_opened_at", table_name="publication_attentions")
    op.drop_table("publication_attentions")
