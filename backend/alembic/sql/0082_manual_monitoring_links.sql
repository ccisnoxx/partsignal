-- Slice 1C: 三类问题分类、固定核心计划、历史补录时间轴、实际改问记录、人工失败态与引用分级归因

ALTER TABLE geo_prompt_variants
    ADD COLUMN prompt_category VARCHAR(24) NULL;

UPDATE geo_prompt_variants
   SET prompt_category = CASE
       WHEN mention_mode = 'BRANDED' THEN 'BRAND_MODEL'
       ELSE 'NATURAL_DEMAND'
   END
 WHERE prompt_category IS NULL;

ALTER TABLE geo_prompt_variants
    ALTER COLUMN prompt_category SET NOT NULL,
    ALTER COLUMN prompt_category SET DEFAULT 'NATURAL_DEMAND',
    ADD CONSTRAINT ck_geo_prompt_variants_category CHECK (
        prompt_category IN ('NATURAL_DEMAND', 'BRAND_MODEL', 'ARTICLE_LOOKUP')
        AND (
            (prompt_category = 'NATURAL_DEMAND' AND mention_mode = 'UNBRANDED')
            OR (prompt_category = 'BRAND_MODEL' AND mention_mode = 'BRANDED')
            OR (prompt_category = 'ARTICLE_LOOKUP')
        )
    );

CREATE INDEX ix_geo_prompt_variants_category_active
    ON geo_prompt_variants (prompt_category, is_active);

CREATE OR REPLACE FUNCTION geo_guard_prompt_variant() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE semantics_changed boolean; changed boolean;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.revision <> 0 OR NEW.first_referenced_at IS NOT NULL THEN
            RAISE EXCEPTION '变体必须从未引用的 revision 0 创建'
                USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_initial';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF OLD.first_referenced_at IS NOT NULL THEN
            RAISE EXCEPTION '已引用变体只能停用'
                USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_history';
        END IF;
        RETURN OLD;
    END IF;
    IF ROW(NEW.id, NEW.query_topic_id, NEW.created_by, NEW.created_at)
        IS DISTINCT FROM ROW(OLD.id, OLD.query_topic_id, OLD.created_by, OLD.created_at) THEN
        RAISE EXCEPTION '变体归属与创建身份不可变'
            USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_identity';
    END IF;
    semantics_changed := ROW(NEW.prompt_text, NEW.mention_mode, NEW.prompt_category,
                             NEW.language_code, NEW.region_code, NEW.priority)
        IS DISTINCT FROM ROW(OLD.prompt_text, OLD.mention_mode, OLD.prompt_category,
                             OLD.language_code, OLD.region_code, OLD.priority);
    IF OLD.first_referenced_at IS NOT NULL AND
        (semantics_changed OR NEW.first_referenced_at IS DISTINCT FROM OLD.first_referenced_at
         OR (NOT OLD.is_active AND NEW.is_active)) THEN
        RAISE EXCEPTION '已引用变体只能停用'
            USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_history';
    END IF;
    IF OLD.first_referenced_at IS NULL AND NEW.first_referenced_at IS NOT NULL
        AND (semantics_changed OR NOT OLD.is_active OR NOT NEW.is_active) THEN
        RAISE EXCEPTION '引用锁存必须保持正在运行的原始语义'
            USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_history';
    END IF;
    changed := semantics_changed OR NEW.is_active IS DISTINCT FROM OLD.is_active
        OR NEW.first_referenced_at IS DISTINCT FROM OLD.first_referenced_at;
    IF NEW.revision <> OLD.revision + (CASE WHEN changed THEN 1 ELSE 0 END) THEN
        RAISE EXCEPTION '有效变更 revision 必须恰好递增一次'
            USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_revision_step';
    END IF;
    IF (NOT changed AND NEW.updated_at IS DISTINCT FROM OLD.updated_at)
        OR NEW.updated_at < OLD.updated_at THEN
        RAISE EXCEPTION '更新时间必须保持单调且 no-op 不改写'
            USING ERRCODE = '23514', CONSTRAINT = 'ck_geo_prompt_variants_updated_at';
    END IF;
    RETURN NEW;
END $$;

ALTER TABLE geo_monitoring_plans
    ADD COLUMN plan_role VARCHAR(24) NOT NULL DEFAULT 'STANDARD'
        CONSTRAINT ck_geo_monitoring_plans_role CHECK (plan_role IN ('CORE_BASELINE', 'STANDARD')),
    ADD COLUMN default_assignee_id UUID NULL
        CONSTRAINT fk_geo_monitoring_plans_default_assignee REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX ix_geo_monitoring_plans_role ON geo_monitoring_plans (plan_role, status);
CREATE INDEX ix_geo_monitoring_plans_default_assignee
    ON geo_monitoring_plans (default_assignee_id) WHERE default_assignee_id IS NOT NULL;

ALTER TABLE geo_observation_runs
    ADD COLUMN entry_kind VARCHAR(24) NOT NULL DEFAULT 'PLAN_STANDARD'
        CONSTRAINT ck_geo_runs_entry_kind
        CHECK (entry_kind IN ('PLAN_STANDARD', 'BACKFILL', 'EXPLORATORY', 'ARTICLE_LOOKUP')),
    ADD COLUMN is_backfill BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN backfill_source VARCHAR(160) NULL,
    ADD COLUMN assignee_id UUID NULL
        CONSTRAINT fk_geo_runs_assignee REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN target_article_publication_id UUID NULL
        CONSTRAINT fk_geo_runs_target_article_pub REFERENCES article_publications(id) ON DELETE RESTRICT,
    ADD CONSTRAINT ck_geo_runs_backfill_pair CHECK (
        (is_backfill = FALSE AND backfill_source IS NULL AND entry_kind <> 'BACKFILL')
        OR (
            is_backfill = TRUE
            AND entry_kind = 'BACKFILL'
            AND backfill_source IS NOT NULL
            AND length(btrim(backfill_source)) BETWEEN 1 AND 160
        )
    ),
    ADD CONSTRAINT ck_geo_runs_article_lookup_target CHECK (
        target_article_publication_id IS NULL OR entry_kind = 'ARTICLE_LOOKUP'
    );

ALTER TABLE geo_observation_runs
    DROP CONSTRAINT IF EXISTS ck_geo_runs_error,
    ADD CONSTRAINT ck_geo_runs_error CHECK (
        (
            status IN ('FAILED', 'BUDGET_BLOCKED')
            AND error_stage IS NOT NULL
            AND error_code IS NOT NULL
            AND error_stage IN ('COLLECTION', 'ANALYSIS', 'REVIEW')
            AND error_code IN (
                'COLLECTOR_CONFIGURATION_INVALID', 'COLLECTOR_DISABLED',
                'PROVIDER_AUTH_FAILED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_TIMEOUT',
                'PROVIDER_UNAVAILABLE', 'PROVIDER_RESPONSE_INVALID',
                'PROVIDER_RESPONSE_TOO_LARGE', 'COLLECTOR_UNKNOWN_OUTCOME',
                'DATA_CLASSIFICATION_FORBIDDEN', 'PROFILE_NEEDS_REAUTH',
                'WORKER_LOST', 'BUDGET_EXCEEDED', 'ANALYSIS_FAILED', 'REVIEW_FAILED',
                'MANUAL_TIMEOUT', 'MANUAL_PLATFORM_UNAVAILABLE',
                'MANUAL_ANSWER_UNAVAILABLE', 'MANUAL_ACCESS_BLOCKED', 'MANUAL_OTHER'
            )
            AND error_summary IS NOT NULL
            AND length(btrim(error_summary)) > 0
        )
        OR (
            status NOT IN ('FAILED', 'BUDGET_BLOCKED')
            AND error_stage IS NULL
            AND error_code IS NULL
            AND error_summary IS NULL
        )
    );

ALTER TABLE geo_observation_runs
    DROP CONSTRAINT IF EXISTS ck_geo_runs_time,
    ADD CONSTRAINT ck_geo_runs_time CHECK (
        (started_at IS NULL OR is_backfill = TRUE OR started_at >= created_at)
        AND (collected_at IS NULL OR (started_at IS NOT NULL AND collected_at >= started_at))
        AND (finished_at IS NULL OR finished_at >= COALESCE(collected_at, started_at, created_at))
        AND ((status IN ('COMPLETED', 'FAILED', 'CANCELLED', 'BUDGET_BLOCKED')) = (finished_at IS NOT NULL))
        AND (status NOT IN ('PENDING', 'CANCELLED', 'BUDGET_BLOCKED') OR started_at IS NULL)
        AND (status NOT IN ('RUNNING', 'COLLECTED', 'ANALYZING', 'NEEDS_REVIEW', 'COMPLETED') OR started_at IS NOT NULL)
        AND (status NOT IN ('COLLECTED', 'ANALYZING', 'NEEDS_REVIEW', 'COMPLETED') OR collected_at IS NOT NULL)
        AND (status NOT IN ('PENDING', 'RUNNING', 'CANCELLED', 'BUDGET_BLOCKED') OR collected_at IS NULL)
    );

-- 保留 0056 全部当前分析指针与人工复核发布防线，并追加 0082 补录/直录字段不可变保护。
CREATE OR REPLACE FUNCTION geo_guard_observation_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent geo_observation_runs%ROWTYPE; batch_state text; target geo_analysis_revisions%ROWTYPE; previous integer;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION '运行历史必须保留'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_immutable';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.current_analysis_revision_id IS DISTINCT FROM OLD.current_analysis_revision_id THEN
            IF NEW.current_analysis_revision_id IS NULL OR NEW.revision <> OLD.revision + 1 OR
                (to_jsonb(NEW) - ARRAY['run_cell_key','revision','current_analysis_revision_id']) IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['run_cell_key','revision','current_analysis_revision_id']) THEN
                RAISE EXCEPTION '当前分析发布只能前进指针并递增运行 revision'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_analysis_publication';
            END IF;
            SELECT * INTO target FROM geo_analysis_revisions WHERE id=NEW.current_analysis_revision_id;
            SELECT revision INTO previous FROM geo_analysis_revisions WHERE id=OLD.current_analysis_revision_id;
            IF target.id IS NULL OR target.run_id <> OLD.id OR target.status <> 'COMPLETED'
                OR target.revision <= COALESCE(previous,0) OR target.revision <
                    (SELECT max(revision) FROM geo_analysis_revisions WHERE run_id=OLD.id AND status='COMPLETED') THEN
                RAISE EXCEPTION '当前分析必须是本运行最新成功版本，不得倒退'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_current_analysis';
            END IF;
            RETURN NEW;
        END IF;
        IF OLD.status IN ('NEEDS_REVIEW','COMPLETED','FAILED') AND
            NEW.status = (CASE WHEN OLD.status='NEEDS_REVIEW' THEN 'COMPLETED' ELSE OLD.status END) THEN
            IF NEW.revision = OLD.revision + 1 AND EXISTS (
                SELECT 1 FROM geo_run_reviews review WHERE review.run_id=OLD.id
                    AND review.analysis_revision_id=OLD.current_analysis_revision_id
                    AND review.xmin=pg_current_xact_id()::xid
            ) AND (
                (OLD.status='NEEDS_REVIEW' AND NEW.finished_at IS NOT NULL AND
                    (to_jsonb(NEW)-ARRAY['run_cell_key','revision','status','finished_at']) IS NOT DISTINCT FROM
                    (to_jsonb(OLD)-ARRAY['run_cell_key','revision','status','finished_at'])) OR
                (OLD.status<>'NEEDS_REVIEW' AND
                    (to_jsonb(NEW)-ARRAY['run_cell_key','revision']) IS NOT DISTINCT FROM
                    (to_jsonb(OLD)-ARRAY['run_cell_key','revision']))
            ) THEN RETURN NEW; END IF;
            IF OLD.status='NEEDS_REVIEW' OR
                (to_jsonb(NEW)-'run_cell_key') IS DISTINCT FROM (to_jsonb(OLD)-'run_cell_key') THEN
                RAISE EXCEPTION '复核发布必须同事务追加当前分析Review且只更新允许字段'
                    USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_review_publication';
            END IF;
        END IF;
        IF ROW(NEW.id,NEW.batch_id,NEW.prompt_variant_id,NEW.collection_profile_id,
                NEW.repeat_index,NEW.attempt_no,NEW.previous_attempt_id,NEW.input_snapshot,
                NEW.created_at,NEW.entry_kind,NEW.is_backfill,NEW.backfill_source,
                NEW.target_article_publication_id)
            IS DISTINCT FROM ROW(OLD.id,OLD.batch_id,OLD.prompt_variant_id,OLD.collection_profile_id,
                OLD.repeat_index,OLD.attempt_no,OLD.previous_attempt_id,OLD.input_snapshot,
                OLD.created_at,OLD.entry_kind,OLD.is_backfill,OLD.backfill_source,
                OLD.target_article_publication_id) THEN
            RAISE EXCEPTION '运行输入和身份不可变'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_immutable';
        END IF;
        IF to_jsonb(NEW) - 'run_cell_key' IS NOT DISTINCT FROM to_jsonb(OLD) - 'run_cell_key'
            THEN RETURN NEW; END IF;
        IF OLD.status IN ('COMPLETED','FAILED','CANCELLED','BUDGET_BLOCKED') THEN
            RAISE EXCEPTION '终态运行不可修改'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_terminal';
        END IF;
        IF NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION '运行实际更新必须递增 revision'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_revision';
        END IF;
        IF (OLD.external_call_state <> 'NOT_STARTED' AND NEW.external_call_state = 'NOT_STARTED')
            OR (OLD.external_call_state = 'COMPLETED' AND NEW.external_call_state <> 'COMPLETED') THEN
            RAISE EXCEPTION '已发送或未知请求不可恢复为未发送'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_external_progress';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.current_analysis_revision_id IS NOT NULL OR NEW.status <> 'PENDING' OR NEW.revision <> 0 OR NEW.external_call_state <> 'NOT_STARTED'
        OR NEW.lease_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL
        OR NEW.started_at IS NOT NULL OR NEW.collected_at IS NOT NULL OR NEW.finished_at IS NOT NULL
        OR NEW.error_stage IS NOT NULL OR NEW.error_code IS NOT NULL OR NEW.error_summary IS NOT NULL
        OR NEW.provider_request_id IS NOT NULL OR NEW.duration_ms IS NOT NULL
        OR NEW.cost_amount IS NOT NULL OR NEW.cost_currency IS NOT NULL
        OR NEW.prompt_tokens IS NOT NULL OR NEW.completion_tokens IS NOT NULL OR NEW.total_tokens IS NOT NULL
        OR NEW.dispatch_attempt_count <> 0 OR NEW.last_dispatch_attempt_at IS NOT NULL THEN
        RAISE EXCEPTION '新尝试必须是未发送的 PENDING revision 0'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_initial';
    END IF;
    SELECT status INTO batch_state FROM geo_observation_batches WHERE id=NEW.batch_id FOR UPDATE;
    UPDATE geo_observation_batches SET revision=revision WHERE id=NEW.batch_id;
    IF NEW.attempt_no=1 AND batch_state <> 'PLANNED' THEN
        RAISE EXCEPTION '初始矩阵已封存'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_initial_matrix';
    END IF;
    IF NEW.previous_attempt_id IS NOT NULL THEN
        SELECT * INTO parent FROM geo_observation_runs WHERE id=NEW.previous_attempt_id FOR KEY SHARE;
        IF NOT FOUND OR (parent.batch_id <> NEW.batch_id
            OR parent.prompt_variant_id <> NEW.prompt_variant_id
            OR parent.collection_profile_id <> NEW.collection_profile_id
            OR parent.repeat_index <> NEW.repeat_index OR parent.attempt_no + 1 <> NEW.attempt_no
            OR parent.input_snapshot IS DISTINCT FROM NEW.input_snapshot
            OR parent.status NOT IN ('FAILED','BUDGET_BLOCKED') OR parent.error_stage IS DISTINCT FROM 'COLLECTION') THEN
            RAISE EXCEPTION '新尝试必须继承同采样单元的失败采集与完整输入'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_runs_attempt_chain';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE INDEX ix_geo_runs_effective_time
    ON geo_observation_runs (COALESCE(collected_at, created_at) DESC, id);
CREATE INDEX ix_geo_runs_assignee_status
    ON geo_observation_runs (assignee_id, status, created_at DESC)
    WHERE assignee_id IS NOT NULL;
CREATE INDEX ix_geo_runs_target_article_pub
    ON geo_observation_runs (target_article_publication_id)
    WHERE target_article_publication_id IS NOT NULL;

ALTER TABLE geo_answer_snapshots
    ADD COLUMN actual_prompt_text TEXT NULL,
    ADD COLUMN query_modified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT ck_geo_answers_actual_prompt CHECK (
        (query_modified = FALSE AND actual_prompt_text IS NULL)
        OR (
            query_modified = TRUE
            AND actual_prompt_text IS NOT NULL
            AND actual_prompt_text ~ '[^[:space:]]'
            AND length(actual_prompt_text) <= 8000
            AND actual_prompt_text <> prompt_text
        )
    );

CREATE TABLE geo_citation_publication_links (
    id UUID CONSTRAINT pk_geo_citation_publication_links PRIMARY KEY,
    citation_id UUID NOT NULL
        CONSTRAINT fk_geo_cpl_citation REFERENCES geo_answer_citations(id) ON DELETE RESTRICT,
    article_publication_id UUID NOT NULL
        CONSTRAINT fk_geo_cpl_article_pub REFERENCES article_publications(id) ON DELETE RESTRICT,
    match_method VARCHAR(32) NOT NULL
        CONSTRAINT ck_geo_cpl_method CHECK (
            match_method IN (
                'EXACT_NORMALIZED_URL',
                'STRIPPED_TRACKING_CANDIDATE',
                'SAME_DOMAIN_CANDIDATE',
                'MANUAL_SELECTED'
            )
        ),
    link_status VARCHAR(24) NOT NULL
        CONSTRAINT ck_geo_cpl_status CHECK (
            link_status IN ('AUTO_EXACT', 'CANDIDATE', 'CONFIRMED', 'REJECTED')
        ),
    match_reason VARCHAR(500) NOT NULL DEFAULT ''
        CONSTRAINT ck_geo_cpl_reason_len CHECK (length(match_reason) <= 500),
    confirmed_by UUID NULL
        CONSTRAINT fk_geo_cpl_confirmed_by REFERENCES users(id) ON DELETE RESTRICT,
    confirmed_at TIMESTAMPTZ NULL,
    revision INT NOT NULL DEFAULT 0 CONSTRAINT ck_geo_cpl_rev CHECK (revision >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_geo_cpl_citation_pub UNIQUE (citation_id, article_publication_id),
    CONSTRAINT ck_geo_cpl_confirm_pair CHECK (
        (link_status IN ('CONFIRMED', 'REJECTED') AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
        OR (link_status IN ('AUTO_EXACT', 'CANDIDATE') AND confirmed_by IS NULL AND confirmed_at IS NULL)
    ),
    CONSTRAINT ck_geo_cpl_method_status CHECK (
        (match_method = 'EXACT_NORMALIZED_URL' AND link_status IN ('AUTO_EXACT', 'CONFIRMED', 'REJECTED'))
        OR (match_method IN ('STRIPPED_TRACKING_CANDIDATE', 'SAME_DOMAIN_CANDIDATE') AND link_status IN ('CANDIDATE', 'CONFIRMED', 'REJECTED'))
        OR (match_method = 'MANUAL_SELECTED' AND link_status IN ('CONFIRMED', 'REJECTED'))
    )
);

CREATE UNIQUE INDEX uq_geo_cpl_one_effective_per_citation
    ON geo_citation_publication_links (citation_id)
    WHERE link_status IN ('AUTO_EXACT', 'CONFIRMED');
CREATE INDEX ix_geo_cpl_article_pub
    ON geo_citation_publication_links (article_publication_id, link_status);
CREATE INDEX ix_geo_cpl_confirmed_by
    ON geo_citation_publication_links (confirmed_by)
    WHERE confirmed_by IS NOT NULL;
