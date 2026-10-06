"""管理员显式机会评估回执：加法迁移，不改写既有评估历史。"""

from alembic import op

revision = "0066_geo_manual_evaluation"
down_revision = "0065_geo_observability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.execute("""CREATE TABLE geo_opportunity_evaluation_runs (
        id uuid CONSTRAINT pk_geo_opportunity_evaluation_runs PRIMARY KEY,
        created_by uuid NOT NULL CONSTRAINT fk_geo_evaluation_run_actor
            REFERENCES users(id) ON DELETE RESTRICT,
        request_key_sha256 varchar(64) NOT NULL,
        request_sha256 varchar(64) NOT NULL,
        rule_set_revision integer NOT NULL CONSTRAINT fk_geo_evaluation_run_rule
            REFERENCES geo_rule_set_revisions(revision) ON DELETE RESTRICT,
        request_snapshot jsonb NOT NULL,
        receipt jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_geo_evaluation_run_key UNIQUE(created_by, request_key_sha256),
        CONSTRAINT ck_geo_evaluation_run_hashes CHECK (
            request_key_sha256 ~ '^[0-9a-f]{64}$' AND request_sha256 ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_geo_evaluation_run_snapshots CHECK (
            jsonb_typeof(request_snapshot) = 'object' AND jsonb_typeof(receipt) = 'object')
    )""")
    op.execute("""CREATE FUNCTION geo_evaluation_run_immutable() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN
            RAISE EXCEPTION '管理员评估回执不可变' USING ERRCODE='55000';
        END $$""")
    op.execute("""CREATE TRIGGER geo_evaluation_run_no_mutation
        BEFORE UPDATE OR DELETE OR TRUNCATE ON geo_opportunity_evaluation_runs
        FOR EACH STATEMENT EXECUTE FUNCTION geo_evaluation_run_immutable()""")


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0066 管理员评估回执须保留；停止评估并采用前向修复或迁移前备份恢复'
            USING ERRCODE='55000';
    END $$""")
