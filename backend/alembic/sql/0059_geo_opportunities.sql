-- 冻结0059合同；不能借运行时ORM重写历史迁移。
CREATE FUNCTION geo_opportunity_snapshot_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE cfg jsonb; s jsonb;
BEGIN
  IF NOT geo_rule_object_keys(v, ARRAY['schema_version','rule_snapshot','rule_code','scope',
    'source_date_from','source_date_to','triggered','priority','value','threshold','numerator',
    'denominator','unavailable_reasons','sources','details']) OR v->'schema_version' <> '1'::jsonb
    OR NOT geo_rule_object_keys(v->'rule_snapshot', ARRAY['schema_version','rule_set_revision','configuration'])
    OR v->'rule_snapshot'->'schema_version' <> '1'::jsonb
    OR NOT geo_rule_number_valid(v->'rule_snapshot'->'rule_set_revision',1,2147483647,true)
    OR NOT geo_rule_configuration_valid(v->'rule_snapshot'->'configuration')
    OR NOT geo_rule_object_keys(v->'scope',ARRAY['subject_id','query_topic_id','prompt_variant_id',
      'collection_profile_id','engine_surface_id','batch_id','environment_key'])
    OR jsonb_typeof(v->'scope'->'environment_key') <> 'string'
    OR jsonb_typeof(v->'rule_code') <> 'string' OR jsonb_typeof(v->'priority') <> 'string'
    OR jsonb_typeof(v->'source_date_from') <> 'string' OR jsonb_typeof(v->'source_date_to') <> 'string'
    OR v->'scope'->>'environment_key' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(v->'triggered') <> 'boolean'
    OR v->>'priority' NOT IN ('LOW','MEDIUM','HIGH','CRITICAL')
    OR v->>'rule_code' NOT IN ('VISIBILITY_DROP','RECOMMENDATION_DROP','COMPETITOR_SURGE',
      'TOPIC_COVERAGE_GAP','OWN_CITATION_LOST','CRITICAL_FACT_ERROR','REPEATED_FACT_ERROR',
      'UNSTABLE_RESULT','DATA_QUALITY_PROBLEM','RUN_FAILURE')
    OR NOT geo_rule_number_valid(v->'numerator',0,2147483647,true)
    OR NOT geo_rule_number_valid(v->'denominator',0,2147483647,true)
    OR (v->'value' <> 'null'::jsonb AND jsonb_typeof(v->'value') <> 'number')
    OR (v->'threshold' <> 'null'::jsonb AND jsonb_typeof(v->'threshold') <> 'number')
    OR jsonb_typeof(v->'sources') <> 'array'
    OR jsonb_typeof(v->'unavailable_reasons') <> 'array'
    OR jsonb_typeof(v->'details') <> 'object'
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v->'unavailable_reasons') r
       WHERE jsonb_typeof(r) <> 'string' OR length(btrim(r #>> '{}')) = 0)
    OR (v->>'source_date_from')::timestamptz >= (v->>'source_date_to')::timestamptz
    OR (v->>'triggered')::boolean AND (v->'value' = 'null'::jsonb
       OR jsonb_array_length(v->'sources') = 0 OR jsonb_array_length(v->'unavailable_reasons') <> 0)
    THEN RETURN false; END IF;
  SELECT configuration INTO cfg FROM geo_rule_set_revisions
    WHERE revision = (v->'rule_snapshot'->>'rule_set_revision')::integer;
  IF cfg IS NULL OR cfg <> v->'rule_snapshot'->'configuration' THEN RETURN false; END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(v->'sources') LOOP
    IF NOT geo_rule_object_keys(s,ARRAY['run_id','analysis_revision_id','review_id','source_role'])
      OR jsonb_typeof(s->'source_role') <> 'string' OR s->>'source_role' NOT IN ('TRIGGER','SUPPORTING','BASELINE','RETEST')
      OR s->>'run_id' IS NULL THEN RETURN false; END IF;
    PERFORM (s->>'run_id')::uuid, (s->>'analysis_revision_id')::uuid, (s->>'review_id')::uuid;
  END LOOP;
  RETURN true;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR datetime_field_overflow OR invalid_datetime_format
  THEN RETURN false;
END $$;

CREATE TABLE geo_opportunities (
	id UUID NOT NULL,
	identity_key VARCHAR(64) NOT NULL,
	rule_code VARCHAR(100) NOT NULL,
	priority VARCHAR(16) NOT NULL,
	status VARCHAR(20) DEFAULT 'OPEN' NOT NULL,
	subject_id UUID,
	query_topic_id UUID,
	prompt_variant_id UUID,
	collection_profile_id UUID,
	engine_surface_id UUID,
	batch_id UUID,
	trigger_snapshot JSONB NOT NULL,
	source_date_from TIMESTAMP WITH TIME ZONE NOT NULL,
	source_date_to TIMESTAMP WITH TIME ZONE NOT NULL,
	revision INTEGER DEFAULT '1' NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	acknowledged_at TIMESTAMP WITH TIME ZONE,
	acknowledged_by UUID,
	resolved_at TIMESTAMP WITH TIME ZONE,
	resolved_by UUID,
	resolution_code VARCHAR(40),
	resolution_comment TEXT,
	CONSTRAINT pk_geo_opportunities PRIMARY KEY (id),
	CONSTRAINT ck_geo_opportunity_identity CHECK (identity_key ~ '^[0-9a-f]{64}$'),
	CONSTRAINT ck_geo_opportunity_rule CHECK (rule_code IN ('VISIBILITY_DROP','RECOMMENDATION_DROP','COMPETITOR_SURGE','TOPIC_COVERAGE_GAP','OWN_CITATION_LOST','CRITICAL_FACT_ERROR','REPEATED_FACT_ERROR','UNSTABLE_RESULT','DATA_QUALITY_PROBLEM','RUN_FAILURE')),
	CONSTRAINT ck_geo_opportunity_priority CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
	CONSTRAINT ck_geo_opportunity_status CHECK (status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DISMISSED')),
	CONSTRAINT ck_geo_opportunity_revision CHECK (revision >= 1),
	CONSTRAINT ck_geo_opportunity_dates CHECK (source_date_from < source_date_to AND last_seen_at >= created_at),
	CONSTRAINT ck_geo_opportunity_snapshot CHECK (geo_opportunity_snapshot_valid(trigger_snapshot) AND trigger_snapshot->>'triggered' = 'true'),
	CONSTRAINT ck_geo_opportunity_resolution CHECK ((status NOT IN ('ACKNOWLEDGED','IN_PROGRESS','RESOLVED') OR (acknowledged_at IS NOT NULL AND acknowledged_by IS NOT NULL)) AND ((status IN ('RESOLVED','DISMISSED') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_code IS NOT NULL AND resolution_comment IS NOT NULL AND length(btrim(resolution_code)) > 0 AND length(btrim(resolution_comment)) > 0) OR (status NOT IN ('RESOLVED','DISMISSED') AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_code IS NULL AND resolution_comment IS NULL))),
	CONSTRAINT fk_geo_opportunities_subject_id_geo_subjects FOREIGN KEY(subject_id) REFERENCES geo_subjects (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunities_query_topic_id_query_topics FOREIGN KEY(query_topic_id) REFERENCES query_topics (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunities_prompt_variant_id_geo_prompt_variants FOREIGN KEY(prompt_variant_id) REFERENCES geo_prompt_variants (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunities_collection_profile_id_geo_collecti_07ab FOREIGN KEY(collection_profile_id) REFERENCES geo_collection_profiles (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunities_engine_surface_id_geo_engine_surfaces FOREIGN KEY(engine_surface_id) REFERENCES geo_engine_surfaces (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunities_acknowledged_by_users FOREIGN KEY(acknowledged_by) REFERENCES users (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunities_resolved_by_users FOREIGN KEY(resolved_by) REFERENCES users (id) ON DELETE RESTRICT
)

;
CREATE INDEX ix_geo_opportunity_period ON geo_opportunities (source_date_from, source_date_to);
CREATE INDEX ix_geo_opportunity_subject ON geo_opportunities (subject_id);
CREATE UNIQUE INDEX uq_geo_opportunity_open_identity ON geo_opportunities (identity_key) WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS');

CREATE TABLE geo_opportunity_sources (
	id UUID NOT NULL,
	opportunity_id UUID NOT NULL,
	run_id UUID NOT NULL,
	analysis_revision_id UUID,
	review_id UUID,
	source_role VARCHAR(16) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_geo_opportunity_sources PRIMARY KEY (id),
	CONSTRAINT ck_geo_opportunity_source_role CHECK (source_role IN ('TRIGGER','SUPPORTING','BASELINE','RETEST')),
	CONSTRAINT fk_geo_opportunity_sources_opportunity_id_geo_opportunities FOREIGN KEY(opportunity_id) REFERENCES geo_opportunities (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunity_sources_run_id_geo_observation_runs FOREIGN KEY(run_id) REFERENCES geo_observation_runs (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunity_sources_analysis_revision_id_geo_ana_7747 FOREIGN KEY(analysis_revision_id) REFERENCES geo_analysis_revisions (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunity_sources_review_id_geo_run_reviews FOREIGN KEY(review_id) REFERENCES geo_run_reviews (id) ON DELETE RESTRICT
)

;
CREATE UNIQUE INDEX uq_geo_opportunity_source ON geo_opportunity_sources (opportunity_id, run_id, analysis_revision_id, review_id, source_role) NULLS NOT DISTINCT;

CREATE TABLE geo_opportunity_actions (
	id UUID NOT NULL,
	opportunity_id UUID NOT NULL,
	action_type VARCHAR(32) NOT NULL,
	target_type VARCHAR(80) NOT NULL,
	target_id UUID NOT NULL,
	status_snapshot VARCHAR(80) NOT NULL,
	created_by UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_geo_opportunity_actions PRIMARY KEY (id),
	CONSTRAINT ck_geo_opportunity_action_type CHECK (action_type IN ('FACT_REVISION','CONTENT_TASK','PUBLICATION_REPAIR','ADDITIONAL_MONITORING','OTHER')),
	CONSTRAINT ck_geo_opportunity_action_target CHECK (length(btrim(target_type)) > 0 AND length(btrim(status_snapshot)) > 0),
	CONSTRAINT fk_geo_opportunity_actions_opportunity_id_geo_opportunities FOREIGN KEY(opportunity_id) REFERENCES geo_opportunities (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunity_actions_created_by_users FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE RESTRICT
)

;
CREATE INDEX ix_geo_opportunity_action_opportunity ON geo_opportunity_actions (opportunity_id);

CREATE TABLE geo_opportunity_evaluations (
	id UUID NOT NULL,
	evaluation_key VARCHAR(64) NOT NULL,
	identity_key VARCHAR(64) NOT NULL,
	rule_set_revision INTEGER NOT NULL,
	opportunity_id UUID,
	result_snapshot JSONB NOT NULL,
	disposition VARCHAR(16) NOT NULL,
	as_of TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	created_by UUID NOT NULL,
	CONSTRAINT pk_geo_opportunity_evaluations PRIMARY KEY (id),
	CONSTRAINT ck_geo_opportunity_evaluation_keys CHECK (evaluation_key ~ '^[0-9a-f]{64}$' AND identity_key ~ '^[0-9a-f]{64}$'),
	CONSTRAINT ck_geo_opportunity_evaluation_snapshot CHECK (geo_opportunity_snapshot_valid(result_snapshot)),
	CONSTRAINT ck_geo_opportunity_disposition CHECK (disposition IN ('CREATED','UPDATED','UNCHANGED','SUPPRESSED','NO_TRIGGER','UNAVAILABLE')),
	CONSTRAINT fk_geo_opportunity_evaluations_rule_set_revision_geo_ru_a0f2 FOREIGN KEY(rule_set_revision) REFERENCES geo_rule_set_revisions (revision) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunity_evaluations_opportunity_id_geo_opportunities FOREIGN KEY(opportunity_id) REFERENCES geo_opportunities (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_opportunity_evaluations_created_by_users FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE RESTRICT
)

;
CREATE INDEX ix_geo_opportunity_evaluation_identity ON geo_opportunity_evaluations (identity_key, created_at);
CREATE UNIQUE INDEX uq_geo_opportunity_evaluation ON geo_opportunity_evaluations (evaluation_key);
ALTER TABLE geo_opportunities ADD CONSTRAINT fk_geo_opportunities_batch_id_geo_observation_batches FOREIGN KEY(batch_id) REFERENCES geo_observation_batches (id) ON DELETE RESTRICT;

-- 生产没有RETEST创建入口；若旧库存在悬空来源必须显式停止，不能猜测补造。
ALTER TABLE geo_observation_batches ADD CONSTRAINT fk_geo_batches_opportunity
  FOREIGN KEY (source_opportunity_id) REFERENCES geo_opportunities(id) ON DELETE RESTRICT;

CREATE FUNCTION geo_opportunity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'opportunity history is immutable' USING ERRCODE='55000'; END $$;
CREATE FUNCTION geo_opportunity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.revision <> 1 THEN
      RAISE EXCEPTION 'opportunity must start OPEN revision 1' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_initial';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['status','revision','last_seen_at','acknowledged_at','acknowledged_by',
      'resolved_at','resolved_by','resolution_code','resolution_comment']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','revision','last_seen_at','acknowledged_at','acknowledged_by',
      'resolved_at','resolved_by','resolution_code','resolution_comment']) THEN
      RAISE EXCEPTION 'opportunity identity and trigger are immutable' USING ERRCODE='55000';
    END IF;
    IF NEW.revision <> OLD.revision + 1 OR NEW.last_seen_at < OLD.last_seen_at THEN
      RAISE EXCEPTION 'invalid opportunity revision' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_update_revision';
    END IF;
    IF OLD.status IN ('RESOLVED','DISMISSED') OR (NEW.status <> OLD.status AND NOT (
      (OLD.status='OPEN' AND NEW.status IN ('ACKNOWLEDGED','DISMISSED')) OR
      (OLD.status='ACKNOWLEDGED' AND NEW.status IN ('IN_PROGRESS','DISMISSED')) OR
      (OLD.status='IN_PROGRESS' AND NEW.status IN ('RESOLVED','DISMISSED')))) THEN
      RAISE EXCEPTION 'invalid opportunity transition' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_transition';
    END IF;
    IF OLD.acknowledged_at IS NOT NULL AND
       (NEW.acknowledged_at,NEW.acknowledged_by) IS DISTINCT FROM (OLD.acknowledged_at,OLD.acknowledged_by) THEN
      RAISE EXCEPTION 'acknowledgement history is immutable' USING ERRCODE='55000';
    END IF;
  END IF;
  s := NEW.trigger_snapshot;
  IF s->>'rule_code' IS DISTINCT FROM NEW.rule_code OR s->>'priority' IS DISTINCT FROM NEW.priority
    OR (s->>'source_date_from')::timestamptz IS DISTINCT FROM NEW.source_date_from
    OR (s->>'source_date_to')::timestamptz IS DISTINCT FROM NEW.source_date_to
    OR (s->'scope'->>'subject_id')::uuid IS DISTINCT FROM NEW.subject_id
    OR (s->'scope'->>'query_topic_id')::uuid IS DISTINCT FROM NEW.query_topic_id
    OR (s->'scope'->>'prompt_variant_id')::uuid IS DISTINCT FROM NEW.prompt_variant_id
    OR (s->'scope'->>'collection_profile_id')::uuid IS DISTINCT FROM NEW.collection_profile_id
    OR (s->'scope'->>'engine_surface_id')::uuid IS DISTINCT FROM NEW.engine_surface_id
    OR (s->'scope'->>'batch_id')::uuid IS DISTINCT FROM NEW.batch_id THEN
    RAISE EXCEPTION 'opportunity scope differs from snapshot' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_scope';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER geo_opportunity_guard BEFORE INSERT OR UPDATE ON geo_opportunities
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_guard();
CREATE TRIGGER geo_opportunity_no_delete BEFORE DELETE ON geo_opportunities
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_immutable();
CREATE TRIGGER geo_opportunity_no_truncate BEFORE TRUNCATE ON geo_opportunities
  FOR EACH STATEMENT EXECUTE FUNCTION geo_opportunity_immutable();

CREATE FUNCTION geo_opportunity_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.analysis_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM geo_analysis_revisions
    WHERE id=NEW.analysis_revision_id AND run_id=NEW.run_id AND status='COMPLETED') THEN
    RAISE EXCEPTION 'opportunity source analysis mismatch' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_source_analysis';
  END IF;
  IF NEW.review_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM geo_run_reviews
    WHERE id=NEW.review_id AND analysis_revision_id=NEW.analysis_revision_id AND run_id=NEW.run_id) THEN
    RAISE EXCEPTION 'opportunity source review mismatch' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_source_review';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER geo_opportunity_source_guard BEFORE INSERT ON geo_opportunity_sources
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_source_guard();

CREATE FUNCTION geo_opportunity_sources_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s jsonb;
BEGIN
  FOR s IN SELECT value FROM jsonb_array_elements(NEW.trigger_snapshot->'sources') LOOP
    IF NOT EXISTS(SELECT 1 FROM geo_opportunity_sources r WHERE r.opportunity_id=NEW.id
      AND r.run_id=(s->>'run_id')::uuid AND r.source_role=s->>'source_role'
      AND r.analysis_revision_id IS NOT DISTINCT FROM (s->>'analysis_revision_id')::uuid
      AND r.review_id IS NOT DISTINCT FROM (s->>'review_id')::uuid) THEN
      RAISE EXCEPTION 'opportunity trigger sources missing' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_sources_required';
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_opportunity_sources_required AFTER INSERT ON geo_opportunities
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_opportunity_sources_required();

CREATE FUNCTION geo_opportunity_evaluation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rule_set_revision <> (NEW.result_snapshot->'rule_snapshot'->>'rule_set_revision')::integer
    OR (NEW.disposition IN ('CREATED','UPDATED','UNCHANGED','SUPPRESSED')) IS DISTINCT FROM
       (NEW.result_snapshot->>'triggered')::boolean
    OR (NEW.disposition IN ('CREATED','UPDATED','UNCHANGED')) IS DISTINCT FROM
       (NEW.opportunity_id IS NOT NULL)
    OR (NEW.disposition='UNAVAILABLE') IS DISTINCT FROM
       (jsonb_array_length(NEW.result_snapshot->'unavailable_reasons') > 0) THEN
    RAISE EXCEPTION 'opportunity evaluation disposition mismatch' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_evaluation_disposition';
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM geo_opportunities
    WHERE id=NEW.opportunity_id AND identity_key=NEW.identity_key) THEN
    RAISE EXCEPTION 'opportunity evaluation identity mismatch' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_evaluation_identity';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER geo_opportunity_evaluation_guard BEFORE INSERT ON geo_opportunity_evaluations
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_evaluation_guard();

CREATE TRIGGER geo_opportunity_sources_immutable BEFORE UPDATE OR DELETE ON geo_opportunity_sources
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_immutable();
CREATE TRIGGER geo_opportunity_sources_no_truncate BEFORE TRUNCATE ON geo_opportunity_sources
  FOR EACH STATEMENT EXECUTE FUNCTION geo_opportunity_immutable();
CREATE TRIGGER geo_opportunity_actions_immutable BEFORE UPDATE OR DELETE ON geo_opportunity_actions
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_immutable();
CREATE TRIGGER geo_opportunity_actions_no_truncate BEFORE TRUNCATE ON geo_opportunity_actions
  FOR EACH STATEMENT EXECUTE FUNCTION geo_opportunity_immutable();
CREATE TRIGGER geo_opportunity_evaluations_immutable BEFORE UPDATE OR DELETE ON geo_opportunity_evaluations
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_immutable();
CREATE TRIGGER geo_opportunity_evaluations_no_truncate BEFORE TRUNCATE ON geo_opportunity_evaluations
  FOR EACH STATEMENT EXECUTE FUNCTION geo_opportunity_immutable();
