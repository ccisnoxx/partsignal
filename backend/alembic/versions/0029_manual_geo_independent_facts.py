"""收敛人工 GEO 独立事实，并为完整更正链删除增加事务门禁。"""

import sqlalchemy as sa

from alembic import op

revision = "0029_geo_evidence_management"
down_revision = "0028_platform_logo_lifecycle"
branch_labels = None
depends_on = None

_GEO_APPEND_ONLY_TABLES = (
    "geo_observations",
    "geo_observation_citations",
    "geo_observation_publications",
    "geo_observation_attachments",
)


def upgrade() -> None:
    """删除累计阶段字段，并安装人工观测专用删除守卫。"""
    op.execute("DROP FUNCTION partsignal_guard_geo_article_result() CASCADE")
    op.drop_constraint(
        "ck_geo_observation_publications_insight_facts",
        "geo_observation_publications",
        type_="check",
    )
    op.drop_constraint(
        "ck_geo_observation_publications_recommendation",
        "geo_observation_publications",
        type_="check",
    )
    op.drop_column("geo_observation_publications", "recommendation_status")
    op.drop_column("geo_observation_publications", "cited")
    op.create_check_constraint(
        "ck_geo_observation_publications_independent_facts",
        "geo_observation_publications",
        "(discovered IS NULL AND mentioned IS NULL AND accuracy IS NULL) OR "
        "(discovered IS NOT NULL AND mentioned IS NOT NULL "
        "AND (accuracy IS NULL OR accuracy IN "
        "('ACCURATE', 'PARTIAL', 'INCORRECT', 'UNJUDGEABLE')))",
    )

    op.execute(
        """
        CREATE FUNCTION partsignal_guard_geo_article_result() RETURNS trigger AS $$
        DECLARE
          target_kind text;
          target_product uuid;
          article_product uuid;
          article_status text;
          article_url text;
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

          SELECT task.product_id, publication.status, publication.final_url
            INTO article_product, article_status, article_url
            FROM publication_records publication
            JOIN content_versions content ON content.id = publication.content_version_id
            JOIN content_tasks task ON task.id = content.task_id
           WHERE publication.id = NEW.publication_record_id;

          IF article_product IS DISTINCT FROM target_product
             OR article_status NOT IN ('PUBLISHED', 'VERIFIED')
             OR article_url IS NULL THEN
            RAISE EXCEPTION 'invalid publication for manual GEO observation'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER geo_observation_publications_article_result_guard
        BEFORE INSERT ON geo_observation_publications
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_geo_article_result();

        CREATE FUNCTION partsignal_guard_geo_observation_change() RETURNS trigger AS $$
        DECLARE
          target_id uuid;
        BEGIN
          IF TG_OP = 'UPDATE' THEN
            RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
          END IF;

          IF TG_TABLE_NAME = 'geo_observations' THEN
            target_id := OLD.id;
            IF OLD.observation_kind <> 'MANUAL_ARTICLE_SEARCH' THEN
              RAISE EXCEPTION 'legacy GEO observation cannot be deleted'
                USING ERRCODE = '55000';
            END IF;
          ELSE
            target_id := OLD.observation_id;
            IF NOT EXISTS (
              SELECT 1
                FROM geo_observations
               WHERE id = target_id
                 AND observation_kind = 'MANUAL_ARTICLE_SEARCH'
            ) THEN
              RAISE EXCEPTION 'legacy GEO relation cannot be deleted'
                USING ERRCODE = '55000';
            END IF;
          END IF;

          IF current_setting('partsignal.geo_observation_delete_id', true)
             IS DISTINCT FROM target_id::text THEN
            RAISE EXCEPTION 'GEO observation delete target mismatch'
              USING ERRCODE = '55000';
          END IF;
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    for table_name in _GEO_APPEND_ONLY_TABLES:
        op.execute(f"DROP TRIGGER {table_name}_append_only ON {table_name}")
        op.execute(
            f"""
            CREATE TRIGGER {table_name}_append_only
            BEFORE UPDATE OR DELETE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION partsignal_guard_geo_observation_change()
            """
        )

    op.drop_index("ix_file_records_platform_logo_cleanup", table_name="file_records")
    op.create_index(
        "ix_file_records_cleanup",
        "file_records",
        ["status", "cleanup_after", "upload_expires_at"],
    )


def downgrade() -> None:
    """恢复空累计字段；已删除的观测与旧事实值都不得猜测重建。"""
    for table_name in _GEO_APPEND_ONLY_TABLES:
        op.execute(f"DROP TRIGGER {table_name}_append_only ON {table_name}")
        op.execute(
            f"""
            CREATE TRIGGER {table_name}_append_only
            BEFORE UPDATE OR DELETE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change()
            """
        )
    op.execute("DROP FUNCTION partsignal_guard_geo_observation_change()")

    op.drop_index("ix_file_records_cleanup", table_name="file_records")
    op.create_index(
        "ix_file_records_platform_logo_cleanup",
        "file_records",
        ["status", "cleanup_after", "upload_expires_at"],
        postgresql_where=sa.text("category = 'PLATFORM_LOGO'"),
    )

    op.execute("DROP FUNCTION partsignal_guard_geo_article_result() CASCADE")
    op.drop_constraint(
        "ck_geo_observation_publications_independent_facts",
        "geo_observation_publications",
        type_="check",
    )
    op.add_column(
        "geo_observation_publications",
        sa.Column("recommendation_status", sa.String(length=24), nullable=True),
    )
    op.add_column(
        "geo_observation_publications",
        sa.Column("cited", sa.Boolean(), nullable=True),
    )
    op.create_check_constraint(
        "ck_geo_observation_publications_recommendation",
        "geo_observation_publications",
        "recommendation_status IS NULL OR "
        "recommendation_status IN ('RECOMMENDED', 'NOT_RECOMMENDED')",
    )
    # 新独立事实行无法无损恢复累计字段；NOT VALID 只豁免这些历史行。
    op.execute(
        """
        ALTER TABLE geo_observation_publications
        ADD CONSTRAINT ck_geo_observation_publications_insight_facts CHECK (
          (discovered IS NULL AND mentioned IS NULL AND cited IS NULL AND accuracy IS NULL)
          OR
          (discovered IS NOT NULL AND mentioned IS NOT NULL AND cited IS NOT NULL
           AND accuracy IN ('ACCURATE', 'PARTIAL', 'INCORRECT', 'UNJUDGEABLE')
           AND recommendation_status IS NOT NULL
           AND (NOT mentioned OR discovered)
           AND (recommendation_status <> 'RECOMMENDED' OR mentioned)
           AND (NOT cited OR recommendation_status = 'RECOMMENDED')
           AND (accuracy <> 'ACCURATE' OR cited))
        ) NOT VALID
        """
    )
    op.execute(
        """
        CREATE FUNCTION partsignal_guard_geo_article_result() RETURNS trigger AS $$
        DECLARE
          target_kind text;
          target_product uuid;
          article_product uuid;
          article_status text;
          article_url text;
        BEGIN
          SELECT observation_kind, product_id
            INTO target_kind, target_product
            FROM geo_observations
           WHERE id = NEW.observation_id;

          IF target_kind = 'LEGACY_MODEL_RESULT' THEN
            IF NEW.recommendation_status IS NOT NULL OR NEW.discovered IS NOT NULL
               OR NEW.mentioned IS NOT NULL OR NEW.cited IS NOT NULL OR NEW.accuracy IS NOT NULL THEN
              RAISE EXCEPTION 'legacy GEO publication cannot have article result'
                USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
          END IF;

          IF target_kind <> 'MANUAL_ARTICLE_SEARCH'
             OR NEW.recommendation_status IS NULL OR NEW.discovered IS NULL
             OR NEW.mentioned IS NULL OR NEW.cited IS NULL OR NEW.accuracy IS NULL THEN
            RAISE EXCEPTION 'manual GEO observation requires complete article result'
              USING ERRCODE = '23514';
          END IF;

          SELECT task.product_id, publication.status, publication.final_url
            INTO article_product, article_status, article_url
            FROM publication_records publication
            JOIN content_versions content ON content.id = publication.content_version_id
            JOIN content_tasks task ON task.id = content.task_id
           WHERE publication.id = NEW.publication_record_id;

          IF article_product IS DISTINCT FROM target_product
             OR article_status NOT IN ('PUBLISHED', 'VERIFIED')
             OR article_url IS NULL THEN
            RAISE EXCEPTION 'invalid publication for manual GEO observation'
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
