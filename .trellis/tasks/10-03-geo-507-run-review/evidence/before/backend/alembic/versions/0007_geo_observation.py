"""创建追加式 GEO 观测及引用关联。"""

from alembic import op
from app.migration_schema_v1 import Base

revision = "0007_geo_observation"
down_revision = "0006_publication"
branch_labels = None
depends_on = None

TABLES = [
    "geo_observations",
    "geo_observation_citations",
    "geo_observation_publications",
]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind, tables=[Base.metadata.tables[name] for name in TABLES])
    op.create_index("ix_geo_observations_tested_at", "geo_observations", ["tested_at"])
    op.create_index(
        "ix_geo_observations_dimensions",
        "geo_observations",
        ["product_id", "query_topic_id", "model_name"],
    )
    op.create_index(
        "uq_geo_observations_supersedes_once",
        "geo_observations",
        ["supersedes_id"],
        unique=True,
        postgresql_where="supersedes_id IS NOT NULL",
    )
    for table_name in TABLES:
        op.execute(
            f"""
            CREATE TRIGGER {table_name}_append_only
            BEFORE UPDATE OR DELETE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    for name in reversed(TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
