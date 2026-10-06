CREATE FUNCTION geo_guard_observation_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'PLANNED' OR NEW.revision <> 0 OR NEW.started_at IS NOT NULL
            OR NEW.finished_at IS NOT NULL THEN
            RAISE EXCEPTION '批次必须从 PLANNED revision 0 创建'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_batches_initial';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '批次历史必须保留'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_batches_immutable';
    END IF;
    IF ROW(NEW.id,NEW.plan_id,NEW.trigger_type,NEW.scheduled_for,NEW.schedule_identity,
        NEW.plan_snapshot,NEW.rule_snapshot,NEW.requested_run_count,NEW.source_opportunity_id,
        NEW.baseline_batch_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM
       ROW(OLD.id,OLD.plan_id,OLD.trigger_type,OLD.scheduled_for,OLD.schedule_identity,
        OLD.plan_snapshot,OLD.rule_snapshot,OLD.requested_run_count,OLD.source_opportunity_id,
        OLD.baseline_batch_id,OLD.created_by,OLD.created_at) THEN
        RAISE EXCEPTION '批次输入和身份不可变'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_batches_immutable';
    END IF;
    IF (NEW IS DISTINCT FROM OLD AND NEW.revision <> OLD.revision + 1)
        OR (NEW IS NOT DISTINCT FROM OLD AND NEW.revision <> OLD.revision) THEN
        RAISE EXCEPTION '批次实际更新必须递增 revision'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_batches_revision';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_batch_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_observation_batches
    FOR EACH ROW EXECUTE FUNCTION geo_guard_observation_batch();

CREATE FUNCTION geo_guard_observation_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent geo_observation_runs%ROWTYPE; batch_state text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '运行历史必须保留'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_immutable';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.id,NEW.batch_id,NEW.prompt_variant_id,NEW.collection_profile_id,
                NEW.repeat_index,NEW.attempt_no,NEW.previous_attempt_id,NEW.input_snapshot,NEW.created_at)
            IS DISTINCT FROM ROW(OLD.id,OLD.batch_id,OLD.prompt_variant_id,OLD.collection_profile_id,
                OLD.repeat_index,OLD.attempt_no,OLD.previous_attempt_id,OLD.input_snapshot,OLD.created_at) THEN
            RAISE EXCEPTION '运行输入和身份不可变'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_immutable';
        END IF;
        -- generated 列在 BEFORE 阶段尚未计算，比较所有其余维护列。
        IF to_jsonb(NEW) - 'run_cell_key' IS NOT DISTINCT FROM to_jsonb(OLD) - 'run_cell_key'
            THEN RETURN NEW; END IF;
        IF OLD.status IN ('COMPLETED','FAILED','CANCELLED','BUDGET_BLOCKED') THEN
            RAISE EXCEPTION '终态运行不可修改'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_terminal';
        END IF;
        IF NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION '运行实际更新必须递增 revision'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_revision';
        END IF;
        IF (OLD.external_call_state <> 'NOT_STARTED' AND NEW.external_call_state = 'NOT_STARTED')
            OR (OLD.external_call_state = 'COMPLETED' AND NEW.external_call_state <> 'COMPLETED') THEN
            RAISE EXCEPTION '已发送或未知请求不可恢复为未发送'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_external_progress';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status <> 'PENDING' OR NEW.revision <> 0 OR NEW.external_call_state <> 'NOT_STARTED'
        OR NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL
        OR NEW.started_at IS NOT NULL OR NEW.collected_at IS NOT NULL OR NEW.finished_at IS NOT NULL
        OR NEW.error_stage IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.error_summary IS NOT NULL
        OR NEW.provider_request_id IS NOT NULL OR NEW.duration_ms IS NOT NULL
        OR NEW.cost_amount IS NOT NULL OR NEW.cost_currency IS NOT NULL
        OR NEW.prompt_tokens IS NOT NULL OR NEW.completion_tokens IS NOT NULL OR NEW.total_tokens IS NOT NULL
        OR NEW.dispatch_attempt_count <> 0 OR NEW.last_dispatch_attempt_at IS NOT NULL THEN
        RAISE EXCEPTION '新尝试必须是未发送的 PENDING revision 0'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_initial';
    END IF;
    SELECT status INTO batch_state FROM geo_observation_batches WHERE id=NEW.batch_id FOR UPDATE;
    -- 写父行使 RR 的旧快照不能绕过集合提交约束；不更改逻辑 revision。
    UPDATE geo_observation_batches SET revision=revision WHERE id=NEW.batch_id;
    IF NEW.attempt_no=1 AND batch_state <> 'PLANNED' THEN
        RAISE EXCEPTION '初始矩阵已封存'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_initial_matrix';
    END IF;
    IF NEW.previous_attempt_id IS NOT NULL THEN
        SELECT * INTO parent FROM geo_observation_runs WHERE id=NEW.previous_attempt_id FOR KEY SHARE;
        IF NOT FOUND OR (parent.batch_id <> NEW.batch_id
            OR parent.prompt_variant_id <> NEW.prompt_variant_id
            OR parent.collection_profile_id <> NEW.collection_profile_id
            OR parent.repeat_index <> NEW.repeat_index OR parent.attempt_no + 1 <> NEW.attempt_no
            OR parent.input_snapshot IS DISTINCT FROM NEW.input_snapshot
            OR parent.status NOT IN ('FAILED','BUDGET_BLOCKED') OR parent.error_stage IS DISTINCT FROM 'COLLECTION') THEN
            RAISE EXCEPTION '新尝试必须继承同采样单元的失败采集与完整输入'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_attempt_chain';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_run_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_observation_runs
    FOR EACH ROW EXECUTE FUNCTION geo_guard_observation_run();

CREATE FUNCTION geo_check_batch_run_count() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent uuid; expected integer; actual bigint;
BEGIN
    IF TG_TABLE_NAME='geo_observation_batches' THEN parent := NEW.id;
    ELSE parent := NEW.batch_id; END IF;
    SELECT requested_run_count INTO expected FROM geo_observation_batches WHERE id=parent;
    SELECT count(*) INTO actual FROM geo_observation_runs WHERE batch_id=parent AND attempt_no=1;
    IF actual <> expected THEN
        RAISE EXCEPTION '批次初始采样单元数必须等于请求数量'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_batches_run_count';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_batch_complete AFTER INSERT ON geo_observation_batches
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_batch_run_count();
CREATE CONSTRAINT TRIGGER geo_run_batch_complete AFTER INSERT ON geo_observation_runs
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_batch_run_count();
