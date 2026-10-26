"""AUTO-01：新计划显式登记，旧CRON不回填；窗口历史追加保存。"""

from alembic import op

revision = "0067_geo_plan_schedules"
down_revision = "0066_geo_manual_evaluation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.execute("""CREATE TABLE geo_plan_schedules (
        plan_id uuid CONSTRAINT pk_geo_plan_schedules PRIMARY KEY
            CONSTRAINT fk_geo_schedule_plan REFERENCES geo_monitoring_plans(id) ON DELETE CASCADE,
        registered_at timestamptz NOT NULL DEFAULT now(), next_run_at timestamptz
    )""")
    op.execute("CREATE INDEX ix_geo_plan_schedules_due ON geo_plan_schedules(next_run_at,plan_id)")
    op.execute("""CREATE TABLE geo_plan_schedule_windows (
        plan_id uuid NOT NULL CONSTRAINT fk_geo_window_schedule
            REFERENCES geo_plan_schedules(plan_id) ON DELETE RESTRICT,
        scheduled_for timestamptz NOT NULL, plan_revision integer NOT NULL,
        status varchar(16) NOT NULL, batch_id uuid CONSTRAINT fk_geo_window_batch
            REFERENCES geo_observation_batches(id) ON DELETE RESTRICT,
        error_code varchar(100), covered_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_geo_plan_schedule_windows PRIMARY KEY(plan_id, scheduled_for),
        CONSTRAINT ck_geo_schedule_window_revision CHECK(plan_revision >= 0),
        CONSTRAINT ck_geo_schedule_window_result CHECK (
            (status='CREATED' AND batch_id IS NOT NULL AND error_code IS NULL AND covered_until IS NULL)
            OR (status='FAILED' AND batch_id IS NULL AND error_code IS NOT NULL AND covered_until IS NULL)
            OR (status='MISSED' AND batch_id IS NULL AND error_code IN ('LATE_WINDOW','PLAN_CHANGED')
                AND covered_until IS NOT NULL AND error_code IS NOT NULL AND covered_until > scheduled_for))
    )""")
    op.execute("""CREATE FUNCTION geo_plan_schedule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE plan geo_monitoring_plans%ROWTYPE;
        BEGIN
            SELECT * INTO STRICT plan FROM geo_monitoring_plans WHERE id=NEW.plan_id FOR UPDATE;
            IF plan.schedule_kind <> 'CRON' OR
                ((plan.status='ACTIVE') <> (NEW.next_run_at IS NOT NULL)) THEN
                RAISE EXCEPTION '登记游标必须属于CRON计划且仅ACTIVE可有下一窗口' USING ERRCODE='23514';
            END IF;
            IF TG_OP='UPDATE' AND (NEW.plan_id<>OLD.plan_id OR NEW.registered_at<>OLD.registered_at) THEN
                RAISE EXCEPTION '调度登记身份不可变' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER geo_plan_schedule_guard BEFORE INSERT OR UPDATE ON geo_plan_schedules
        FOR EACH ROW EXECUTE FUNCTION geo_plan_schedule_guard()""")
    op.execute("""CREATE FUNCTION geo_schedule_plan_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE identity uuid;
        BEGIN
            IF TG_TABLE_NAME='geo_monitoring_plans' THEN
                identity := NEW.id;
            ELSE
                identity := NEW.plan_id;
            END IF;
            IF EXISTS (SELECT 1 FROM geo_plan_schedules s JOIN geo_monitoring_plans p ON p.id=s.plan_id
                WHERE s.plan_id=identity AND (p.schedule_kind<>'CRON'
                    OR ((p.status='ACTIVE') <> (s.next_run_at IS NOT NULL)))) THEN
                RAISE EXCEPTION '计划与调度游标状态不一致' USING ERRCODE='23514';
            END IF;
            RETURN NULL;
        END $$""")
    op.execute("""CREATE CONSTRAINT TRIGGER geo_schedule_plan_consistent
        AFTER INSERT OR UPDATE ON geo_monitoring_plans DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION geo_schedule_plan_consistent()""")
    op.execute("""CREATE CONSTRAINT TRIGGER geo_schedule_cursor_consistent
        AFTER INSERT OR UPDATE ON geo_plan_schedules DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW EXECUTE FUNCTION geo_schedule_plan_consistent()""")
    op.execute("""CREATE FUNCTION geo_schedule_window_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.status='CREATED' AND NOT EXISTS (
                SELECT 1 FROM geo_observation_batches WHERE id=NEW.batch_id AND plan_id=NEW.plan_id
                AND scheduled_for=NEW.scheduled_for AND trigger_type='SCHEDULED'
                AND (plan_snapshot->>'plan_revision')::integer=NEW.plan_revision) THEN
                RAISE EXCEPTION '窗口批次归属不匹配' USING ERRCODE='23514';
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER geo_schedule_window_guard BEFORE INSERT ON geo_plan_schedule_windows
        FOR EACH ROW EXECUTE FUNCTION geo_schedule_window_guard()""")
    op.execute("""CREATE FUNCTION geo_schedule_window_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION '调度窗口历史不可变' USING ERRCODE='55000'; END $$""")
    op.execute("""CREATE TRIGGER geo_schedule_window_no_mutation BEFORE UPDATE OR DELETE OR TRUNCATE
        ON geo_plan_schedule_windows FOR EACH STATEMENT EXECUTE FUNCTION geo_schedule_window_immutable()""")


def downgrade() -> None:
    op.execute("""DO $$ BEGIN RAISE EXCEPTION
        '0067调度窗口须保留；停用新扫描并前向修复，或恢复迁移前备份' USING ERRCODE='55000'; END $$""")
