CREATE FUNCTION geo_guard_analysis_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r geo_observation_runs%ROWTYPE; a geo_answer_snapshots%ROWTYPE; maximum integer; subject jsonb; eligible uuid;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '分析历史必须保留' USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_immutable';
    END IF;
    -- 调用者必须先锁 Run 再写 Analysis；同值父写令 RR 旧快照显式序列化失败。
    SELECT * INTO r FROM geo_observation_runs WHERE id=NEW.run_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '分析运行不存在'
        USING ERRCODE='23503', CONSTRAINT='fk_geo_analysis_run'; END IF;
    UPDATE geo_observation_runs SET revision=revision WHERE id=r.id;
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - ARRAY['input_sha256','status','confidence_summary',
            'review_required_reasons','error_code','error_summary','finished_at']) IS DISTINCT FROM
           (to_jsonb(OLD) - ARRAY['input_sha256','status','confidence_summary',
            'review_required_reasons','error_code','error_summary','finished_at']) THEN
            RAISE EXCEPTION '分析身份与完整输入不可变'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_immutable';
        END IF;
        IF OLD.status <> 'PENDING' THEN
            RAISE EXCEPTION '已终结分析不可 UPDATE'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_immutable';
        END IF;
        IF NEW.status = 'PENDING' AND to_jsonb(NEW) - 'input_sha256' IS NOT DISTINCT FROM
            to_jsonb(OLD) - 'input_sha256' THEN RETURN NEW; END IF;
        IF NEW.status NOT IN ('COMPLETED','FAILED') THEN
            RAISE EXCEPTION 'PENDING 只允许一次终结'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_transition';
        END IF;
        RETURN NEW;
    END IF;
    IF NOT geo_analysis_input_valid(NEW.input_snapshot) THEN
        RAISE EXCEPTION '分析输入结构无效' USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_input';
    END IF;
    IF NEW.status <> 'PENDING' OR NEW.finished_at IS NOT NULL OR NEW.confidence_summary IS NOT NULL
        OR NEW.review_required_reasons <> '[]'::jsonb OR NEW.error_code IS NOT NULL OR NEW.error_summary IS NOT NULL THEN
        RAISE EXCEPTION '分析必须以空结果 PENDING 创建'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_initial';
    END IF;
    SELECT * INTO a FROM geo_answer_snapshots WHERE id=NEW.answer_snapshot_id;
    IF NOT FOUND OR a.run_id <> r.id OR r.collected_at IS NULL OR
        NEW.input_snapshot->>'answer_sha256' IS DISTINCT FROM a.answer_sha256 THEN
        RAISE EXCEPTION '分析必须绑定本 Run 的完整原始回答'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_answer';
    END IF;
    SELECT COALESCE(max(revision),0) INTO maximum FROM geo_analysis_revisions WHERE run_id=r.id;
    IF NEW.revision <> maximum + 1 THEN
        RAISE EXCEPTION '分析 revision 必须在同 Run 单调分配'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_revision_sequence';
    END IF;
    -- 别名/域名可用新配置重分析，但不能改变该 Run 的受监测对象身份或角色。
    IF EXISTS (
        (SELECT s->>'id',s->>'subject_type',s->>'product_id',s->>'role'
            FROM jsonb_array_elements(r.input_snapshot->'subjects') s
         EXCEPT SELECT s->>'id',s->>'subject_type',s->>'product_id',s->>'role'
            FROM jsonb_array_elements(NEW.input_snapshot->'subjects') s)
        UNION ALL
        (SELECT s->>'id',s->>'subject_type',s->>'product_id',s->>'role'
            FROM jsonb_array_elements(NEW.input_snapshot->'subjects') s
         EXCEPT SELECT s->>'id',s->>'subject_type',s->>'product_id',s->>'role'
            FROM jsonb_array_elements(r.input_snapshot->'subjects') s)
    ) THEN RAISE EXCEPTION '分析对象必须继承运行监测身份'
        USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_subjects'; END IF;
    -- 冻结创建时可见的事实资格：有权威依据的产品不得通过省略manifest伪装未知。
    FOR subject IN SELECT * FROM jsonb_array_elements(NEW.input_snapshot->'subjects')
        WHERE value->>'subject_type'='OWN_PRODUCT' LOOP
        SELECT id INTO eligible FROM fact_versions WHERE product_id=(subject->>'product_id')::uuid
            AND status='APPROVED' AND body_markdown ~ '[^[:space:]]' ORDER BY id LIMIT 1 FOR SHARE;
        IF eligible IS NOT NULL AND NOT EXISTS(
            SELECT 1 FROM jsonb_array_elements(NEW.input_snapshot->'fact_versions') b
                WHERE b->>'subject_id'=subject->>'id') THEN
            RAISE EXCEPTION '已有合格事实的自有产品必须冻结事实绑定'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_fact_required';
        END IF;
    END LOOP;
    IF (NEW.analyzer_type = 'DETERMINISTIC') <>
        (NEW.input_snapshot->'configuration'->'model_name' = 'null'::jsonb) THEN
        RAISE EXCEPTION '模型分析必须冻结完整模型与提示身份'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_configuration';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_analysis_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_analysis_revisions
    FOR EACH ROW EXECUTE FUNCTION geo_guard_analysis_revision();

CREATE FUNCTION geo_guard_analysis_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a geo_analysis_revisions%ROWTYPE; product uuid; f fact_versions%ROWTYPE;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION '分析子结果与事实绑定不可 UPDATE/DELETE'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_children_immutable';
    END IF;
    SELECT * INTO a FROM geo_analysis_revisions WHERE id=NEW.analysis_revision_id;
    IF NOT FOUND THEN RAISE EXCEPTION '分析不存在'
        USING ERRCODE='23503', CONSTRAINT='fk_geo_analysis_child'; END IF;
    PERFORM 1 FROM geo_observation_runs WHERE id=a.run_id FOR UPDATE;
    UPDATE geo_observation_runs SET revision=revision WHERE id=a.run_id;
    SELECT * INTO a FROM geo_analysis_revisions WHERE id=NEW.analysis_revision_id FOR UPDATE;
    IF a.status <> 'PENDING' THEN RAISE EXCEPTION '仅待完成分析可装配子结果'
        USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_children_open'; END IF;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.input_snapshot->'subjects') s
        WHERE s->>'id'=NEW.subject_id::text) THEN
        RAISE EXCEPTION '子结果对象不在分析快照内'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_child_subject';
    END IF;
    IF TG_TABLE_NAME='geo_analysis_fact_versions' THEN
        SELECT (s->>'product_id')::uuid INTO product FROM jsonb_array_elements(a.input_snapshot->'subjects') s
            WHERE s->>'id'=NEW.subject_id::text AND s->>'subject_type'='OWN_PRODUCT';
        SELECT * INTO f FROM fact_versions WHERE id=NEW.fact_version_id FOR SHARE;
        IF NOT FOUND OR product IS NULL OR f.product_id <> product OR f.status <> 'APPROVED'
            OR f.body_markdown !~ '[^[:space:]]' OR NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(a.input_snapshot->'fact_versions') b
                WHERE b->>'subject_id'=NEW.subject_id::text AND b->>'fact_version_id'=NEW.fact_version_id::text
            ) THEN RAISE EXCEPTION '分析事实必须是同产品非空 APPROVED 版本'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_fact_qualification'; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_analysis_fact_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_analysis_fact_versions
    FOR EACH ROW EXECUTE FUNCTION geo_guard_analysis_child();
CREATE TRIGGER geo_mention_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_entity_mentions
    FOR EACH ROW EXECUTE FUNCTION geo_guard_analysis_child();
CREATE TRIGGER geo_recommendation_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_recommendations
    FOR EACH ROW EXECUTE FUNCTION geo_guard_analysis_child();
CREATE TRIGGER geo_claim_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_claim_assessments
    FOR EACH ROW EXECUTE FUNCTION geo_guard_analysis_child();

CREATE FUNCTION geo_check_analysis_assembly() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity uuid; a geo_analysis_revisions%ROWTYPE;
BEGIN
    IF TG_TABLE_NAME='geo_analysis_revisions' THEN identity := NEW.id;
    ELSE identity := NEW.analysis_revision_id; END IF;
    SELECT * INTO a FROM geo_analysis_revisions WHERE id=identity;
    IF EXISTS (
        (SELECT b->>'subject_id',b->>'fact_version_id' FROM jsonb_array_elements(a.input_snapshot->'fact_versions') b
         EXCEPT SELECT subject_id::text,fact_version_id::text FROM geo_analysis_fact_versions WHERE analysis_revision_id=identity)
        UNION ALL
        (SELECT subject_id::text,fact_version_id::text FROM geo_analysis_fact_versions WHERE analysis_revision_id=identity
         EXCEPT SELECT b->>'subject_id',b->>'fact_version_id' FROM jsonb_array_elements(a.input_snapshot->'fact_versions') b)
    ) THEN RAISE EXCEPTION '输入事实 manifest 与强引用必须原子一致'
        USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_fact_manifest'; END IF;
    IF a.status <> 'COMPLETED' AND (
        EXISTS(SELECT 1 FROM geo_entity_mentions WHERE analysis_revision_id=identity) OR
        EXISTS(SELECT 1 FROM geo_recommendations WHERE analysis_revision_id=identity) OR
        EXISTS(SELECT 1 FROM geo_claim_assessments WHERE analysis_revision_id=identity)
    ) THEN RAISE EXCEPTION '子结果必须与 COMPLETED 分析同事务提交'
        USING ERRCODE='23514', CONSTRAINT='ck_geo_analysis_results_complete'; END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_analysis_assembly AFTER INSERT OR UPDATE ON geo_analysis_revisions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_analysis_assembly();
CREATE CONSTRAINT TRIGGER geo_analysis_facts_assembly AFTER INSERT ON geo_analysis_fact_versions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_analysis_assembly();
CREATE CONSTRAINT TRIGGER geo_mentions_assembly AFTER INSERT ON geo_entity_mentions
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_analysis_assembly();
CREATE CONSTRAINT TRIGGER geo_recommendations_assembly AFTER INSERT ON geo_recommendations
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_analysis_assembly();
CREATE CONSTRAINT TRIGGER geo_claims_assembly AFTER INSERT ON geo_claim_assessments
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_check_analysis_assembly();
