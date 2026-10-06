CREATE FUNCTION geo_guard_run_review() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r geo_observation_runs%ROWTYPE; a geo_analysis_revisions%ROWTYPE; item jsonb;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION '人工复核必须追加，历史不可改'
        USING ERRCODE='23514', CONSTRAINT='ck_geo_reviews_immutable'; END IF;
    SELECT * INTO r FROM geo_observation_runs WHERE id=NEW.run_id FOR UPDATE;
    UPDATE geo_observation_runs SET revision=revision WHERE id=NEW.run_id;
    SELECT * INTO a FROM geo_analysis_revisions WHERE id=NEW.analysis_revision_id;
    IF r.id IS NULL OR a.id IS NULL OR a.run_id <> r.id OR a.status <> 'COMPLETED'
        OR r.current_analysis_revision_id IS DISTINCT FROM a.id THEN
        RAISE EXCEPTION '复核只能追加到当前成功分析'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_reviews_current_analysis';
    END IF;
    NEW.created_at := clock_timestamp();
    IF NEW.decision='CORRECTED' THEN
        IF NOT geo_review_corrections_valid(NEW.correction_payload) THEN RAISE EXCEPTION '复核修正结构无效'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_reviews_decision'; END IF;
        FOR item IN SELECT * FROM jsonb_array_elements(NEW.correction_payload->'mentions')
            UNION ALL SELECT * FROM jsonb_array_elements(NEW.correction_payload->'recommendations') LOOP
            IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.input_snapshot->'subjects') s
                WHERE s->>'id'=item->>'subject_id') THEN RAISE EXCEPTION '修正对象不在分析内'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_reviews_correction_scope'; END IF;
        END LOOP;
        FOR item IN SELECT * FROM jsonb_array_elements(NEW.correction_payload->'claims') LOOP
            IF NOT EXISTS(SELECT 1 FROM geo_claim_assessments c WHERE c.id::text=item->>'claim_assessment_id'
                AND c.analysis_revision_id=a.id AND (c.fact_version_id IS NOT NULL OR item->>'verdict'='UNJUDGEABLE')) THEN
                RAISE EXCEPTION '修正声明必须属于本分析且保留事实依据'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_reviews_correction_scope'; END IF;
        END LOOP;
        FOR item IN SELECT * FROM jsonb_array_elements(NEW.correction_payload->'citations') LOOP
            IF NOT EXISTS(SELECT 1 FROM geo_answer_citations c WHERE c.id::text=item->>'citation_id'
                AND c.answer_snapshot_id=a.answer_snapshot_id) OR (item->'subject_id' <> 'null'::jsonb
                AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.input_snapshot->'subjects') s
                    WHERE s->>'id'=item->>'subject_id')) THEN
                RAISE EXCEPTION '引用修正必须属于本回答与监测范围'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_reviews_correction_scope'; END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_run_review_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_run_reviews
    FOR EACH ROW EXECUTE FUNCTION geo_guard_run_review();
