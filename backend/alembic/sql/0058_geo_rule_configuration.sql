-- GEO-701：冻结数据库校验，不导入可变运行时 Schema。
CREATE FUNCTION geo_rule_number_valid(v jsonb, lo numeric, hi numeric, integral boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n numeric;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
 n := v::numeric;
 RETURN n >= lo AND n <= hi AND (NOT integral OR (n = trunc(n) AND v::text ~ '^(0|[1-9][0-9]*)$'));
END $$;
CREATE FUNCTION geo_rule_object_keys(v jsonb, keys text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 RETURN v ?& keys AND (SELECT count(*) FROM jsonb_object_keys(v)) = cardinality(keys);
END $$;
CREATE FUNCTION geo_rule_configuration_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF NOT geo_rule_object_keys(v,ARRAY['sample_policy','visibility_drop_points','recommendation_drop_points','competitor_surge_points','own_citation_previous_count','repeated_error_minimum_runs','repeated_error_window_days','unstable_minimum_repeats','stability_minimum_rate','dedup_window_days','data_quality_minimum_success_rate','data_quality_minimum_evidence_rate','run_failure_consecutive_limit','recovery'])
 OR NOT geo_rule_object_keys(v->'sample_policy',ARRAY['reportable_minimum','stable_minimum'])
 OR NOT geo_rule_object_keys(v->'recovery',ARRAY['minimum_runs','visibility_drop_max_points','recommendation_drop_max_points','competitor_surge_max_points','topic_visibility_minimum_rate','owned_citation_minimum_count','stability_minimum_rate','fact_error_max_count','strict_comparability_required','manual_confirmation_required']) THEN RETURN false; END IF;
 IF NOT (geo_rule_number_valid(v->'visibility_drop_points', 0, 1, false) AND geo_rule_number_valid(v->'recommendation_drop_points', 0, 1, false) AND geo_rule_number_valid(v->'competitor_surge_points', 0, 1, false) AND geo_rule_number_valid(v->'own_citation_previous_count', 1, 10000, true) AND geo_rule_number_valid(v->'repeated_error_minimum_runs', 1, 10000, true) AND geo_rule_number_valid(v->'repeated_error_window_days', 1, 365, true) AND geo_rule_number_valid(v->'unstable_minimum_repeats', 1, 10000, true) AND geo_rule_number_valid(v->'stability_minimum_rate', 0, 1, false) AND geo_rule_number_valid(v->'dedup_window_days', 1, 365, true) AND (v->'data_quality_minimum_success_rate' = 'null'::jsonb OR geo_rule_number_valid(v->'data_quality_minimum_success_rate', 0, 1, false)) AND (v->'data_quality_minimum_evidence_rate' = 'null'::jsonb OR geo_rule_number_valid(v->'data_quality_minimum_evidence_rate', 0, 1, false)) AND (v->'run_failure_consecutive_limit' = 'null'::jsonb OR geo_rule_number_valid(v->'run_failure_consecutive_limit', 1, 10000, true))) THEN RETURN false; END IF;
 -- 先校验类型，避免在错误 JSON 上执行 cast。
 IF NOT (geo_rule_number_valid(v->'sample_policy'->'reportable_minimum',2,10000,true) AND geo_rule_number_valid(v->'sample_policy'->'stable_minimum',2,10000,true)) THEN RETURN false; END IF;
 RETURN (v->'sample_policy'->>'reportable_minimum')::numeric < (v->'sample_policy'->>'stable_minimum')::numeric AND geo_rule_number_valid(v->'recovery'->'minimum_runs',1,10000,true) AND geo_rule_number_valid(v->'recovery'->'visibility_drop_max_points',0,1,false) AND geo_rule_number_valid(v->'recovery'->'recommendation_drop_max_points',0,1,false) AND geo_rule_number_valid(v->'recovery'->'competitor_surge_max_points',0,1,false) AND geo_rule_number_valid(v->'recovery'->'topic_visibility_minimum_rate',0,1,false) AND geo_rule_number_valid(v->'recovery'->'owned_citation_minimum_count',1,10000,true) AND geo_rule_number_valid(v->'recovery'->'stability_minimum_rate',0,1,false) AND geo_rule_number_valid(v->'recovery'->'fact_error_max_count',0,0,true) AND v->'recovery'->'strict_comparability_required' = 'true'::jsonb AND v->'recovery'->'manual_confirmation_required' = 'true'::jsonb;
END $$;
CREATE TABLE geo_rule_set_revisions (
 revision integer PRIMARY KEY CONSTRAINT ck_geo_rule_revision_positive CHECK (revision >= 1),
 configuration jsonb NOT NULL CONSTRAINT ck_geo_rule_configuration_object CHECK (jsonb_typeof(configuration) = 'object')
 CONSTRAINT ck_geo_rule_configuration_valid CHECK (geo_rule_configuration_valid(configuration)),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid REFERENCES users(id) ON DELETE RESTRICT
);
CREATE TABLE geo_rule_set_current (
 id integer PRIMARY KEY CONSTRAINT ck_geo_rule_current_singleton CHECK (id=1),
 revision integer NOT NULL REFERENCES geo_rule_set_revisions(revision) ON DELETE RESTRICT
);
INSERT INTO geo_rule_set_revisions(revision,configuration) VALUES (1,'{"sample_policy":{"reportable_minimum":3,"stable_minimum":5},"visibility_drop_points":0.1,"recommendation_drop_points":0.1,"competitor_surge_points":0.15,"own_citation_previous_count":2,"repeated_error_minimum_runs":3,"repeated_error_window_days":30,"unstable_minimum_repeats":3,"stability_minimum_rate":0.67,"dedup_window_days":30,"data_quality_minimum_success_rate":null,"data_quality_minimum_evidence_rate":null,"run_failure_consecutive_limit":null,"recovery":{"minimum_runs":5,"visibility_drop_max_points":0.0,"recommendation_drop_max_points":0.0,"competitor_surge_max_points":0.0,"topic_visibility_minimum_rate":0.6,"owned_citation_minimum_count":1,"stability_minimum_rate":0.67,"fact_error_max_count":0,"strict_comparability_required":true,"manual_confirmation_required":true}}'::jsonb);
INSERT INTO geo_rule_set_current(id,revision) VALUES(1,1);
CREATE FUNCTION geo_rule_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'GEO规则历史不可修改、删除或截断' USING ERRCODE='23514',CONSTRAINT='ck_geo_rule_history_immutable'; END $$;
CREATE TRIGGER geo_rule_history_immutable BEFORE UPDATE OR DELETE ON geo_rule_set_revisions FOR EACH ROW EXECUTE FUNCTION geo_rule_history_immutable();
CREATE TRIGGER geo_rule_history_no_truncate BEFORE TRUNCATE ON geo_rule_set_revisions FOR EACH STATEMENT EXECUTE FUNCTION geo_rule_history_immutable();
CREATE FUNCTION geo_rule_current_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'UPDATE' THEN RAISE EXCEPTION 'GEO当前规则指针不可删除或截断' USING ERRCODE='23514'; END IF;
 IF NEW.id <> OLD.id OR NEW.revision <> OLD.revision+1 THEN RAISE EXCEPTION 'GEO规则revision必须逐次递增' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER geo_rule_current_guard BEFORE UPDATE OR DELETE ON geo_rule_set_current FOR EACH ROW EXECUTE FUNCTION geo_rule_current_guard();
CREATE TRIGGER geo_rule_current_no_truncate BEFORE TRUNCATE ON geo_rule_set_current FOR EACH STATEMENT EXECUTE FUNCTION geo_rule_current_guard();

-- 保留已存在 v1 的完整历史验证合同；新 v2 额外验证完整配置。
CREATE FUNCTION geo_batch_snapshots_v1_valid(p jsonb, r jsonb, source uuid) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; identity jsonb;
BEGIN
    IF NOT geo_run_snapshot_object(p, ARRAY['schema_version','plan_id','plan_revision',
            'name','description','subjects','prompt_variant_ids','collection_profile_ids',
            'repeat_count','schedule_kind','cron_expression','timezone','budget_limit','rule_set_revision'])
        OR NOT geo_snapshot_strings(p, ARRAY['name','description','schedule_kind','timezone'],
            ARRAY['cron_expression','budget_limit'])
        OR NOT geo_snapshot_uuids(p, ARRAY[]::text[], ARRAY['plan_id'])
        OR NOT geo_run_snapshot_object(r, ARRAY['schema_version','rule_set_revision'])
        OR p->'schema_version' IS DISTINCT FROM '1'::jsonb
        OR r->'schema_version' IS DISTINCT FROM '1'::jsonb
        OR r->'rule_set_revision' IS DISTINCT FROM p->'rule_set_revision'
        OR jsonb_typeof(r->'rule_set_revision') IS DISTINCT FROM 'number'
        OR COALESCE(r->>'rule_set_revision' !~ '^[1-9][0-9]*$',true)
        OR ((source IS NULL) <> (p->'plan_id' = 'null'::jsonb))
        OR (source IS NOT NULL AND p->>'plan_id' IS DISTINCT FROM source::text)
        OR ((p->'plan_id' = 'null'::jsonb) <> (p->'plan_revision' = 'null'::jsonb))
        OR (source IS NOT NULL AND (jsonb_typeof(p->'plan_revision') <> 'number'
            OR p->>'plan_revision' !~ '^(0|[1-9][0-9]*)$'))
        OR jsonb_typeof(p->'subjects') IS DISTINCT FROM 'array'
        OR jsonb_typeof(p->'prompt_variant_ids') IS DISTINCT FROM 'array'
        OR jsonb_typeof(p->'collection_profile_ids') IS DISTINCT FROM 'array'
        THEN RETURN false; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(p->'subjects') LOOP
        IF NOT geo_run_snapshot_object(item, ARRAY['subject_id','role'])
            OR NOT geo_snapshot_uuids(item, ARRAY['subject_id'])
            OR NOT geo_snapshot_strings(item, ARRAY['role']) THEN RETURN false; END IF;
    END LOOP;
    FOR identity IN SELECT * FROM jsonb_array_elements(p->'prompt_variant_ids')
        UNION ALL SELECT * FROM jsonb_array_elements(p->'collection_profile_ids') LOOP
        IF NOT geo_snapshot_uuids(jsonb_build_object('id', identity), ARRAY['id'])
            THEN RETURN false; END IF;
    END LOOP;
    RETURN COALESCE(jsonb_array_length(p->'subjects') > 0
        AND jsonb_array_length(p->'prompt_variant_ids') > 0
        AND jsonb_array_length(p->'collection_profile_ids') > 0
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(p->'subjects') s WHERE s->>'role'='PRIMARY')
        AND jsonb_typeof(p->'repeat_count') = 'number'
        AND p->>'repeat_count' ~ '^([1-9]|10)$', false);
END $$;

CREATE OR REPLACE FUNCTION geo_batch_snapshots_valid(p jsonb, r jsonb, source uuid) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF r->'schema_version' = '2'::jsonb THEN
  IF NOT geo_rule_configuration_valid(r->'configuration') THEN RETURN false; END IF;
  RETURN geo_batch_snapshots_v1_valid(p, (r-'configuration') || '{"schema_version":1}'::jsonb, source);
 END IF;
 RETURN geo_batch_snapshots_v1_valid(p,r,source);
END $$;
CREATE FUNCTION geo_batch_rule_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actual jsonb;
BEGIN
 IF NEW.rule_snapshot->'schema_version' = '2'::jsonb THEN
  SELECT configuration INTO actual FROM geo_rule_set_revisions
   WHERE revision=(NEW.rule_snapshot->>'rule_set_revision')::integer;
  IF actual IS DISTINCT FROM NEW.rule_snapshot->'configuration' THEN
   RAISE EXCEPTION '批次规则快照必须来自不可变规则revision'
    USING ERRCODE='23514',CONSTRAINT='ck_geo_batch_rule_revision';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER geo_batch_rule_revision_guard BEFORE INSERT ON geo_observation_batches
 FOR EACH ROW EXECUTE FUNCTION geo_batch_rule_revision_guard();

-- 既有v1历史/重试保持；v2新Run必须继承父批次实际规则revision。
CREATE FUNCTION geo_run_rule_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rules jsonb;
BEGIN
 SELECT rule_snapshot INTO rules FROM geo_observation_batches WHERE id=NEW.batch_id;
 IF rules->'schema_version' = '2'::jsonb
  AND NEW.input_snapshot->'rule_set_revision' IS DISTINCT FROM rules->'rule_set_revision' THEN
  RAISE EXCEPTION '运行规则revision必须与父批次一致'
   USING ERRCODE='23514',CONSTRAINT='ck_geo_run_rule_revision';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER geo_run_rule_revision_guard BEFORE INSERT ON geo_observation_runs
 FOR EACH ROW EXECUTE FUNCTION geo_run_rule_revision_guard();
