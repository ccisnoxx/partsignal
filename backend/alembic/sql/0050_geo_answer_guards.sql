CREATE FUNCTION geo_guard_answer_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r geo_observation_runs%ROWTYPE; f file_records%ROWTYPE; file_count integer := 0;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION '原始回答和证据不可修改或删除'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_answers_immutable';
    END IF;
    SELECT * INTO r FROM geo_observation_runs WHERE id=NEW.run_id FOR UPDATE;
    IF NOT FOUND OR NEW.prompt_text IS DISTINCT FROM r.input_snapshot->'prompt'->>'prompt_text'
        OR NOT ((r.status='PENDING' AND r.input_snapshot->'profile'->>'collection_mode'='MANUAL'
            AND r.external_call_state='NOT_STARTED') OR (r.status='RUNNING'
            AND r.input_snapshot->'profile'->>'collection_mode' IN ('API','BROWSER')
            AND r.external_call_state='COMPLETED')) THEN
        RAISE EXCEPTION '原始回答必须属于当前可提交的运行和冻结问题'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_answers_submission';
    END IF;
    FOR f IN SELECT * FROM file_records
        WHERE id=ANY(ARRAY[NEW.raw_payload_file_id,NEW.screenshot_file_id]) ORDER BY id FOR UPDATE
    LOOP
        file_count := file_count+1;
        IF f.status <> 'VERIFIED' OR f.verified_at IS NULL OR f.access_level NOT IN ('INTERNAL','RESTRICTED')
            OR f.sha256 !~ '^[0-9a-f]{64}$' OR f.size < 1
            OR (f.id=NEW.screenshot_file_id AND (f.category <> 'OPERATION_SCREENSHOT'
                OR f.content_type NOT IN ('image/png','image/jpeg','image/webp') OR f.size > 10485760))
            OR (f.id=NEW.raw_payload_file_id AND (f.category <> 'EVIDENCE'
                OR f.content_type <> 'text/plain' OR f.size > 52428800)) THEN
            RAISE EXCEPTION '原始证据文件资格无效'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_answers_file_eligible';
        END IF;
        -- 写文件建立 MVCC 冲突，RR 陈旧快照也不能引用已被清理的对象。
        UPDATE file_records SET cleanup_after=NULL WHERE id=f.id;
    END LOOP;
    IF file_count <> (NEW.raw_payload_file_id IS NOT NULL)::integer
        + (NEW.screenshot_file_id IS NOT NULL)::integer THEN
        RAISE EXCEPTION '原始证据文件不存在或重复'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_answers_file_eligible';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_answer_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_answer_snapshots
    FOR EACH ROW EXECUTE FUNCTION geo_guard_answer_snapshot();

CREATE FUNCTION geo_guard_answer_citation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r geo_observation_runs%ROWTYPE;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION '原始引用不可修改或删除'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_citations_immutable';
    END IF;
    SELECT r0.* INTO r FROM geo_observation_runs r0 JOIN geo_answer_snapshots s ON s.run_id=r0.id
        WHERE s.id=NEW.answer_snapshot_id FOR UPDATE OF r0;
    IF NOT FOUND OR r.status NOT IN ('PENDING','RUNNING') THEN
        RAISE EXCEPTION '引用只能与原始回答一次性提交'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_citations_submission';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_answer_citation_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_answer_citations
    FOR EACH ROW EXECUTE FUNCTION geo_guard_answer_citation();

CREATE FUNCTION geo_check_answer_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r geo_observation_runs%ROWTYPE; s geo_answer_snapshots%ROWTYPE; target uuid;
    actual bigint; positions bigint; unique_positions bigint;
BEGIN
    IF TG_TABLE_NAME='geo_observation_runs' THEN target:=NEW.id; ELSE target:=NEW.run_id; END IF;
    SELECT * INTO r FROM geo_observation_runs WHERE id=target;
    SELECT * INTO s FROM geo_answer_snapshots WHERE run_id=target;
    IF NOT FOUND THEN
        IF r.collected_at IS NOT NULL OR r.status IN ('COLLECTED','ANALYZING','NEEDS_REVIEW','COMPLETED') THEN
            RAISE EXCEPTION '采集事实必须有原始回答'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_answers_complete';
        END IF;
        RETURN NULL;
    END IF;
    IF r.status NOT IN ('COLLECTED','ANALYZING','NEEDS_REVIEW','COMPLETED','FAILED')
        OR r.collected_at IS DISTINCT FROM s.collected_at
        OR r.input_snapshot->'prompt'->>'prompt_text' IS DISTINCT FROM s.prompt_text
        OR (r.status='FAILED' AND r.error_stage='COLLECTION')
        OR (r.input_snapshot->'profile'->>'collection_mode'='MANUAL' AND r.external_call_state <> 'NOT_STARTED')
        OR (r.input_snapshot->'profile'->>'collection_mode'<>'MANUAL' AND r.external_call_state <> 'COMPLETED') THEN
        RAISE EXCEPTION '原始回答与运行采集事实必须同事务一致提交'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_answers_complete';
    END IF;
    SELECT count(*) INTO actual FROM geo_answer_citations WHERE answer_snapshot_id=s.id;
    SELECT count(*),count(DISTINCT p) INTO positions,unique_positions FROM geo_answer_citations c,
        LATERAL unnest(c.occurrences) p WHERE c.answer_snapshot_id=s.id;
    IF actual <> s.citation_count OR positions <> unique_positions THEN
        RAISE EXCEPTION '原始引用集合必须完整且实际位置不冲突'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_citations_complete';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_answer_complete AFTER INSERT ON geo_answer_snapshots
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_answer_complete();
CREATE CONSTRAINT TRIGGER geo_run_answer_complete AFTER INSERT OR UPDATE ON geo_observation_runs
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_answer_complete();

CREATE FUNCTION geo_guard_evidence_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM geo_answer_snapshots
        WHERE raw_payload_file_id=OLD.id OR screenshot_file_id=OLD.id) THEN
        IF TG_OP='DELETE' THEN
            RAISE EXCEPTION '原始证据文件必须保留'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_evidence_file_immutable';
        END IF;
        IF ROW(NEW.id,NEW.category,NEW.original_filename,NEW.object_key,NEW.content_type,
            NEW.size,NEW.sha256,NEW.access_level,NEW.status,NEW.uploader_id,
            NEW.upload_expires_at,NEW.created_at,NEW.verified_at,NEW.deleted_at)
            IS DISTINCT FROM ROW(OLD.id,OLD.category,OLD.original_filename,OLD.object_key,OLD.content_type,
            OLD.size,OLD.sha256,OLD.access_level,OLD.status,OLD.uploader_id,
            OLD.upload_expires_at,OLD.created_at,OLD.verified_at,OLD.deleted_at) THEN
            RAISE EXCEPTION '被原始证据引用的文件身份与完整性不可变'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_evidence_file_immutable';
        END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_evidence_file_guard BEFORE UPDATE OR DELETE ON file_records
    FOR EACH ROW EXECUTE FUNCTION geo_guard_evidence_file();
