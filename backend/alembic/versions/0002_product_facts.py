"""创建规范化产品事实和不可变事实版本。"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

from alembic import op
from app.migration_schema_v1 import Base

revision = "0002_product_facts"
down_revision = "0001_identity_audit"
branch_labels = None
depends_on = None

TABLES = [
    "products",
    "reference_parts",
    "evidences",
    "part_parameters",
    "replacement_relations",
    "fact_claims",
    "parameter_evidence_links",
    "replacement_evidence_links",
    "claim_evidence_links",
    "fact_versions",
    "fact_review_records",
]


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(
        bind,
        tables=[Base.metadata.tables[name] for name in ["products", "reference_parts"]],
    )
    # file_record_id 在 0008 才能建立外键；列先作为事实元数据的一部分存在。
    op.create_table(
        "evidences",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "product_id",
            UUID(as_uuid=True),
            sa.ForeignKey("products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("client_key", sa.String(120), nullable=False),
        sa.Column("type", sa.String(40), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("version", sa.String(100), nullable=False),
        sa.Column("source_url", sa.Text()),
        sa.Column("file_record_id", UUID(as_uuid=True)),
        sa.Column("confidentiality", sa.String(32), nullable=False),
        sa.UniqueConstraint("product_id", "client_key", name="uq_evidences_product_id"),
    )
    Base.metadata.create_all(
        bind,
        tables=[
            Base.metadata.tables[name]
            for name in TABLES
            if name not in {"products", "reference_parts", "evidences"}
        ],
    )
    op.execute(
        """
        CREATE TRIGGER fact_review_records_append_only
        BEFORE UPDATE OR DELETE ON fact_review_records
        FOR EACH ROW EXECUTE FUNCTION partsignal_prevent_change();

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
        CREATE TRIGGER fact_versions_guard
        BEFORE UPDATE ON fact_versions
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_fact_version();

        CREATE OR REPLACE FUNCTION partsignal_guard_product_identity() RETURNS trigger AS $$
        BEGIN
          IF (NEW.part_number IS DISTINCT FROM OLD.part_number
              OR NEW.brand IS DISTINCT FROM OLD.brand
              OR NEW.category IS DISTINCT FROM OLD.category)
             AND EXISTS (
               SELECT 1 FROM fact_versions
               WHERE product_id = OLD.id AND status IN ('APPROVED', 'RETIRED')
             ) THEN
            RAISE EXCEPTION 'approved fact requires stable product identity'
              USING ERRCODE = '55000';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER products_identity_guard
        BEFORE UPDATE ON products
        FOR EACH ROW EXECUTE FUNCTION partsignal_guard_product_identity();
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_product_identity() CASCADE")
    op.execute("DROP FUNCTION IF EXISTS partsignal_guard_fact_version() CASCADE")
    for name in reversed(TABLES):
        Base.metadata.tables[name].drop(bind, checkfirst=True)
