"""补充人工 GEO 逐篇阶段事实与问题主题约束。"""

import sqlalchemy as sa

from alembic import op

revision = "0022_geo_observation_insights"
down_revision = "0021_ai_channel_model_management"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """保留历史空值，同时要求后续人工观测完整提交已批准事实。"""
    op.drop_constraint("ck_geo_observations_kind_fields", "geo_observations", type_="check")
    # NOT VALID 只跳过历史行校验；PostgreSQL 仍会校验迁移后的 INSERT/UPDATE。
    op.execute(
        """
        ALTER TABLE geo_observations
        ADD CONSTRAINT ck_geo_observations_kind_fields CHECK (
          (observation_kind = 'LEGACY_MODEL_RESULT'
           AND query_topic_id IS NOT NULL AND actual_prompt IS NOT NULL
           AND model_name IS NOT NULL AND web_search_enabled IS NOT NULL
           AND answer_summary IS NOT NULL AND mentioned IS NOT NULL
           AND recommendation IS NOT NULL AND accuracy IS NOT NULL
           AND search_platform IS NULL AND search_query IS NULL)
          OR
          (observation_kind = 'MANUAL_ARTICLE_SEARCH'
           AND query_topic_id IS NOT NULL AND actual_prompt IS NULL AND model_name IS NULL
           AND model_version IS NULL AND web_search_enabled IS NULL
           AND answer_summary IS NULL AND mentioned IS NULL AND recommendation IS NULL
           AND accuracy IS NULL AND length(btrim(search_platform)) > 0
           AND length(btrim(search_query)) > 0)
        ) NOT VALID
        """
    )

    for column_name, column_type in (
        ("discovered", sa.Boolean()),
        ("mentioned", sa.Boolean()),
        ("cited", sa.Boolean()),
        ("accuracy", sa.String(length=32)),
    ):
        op.add_column(
            "geo_observation_publications",
            sa.Column(column_name, column_type, nullable=True),
        )
    op.create_check_constraint(
        "ck_geo_observation_publications_insight_facts",
        "geo_observation_publications",
        "(discovered IS NULL AND mentioned IS NULL AND cited IS NULL AND accuracy IS NULL) OR "
        "(discovered IS NOT NULL AND mentioned IS NOT NULL AND cited IS NOT NULL "
        "AND accuracy IN ('ACCURATE', 'PARTIAL', 'INCORRECT', 'UNJUDGEABLE') "
        "AND recommendation_status IS NOT NULL "
        "AND (NOT mentioned OR discovered) "
        "AND (recommendation_status <> 'RECOMMENDED' OR mentioned) "
        "AND (NOT cited OR recommendation_status = 'RECOMMENDED') "
        "AND (accuracy <> 'ACCURATE' OR cited))",
    )

    op.execute("DROP FUNCTION partsignal_guard_geo_article_result() CASCADE")
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


def downgrade() -> None:
    """已有新问题关联或逐篇事实时拒绝删除洞察语义。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM geo_observations
             WHERE observation_kind = 'MANUAL_ARTICLE_SEARCH' AND query_topic_id IS NOT NULL
          ) OR EXISTS (
            SELECT 1 FROM geo_observation_publications
             WHERE discovered IS NOT NULL OR mentioned IS NOT NULL
                OR cited IS NOT NULL OR accuracy IS NOT NULL
          ) THEN
            RAISE EXCEPTION 'GEO insight facts exist; downgrade is forbidden'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )
    op.execute("DROP FUNCTION partsignal_guard_geo_article_result() CASCADE")
    op.drop_constraint(
        "ck_geo_observation_publications_insight_facts",
        "geo_observation_publications",
        type_="check",
    )
    for column_name in ("accuracy", "cited", "mentioned", "discovered"):
        op.drop_column("geo_observation_publications", column_name)

    op.drop_constraint("ck_geo_observations_kind_fields", "geo_observations", type_="check")
    op.create_check_constraint(
        "ck_geo_observations_kind_fields",
        "geo_observations",
        "(observation_kind = 'LEGACY_MODEL_RESULT' "
        "AND query_topic_id IS NOT NULL AND actual_prompt IS NOT NULL "
        "AND model_name IS NOT NULL AND web_search_enabled IS NOT NULL "
        "AND answer_summary IS NOT NULL AND mentioned IS NOT NULL "
        "AND recommendation IS NOT NULL AND accuracy IS NOT NULL "
        "AND search_platform IS NULL AND search_query IS NULL) OR "
        "(observation_kind = 'MANUAL_ARTICLE_SEARCH' "
        "AND query_topic_id IS NULL AND actual_prompt IS NULL AND model_name IS NULL "
        "AND model_version IS NULL AND web_search_enabled IS NULL "
        "AND answer_summary IS NULL AND mentioned IS NULL AND recommendation IS NULL "
        "AND accuracy IS NULL AND length(btrim(search_platform)) > 0 "
        "AND length(btrim(search_query)) > 0)",
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
            IF NEW.recommendation_status IS NOT NULL THEN
              RAISE EXCEPTION 'legacy GEO publication cannot have article result'
                USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
          END IF;
          IF target_kind <> 'MANUAL_ARTICLE_SEARCH' OR NEW.recommendation_status IS NULL THEN
            RAISE EXCEPTION 'manual GEO observation requires article result'
              USING ERRCODE = '23514';
          END IF;
          SELECT task.product_id, publication.status, publication.final_url
            INTO article_product, article_status, article_url
            FROM publication_records publication
            JOIN content_versions content ON content.id = publication.content_version_id
            JOIN content_tasks task ON task.id = content.task_id
           WHERE publication.id = NEW.publication_record_id;
          IF article_product IS DISTINCT FROM target_product
             OR article_status NOT IN ('PUBLISHED', 'VERIFIED') OR article_url IS NULL THEN
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
