-- 冻结0054指针与采集防线；追加受控人工复核revision发布。
CREATE OR REPLACE FUNCTION geo_guard_observation_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent geo_observation_runs%ROWTYPE; batch_state text; target geo_analysis_revisions%ROWTYPE; previous integer;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '运行历史必须保留'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_immutable';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        -- 唯一终态例外是独立发布成功指针，不能夹带采集状态、费用或证据字段。
        IF NEW.current_analysis_revision_id IS DISTINCT FROM OLD.current_analysis_revision_id THEN
            IF NEW.current_analysis_revision_id IS NULL OR NEW.revision <> OLD.revision + 1 OR
                (to_jsonb(NEW) - ARRAY['run_cell_key','revision','current_analysis_revision_id']) IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['run_cell_key','revision','current_analysis_revision_id']) THEN
                RAISE EXCEPTION '当前分析发布只能前进指针并递增运行 revision'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_analysis_publication';
            END IF;
            SELECT * INTO target FROM geo_analysis_revisions WHERE id=NEW.current_analysis_revision_id;
            SELECT revision INTO previous FROM geo_analysis_revisions WHERE id=OLD.current_analysis_revision_id;
            IF target.id IS NULL OR target.run_id <> OLD.id OR target.status <> 'COMPLETED'
                OR target.revision <= COALESCE(previous,0) OR target.revision <
                    (SELECT max(revision) FROM geo_analysis_revisions WHERE run_id=OLD.id AND status='COMPLETED') THEN
                RAISE EXCEPTION '当前分析必须是本运行最新成功版本，不得倒退'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_current_analysis';
            END IF;
            RETURN NEW;
        END IF;
        -- 复核只发布revision；仅首轮NEEDS_REVIEW额外完成，不能重写采集历史。
        IF OLD.status IN ('NEEDS_REVIEW','COMPLETED','FAILED') AND
            NEW.status = (CASE WHEN OLD.status='NEEDS_REVIEW' THEN 'COMPLETED' ELSE OLD.status END) THEN
            IF NEW.revision = OLD.revision + 1 AND EXISTS (
                SELECT 1 FROM geo_run_reviews review WHERE review.run_id=OLD.id
                    AND review.analysis_revision_id=OLD.current_analysis_revision_id
                    AND review.xmin=pg_current_xact_id()::xid
            ) AND (
                (OLD.status='NEEDS_REVIEW' AND NEW.finished_at IS NOT NULL AND
                    (to_jsonb(NEW)-ARRAY['run_cell_key','revision','status','finished_at']) IS NOT DISTINCT FROM
                    (to_jsonb(OLD)-ARRAY['run_cell_key','revision','status','finished_at'])) OR
                (OLD.status<>'NEEDS_REVIEW' AND
                    (to_jsonb(NEW)-ARRAY['run_cell_key','revision']) IS NOT DISTINCT FROM
                    (to_jsonb(OLD)-ARRAY['run_cell_key','revision']))
            ) THEN RETURN NEW; END IF;
            -- 同值锁定仍保留；需要完成或终态实际修改却没有新Review时拒绝。
            IF OLD.status='NEEDS_REVIEW' OR
                (to_jsonb(NEW)-'run_cell_key') IS DISTINCT FROM (to_jsonb(OLD)-'run_cell_key') THEN
                RAISE EXCEPTION '复核发布必须同事务追加当前分析Review且只更新允许字段'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_review_publication';
            END IF;
        END IF;
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
    IF NEW.current_analysis_revision_id IS NOT NULL OR NEW.status <> 'PENDING' OR NEW.revision <> 0 OR NEW.external_call_state <> 'NOT_STARTED'
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
