LOCK TABLE geo_observation_runs IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE geo_observation_runs ADD COLUMN provider_status integer,
    ADD COLUMN retry_after_seconds bigint,
    ADD CONSTRAINT ck_geo_runs_provider_failure CHECK (
        (provider_status IS NULL OR (provider_status BETWEEN 100 AND 599
            AND external_call_state='COMPLETED')) AND
        (retry_after_seconds IS NULL OR (retry_after_seconds >= 0
            AND provider_status IS NOT NULL AND provider_status=429
            AND error_code IS NOT NULL AND error_code='PROVIDER_RATE_LIMITED')));
CREATE FUNCTION geo_guard_provider_failure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.provider_status IS NOT NULL OR NEW.retry_after_seconds IS NOT NULL THEN
        RAISE EXCEPTION '新尝试不能含供应商结果'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_initial';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_run_provider_initial BEFORE INSERT ON geo_observation_runs
    FOR EACH ROW EXECUTE FUNCTION geo_guard_provider_failure();
CREATE FUNCTION geo_guard_collected_run_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.collected_at IS NOT NULL AND
        ROW(NEW.external_call_state,NEW.started_at,NEW.collected_at,NEW.provider_request_id,
            NEW.provider_status,NEW.retry_after_seconds,NEW.duration_ms,NEW.cost_amount,
            NEW.cost_currency,NEW.prompt_tokens,NEW.completion_tokens,NEW.total_tokens)
        IS DISTINCT FROM
        ROW(OLD.external_call_state,OLD.started_at,OLD.collected_at,OLD.provider_request_id,
            OLD.provider_status,OLD.retry_after_seconds,OLD.duration_ms,OLD.cost_amount,
            OLD.cost_currency,OLD.prompt_tokens,OLD.completion_tokens,OLD.total_tokens) THEN
        RAISE EXCEPTION '已采集的原始费用与元数据不能改写'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_collection_immutable';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_run_collection_fact_guard BEFORE UPDATE ON geo_observation_runs
    FOR EACH ROW EXECUTE FUNCTION geo_guard_collected_run_metadata();
CREATE TABLE geo_collection_reservations (
    run_id uuid CONSTRAINT pk_geo_collection_reservations PRIMARY KEY,
    state varchar(16) NOT NULL,
    estimated_amount numeric(14,6),
    estimated_currency varchar(3),
    budget_day date NOT NULL,
    reserved_at timestamptz NOT NULL,
    sent_at timestamptz,
    settled_at timestamptz,
    CONSTRAINT fk_geo_reservations_run FOREIGN KEY(run_id)
        REFERENCES geo_observation_runs(id) ON DELETE RESTRICT,
    CONSTRAINT ck_geo_reservations_state CHECK
        (state IN ('RESERVED','SENT','SETTLED','UNKNOWN','RELEASED')),
    CONSTRAINT ck_geo_reservations_cost CHECK (
        (estimated_amount IS NULL AND estimated_currency IS NULL) OR
        (estimated_amount IS NOT NULL AND estimated_currency IS NOT NULL
            AND estimated_amount >= 0 AND estimated_amount < 'Infinity'::numeric
            AND estimated_currency ~ '^[A-Z]{3}$')),
    CONSTRAINT ck_geo_reservations_day CHECK
        (budget_day=(COALESCE(sent_at,reserved_at) AT TIME ZONE 'UTC')::date),
    CONSTRAINT ck_geo_reservations_time CHECK (
        ((state IN ('SENT','SETTLED','UNKNOWN')) = (sent_at IS NOT NULL)) AND
        ((state IN ('SETTLED','UNKNOWN','RELEASED')) = (settled_at IS NOT NULL)) AND
        (sent_at IS NULL OR sent_at >= reserved_at) AND
        (settled_at IS NULL OR settled_at >= COALESCE(sent_at,reserved_at)))
);
CREATE INDEX ix_geo_reservations_day ON geo_collection_reservations(budget_day);
CREATE INDEX ix_geo_reservations_sent ON geo_collection_reservations(sent_at);
-- 仅归集已有自动采集事实；旧发送时刻取最晚可能上界，避免跨UTC日漏账。
-- 已终结用finished/collected，仍未结用本次迁移时刻；这些是计账上界，不是provider原始事实。
INSERT INTO geo_collection_reservations
    (run_id,state,budget_day,reserved_at,sent_at,settled_at)
SELECT id,
    CASE WHEN external_call_state='NOT_STARTED' THEN
        CASE WHEN status='RUNNING' THEN 'RESERVED' ELSE 'RELEASED' END
        WHEN status='RUNNING' THEN 'SENT'
        WHEN cost_amount IS NOT NULL THEN 'SETTLED' ELSE 'UNKNOWN' END,
    ((CASE WHEN external_call_state='NOT_STARTED' THEN COALESCE(started_at,created_at)
        ELSE COALESCE(finished_at,collected_at,statement_timestamp()) END) AT TIME ZONE 'UTC')::date,
    COALESCE(started_at,created_at),
    CASE WHEN external_call_state<>'NOT_STARTED'
        THEN COALESCE(finished_at,collected_at,statement_timestamp()) END,
    CASE WHEN status<>'RUNNING' THEN COALESCE(finished_at,collected_at,started_at,created_at) END
FROM geo_observation_runs
WHERE input_snapshot->'profile'->>'collection_mode'='API'
    AND (status='RUNNING' OR external_call_state<>'NOT_STARTED');
CREATE FUNCTION geo_guard_collection_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND
        (OLD.state IN ('SETTLED','UNKNOWN') OR NEW.run_id IS DISTINCT FROM OLD.run_id)) THEN
        RAISE EXCEPTION '已结算或未知费用的发送历史必须保留'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_reservations_immutable';
    END IF;
    IF TG_OP='INSERT' AND NEW.state <> 'RESERVED' THEN
        RAISE EXCEPTION '新预留必须是RESERVED'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_reservations_initial';
    END IF;
    IF TG_OP='UPDATE' AND NOT (
        (OLD.state='RESERVED' AND NEW.state IN ('SENT','RELEASED')) OR
        (OLD.state='SENT' AND NEW.state IN ('SETTLED','UNKNOWN')) OR
        (OLD.state='RELEASED' AND NEW.state='RESERVED')) THEN
        RAISE EXCEPTION '非法预留状态转换'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_reservations_transition';
    END IF;
    IF TG_OP='UPDATE' AND OLD.state <> 'RELEASED' AND (
        NEW.estimated_amount IS DISTINCT FROM OLD.estimated_amount OR
        NEW.estimated_currency IS DISTINCT FROM OLD.estimated_currency OR
        NEW.reserved_at IS DISTINCT FROM OLD.reserved_at OR
        (OLD.state='SENT' AND (NEW.sent_at IS DISTINCT FROM OLD.sent_at OR
            NEW.budget_day IS DISTINCT FROM OLD.budget_day))) THEN
        RAISE EXCEPTION '预留报价和已发送时刻不能改写'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_reservations_immutable';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_collection_reservations
    FOR EACH ROW EXECUTE FUNCTION geo_guard_collection_reservation();
CREATE FUNCTION geo_check_collection_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE value geo_collection_reservations%ROWTYPE; r geo_observation_runs%ROWTYPE; identity uuid;
BEGIN
    IF TG_TABLE_NAME='geo_observation_runs' THEN identity := NEW.id;
    ELSE identity := NEW.run_id; END IF;
    SELECT * INTO r FROM geo_observation_runs WHERE id=identity;
    SELECT * INTO value FROM geo_collection_reservations WHERE run_id=identity;
    IF NOT FOUND THEN
        IF r.input_snapshot->'profile'->>'collection_mode'='API' AND
            (r.status='RUNNING' OR r.external_call_state<>'NOT_STARTED') THEN
            RAISE EXCEPTION 'API领取或发送必须持有唯一预算预留'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_reservations_run';
        END IF;
        RETURN NULL;
    END IF;
    IF r.input_snapshot->'profile'->>'collection_mode' <> 'API' OR NOT (
        (value.state='RESERVED' AND r.status='RUNNING' AND r.external_call_state='NOT_STARTED') OR
        (value.state='RELEASED' AND r.external_call_state='NOT_STARTED') OR
        (value.state='SENT' AND r.status='RUNNING' AND r.external_call_state IN ('SENT','UNKNOWN')) OR
        (value.state='SETTLED' AND r.status<>'RUNNING'
            AND r.external_call_state='COMPLETED' AND r.cost_amount IS NOT NULL) OR
        (value.state='UNKNOWN' AND r.external_call_state IN ('SENT','UNKNOWN','COMPLETED')
            AND r.cost_amount IS NULL AND r.status<>'RUNNING')) THEN
        RAISE EXCEPTION '预留与Run发送/费用事实必须一致'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_reservations_run';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_reservation_complete AFTER INSERT OR UPDATE ON geo_collection_reservations
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_collection_reservation();
CREATE CONSTRAINT TRIGGER geo_run_reservation_complete AFTER UPDATE ON geo_observation_runs
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_collection_reservation();
        CREATE OR REPLACE FUNCTION geo_profile_settings_valid(mode text, value jsonb) RETURNS boolean
        LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
        DECLARE key text; item jsonb; allowed text[];
        BEGIN
            IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
            CASE mode
                WHEN 'MANUAL' THEN allowed := ARRAY['require_screenshot'];
                WHEN 'API' THEN allowed := ARRAY['temperature','max_output_tokens','max_concurrency','requests_per_minute'];
                WHEN 'BROWSER' THEN allowed := ARRAY['require_screenshot','answer_timeout_seconds'];
                ELSE RETURN false;
            END CASE;
            IF value - allowed <> '{}'::jsonb THEN RETURN false; END IF;
            FOR key, item IN SELECT * FROM jsonb_each(value) LOOP
                IF key = 'require_screenshot' THEN
                    IF jsonb_typeof(item) <> 'boolean' THEN RETURN false; END IF;
                ELSIF item = 'null'::jsonb AND key IN ('temperature','max_output_tokens') THEN
                    CONTINUE;
                ELSIF jsonb_typeof(item) <> 'number' THEN
                    RETURN false;
                ELSIF key = 'temperature' THEN
                    IF item::text::numeric NOT BETWEEN 0 AND 2 THEN RETURN false; END IF;
                ELSE
                    IF item::text !~ '^[0-9]+$' THEN RETURN false; END IF;
                    IF key = 'max_output_tokens' AND item::text::numeric NOT BETWEEN 1 AND 65536
                        THEN
                        RETURN false;
                    END IF;
                    IF key = 'max_concurrency' AND item::text::numeric NOT BETWEEN 1 AND 100
                        THEN RETURN false; END IF;
                    IF key = 'requests_per_minute' AND item::text::numeric NOT BETWEEN 1 AND 60000
                        THEN RETURN false; END IF;
                    IF key = 'answer_timeout_seconds' AND item::text::numeric NOT BETWEEN 10 AND
                        600 THEN
                        RETURN false;
                    END IF;
                END IF;
            END LOOP;
            RETURN true;
        END $$;
