"""新增独立回答级 Batch/Run，冻结 DDL 与快照/写入守卫，不迁移旧 GEO。"""

from pathlib import Path

from alembic import op

revision = "0048_geo_batches_runs"
down_revision = "0047_geo_monitoring_plans"
branch_labels = None
depends_on = None


def upgrade() -> None:
    sql_dir = Path(__file__).resolve().parents[1] / "sql"
    op.execute((sql_dir / "0048_geo_run_snapshots.sql").read_text())
    # 以下 DDL 已冻结；历史执行不导入运行时 ORM。
    op.execute("""
CREATE TABLE geo_observation_batches (
	id UUID NOT NULL,
	plan_id UUID,
	trigger_type VARCHAR(16) NOT NULL,
	status VARCHAR(20) DEFAULT 'PLANNED' NOT NULL,
	revision INTEGER DEFAULT '0' NOT NULL,
	scheduled_for TIMESTAMP WITH TIME ZONE,
	schedule_identity VARCHAR(64),
	plan_snapshot JSONB NOT NULL,
	rule_snapshot JSONB NOT NULL,
	requested_run_count INTEGER NOT NULL,
	source_opportunity_id UUID,
	baseline_batch_id UUID,
	created_by UUID,
	started_at TIMESTAMP WITH TIME ZONE,
	finished_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_geo_observation_batches PRIMARY KEY (id),
	CONSTRAINT uq_geo_batches_schedule_window UNIQUE (plan_id, scheduled_for),
	CONSTRAINT ck_geo_batches_trigger CHECK (trigger_type IN ('SCHEDULED','MANUAL','RETEST')),
	CONSTRAINT ck_geo_batches_status CHECK (status IN ('PLANNED','QUEUED','RUNNING','COMPLETED','PARTIAL','FAILED','CANCELLED','BUDGET_BLOCKED')),
	CONSTRAINT ck_geo_batches_schedule CHECK ((trigger_type = 'SCHEDULED' AND plan_id IS NOT NULL AND scheduled_for IS NOT NULL AND schedule_identity IS NOT NULL AND schedule_identity ~ '^[0-9a-f]{64}$') OR (trigger_type <> 'SCHEDULED' AND scheduled_for IS NULL AND schedule_identity IS NULL)),
	CONSTRAINT ck_geo_batches_retest CHECK ((trigger_type = 'RETEST' AND source_opportunity_id IS NOT NULL AND baseline_batch_id IS NOT NULL AND baseline_batch_id <> id) OR (trigger_type <> 'RETEST' AND source_opportunity_id IS NULL AND baseline_batch_id IS NULL)),
	CONSTRAINT ck_geo_batches_actor CHECK (trigger_type = 'SCHEDULED' OR created_by IS NOT NULL),
	CONSTRAINT ck_geo_batches_count CHECK (requested_run_count >= 1),
	CONSTRAINT ck_geo_batches_revision CHECK (revision >= 0),
	CONSTRAINT ck_geo_batches_snapshots CHECK (geo_batch_snapshots_valid(plan_snapshot, rule_snapshot, plan_id)),
	CONSTRAINT ck_geo_batches_time CHECK ((started_at IS NULL OR started_at >= created_at) AND (finished_at IS NULL OR finished_at >= COALESCE(started_at,created_at)) AND ((status IN ('COMPLETED','PARTIAL','FAILED','CANCELLED','BUDGET_BLOCKED')) = (finished_at IS NOT NULL))),
	CONSTRAINT fk_geo_batches_plan FOREIGN KEY(plan_id) REFERENCES geo_monitoring_plans (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_batches_baseline FOREIGN KEY(baseline_batch_id) REFERENCES geo_observation_batches (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_batches_creator FOREIGN KEY(created_by) REFERENCES users (id) ON DELETE RESTRICT
);
CREATE INDEX ix_geo_batches_baseline ON geo_observation_batches (baseline_batch_id);
CREATE INDEX ix_geo_batches_creator ON geo_observation_batches (created_by);
CREATE INDEX ix_geo_batches_plan_created ON geo_observation_batches (plan_id, created_at, id);
CREATE INDEX ix_geo_batches_status_created ON geo_observation_batches (status, created_at, id);
CREATE UNIQUE INDEX uq_geo_batches_schedule_identity ON geo_observation_batches (schedule_identity) WHERE schedule_identity IS NOT NULL;
CREATE TABLE geo_observation_runs (
	id UUID NOT NULL,
	batch_id UUID NOT NULL,
	prompt_variant_id UUID NOT NULL,
	collection_profile_id UUID NOT NULL,
	repeat_index INTEGER NOT NULL,
	run_cell_key VARCHAR(64) GENERATED ALWAYS AS (geo_run_cell_key(prompt_variant_id, collection_profile_id, repeat_index)) STORED NOT NULL,
	attempt_no INTEGER DEFAULT '1' NOT NULL,
	previous_attempt_id UUID,
	status VARCHAR(20) DEFAULT 'PENDING' NOT NULL,
	revision INTEGER DEFAULT '0' NOT NULL,
	input_snapshot JSONB NOT NULL,
	external_call_state VARCHAR(24) DEFAULT 'NOT_STARTED' NOT NULL,
	lease_token UUID,
	lease_expires_at TIMESTAMP WITH TIME ZONE,
	dispatch_attempt_count INTEGER DEFAULT '0' NOT NULL,
	last_dispatch_attempt_at TIMESTAMP WITH TIME ZONE,
	error_stage VARCHAR(24),
	error_code VARCHAR(100),
	error_summary VARCHAR(500),
	provider_request_id VARCHAR(200),
	duration_ms BIGINT,
	cost_amount NUMERIC(14, 6),
	cost_currency VARCHAR(8),
	prompt_tokens INTEGER,
	completion_tokens INTEGER,
	total_tokens INTEGER,
	started_at TIMESTAMP WITH TIME ZONE,
	collected_at TIMESTAMP WITH TIME ZONE,
	finished_at TIMESTAMP WITH TIME ZONE,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_geo_observation_runs PRIMARY KEY (id),
	CONSTRAINT uq_geo_runs_cell_attempt UNIQUE (batch_id, run_cell_key, attempt_no),
	CONSTRAINT ck_geo_runs_status CHECK (status IN ('PENDING','RUNNING','COLLECTED','ANALYZING','NEEDS_REVIEW','COMPLETED','FAILED','CANCELLED','BUDGET_BLOCKED')),
	CONSTRAINT ck_geo_runs_repeat CHECK (repeat_index BETWEEN 1 AND 10),
	CONSTRAINT ck_geo_runs_attempt CHECK (attempt_no >= 1),
	CONSTRAINT ck_geo_runs_previous CHECK ((attempt_no = 1 AND previous_attempt_id IS NULL) OR (attempt_no > 1 AND previous_attempt_id IS NOT NULL AND previous_attempt_id <> id)),
	CONSTRAINT ck_geo_runs_revision CHECK (revision >= 0),
	CONSTRAINT ck_geo_runs_input CHECK (geo_run_input_valid(input_snapshot) AND input_snapshot->'prompt'->>'id' = prompt_variant_id::text AND input_snapshot->'profile'->>'id' = collection_profile_id::text),
	CONSTRAINT ck_geo_runs_external CHECK (external_call_state IN ('NOT_STARTED','SENT','UNKNOWN','COMPLETED') AND (status NOT IN ('PENDING','CANCELLED','BUDGET_BLOCKED') OR external_call_state = 'NOT_STARTED')),
	CONSTRAINT ck_geo_runs_lease CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL) AND ((status IN ('RUNNING','ANALYZING')) = (lease_token IS NOT NULL)) AND (lease_expires_at IS NULL OR lease_expires_at > started_at)),
	CONSTRAINT ck_geo_runs_dispatch CHECK (dispatch_attempt_count >= 0 AND ((dispatch_attempt_count = 0) = (last_dispatch_attempt_at IS NULL)) AND (last_dispatch_attempt_at IS NULL OR last_dispatch_attempt_at >= created_at)),
	CONSTRAINT ck_geo_runs_error CHECK ((status IN ('FAILED','BUDGET_BLOCKED') AND error_stage IS NOT NULL AND error_code IS NOT NULL AND error_stage IN ('COLLECTION','ANALYSIS','REVIEW') AND error_code IN ('COLLECTOR_CONFIGURATION_INVALID','COLLECTOR_DISABLED','PROVIDER_AUTH_FAILED','PROVIDER_RATE_LIMITED','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_RESPONSE_INVALID','PROVIDER_RESPONSE_TOO_LARGE','COLLECTOR_UNKNOWN_OUTCOME','DATA_CLASSIFICATION_FORBIDDEN','PROFILE_NEEDS_REAUTH','WORKER_LOST','BUDGET_EXCEEDED','ANALYSIS_FAILED','REVIEW_FAILED') AND error_summary IS NOT NULL AND length(btrim(error_summary)) > 0) OR (status NOT IN ('FAILED','BUDGET_BLOCKED') AND error_stage IS NULL AND error_code IS NULL AND error_summary IS NULL)),
	CONSTRAINT ck_geo_runs_provider CHECK (provider_request_id IS NULL OR (length(provider_request_id) > 0 AND provider_request_id !~ '^[[:space:]]|[[:space:]]$')),
	CONSTRAINT ck_geo_runs_duration CHECK (duration_ms IS NULL OR duration_ms >= 0),
	CONSTRAINT ck_geo_runs_cost CHECK ((cost_amount IS NULL AND cost_currency IS NULL) OR (cost_amount IS NOT NULL AND cost_currency IS NOT NULL AND cost_amount >= 0 AND cost_amount < 'Infinity'::numeric AND cost_currency ~ '^[A-Z]{3}$')),
	CONSTRAINT ck_geo_runs_usage CHECK ((prompt_tokens IS NULL OR prompt_tokens >= 0) AND (completion_tokens IS NULL OR completion_tokens >= 0) AND (total_tokens IS NULL OR total_tokens >= 0)),
	CONSTRAINT ck_geo_runs_time CHECK ((started_at IS NULL OR started_at >= created_at) AND (collected_at IS NULL OR (started_at IS NOT NULL AND collected_at >= started_at)) AND (finished_at IS NULL OR finished_at >= COALESCE(collected_at,started_at,created_at)) AND ((status IN ('COMPLETED','FAILED','CANCELLED','BUDGET_BLOCKED')) = (finished_at IS NOT NULL)) AND (status NOT IN ('PENDING','CANCELLED','BUDGET_BLOCKED') OR started_at IS NULL) AND (status NOT IN ('RUNNING','COLLECTED','ANALYZING','NEEDS_REVIEW','COMPLETED') OR started_at IS NOT NULL) AND (status NOT IN ('COLLECTED','ANALYZING','NEEDS_REVIEW','COMPLETED') OR collected_at IS NOT NULL) AND (status NOT IN ('PENDING','RUNNING','CANCELLED','BUDGET_BLOCKED') OR collected_at IS NULL)),
	CONSTRAINT fk_geo_runs_batch FOREIGN KEY(batch_id) REFERENCES geo_observation_batches (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_runs_prompt FOREIGN KEY(prompt_variant_id) REFERENCES geo_prompt_variants (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_runs_profile FOREIGN KEY(collection_profile_id) REFERENCES geo_collection_profiles (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_runs_previous FOREIGN KEY(previous_attempt_id) REFERENCES geo_observation_runs (id) ON DELETE RESTRICT
);
CREATE INDEX ix_geo_runs_batch_status ON geo_observation_runs (batch_id, status, id);
CREATE INDEX ix_geo_runs_pending_dispatch_due ON geo_observation_runs (COALESCE(last_dispatch_attempt_at, created_at), id) WHERE status = 'PENDING';
CREATE INDEX ix_geo_runs_profile_created ON geo_observation_runs (collection_profile_id, created_at, id);
CREATE INDEX ix_geo_runs_prompt ON geo_observation_runs (prompt_variant_id);
CREATE INDEX ix_geo_runs_running_lease ON geo_observation_runs (lease_expires_at, id) WHERE status IN ('RUNNING','ANALYZING');
CREATE INDEX ix_geo_runs_status_created ON geo_observation_runs (status, created_at, id);
CREATE UNIQUE INDEX uq_geo_runs_successor ON geo_observation_runs (previous_attempt_id) WHERE previous_attempt_id IS NOT NULL;
    """)
    op.execute((sql_dir / "0048_geo_run_guards.sql").read_text())


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            RAISE EXCEPTION '0048 Batch/Run 无法安全降级；保留历史并使用前向修复'
                USING ERRCODE = '55000';
        END $$;
    """)
