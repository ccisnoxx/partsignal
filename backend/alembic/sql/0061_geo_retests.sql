-- 旧RETEST没有可证明的actor/key/revision回执，禁止补造；锁住写入口避免预检后竞态。
LOCK TABLE geo_observation_batches IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM geo_observation_batches WHERE trigger_type='RETEST') THEN
    RAISE EXCEPTION '0061存在无严格复测回执的历史RETEST；保留历史并使用前向修复'
      USING ERRCODE='55000';
  END IF;
END $$;

CREATE FUNCTION geo_retest_snapshot_valid(s jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb; ids text[] := '{}';
BEGIN
  IF NOT geo_run_snapshot_object(s,ARRAY['schema_version','opportunity_id','baseline_batch_id',
      'trigger_snapshot','plan_snapshot','rule_snapshot','cells'])
    OR s->'schema_version' IS DISTINCT FROM '1'::jsonb
    OR NOT geo_snapshot_uuids(s,ARRAY['opportunity_id','baseline_batch_id'])
    OR NOT geo_opportunity_snapshot_valid(s->'trigger_snapshot')
    OR NOT geo_batch_snapshots_valid(s->'plan_snapshot',s->'rule_snapshot',
      (s->'plan_snapshot'->>'plan_id')::uuid)
    OR jsonb_typeof(s->'cells') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(s->'cells') < 1 THEN RETURN false; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(s->'cells') LOOP
    IF NOT geo_run_snapshot_object(c,ARRAY['root_run_id','repeat_index','input_snapshot',
        'answer_snapshot_id','source_product','source_model','source_version'])
      OR NOT geo_snapshot_uuids(c,ARRAY['root_run_id'],ARRAY['answer_snapshot_id'])
      OR NOT geo_snapshot_strings(c,ARRAY[]::text[],
        ARRAY['source_product','source_model','source_version'])
      OR NOT geo_run_input_valid(c->'input_snapshot')
      OR jsonb_typeof(c->'repeat_index') IS DISTINCT FROM 'number'
      OR c->>'repeat_index' !~ '^([1-9]|10)$'
      OR c->>'root_run_id'=ANY(ids) THEN RETURN false; END IF;
    ids := array_append(ids,c->>'root_run_id');
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE geo_retest_baselines (
  id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  baseline_batch_id uuid NOT NULL,
  created_by uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_geo_retest_baselines PRIMARY KEY(id),
  CONSTRAINT uq_geo_retest_baseline UNIQUE(opportunity_id,baseline_batch_id),
  CONSTRAINT ck_geo_retest_baseline_snapshot CHECK(geo_retest_snapshot_valid(snapshot)),
  CONSTRAINT fk_geo_retest_baseline_opportunity FOREIGN KEY(opportunity_id)
    REFERENCES geo_opportunities(id) ON DELETE RESTRICT,
  CONSTRAINT fk_geo_retest_baseline_batch FOREIGN KEY(baseline_batch_id)
    REFERENCES geo_observation_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_geo_retest_baseline_creator FOREIGN KEY(created_by)
    REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE geo_retest_requests (
  id uuid NOT NULL,
  baseline_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  created_by uuid NOT NULL,
  request_key_sha256 varchar(64) NOT NULL,
  request_sha256 varchar(64) NOT NULL,
  opportunity_revision_after integer NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_geo_retest_requests PRIMARY KEY(id),
  CONSTRAINT uq_geo_retest_request_key UNIQUE(created_by,request_key_sha256),
  CONSTRAINT uq_geo_retest_request_batch UNIQUE(batch_id),
  CONSTRAINT ck_geo_retest_request_hashes CHECK(request_key_sha256 ~ '^[0-9a-f]{64}$'
    AND request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_geo_retest_request_revision CHECK(opportunity_revision_after >= 1),
  CONSTRAINT fk_geo_retest_request_baseline FOREIGN KEY(baseline_id)
    REFERENCES geo_retest_baselines(id) ON DELETE RESTRICT,
  CONSTRAINT fk_geo_retest_request_batch FOREIGN KEY(batch_id)
    REFERENCES geo_observation_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_geo_retest_request_creator FOREIGN KEY(created_by)
    REFERENCES users(id) ON DELETE RESTRICT
);

CREATE FUNCTION geo_retest_baseline_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o geo_opportunities; b geo_observation_batches; c jsonb;
  r geo_observation_runs; a geo_answer_snapshots;
BEGIN
  SELECT * INTO o FROM geo_opportunities WHERE id=NEW.opportunity_id;
  SELECT * INTO b FROM geo_observation_batches WHERE id=NEW.baseline_batch_id;
  IF NOT geo_retest_snapshot_valid(NEW.snapshot) OR o.id IS NULL OR b.id IS NULL
    OR NEW.snapshot->>'opportunity_id' IS DISTINCT FROM NEW.opportunity_id::text
    OR NEW.snapshot->>'baseline_batch_id' IS DISTINCT FROM NEW.baseline_batch_id::text
    OR NEW.snapshot->'trigger_snapshot' IS DISTINCT FROM o.trigger_snapshot
    OR NEW.snapshot->'plan_snapshot' IS DISTINCT FROM b.plan_snapshot
    OR NEW.snapshot->'rule_snapshot' IS DISTINCT FROM b.rule_snapshot
    OR b.status NOT IN ('COMPLETED','PARTIAL','FAILED','CANCELLED','BUDGET_BLOCKED')
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o.trigger_snapshot->'sources') source
      JOIN geo_observation_runs run ON run.id=(source->>'run_id')::uuid
      WHERE run.batch_id=b.id AND source->>'source_role' NOT IN ('BASELINE','RETEST'))
    OR jsonb_array_length(NEW.snapshot->'cells') <> b.requested_run_count
    OR (SELECT count(*) FROM geo_observation_runs WHERE batch_id=b.id AND attempt_no=1)
      <> b.requested_run_count THEN
    RAISE EXCEPTION '复测基线必须完整匹配首次触发来源与已封存批次'
      USING ERRCODE='23514',CONSTRAINT='ck_geo_retest_baseline_source';
  END IF;
  -- 历史输入不可变；不锁Batch/Run，避免配置→Opportunity与worker配置→Batch锁序反转。
  FOR c IN SELECT value FROM jsonb_array_elements(NEW.snapshot->'cells') LOOP
    SELECT * INTO r FROM geo_observation_runs
      WHERE id=(c->>'root_run_id')::uuid AND batch_id=b.id AND attempt_no=1;
    IF r.id IS NULL OR c->'input_snapshot' IS DISTINCT FROM r.input_snapshot
      OR (c->>'repeat_index')::integer IS DISTINCT FROM r.repeat_index THEN
      RAISE EXCEPTION '复测基线单元必须匹配实际根输入'
        USING ERRCODE='23514',CONSTRAINT='ck_geo_retest_baseline_cell';
    END IF;
    SELECT answer.* INTO a FROM geo_observation_runs latest
      LEFT JOIN geo_answer_snapshots answer ON answer.run_id=latest.id
      WHERE latest.batch_id=b.id AND latest.run_cell_key=r.run_cell_key
      ORDER BY latest.attempt_no DESC LIMIT 1;
    IF (c->>'answer_snapshot_id')::uuid IS DISTINCT FROM a.id
      OR c->>'source_product' IS DISTINCT FROM a.source_product
      OR c->>'source_model' IS DISTINCT FROM a.source_model
      OR c->>'source_version' IS DISTINCT FROM a.source_version THEN
      RAISE EXCEPTION '复测基线版本必须来自该单元最新尝试的真实回答'
        USING ERRCODE='23514',CONSTRAINT='ck_geo_retest_baseline_answer';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER geo_retest_baseline_guard BEFORE INSERT ON geo_retest_baselines
  FOR EACH ROW EXECUTE FUNCTION geo_retest_baseline_guard();

CREATE FUNCTION geo_retest_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE baseline geo_retest_baselines; b geo_observation_batches; o geo_opportunities;
BEGIN
  SELECT * INTO baseline FROM geo_retest_baselines WHERE id=NEW.baseline_id;
  SELECT * INTO o FROM geo_opportunities WHERE id=baseline.opportunity_id FOR UPDATE;
  SELECT * INTO b FROM geo_observation_batches WHERE id=NEW.batch_id;
  IF baseline.id IS NULL OR o.id IS NULL OR o.status <> 'IN_PROGRESS'
    OR o.revision IS DISTINCT FROM NEW.opportunity_revision_after OR b.id IS NULL
    OR b.trigger_type <> 'RETEST' OR b.source_opportunity_id IS DISTINCT FROM o.id
    OR b.baseline_batch_id IS DISTINCT FROM baseline.baseline_batch_id
    OR b.created_by IS DISTINCT FROM NEW.created_by THEN
    RAISE EXCEPTION '复测回执必须匹配锁定的机会修订与批次身份'
      USING ERRCODE='23514',CONSTRAINT='ck_geo_retest_request_identity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER geo_retest_request_guard BEFORE INSERT ON geo_retest_requests
  FOR EACH ROW EXECUTE FUNCTION geo_retest_request_guard();

CREATE FUNCTION geo_retest_matrix_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE batch_id uuid; b geo_observation_batches; receipt geo_retest_requests;
  baseline geo_retest_baselines; source geo_observation_batches;
BEGIN
  IF TG_TABLE_NAME='geo_observation_batches' THEN batch_id := NEW.id;
  ELSE batch_id := NEW.batch_id; END IF;
  SELECT * INTO b FROM geo_observation_batches WHERE id=batch_id;
  IF b.trigger_type <> 'RETEST' THEN RETURN NULL; END IF;
  SELECT * INTO receipt FROM geo_retest_requests WHERE geo_retest_requests.batch_id=b.id;
  SELECT * INTO baseline FROM geo_retest_baselines WHERE id=receipt.baseline_id;
  SELECT * INTO source FROM geo_observation_batches WHERE id=baseline.baseline_batch_id;
  IF receipt.id IS NULL OR baseline.id IS NULL OR source.id IS NULL
    OR b.source_opportunity_id IS DISTINCT FROM baseline.opportunity_id
    OR b.baseline_batch_id IS DISTINCT FROM baseline.baseline_batch_id
    OR b.created_by IS DISTINCT FROM receipt.created_by
    OR b.plan_id IS DISTINCT FROM source.plan_id
    OR b.plan_snapshot IS DISTINCT FROM baseline.snapshot->'plan_snapshot'
    OR b.rule_snapshot IS DISTINCT FROM baseline.snapshot->'rule_snapshot'
    OR b.requested_run_count IS DISTINCT FROM jsonb_array_length(baseline.snapshot->'cells')
    OR (SELECT count(*) FROM geo_observation_runs WHERE geo_observation_runs.batch_id=b.id
      AND attempt_no=1) <> b.requested_run_count
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(baseline.snapshot->'cells') c
      WHERE NOT EXISTS(SELECT 1 FROM geo_observation_runs r WHERE r.batch_id=b.id AND r.attempt_no=1
        AND r.repeat_index=(c->>'repeat_index')::integer
        AND r.input_snapshot=c->'input_snapshot')) THEN
    RAISE EXCEPTION 'RETEST必须有回执且逐项复制完整基线矩阵与规则'
      USING ERRCODE='23514',CONSTRAINT='ck_geo_retest_matrix';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_retest_batch_complete AFTER INSERT ON geo_observation_batches
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_retest_matrix_required();
CREATE CONSTRAINT TRIGGER geo_retest_request_complete AFTER INSERT ON geo_retest_requests
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_retest_matrix_required();
-- receipt之后的root追加也必须验证最终集合，不能依赖receipt INSERT时的数量。
CREATE CONSTRAINT TRIGGER geo_retest_root_complete AFTER INSERT ON geo_observation_runs
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.attempt_no=1)
  EXECUTE FUNCTION geo_retest_matrix_required();

CREATE FUNCTION geo_retest_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '复测基线与回执历史不可修改或删除' USING ERRCODE='55000';
END $$;
CREATE TRIGGER geo_retest_baseline_immutable BEFORE UPDATE OR DELETE ON geo_retest_baselines
  FOR EACH ROW EXECUTE FUNCTION geo_retest_immutable();
CREATE TRIGGER geo_retest_request_immutable BEFORE UPDATE OR DELETE ON geo_retest_requests
  FOR EACH ROW EXECUTE FUNCTION geo_retest_immutable();
CREATE TRIGGER geo_retest_baseline_no_truncate BEFORE TRUNCATE ON geo_retest_baselines
  FOR EACH STATEMENT EXECUTE FUNCTION geo_retest_immutable();
CREATE TRIGGER geo_retest_request_no_truncate BEFORE TRUNCATE ON geo_retest_requests
  FOR EACH STATEMENT EXECUTE FUNCTION geo_retest_immutable();
