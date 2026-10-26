"""MAN-01：新增人工取消留痕，不回填或改写历史运行与证据。"""

from alembic import op

revision = "0069_geo_manual_cancellation"
down_revision = "0068_geo_opportunity_schedule"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout='5s'")
    op.execute("SET LOCAL statement_timeout='120s'")
    op.execute("""CREATE TABLE geo_manual_run_cancellations (
        run_id uuid CONSTRAINT pk_geo_manual_run_cancellations PRIMARY KEY
            CONSTRAINT fk_geo_manual_cancel_run REFERENCES geo_observation_runs(id) ON DELETE RESTRICT,
        cancelled_by uuid NOT NULL CONSTRAINT fk_geo_manual_cancel_actor REFERENCES users(id) ON DELETE RESTRICT,
        cancelled_at timestamptz NOT NULL, reason varchar(2000) NOT NULL,
        run_revision integer NOT NULL, draft_revision integer NOT NULL,
        CONSTRAINT ck_geo_manual_cancel_revision CHECK(run_revision>=1 AND draft_revision>=0),
        CONSTRAINT ck_geo_manual_cancel_reason CHECK(length(reason) BETWEEN 1 AND 2000 AND length(btrim(reason))>0)
    )""")
    op.execute(
        "CREATE INDEX ix_geo_manual_run_cancellations_cancelled_by ON geo_manual_run_cancellations(cancelled_by)"
    )
    op.execute("""CREATE FUNCTION geo_guard_manual_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE r geo_observation_runs%ROWTYPE; saved_revision integer;
        BEGIN
            SELECT * INTO r FROM geo_observation_runs WHERE id=NEW.run_id FOR UPDATE;
            SELECT draft_revision INTO saved_revision FROM geo_manual_drafts WHERE run_id=NEW.run_id;
            IF r.id IS NULL OR r.input_snapshot->'profile'->>'collection_mode'<>'MANUAL'
                OR r.status<>'CANCELLED' OR r.external_call_state<>'NOT_STARTED'
                OR r.revision<>NEW.run_revision OR r.finished_at IS DISTINCT FROM NEW.cancelled_at
                OR coalesce(saved_revision,0)<>NEW.draft_revision
                OR EXISTS(SELECT 1 FROM geo_answer_snapshots WHERE run_id=r.id) THEN
                RAISE EXCEPTION '人工取消记录与运行或草稿不一致' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER geo_manual_cancel_guard BEFORE INSERT ON geo_manual_run_cancellations
        FOR EACH ROW EXECUTE FUNCTION geo_guard_manual_cancellation()""")
    op.execute("""CREATE FUNCTION geo_require_manual_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.status='CANCELLED' AND OLD.status<>'CANCELLED'
                AND NEW.input_snapshot->'profile'->>'collection_mode'='MANUAL'
                AND NOT EXISTS(SELECT 1 FROM geo_manual_run_cancellations c
                    WHERE c.run_id=NEW.id AND c.run_revision=NEW.revision AND c.cancelled_at=NEW.finished_at) THEN
                RAISE EXCEPTION '新人工取消必须同时保存原因记录' USING ERRCODE='23514';
            END IF;
            RETURN NULL;
        END $$""")
    op.execute("""CREATE CONSTRAINT TRIGGER geo_manual_cancel_required AFTER UPDATE ON geo_observation_runs
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_require_manual_cancellation()""")
    op.execute("""CREATE FUNCTION geo_manual_cancellation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION '人工取消历史不可变' USING ERRCODE='55000'; END $$""")
    op.execute("""CREATE TRIGGER geo_manual_cancel_no_mutation BEFORE UPDATE OR DELETE OR TRUNCATE
        ON geo_manual_run_cancellations FOR EACH STATEMENT EXECUTE FUNCTION geo_manual_cancellation_immutable()""")


def downgrade() -> None:
    op.execute(
        """DO $$ BEGIN RAISE EXCEPTION '0069人工取消历史须保留；采用前向修复或迁移前备份' USING ERRCODE='55000'; END $$"""
    )
