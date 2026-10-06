-- 加法迁移，不猜测或回填旧机会的解决依据。PostgreSQL JSONB 是指纹的规范序列化者。
CREATE FUNCTION geo_retest_comparison_fingerprint(s jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT encode(sha256(convert_to((s - 'fingerprint')::text, 'UTF8')), 'hex')
$$;

CREATE TABLE geo_opportunity_decisions (
  id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  decision varchar(20) NOT NULL,
  reason_code varchar(40) NOT NULL,
  reason_comment text NOT NULL,
  revision_before integer NOT NULL,
  revision_after integer NOT NULL,
  baseline_id uuid,
  retest_batch_id uuid,
  comparison_fingerprint varchar(64),
  comparison_snapshot jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT pk_geo_opportunity_decisions PRIMARY KEY(id),
  CONSTRAINT uq_geo_opportunity_decision_revision UNIQUE(opportunity_id,revision_after),
  CONSTRAINT ck_geo_opportunity_decision_kind CHECK(decision IN ('MANUAL_RESOLVE','RETEST_RESOLVE','CONTINUE')),
  CONSTRAINT ck_geo_opportunity_decision_revision CHECK(revision_before >= 1 AND revision_after=revision_before+1),
  CONSTRAINT ck_geo_opportunity_decision_reason CHECK(length(btrim(reason_code))>0 AND length(btrim(reason_comment))>0),
  CONSTRAINT ck_geo_opportunity_decision_comparison CHECK(
    (baseline_id IS NULL AND retest_batch_id IS NULL AND comparison_fingerprint IS NULL
      AND comparison_snapshot IS NULL AND decision<>'RETEST_RESOLVE') OR
    (baseline_id IS NOT NULL AND retest_batch_id IS NOT NULL
      AND comparison_fingerprint ~ '^[0-9a-f]{64}$'
      AND comparison_snapshot IS NOT NULL AND decision<>'MANUAL_RESOLVE')),
  CONSTRAINT fk_geo_decision_opportunity FOREIGN KEY(opportunity_id) REFERENCES geo_opportunities(id) ON DELETE RESTRICT,
  CONSTRAINT fk_geo_decision_baseline FOREIGN KEY(baseline_id) REFERENCES geo_retest_baselines(id) ON DELETE RESTRICT,
  CONSTRAINT fk_geo_decision_retest FOREIGN KEY(retest_batch_id) REFERENCES geo_observation_batches(id) ON DELETE RESTRICT,
  CONSTRAINT fk_geo_decision_creator FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE FUNCTION geo_opportunity_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o geo_opportunities; b geo_retest_baselines; r geo_retest_requests; s jsonb;
BEGIN
  SELECT * INTO o FROM geo_opportunities WHERE id=NEW.opportunity_id FOR UPDATE;
  IF o.id IS NULL OR o.revision IS DISTINCT FROM NEW.revision_after
    OR (NEW.decision='CONTINUE' AND o.status<>'IN_PROGRESS')
    OR (NEW.decision<>'CONTINUE' AND (o.status<>'RESOLVED'
      OR o.resolved_by IS DISTINCT FROM NEW.created_by
      OR o.resolution_code IS DISTINCT FROM NEW.reason_code
      OR o.resolution_comment IS DISTINCT FROM NEW.reason_comment)) THEN
    RAISE EXCEPTION '处理历史必须匹配机会状态、操作者和修订'
      USING ERRCODE='23514',CONSTRAINT='ck_geo_decision_identity';
  END IF;
  NEW.created_at := clock_timestamp();
  s := NEW.comparison_snapshot;
  IF s IS NOT NULL THEN
    SELECT * INTO b FROM geo_retest_baselines WHERE id=NEW.baseline_id;
    SELECT * INTO r FROM geo_retest_requests WHERE batch_id=NEW.retest_batch_id;
    IF b.id IS NULL OR b.opportunity_id IS DISTINCT FROM o.id
      OR r.baseline_id IS DISTINCT FROM b.id
      OR s->>'baseline_id' IS DISTINCT FROM b.id::text
      OR s->>'retest_batch_id' IS DISTINCT FROM r.batch_id::text
      OR s->'baseline'->>'batch_id' IS DISTINCT FROM b.baseline_batch_id::text
      OR s->'retest'->>'batch_id' IS DISTINCT FROM r.batch_id::text
      OR s->>'fingerprint' IS DISTINCT FROM NEW.comparison_fingerprint
      OR geo_retest_comparison_fingerprint(s) IS DISTINCT FROM NEW.comparison_fingerprint
      OR s->>'causal_claim' IS DISTINCT FROM 'NOT_ESTABLISHED'
      OR (NEW.decision='RETEST_RESOLVE' AND (s->>'comparable' IS DISTINCT FROM 'true'
        OR s->'recovery'->>'status' IS DISTINCT FROM 'RECOVERED')) THEN
      RAISE EXCEPTION '处理比较必须绑定真实基线、复测及完整证据指纹'
        USING ERRCODE='23514',CONSTRAINT='ck_geo_decision_comparison_identity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER geo_opportunity_decision_guard BEFORE INSERT ON geo_opportunity_decisions
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_decision_guard();

CREATE FUNCTION geo_opportunity_resolution_decision_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='IN_PROGRESS' AND NEW.status='RESOLVED' AND NOT EXISTS(
    SELECT 1 FROM geo_opportunity_decisions WHERE opportunity_id=NEW.id
      AND revision_before=OLD.revision AND revision_after=NEW.revision
      AND decision IN ('MANUAL_RESOLVE','RETEST_RESOLVE')) THEN
    RAISE EXCEPTION '解决机会必须同事务保存显式处理依据'
      USING ERRCODE='23514',CONSTRAINT='ck_geo_resolution_decision_required';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_opportunity_resolution_decision_required
  AFTER UPDATE ON geo_opportunities DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_resolution_decision_required();

CREATE FUNCTION geo_opportunity_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '机会处理历史不可修改、删除或清空' USING ERRCODE='55000'; END $$;
CREATE TRIGGER geo_opportunity_decision_immutable BEFORE UPDATE OR DELETE ON geo_opportunity_decisions
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_decision_immutable();
CREATE TRIGGER geo_opportunity_decision_no_truncate BEFORE TRUNCATE ON geo_opportunity_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION geo_opportunity_decision_immutable();
