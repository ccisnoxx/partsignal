-- Slice 2B: 内容策划层（ContentCampaign + 4 N:M 关联 + QueryTopic 增强 + ContentBriefSnapshot）
-- 纯加法前滚迁移，不回填存量任务 Brief，不改写历史数据。

-- 1. QueryTopic 升级为一等策划对象
ALTER TABLE query_topics
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN description TEXT NOT NULL DEFAULT '';

ALTER TABLE query_topics
  ADD CONSTRAINT ck_query_topics_description_length
    CHECK (length(description) <= 1000);

CREATE INDEX ix_query_topics_is_active
  ON query_topics (is_active, id);

-- 2. ContentCampaign 主聚合表
CREATE TABLE content_campaigns (
  id UUID PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  target_audience TEXT NOT NULL DEFAULT '',
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  start_date DATE NULL,
  end_date DATE NULL,
  target_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  budget_amount NUMERIC(14, 2) NULL,
  budget_currency VARCHAR(8) NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_content_campaigns_name_nonempty
    CHECK (btrim(name) <> '' AND name = btrim(name)),
  CONSTRAINT ck_content_campaigns_description_length
    CHECK (length(description) <= 4000),
  CONSTRAINT ck_content_campaigns_target_audience_length
    CHECK (length(target_audience) <= 500),
  CONSTRAINT ck_content_campaigns_priority
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT ck_content_campaigns_status
    CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED')),
  CONSTRAINT ck_content_campaigns_date_range
    CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date),
  CONSTRAINT ck_content_campaigns_target_metrics_object
    CHECK (jsonb_typeof(target_metrics) = 'object'),
  CONSTRAINT ck_content_campaigns_budget_pair
    CHECK (
      (budget_amount IS NULL AND budget_currency IS NULL)
      OR (
        budget_amount IS NOT NULL
        AND budget_currency IS NOT NULL
        AND budget_amount >= 0
        AND budget_currency ~ '^[A-Z]{3}$'
      )
    ),
  CONSTRAINT ck_content_campaigns_revision_nonneg
    CHECK (revision >= 0)
);

CREATE INDEX ix_content_campaigns_status_updated
  ON content_campaigns (status, updated_at DESC, id);
CREATE INDEX ix_content_campaigns_owner_id
  ON content_campaigns (owner_id);
CREATE INDEX ix_content_campaigns_created_by
  ON content_campaigns (created_by);
CREATE INDEX ix_content_campaigns_updated_by
  ON content_campaigns (updated_by);

CREATE FUNCTION partsignal_guard_content_campaign() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'only draft content campaign can be deleted' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'content campaign identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'archived content campaign is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'COMPLETED' THEN
    IF NEW.status <> 'ARCHIVED' THEN
      RAISE EXCEPTION 'completed content campaign can only be archived' USING ERRCODE = '55000';
    END IF;
    IF to_jsonb(NEW) - ARRAY['status', 'revision', 'updated_by', 'updated_at']
       IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status', 'revision', 'updated_by', 'updated_at'] THEN
      RAISE EXCEPTION 'completed content campaign payload is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'ACTIVE', 'ARCHIVED'))
    OR (OLD.status = 'ACTIVE' AND NEW.status IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'))
    OR (OLD.status = 'PAUSED' AND NEW.status IN ('PAUSED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'))
    OR (OLD.status = 'COMPLETED' AND NEW.status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'invalid content campaign status transition' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_campaigns_lifecycle_guard
  BEFORE UPDATE OR DELETE ON content_campaigns
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_campaign();

-- 3. ContentCampaign 4 张 N:M 关联表
CREATE TABLE content_campaign_products (
  campaign_id UUID NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  PRIMARY KEY (campaign_id, product_id)
);
CREATE INDEX ix_content_campaign_products_product_id
  ON content_campaign_products (product_id, campaign_id);

CREATE TABLE content_campaign_topics (
  campaign_id UUID NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
  query_topic_id UUID NOT NULL REFERENCES query_topics(id) ON DELETE RESTRICT,
  PRIMARY KEY (campaign_id, query_topic_id)
);
CREATE INDEX ix_content_campaign_topics_topic_id
  ON content_campaign_topics (query_topic_id, campaign_id);

CREATE TABLE content_campaign_platforms (
  campaign_id UUID NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
  platform_profile_id UUID NOT NULL REFERENCES platform_profiles(id) ON DELETE RESTRICT,
  PRIMARY KEY (campaign_id, platform_profile_id)
);
CREATE INDEX ix_content_campaign_platforms_platform_id
  ON content_campaign_platforms (platform_profile_id, campaign_id);

CREATE TABLE content_campaign_monitoring_plans (
  campaign_id UUID NOT NULL REFERENCES content_campaigns(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES geo_monitoring_plans(id) ON DELETE RESTRICT,
  PRIMARY KEY (campaign_id, plan_id)
);
CREATE INDEX ix_content_campaign_monitoring_plans_plan_id
  ON content_campaign_monitoring_plans (plan_id, campaign_id);

CREATE FUNCTION partsignal_guard_content_campaign_link() RETURNS trigger AS $$
DECLARE
  campaign_status VARCHAR(20);
  target_campaign_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'content campaign link rows cannot be updated in place' USING ERRCODE = '55000';
  END IF;
  target_campaign_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.campaign_id ELSE OLD.campaign_id END;
  SELECT status INTO campaign_status FROM content_campaigns WHERE id = target_campaign_id FOR SHARE;
  IF FOUND AND campaign_status IN ('COMPLETED', 'ARCHIVED') THEN
    RAISE EXCEPTION 'cannot modify links of completed or archived content campaign' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'INSERT' THEN NEW ELSE OLD END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_campaign_products_guard
  BEFORE INSERT OR UPDATE OR DELETE ON content_campaign_products
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_campaign_link();

CREATE TRIGGER content_campaign_topics_guard
  BEFORE INSERT OR UPDATE OR DELETE ON content_campaign_topics
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_campaign_link();

CREATE TRIGGER content_campaign_platforms_guard
  BEFORE INSERT OR UPDATE OR DELETE ON content_campaign_platforms
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_campaign_link();

CREATE TRIGGER content_campaign_monitoring_plans_guard
  BEFORE INSERT OR UPDATE OR DELETE ON content_campaign_monitoring_plans
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_campaign_link();

-- 4. content_tasks 增加可空 campaign_id 与策划身份不可变守卫
ALTER TABLE content_tasks
  ADD COLUMN campaign_id UUID NULL REFERENCES content_campaigns(id) ON DELETE RESTRICT;

CREATE INDEX ix_content_tasks_campaign_id_created_at
  ON content_tasks (campaign_id, created_at)
  WHERE campaign_id IS NOT NULL;

CREATE FUNCTION partsignal_guard_content_task_planning_identity() RETURNS trigger AS $$
BEGIN
  IF NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.query_topic_id IS DISTINCT FROM OLD.query_topic_id THEN
    RAISE EXCEPTION 'content task planning identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_tasks_planning_identity_guard
  BEFORE UPDATE ON content_tasks
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_task_planning_identity();

-- 5. 1:1 不可变 content_brief_snapshots
CREATE TABLE content_brief_snapshots (
  content_task_id UUID PRIMARY KEY REFERENCES content_tasks(id) ON DELETE RESTRICT,
  query_topic_id UUID NULL REFERENCES query_topics(id) ON DELETE RESTRICT,
  target_question TEXT NOT NULL,
  search_intent VARCHAR(40) NOT NULL,
  content_angle VARCHAR(160) NOT NULL,
  target_audience TEXT NOT NULL DEFAULT '',
  must_answer_questions TEXT[] NOT NULL DEFAULT '{}'::text[],
  required_fact_points TEXT[] NOT NULL DEFAULT '{}'::text[],
  forbidden_expressions TEXT[] NOT NULL DEFAULT '{}'::text[],
  content_format VARCHAR(80) NOT NULL DEFAULT '',
  cta TEXT NOT NULL DEFAULT '',
  target_keywords TEXT[] NOT NULL DEFAULT '{}'::text[],
  success_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_content_brief_target_question_nonempty
    CHECK (btrim(target_question) <> '' AND length(target_question) <= 500),
  CONSTRAINT ck_content_brief_search_intent
    CHECK (search_intent IN ('BRAND', 'PRODUCT', 'REPLACEMENT', 'COMPARISON', 'APPLICATION', 'TROUBLESHOOTING')),
  CONSTRAINT ck_content_brief_content_angle_nonempty
    CHECK (btrim(content_angle) <> '' AND length(content_angle) <= 160),
  CONSTRAINT ck_content_brief_target_audience_length
    CHECK (length(target_audience) <= 500),
  CONSTRAINT ck_content_brief_content_format_length
    CHECK (length(content_format) <= 80),
  CONSTRAINT ck_content_brief_cta_length
    CHECK (length(cta) <= 500),
  CONSTRAINT ck_content_brief_success_metrics_object
    CHECK (jsonb_typeof(success_metrics) = 'object')
);

CREATE INDEX ix_content_brief_snapshots_query_topic_id
  ON content_brief_snapshots (query_topic_id)
  WHERE query_topic_id IS NOT NULL;

CREATE INDEX ix_content_brief_snapshots_created_by
  ON content_brief_snapshots (created_by);

CREATE FUNCTION partsignal_validate_content_brief_snapshot() RETURNS trigger AS $$
DECLARE
  task_topic_id UUID;
BEGIN
  SELECT query_topic_id INTO task_topic_id
    FROM content_tasks
   WHERE id = NEW.content_task_id
     FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'content brief requires existing content task' USING ERRCODE = '23503';
  END IF;
  IF NEW.query_topic_id IS DISTINCT FROM task_topic_id THEN
    RAISE EXCEPTION 'content brief query_topic_id must match content task query_topic_id'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_brief_snapshots_validate_insert
  BEFORE INSERT ON content_brief_snapshots
  FOR EACH ROW EXECUTE FUNCTION partsignal_validate_content_brief_snapshot();

CREATE FUNCTION partsignal_guard_content_brief_snapshot() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('partsignal.content_task_delete_id', true) = OLD.content_task_id::text THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'content brief snapshot is immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_brief_snapshots_immutable_guard
  BEFORE UPDATE OR DELETE ON content_brief_snapshots
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_brief_snapshot();
