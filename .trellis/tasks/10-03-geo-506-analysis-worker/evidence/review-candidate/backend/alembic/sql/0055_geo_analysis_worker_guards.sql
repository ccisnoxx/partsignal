CREATE FUNCTION geo_guard_analysis_job() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a geo_analysis_revisions%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '分析执行历史必须保留' USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_jobs_immutable';
    END IF;
    SELECT * INTO a FROM geo_analysis_revisions WHERE id=NEW.analysis_revision_id;
    PERFORM 1 FROM geo_observation_runs WHERE id=a.run_id FOR UPDATE;
    UPDATE geo_observation_runs SET revision=revision WHERE id=a.run_id;
    SELECT * INTO a FROM geo_analysis_revisions WHERE id=NEW.analysis_revision_id FOR UPDATE;
    IF NOT FOUND OR a.status <> 'PENDING' THEN
        RAISE EXCEPTION '只有 PENDING 分析可维护执行元数据'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_jobs_open';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.claimed_at IS NOT NULL OR NEW.lease_token IS NOT NULL OR
            NEW.dispatch_attempt_count <> 0 OR NEW.last_dispatch_attempt_at IS NOT NULL THEN
            RAISE EXCEPTION '执行元数据必须以未派发未 claim 创建'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_jobs_initial';
        END IF;
    ELSE
        IF NEW.analysis_revision_id <> OLD.analysis_revision_id OR
            (OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at) OR
            (OLD.lease_token IS NOT NULL AND NEW.lease_token IS NOT NULL AND
                ROW(NEW.lease_token,NEW.lease_expires_at) IS DISTINCT FROM ROW(OLD.lease_token,OLD.lease_expires_at)) OR
            (OLD.claimed_at IS NOT NULL AND OLD.lease_token IS NULL AND NEW.lease_token IS NOT NULL) THEN
            RAISE EXCEPTION '同 revision 不得重新 claim 或替换执行身份'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_jobs_immutable';
        END IF;
        IF NEW.dispatch_attempt_count IS DISTINCT FROM OLD.dispatch_attempt_count OR
            NEW.last_dispatch_attempt_at IS DISTINCT FROM OLD.last_dispatch_attempt_at THEN
            IF OLD.claimed_at IS NOT NULL OR NEW.dispatch_attempt_count <> OLD.dispatch_attempt_count + 1
                OR NEW.last_dispatch_attempt_at IS NULL OR
                NEW.last_dispatch_attempt_at < COALESCE(OLD.last_dispatch_attempt_at,a.created_at) THEN
                RAISE EXCEPTION '派发元数据只能在 claim 前单调推进'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_jobs_dispatch_progress';
            END IF;
        END IF;
    END IF;
    IF NEW.claimed_at < a.created_at OR NEW.last_dispatch_attempt_at < a.created_at THEN
        RAISE EXCEPTION '执行时间不得早于 revision'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_jobs_time';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_analysis_job_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_analysis_jobs
    FOR EACH ROW EXECUTE FUNCTION geo_guard_analysis_job();

CREATE FUNCTION geo_guard_citation_classification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a geo_analysis_revisions%ROWTYPE; answer uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION '引用分类不可 UPDATE/DELETE'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_citation_classifications_immutable';
    END IF;
    SELECT * INTO a FROM geo_analysis_revisions WHERE id=NEW.analysis_revision_id;
    PERFORM 1 FROM geo_observation_runs WHERE id=a.run_id FOR UPDATE;
    UPDATE geo_observation_runs SET revision=revision WHERE id=a.run_id;
    SELECT * INTO a FROM geo_analysis_revisions WHERE id=NEW.analysis_revision_id FOR UPDATE;
    SELECT answer_snapshot_id INTO answer FROM geo_answer_citations WHERE id=NEW.citation_id;
    IF NOT FOUND OR a.id IS NULL OR a.status <> 'PENDING' OR answer <> a.answer_snapshot_id THEN
        RAISE EXCEPTION '引用分类必须绑定 PENDING revision 的原始引用'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_citation_classifications_answer';
    END IF;
    IF NEW.subject_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(a.input_snapshot->'subjects') s WHERE s->>'id'=NEW.subject_id::text
    ) THEN
        RAISE EXCEPTION '引用对象不在分析快照内'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_citation_classifications_subject';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_citation_classification_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_citation_classifications
    FOR EACH ROW EXECUTE FUNCTION geo_guard_citation_classification();

CREATE FUNCTION geo_check_analysis_worker_assembly() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity uuid; a geo_analysis_revisions%ROWTYPE; j geo_analysis_jobs%ROWTYPE; r geo_observation_runs%ROWTYPE;
BEGIN
    IF TG_TABLE_NAME='geo_analysis_revisions' THEN identity := NEW.id;
    ELSE identity := NEW.analysis_revision_id; END IF;
    SELECT * INTO a FROM geo_analysis_revisions WHERE id=identity;
    SELECT * INTO j FROM geo_analysis_jobs WHERE analysis_revision_id=identity;
    IF a.status <> 'COMPLETED' AND EXISTS (
        SELECT 1 FROM geo_citation_classifications WHERE analysis_revision_id=identity
    ) THEN RAISE EXCEPTION '引用分类必须与 COMPLETED 同事务提交'
        USING ERRCODE='23514', CONSTRAINT='ck_geo_citation_classifications_complete'; END IF;
    -- 旧 revision 没有执行元数据，不回填不存在的机器结果。
    IF j.analysis_revision_id IS NULL THEN RETURN NULL; END IF;
    IF (a.status <> 'PENDING' AND j.lease_token IS NOT NULL) OR
        (a.status='PENDING' AND j.claimed_at IS NOT NULL AND j.lease_token IS NULL) THEN
        RAISE EXCEPTION 'lease 释放必须与分析终结原子一致'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_jobs_assembly';
    END IF;
    SELECT * INTO r FROM geo_observation_runs WHERE id=a.run_id;
    IF r.status='ANALYZING' AND j.lease_token IS NOT NULL AND
        ROW(r.lease_token,r.lease_expires_at) IS DISTINCT FROM ROW(j.lease_token,j.lease_expires_at) THEN
        RAISE EXCEPTION '首次 Run 与分析 lease 必须一致'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_jobs_run_lease';
    END IF;
    IF a.status='COMPLETED' AND
        (SELECT count(*) FROM geo_citation_classifications WHERE analysis_revision_id=identity) <>
        (SELECT citation_count FROM geo_answer_snapshots WHERE id=a.answer_snapshot_id) THEN
        RAISE EXCEPTION '成功 Worker 必须提交全部原始引用的分类'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_citation_classifications_assembly';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_analysis_worker_assembly AFTER INSERT OR UPDATE ON geo_analysis_revisions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_analysis_worker_assembly();
CREATE CONSTRAINT TRIGGER geo_analysis_job_assembly AFTER INSERT OR UPDATE ON geo_analysis_jobs
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_analysis_worker_assembly();
CREATE CONSTRAINT TRIGGER geo_citation_classification_assembly AFTER INSERT ON geo_citation_classifications
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_analysis_worker_assembly();
