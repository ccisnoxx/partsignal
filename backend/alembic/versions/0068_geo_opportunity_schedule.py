"""AUTO-02：独立机会周期配置与原子评估窗口；不启用或回填旧数据。"""

from alembic import op

revision = "0068_geo_opportunity_schedule"
down_revision = "0067_geo_plan_schedules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("SET LOCAL statement_timeout = '120s'")
    op.execute("""CREATE TABLE geo_opportunity_schedule (
        id integer CONSTRAINT pk_geo_opportunity_schedule PRIMARY KEY,
        configuration jsonb NOT NULL, rule_set_revision integer NOT NULL
            CONSTRAINT fk_geo_opp_schedule_rule REFERENCES geo_rule_set_revisions(revision) ON DELETE RESTRICT,
        authorizer_id uuid NOT NULL CONSTRAINT fk_geo_opp_schedule_authorizer REFERENCES users(id) ON DELETE RESTRICT,
        status varchar(16) NOT NULL, revision integer NOT NULL, next_run_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_geo_opportunity_schedule_singleton CHECK(id=1),
        CONSTRAINT ck_geo_opportunity_schedule_revision CHECK(revision>=1),
        CONSTRAINT ck_geo_opportunity_schedule_state CHECK(status IN ('DISABLED','ACTIVE','PAUSED')
            AND ((status='ACTIVE')=(next_run_at IS NOT NULL))),
        CONSTRAINT ck_geo_opportunity_schedule_configuration CHECK(jsonb_typeof(configuration)='object'
            AND NOT configuration ? 'rule_set_revision')
    )""")
    op.execute("""CREATE TABLE geo_opportunity_schedule_windows (
        schedule_id integer NOT NULL CONSTRAINT fk_geo_opp_window_schedule
            REFERENCES geo_opportunity_schedule(id) ON DELETE RESTRICT,
        scheduled_for timestamptz NOT NULL, configuration_revision integer NOT NULL,
        configuration_snapshot jsonb NOT NULL, rule_set_revision integer NOT NULL
            CONSTRAINT fk_geo_opp_window_rule REFERENCES geo_rule_set_revisions(revision) ON DELETE RESTRICT,
        status varchar(16) NOT NULL, evaluation_run_id uuid CONSTRAINT fk_geo_opp_window_run
            REFERENCES geo_opportunity_evaluation_runs(id) ON DELETE RESTRICT,
        error_code varchar(100), covered_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_geo_opportunity_schedule_windows PRIMARY KEY(schedule_id,scheduled_for),
        CONSTRAINT ck_geo_opp_window_revision CHECK(configuration_revision>=1),
        CONSTRAINT ck_geo_opp_window_configuration CHECK(jsonb_typeof(configuration_snapshot)='object'
            AND NOT configuration_snapshot ? 'rule_set_revision'),
        CONSTRAINT ck_geo_opp_window_result CHECK(
            (status='COMPLETED' AND evaluation_run_id IS NOT NULL AND error_code IS NULL AND covered_until IS NULL)
            OR (status='FAILED' AND evaluation_run_id IS NULL AND error_code IS NOT NULL AND covered_until IS NULL)
            OR (status='MISSED' AND evaluation_run_id IS NULL AND error_code IS NOT NULL
                AND error_code IN ('SUPERSEDED','SKIPPED_OLDER_WINDOWS')
                AND covered_until IS NOT NULL AND covered_until>scheduled_for))
    )""")
    op.execute("""CREATE FUNCTION geo_opp_schedule_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP='INSERT' THEN
                IF NEW.status<>'DISABLED' OR NEW.revision<>1 THEN
                    RAISE EXCEPTION '自动评估必须先保存为未启用配置' USING ERRCODE='23514';
                END IF;
            ELSE
                IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at THEN
                    RAISE EXCEPTION '自动评估配置身份不可变' USING ERRCODE='23514';
                END IF;
                IF (NEW.configuration,NEW.rule_set_revision,NEW.authorizer_id,NEW.status)
                    IS DISTINCT FROM (OLD.configuration,OLD.rule_set_revision,OLD.authorizer_id,OLD.status) THEN
                    IF NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at THEN
                        RAISE EXCEPTION '配置变化须递增revision' USING ERRCODE='23514';
                    END IF;
                ELSIF NEW.revision<>OLD.revision OR NEW.updated_at<>OLD.updated_at THEN
                    RAISE EXCEPTION '窗口推进不能改配置revision' USING ERRCODE='23514';
                END IF;
            END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER geo_opp_schedule_guard BEFORE INSERT OR UPDATE ON geo_opportunity_schedule
        FOR EACH ROW EXECUTE FUNCTION geo_opp_schedule_guard()""")
    op.execute("""CREATE FUNCTION geo_opp_schedule_window_guard() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.status='COMPLETED' AND NOT EXISTS (
                SELECT 1 FROM geo_opportunity_evaluation_runs r JOIN geo_opportunity_schedule s
                    ON s.id=NEW.schedule_id
                WHERE r.id=NEW.evaluation_run_id AND r.created_by=s.authorizer_id
                    AND s.status='ACTIVE' AND s.revision=NEW.configuration_revision
                    AND s.configuration=NEW.configuration_snapshot
                    AND s.rule_set_revision=NEW.rule_set_revision
                    AND r.rule_set_revision=NEW.rule_set_revision
                    AND (r.request_snapshot->>'date_to')::timestamptz=NEW.scheduled_for
                    AND (r.request_snapshot->>'date_from')::timestamptz=NEW.scheduled_for
                        -(NEW.configuration_snapshot->>'lookback_days')::integer*interval '1 day'
                    AND (r.request_snapshot-'date_from'-'date_to')=
                        ((NEW.configuration_snapshot-'interval_hours'-'lookback_days')
                         || jsonb_build_object('rule_set_revision',NEW.rule_set_revision))
            ) THEN RAISE EXCEPTION '周期窗口与评估回执不匹配' USING ERRCODE='23514'; END IF;
            RETURN NEW;
        END $$""")
    op.execute("""CREATE TRIGGER geo_opp_schedule_window_guard BEFORE INSERT ON geo_opportunity_schedule_windows
        FOR EACH ROW EXECUTE FUNCTION geo_opp_schedule_window_guard()""")
    op.execute("""CREATE FUNCTION geo_opp_schedule_window_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION '自动评估窗口不可变' USING ERRCODE='55000'; END $$""")
    op.execute("""CREATE TRIGGER geo_opp_schedule_window_no_mutation BEFORE UPDATE OR DELETE OR TRUNCATE
        ON geo_opportunity_schedule_windows FOR EACH STATEMENT EXECUTE FUNCTION geo_opp_schedule_window_immutable()""")


def downgrade() -> None:
    op.execute("""DO $$ BEGIN RAISE EXCEPTION
        '0068自动评估窗口须保留；停用扫描并前向修复，或恢复迁移前备份' USING ERRCODE='55000'; END $$""")
