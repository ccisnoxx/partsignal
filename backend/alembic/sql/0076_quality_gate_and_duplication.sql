-- Slice 3B: Layer 2 optional async AI semantic quality check jobs (append-only, PUBLIC-only egress)

CREATE TABLE content_quality_check_jobs (
    id UUID CONSTRAINT pk_content_quality_check_jobs PRIMARY KEY,
    content_version_id UUID NOT NULL
        CONSTRAINT fk_content_quality_check_jobs_version
        REFERENCES content_versions(id) ON DELETE RESTRICT,
    content_task_id UUID NOT NULL
        CONSTRAINT fk_content_quality_check_jobs_task
        REFERENCES content_tasks(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(128) NOT NULL
        CONSTRAINT uq_content_quality_check_jobs_idempotency_key UNIQUE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CONSTRAINT ck_content_quality_check_jobs_status
        CHECK (status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    ai_channel_id UUID NULL
        CONSTRAINT fk_content_quality_check_jobs_channel
        REFERENCES ai_channels(id) ON DELETE SET NULL,
    ai_model_id UUID NULL
        CONSTRAINT fk_content_quality_check_jobs_model
        REFERENCES ai_models(id) ON DELETE SET NULL,
    adapter_name VARCHAR(64) NOT NULL
        CONSTRAINT ck_content_quality_check_jobs_adapter_nonblank
        CHECK (length(btrim(adapter_name)) > 0),
    input_snapshot JSONB NOT NULL,
    findings JSONB NOT NULL DEFAULT '[]'::jsonb,
    differentiation_suggestions JSONB NOT NULL DEFAULT '[]'::jsonb,
    prompt_tokens INTEGER NULL
        CONSTRAINT ck_content_quality_check_jobs_prompt_tokens
        CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
    completion_tokens INTEGER NULL
        CONSTRAINT ck_content_quality_check_jobs_completion_tokens
        CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
    total_tokens INTEGER NULL
        CONSTRAINT ck_content_quality_check_jobs_total_tokens
        CHECK (total_tokens IS NULL OR total_tokens >= 0),
    response_duration_ms INTEGER NULL
        CONSTRAINT ck_content_quality_check_jobs_duration_ms
        CHECK (response_duration_ms IS NULL OR response_duration_ms >= 0),
    error_code VARCHAR(64) NULL,
    error_summary TEXT NULL,
    created_by UUID NOT NULL
        CONSTRAINT fk_content_quality_check_jobs_created_by
        REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ NULL,
    lease_expires_at TIMESTAMPTZ NULL,
    finished_at TIMESTAMPTZ NULL,
    CONSTRAINT ck_content_quality_check_jobs_findings_array
        CHECK (jsonb_typeof(findings) = 'array'),
    CONSTRAINT ck_content_quality_check_jobs_suggestions_array
        CHECK (jsonb_typeof(differentiation_suggestions) = 'array'),
    CONSTRAINT ck_content_quality_check_jobs_terminal_finished
        CHECK (
            (status IN ('PENDING', 'RUNNING') AND finished_at IS NULL)
            OR (status IN ('SUCCEEDED', 'FAILED') AND finished_at IS NOT NULL)
        )
);

CREATE INDEX ix_content_quality_check_jobs_version_created
    ON content_quality_check_jobs (content_version_id, created_at DESC, id DESC);

CREATE INDEX ix_content_quality_check_jobs_task_created
    ON content_quality_check_jobs (content_task_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX uq_content_quality_check_jobs_active_version
    ON content_quality_check_jobs (content_version_id)
    WHERE status IN ('PENDING', 'RUNNING');

CREATE INDEX ix_content_quality_check_jobs_pending
    ON content_quality_check_jobs (created_at, id)
    WHERE status = 'PENDING';

CREATE INDEX ix_content_quality_check_jobs_running_lease
    ON content_quality_check_jobs (lease_expires_at, id)
    WHERE status = 'RUNNING';

CREATE OR REPLACE FUNCTION partsignal_guard_content_quality_check_job()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_setting('partsignal.content_task_delete_id', true) = OLD.content_task_id::text
           OR current_setting('partsignal.content_version_delete_id', true) = OLD.content_version_id::text
        THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'content quality check jobs are append-only history'
            USING ERRCODE = '55000';
    END IF;

    IF pg_trigger_depth() > 1
       AND (NEW.ai_channel_id IS NULL OR NEW.ai_channel_id = OLD.ai_channel_id)
       AND (NEW.ai_model_id IS NULL OR NEW.ai_model_id = OLD.ai_model_id)
       AND (to_jsonb(NEW) - ARRAY['ai_channel_id', 'ai_model_id'])
           = (to_jsonb(OLD) - ARRAY['ai_channel_id', 'ai_model_id'])
    THEN
        RETURN NEW;
    END IF;

    IF OLD.status IN ('SUCCEEDED', 'FAILED') THEN
        RAISE EXCEPTION 'terminal content quality check jobs are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id <> OLD.id
       OR NEW.content_version_id <> OLD.content_version_id
       OR NEW.content_task_id <> OLD.content_task_id
       OR NEW.idempotency_key <> OLD.idempotency_key
       OR NEW.adapter_name <> OLD.adapter_name
       OR NEW.input_snapshot IS DISTINCT FROM OLD.input_snapshot
       OR NEW.created_by <> OLD.created_by
       OR NEW.created_at <> OLD.created_at
    THEN
        RAISE EXCEPTION 'content quality check job identity and snapshot are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'RUNNING' AND NEW.status = 'PENDING' THEN
        RAISE EXCEPTION 'running content quality check job cannot revert to PENDING'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_content_quality_check_jobs_guard
    BEFORE UPDATE OR DELETE ON content_quality_check_jobs
    FOR EACH ROW
    EXECUTE FUNCTION partsignal_guard_content_quality_check_job();
