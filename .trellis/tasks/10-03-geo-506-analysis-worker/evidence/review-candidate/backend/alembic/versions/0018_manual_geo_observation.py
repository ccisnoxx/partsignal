"""增加产品级人工 GEO 观测，并保留旧模型观测历史。"""

import sqlalchemy as sa

from alembic import op

revision = "0018_manual_geo_observation"
down_revision = "0017_content_humanization"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """增加人工搜索字段和逐篇推荐状态，并约束新旧语义互斥。"""
    op.add_column(
        "geo_observations",
        sa.Column(
            "observation_kind",
            sa.String(length=32),
            server_default="LEGACY_MODEL_RESULT",
            nullable=False,
        ),
    )
    op.alter_column("geo_observations", "observation_kind", server_default=None)
    op.add_column("geo_observations", sa.Column("search_platform", sa.String(160)))
    op.add_column("geo_observations", sa.Column("search_query", sa.Text()))
    for column_name, column_type in (
        ("query_topic_id", sa.Uuid()),
        ("actual_prompt", sa.Text()),
        ("model_name", sa.String(length=160)),
        ("web_search_enabled", sa.Boolean()),
        ("answer_summary", sa.Text()),
        ("mentioned", sa.Boolean()),
        ("recommendation", sa.String(length=32)),
        ("accuracy", sa.String(length=32)),
    ):
        op.alter_column("geo_observations", column_name, existing_type=column_type, nullable=True)
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
    op.create_index(
        "ix_geo_observations_manual_dimensions",
        "geo_observations",
        ["product_id", "search_platform", "tested_at"],
        postgresql_where=sa.text("observation_kind = 'MANUAL_ARTICLE_SEARCH'"),
    )

    op.add_column(
        "geo_observation_publications",
        sa.Column("recommendation_status", sa.String(length=24)),
    )
    op.create_check_constraint(
        "ck_geo_observation_publications_recommendation",
        "geo_observation_publications",
        "recommendation_status IS NULL OR "
        "recommendation_status IN ('RECOMMENDED', 'NOT_RECOMMENDED')",
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
    """已有人工观测时拒绝降级，避免不可变历史失去语义。"""
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM geo_observations
             WHERE observation_kind = 'MANUAL_ARTICLE_SEARCH'
          ) THEN
            RAISE EXCEPTION 'manual GEO observation history exists; downgrade is forbidden'
              USING ERRCODE = '55000';
          END IF;
        END;
        $$;
        """
    )
    op.execute("DROP FUNCTION partsignal_guard_geo_article_result() CASCADE")
    op.drop_constraint(
        "ck_geo_observation_publications_recommendation",
        "geo_observation_publications",
        type_="check",
    )
    op.drop_column("geo_observation_publications", "recommendation_status")
    op.drop_index("ix_geo_observations_manual_dimensions", table_name="geo_observations")
    op.drop_constraint("ck_geo_observations_kind_fields", "geo_observations", type_="check")
    op.drop_column("geo_observations", "search_query")
    op.drop_column("geo_observations", "search_platform")
    for column_name, column_type in (
        ("query_topic_id", sa.Uuid()),
        ("actual_prompt", sa.Text()),
        ("model_name", sa.String(length=160)),
        ("web_search_enabled", sa.Boolean()),
        ("answer_summary", sa.Text()),
        ("mentioned", sa.Boolean()),
        ("recommendation", sa.String(length=32)),
        ("accuracy", sa.String(length=32)),
    ):
        op.alter_column("geo_observations", column_name, existing_type=column_type, nullable=False)
    op.drop_column("geo_observations", "observation_kind")
