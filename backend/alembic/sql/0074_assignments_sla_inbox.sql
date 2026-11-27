-- Slice 2D：统一任务分派、SLA 与运营收件箱（0074）
-- 纯加法前滚迁移：在 5 个主聚合落库分派与 SLA 字段，更新非终态可变/终态冻结触发器，不建第二份待办表。

-- 1. fact_versions（仅 PENDING_REVIEW 可变更分派与 SLA）
ALTER TABLE fact_versions
  ADD COLUMN assignee_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN due_at TIMESTAMPTZ,
  ADD COLUMN blocked_reason TEXT,
  ADD COLUMN assigned_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN assigned_at TIMESTAMPTZ;

ALTER TABLE fact_versions
  ADD CONSTRAINT ck_fact_versions_priority
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD CONSTRAINT ck_fact_versions_blocked_reason_bounds
    CHECK (
      blocked_reason IS NULL
      OR (length(btrim(blocked_reason)) BETWEEN 1 AND 500 AND blocked_reason !~ '^[[:space:]]|[[:space:]]$')
    ),
  ADD CONSTRAINT ck_fact_versions_assignment_pair
    CHECK (
      (assignee_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
      OR (assignee_id IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)
    );

CREATE INDEX ix_fact_versions_assignee_due
  ON fact_versions (assignee_id, due_at) WHERE assignee_id IS NOT NULL;
CREATE INDEX ix_fact_versions_assigned_by
  ON fact_versions (assigned_by) WHERE assigned_by IS NOT NULL;
CREATE INDEX ix_fact_versions_due_at
  ON fact_versions (due_at) WHERE due_at IS NOT NULL;

CREATE OR REPLACE FUNCTION partsignal_guard_fact_version() RETURNS trigger AS $$
DECLARE
  assignment_changed BOOLEAN;
BEGIN
  IF NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
     OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.applicable_region IS DISTINCT FROM OLD.applicable_region
     OR NEW.content_restrictions IS DISTINCT FROM OLD.content_restrictions
     OR NEW.approved_claims_summary IS DISTINCT FROM OLD.approved_claims_summary
     OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'fact version payload is immutable' USING ERRCODE = '55000';
  END IF;

  assignment_changed :=
    NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
    OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.due_at IS DISTINCT FROM OLD.due_at
    OR NEW.blocked_reason IS DISTINCT FROM OLD.blocked_reason
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at;

  IF assignment_changed AND (OLD.status <> 'PENDING_REVIEW' OR NEW.status <> 'PENDING_REVIEW') THEN
    RAISE EXCEPTION 'fact version assignment is frozen outside pending review' USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'PENDING_REVIEW'
     AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
    (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'RETIRED')) OR
    (OLD.status = NEW.status)
  ) THEN
    RAISE EXCEPTION 'invalid fact version transition' USING ERRCODE = '55000';
  END IF;

  IF (OLD.status <> 'PENDING_REVIEW' OR NEW.status <> 'APPROVED')
     AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'fact approval metadata is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. content_tasks（仅 OPEN 且未归档时可变更分派与 SLA）
ALTER TABLE content_tasks
  ADD COLUMN assignee_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN due_at TIMESTAMPTZ,
  ADD COLUMN blocked_reason TEXT,
  ADD COLUMN assigned_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN assigned_at TIMESTAMPTZ;

ALTER TABLE content_tasks
  ADD CONSTRAINT ck_content_tasks_priority
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD CONSTRAINT ck_content_tasks_blocked_reason_bounds
    CHECK (
      blocked_reason IS NULL
      OR (length(btrim(blocked_reason)) BETWEEN 1 AND 500 AND blocked_reason !~ '^[[:space:]]|[[:space:]]$')
    ),
  ADD CONSTRAINT ck_content_tasks_assignment_pair
    CHECK (
      (assignee_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
      OR (assignee_id IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)
    );

CREATE INDEX ix_content_tasks_assignee_due
  ON content_tasks (assignee_id, due_at) WHERE assignee_id IS NOT NULL;
CREATE INDEX ix_content_tasks_assigned_by
  ON content_tasks (assigned_by) WHERE assigned_by IS NOT NULL;
CREATE INDEX ix_content_tasks_due_at
  ON content_tasks (due_at) WHERE due_at IS NOT NULL;

CREATE FUNCTION partsignal_guard_content_task_assignment() RETURNS trigger AS $$
DECLARE
  assignment_changed BOOLEAN;
BEGIN
  assignment_changed :=
    NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
    OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.due_at IS DISTINCT FROM OLD.due_at
    OR NEW.blocked_reason IS DISTINCT FROM OLD.blocked_reason
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at;

  IF assignment_changed AND (
    OLD.status <> 'OPEN' OR OLD.archived_at IS NOT NULL
    OR NEW.status <> 'OPEN' OR NEW.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'content task assignment is frozen when closed or archived' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_tasks_assignment_guard
  BEFORE UPDATE ON content_tasks
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_task_assignment();

-- 3. publication_works（仅非终态可变更分派与 SLA）
ALTER TABLE publication_works
  ADD COLUMN assignee_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN due_at TIMESTAMPTZ,
  ADD COLUMN blocked_reason TEXT,
  ADD COLUMN assigned_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN assigned_at TIMESTAMPTZ;

ALTER TABLE publication_works
  ADD CONSTRAINT ck_publication_works_priority
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD CONSTRAINT ck_publication_works_blocked_reason_bounds
    CHECK (
      blocked_reason IS NULL
      OR (length(btrim(blocked_reason)) BETWEEN 1 AND 500 AND blocked_reason !~ '^[[:space:]]|[[:space:]]$')
    ),
  ADD CONSTRAINT ck_publication_works_assignment_pair
    CHECK (
      (assignee_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
      OR (assignee_id IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)
    );

CREATE INDEX ix_publication_works_assignee_due
  ON publication_works (assignee_id, due_at) WHERE assignee_id IS NOT NULL;
CREATE INDEX ix_publication_works_assigned_by
  ON publication_works (assigned_by) WHERE assigned_by IS NOT NULL;
CREATE INDEX ix_publication_works_due_at
  ON publication_works (due_at) WHERE due_at IS NOT NULL;

CREATE FUNCTION partsignal_guard_publication_work_assignment() RETURNS trigger AS $$
DECLARE
  assignment_changed BOOLEAN;
BEGIN
  assignment_changed :=
    NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
    OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.due_at IS DISTINCT FROM OLD.due_at
    OR NEW.blocked_reason IS DISTINCT FROM OLD.blocked_reason
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at;

  IF assignment_changed AND (
    OLD.status IN ('COMPLETED', 'CLOSED') OR NEW.status IN ('COMPLETED', 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'publication work assignment is frozen in terminal status' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER publication_works_assignment_guard
  BEFORE UPDATE ON publication_works
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_publication_work_assignment();

-- 4. published_content_issues（仅 OPEN 可变更分派与 SLA，RESOLVED 后冻结）
ALTER TABLE published_content_issues
  ADD COLUMN assignee_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN priority VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN due_at TIMESTAMPTZ,
  ADD COLUMN blocked_reason TEXT,
  ADD COLUMN assigned_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN assigned_at TIMESTAMPTZ;

ALTER TABLE published_content_issues
  ADD CONSTRAINT ck_published_content_issues_priority
    CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  ADD CONSTRAINT ck_published_content_issues_blocked_reason_bounds
    CHECK (
      blocked_reason IS NULL
      OR (length(btrim(blocked_reason)) BETWEEN 1 AND 500 AND blocked_reason !~ '^[[:space:]]|[[:space:]]$')
    ),
  ADD CONSTRAINT ck_published_content_issues_assignment_pair
    CHECK (
      (assignee_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
      OR (assignee_id IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)
    );

CREATE INDEX ix_published_content_issues_assignee_due
  ON published_content_issues (assignee_id, due_at) WHERE assignee_id IS NOT NULL;
CREATE INDEX ix_published_content_issues_assigned_by
  ON published_content_issues (assigned_by) WHERE assigned_by IS NOT NULL;
CREATE INDEX ix_published_content_issues_due_at
  ON published_content_issues (due_at) WHERE due_at IS NOT NULL;

CREATE OR REPLACE FUNCTION partsignal_guard_published_content_issue() RETURNS trigger AS $$
DECLARE
  assignment_changed BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'published content issue history is append-only'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.published_article_id IS DISTINCT FROM OLD.published_article_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
     OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN
    RAISE EXCEPTION 'published content issue binding is immutable'
      USING ERRCODE = '55000';
  END IF;

  assignment_changed :=
    NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
    OR NEW.priority IS DISTINCT FROM OLD.priority
    OR NEW.due_at IS DISTINCT FROM OLD.due_at
    OR NEW.blocked_reason IS DISTINCT FROM OLD.blocked_reason
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at;

  IF OLD.status <> 'OPEN' OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'invalid published content issue transition'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'OPEN' THEN
    IF NOT assignment_changed THEN
      RAISE EXCEPTION 'invalid published content issue transition'
        USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.status = 'RESOLVED' THEN
    IF assignment_changed THEN
      RAISE EXCEPTION 'published content issue assignment cannot change during resolution'
        USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid published content issue transition'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. geo_opportunities（复用规则冻结的 priority，仅开放态可变更分派与 SLA）
ALTER TABLE geo_opportunities
  ADD COLUMN assignee_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN due_at TIMESTAMPTZ,
  ADD COLUMN blocked_reason TEXT,
  ADD COLUMN assigned_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN assigned_at TIMESTAMPTZ;

ALTER TABLE geo_opportunities
  ADD CONSTRAINT ck_geo_opportunities_blocked_reason_bounds
    CHECK (
      blocked_reason IS NULL
      OR (length(btrim(blocked_reason)) BETWEEN 1 AND 500 AND blocked_reason !~ '^[[:space:]]|[[:space:]]$')
    ),
  ADD CONSTRAINT ck_geo_opportunities_assignment_pair
    CHECK (
      (assignee_id IS NULL AND assigned_by IS NULL AND assigned_at IS NULL)
      OR (assignee_id IS NOT NULL AND assigned_by IS NOT NULL AND assigned_at IS NOT NULL)
    );

CREATE INDEX ix_geo_opportunities_assignee_due
  ON geo_opportunities (assignee_id, due_at) WHERE assignee_id IS NOT NULL;
CREATE INDEX ix_geo_opportunities_assigned_by
  ON geo_opportunities (assigned_by) WHERE assigned_by IS NOT NULL;
CREATE INDEX ix_geo_opportunities_due_at
  ON geo_opportunities (due_at) WHERE due_at IS NOT NULL;

CREATE OR REPLACE FUNCTION geo_opportunity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s jsonb;
  assignment_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'OPEN' OR NEW.revision <> 1 THEN
      RAISE EXCEPTION 'opportunity must start OPEN revision 1' USING ERRCODE='23514', CONSTRAINT='ck_geo_opportunity_initial';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - ARRAY['status','revision','last_seen_at','acknowledged_at','acknowledged_by',
      'resolved_at','resolved_by','resolution_code','resolution_comment',
      'assignee_id','due_at','blocked_reason','assigned_by','assigned_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status','revision','last_seen_at','acknowledged_at','acknowledged_by',
      'resolved_at','resolved_by','resolution_code','resolution_comment',
      'assignee_id','due_at','blocked_reason','assigned_by','assigned_at']) THEN
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
    assignment_changed :=
      NEW.assignee_id IS DISTINCT FROM OLD.assignee_id
      OR NEW.due_at IS DISTINCT FROM OLD.due_at
      OR NEW.blocked_reason IS DISTINCT FROM OLD.blocked_reason
      OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
      OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at;
    IF assignment_changed AND NEW.status IN ('RESOLVED','DISMISSED') THEN
      RAISE EXCEPTION 'opportunity assignment cannot change during resolution' USING ERRCODE='55000';
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
