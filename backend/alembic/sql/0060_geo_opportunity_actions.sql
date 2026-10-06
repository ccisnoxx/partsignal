-- 0060仅加列；旧行动快照保持NULL，不补造历史证据。
ALTER TABLE geo_opportunity_actions
  ADD COLUMN source_snapshot jsonb,
  ADD COLUMN request_key_sha256 varchar(64),
  ADD COLUMN request_sha256 varchar(64),
  ADD COLUMN opportunity_revision_after integer;
ALTER TABLE geo_opportunity_actions ADD CONSTRAINT ck_geo_opportunity_action_receipt CHECK (
  (source_snapshot IS NULL AND request_key_sha256 IS NULL AND request_sha256 IS NULL AND opportunity_revision_after IS NULL) OR
  (source_snapshot IS NOT NULL AND request_key_sha256 IS NOT NULL AND request_sha256 IS NOT NULL AND opportunity_revision_after IS NOT NULL
    AND request_key_sha256 ~ '^[0-9a-f]{64}$' AND request_sha256 ~ '^[0-9a-f]{64}$' AND opportunity_revision_after >= 2));
CREATE UNIQUE INDEX uq_geo_opportunity_action_request ON geo_opportunity_actions(created_by,request_key_sha256)
  WHERE request_key_sha256 IS NOT NULL;
CREATE INDEX ix_geo_opportunity_action_target ON geo_opportunity_actions(target_type,target_id);

CREATE FUNCTION geo_opportunity_action_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s jsonb; o geo_opportunities; t content_tasks; i published_content_issues; actual_sources jsonb; valid_product boolean;
BEGIN
  s := NEW.source_snapshot;
  IF NEW.action_type NOT IN ('FACT_REVISION','CONTENT_TASK','PUBLICATION_REPAIR') THEN RETURN NEW; END IF;
  SELECT * INTO o FROM geo_opportunities WHERE id=NEW.opportunity_id;
  SELECT jsonb_agg(jsonb_build_object('run_id',run_id,'analysis_revision_id',analysis_revision_id,
    'review_id',review_id,'source_role',source_role) ORDER BY id) INTO actual_sources
    FROM geo_opportunity_sources WHERE opportunity_id=NEW.opportunity_id;
  IF s IS NULL OR NOT geo_rule_object_keys(s,ARRAY['schema_version','opportunity_id','opportunity_revision',
      'trigger_snapshot','sources','product_id','query_topic_id','fact_version_id','platform_profile_id',
      'published_article_id','published_content_issue_id','request_id'])
    OR s->'schema_version' <> '1'::jsonb OR o.status <> 'IN_PROGRESS'
    OR (s->>'opportunity_id')::uuid IS DISTINCT FROM NEW.opportunity_id
    OR (s->>'opportunity_revision')::integer + 1 IS DISTINCT FROM NEW.opportunity_revision_after
    OR o.revision IS DISTINCT FROM NEW.opportunity_revision_after
    OR s->'trigger_snapshot' IS DISTINCT FROM o.trigger_snapshot
    OR s->'sources' IS DISTINCT FROM actual_sources
    OR jsonb_typeof(s->'request_id') <> 'string' OR length(s->>'request_id') NOT BETWEEN 1 AND 100
    OR s->>'request_id' !~ '^[ -~]+$' OR s->>'product_id' IS NULL THEN
    RAISE EXCEPTION 'invalid action source' USING ERRCODE='23514',CONSTRAINT='ck_geo_opportunity_action_source';
  END IF;
  WITH saved AS MATERIALIZED (
    SELECT subject.value FROM geo_opportunity_sources source
    JOIN geo_observation_runs run ON run.id=source.run_id
    CROSS JOIN LATERAL jsonb_array_elements(run.input_snapshot->'subjects') subject
    WHERE source.opportunity_id=NEW.opportunity_id
  ) SELECT EXISTS (
    SELECT 1 FROM saved WHERE value->>'subject_type'='OWN_PRODUCT'
      AND value->>'product_id'=s->>'product_id'
      AND (NOT EXISTS(SELECT 1 FROM saved WHERE value->>'subject_type'='OWN_PRODUCT'
        AND value->>'id'=o.subject_id::text) OR value->>'id'=o.subject_id::text)
  ) INTO valid_product;
  IF NOT valid_product THEN
    RAISE EXCEPTION 'action product outside saved source' USING ERRCODE='23514',CONSTRAINT='ck_geo_opportunity_action_target_owner';
  END IF;
  IF NEW.action_type='FACT_REVISION' AND NEW.target_type='Product' THEN
    PERFORM id FROM products WHERE id=NEW.target_id AND status='ACTIVE' FOR KEY SHARE;
    IF NOT FOUND OR NEW.target_id IS DISTINCT FROM (s->>'product_id')::uuid THEN
      RAISE EXCEPTION 'invalid fact action target' USING ERRCODE='23514',CONSTRAINT='ck_geo_opportunity_action_target_owner';
    END IF;
  ELSIF NEW.target_type='ContentTask' AND NEW.action_type IN ('CONTENT_TASK','PUBLICATION_REPAIR') THEN
    SELECT * INTO t FROM content_tasks WHERE id=NEW.target_id FOR KEY SHARE;
    IF t.id IS NULL OR (t.product_id,t.fact_version_id,t.platform_profile_id,t.query_topic_id) IS DISTINCT FROM
      ((s->>'product_id')::uuid,(s->>'fact_version_id')::uuid,(s->>'platform_profile_id')::uuid,(s->>'query_topic_id')::uuid)
      OR NEW.status_snapshot IS DISTINCT FROM t.status
      OR (NEW.action_type='CONTENT_TASK' AND (t.query_topic_id IS DISTINCT FROM o.query_topic_id
        OR s->>'published_article_id' IS NOT NULL OR s->>'published_content_issue_id' IS NOT NULL))
      OR (NEW.action_type='PUBLICATION_REPAIR' AND (
        t.source_published_content_issue_id IS DISTINCT FROM (s->>'published_content_issue_id')::uuid
        OR NOT EXISTS(SELECT 1 FROM published_content_issues WHERE id=t.source_published_content_issue_id
          AND published_article_id=(s->>'published_article_id')::uuid AND status='OPEN'))) THEN
      RAISE EXCEPTION 'invalid task action target' USING ERRCODE='23514',CONSTRAINT='ck_geo_opportunity_action_target_owner';
    END IF;
  ELSIF NEW.action_type='PUBLICATION_REPAIR' AND NEW.target_type='PublishedContentIssue' THEN
    SELECT * INTO i FROM published_content_issues WHERE id=NEW.target_id AND status='OPEN' FOR KEY SHARE;
    IF i.id IS NULL OR i.id IS DISTINCT FROM (s->>'published_content_issue_id')::uuid
      OR i.published_article_id IS DISTINCT FROM (s->>'published_article_id')::uuid
      OR NEW.status_snapshot IS DISTINCT FROM i.status THEN
      RAISE EXCEPTION 'invalid issue action target' USING ERRCODE='23514',CONSTRAINT='ck_geo_opportunity_action_target_owner';
    END IF;
    -- 只读父身份：Issue锁阻止聚合删除；再锁父Task会与Task→Issue删除锁序反转。
    SELECT task.* INTO t FROM content_tasks task
      JOIN publication_works work ON work.content_task_id=task.id WHERE work.id=i.published_article_id;
    IF t.id IS NULL OR (t.product_id,t.fact_version_id,t.platform_profile_id,t.query_topic_id) IS DISTINCT FROM
      ((s->>'product_id')::uuid,(s->>'fact_version_id')::uuid,(s->>'platform_profile_id')::uuid,(s->>'query_topic_id')::uuid) THEN
      RAISE EXCEPTION 'issue snapshot differs from source task' USING ERRCODE='23514',CONSTRAINT='ck_geo_opportunity_action_target_owner';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported action target'  USING ERRCODE='23514',CONSTRAINT='ck_geo_opportunity_action_target_owner';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER geo_opportunity_action_guard BEFORE INSERT ON geo_opportunity_actions
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_action_guard();

-- 目标UUID和快照永不清空；归档聚合永久删除仅产生可识别的目标缺失。
CREATE FUNCTION geo_opportunity_action_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root uuid; permitted boolean; referenced boolean;
BEGIN
  IF TG_TABLE_NAME='content_tasks' THEN
    referenced := EXISTS(SELECT 1 FROM geo_opportunity_actions WHERE target_type='ContentTask' AND target_id=OLD.id);
    permitted := OLD.archived_at IS NOT NULL AND current_setting('partsignal.content_task_delete_id',true)=OLD.id::text;
  ELSE
    root := nullif(current_setting('partsignal.content_task_delete_id',true),'')::uuid;
    permitted := EXISTS(SELECT 1 FROM content_tasks WHERE id=root AND archived_at IS NOT NULL);
    IF TG_TABLE_NAME='published_articles' THEN
      referenced := EXISTS(SELECT 1 FROM geo_opportunity_actions WHERE source_snapshot->>'published_article_id'=OLD.id::text
        OR (target_type='PublishedArticle' AND target_id=OLD.id));
      permitted := permitted AND EXISTS(SELECT 1 FROM publication_works WHERE id=OLD.id AND content_task_id=root);
    ELSE
      referenced := EXISTS(SELECT 1 FROM geo_opportunity_actions WHERE target_type='PublishedContentIssue' AND target_id=OLD.id);
      -- 父Article删除的守卫已验证对应归档aggregate，既有Issue guard再验证同一删除语境。
    END IF;
  END IF;
  IF referenced AND NOT coalesce(permitted,false) THEN
    RAISE EXCEPTION 'action target requires archived aggregate deletion' USING ERRCODE='23514',CONSTRAINT='ck_geo_opportunity_action_target_delete';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER geo_action_task_delete BEFORE DELETE ON content_tasks
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_action_delete_guard();
CREATE TRIGGER geo_action_article_delete BEFORE DELETE ON published_articles
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_action_delete_guard();
CREATE TRIGGER geo_action_issue_delete BEFORE DELETE ON published_content_issues
  FOR EACH ROW EXECUTE FUNCTION geo_opportunity_action_delete_guard();
