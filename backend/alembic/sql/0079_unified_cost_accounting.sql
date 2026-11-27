-- Slice 4B: 统一 AI 模型单价、作业冻结成本与人工/外采运营费用台账

ALTER TABLE ai_models
    ADD COLUMN input_price_per_1m_tokens NUMERIC(14, 6) NULL,
    ADD COLUMN output_price_per_1m_tokens NUMERIC(14, 6) NULL,
    ADD COLUMN price_currency VARCHAR(8) NULL;

ALTER TABLE ai_models
    ADD CONSTRAINT ck_ai_models_pricing_triplet
        CHECK (
            (input_price_per_1m_tokens IS NULL
                AND output_price_per_1m_tokens IS NULL
                AND price_currency IS NULL)
            OR (input_price_per_1m_tokens IS NOT NULL
                AND output_price_per_1m_tokens IS NOT NULL
                AND price_currency IS NOT NULL
                AND input_price_per_1m_tokens >= 0
                AND output_price_per_1m_tokens >= 0
                AND price_currency ~ '^[A-Z]{3}$')
        );

ALTER TABLE generation_jobs
    ADD COLUMN cost_amount NUMERIC(14, 6) NULL,
    ADD COLUMN cost_currency VARCHAR(8) NULL;

ALTER TABLE generation_jobs
    ADD CONSTRAINT ck_generation_jobs_cost_pair
        CHECK (
            (cost_amount IS NULL AND cost_currency IS NULL)
            OR (cost_amount IS NOT NULL
                AND cost_currency IS NOT NULL
                AND cost_amount >= 0
                AND cost_currency ~ '^[A-Z]{3}$')
        );

ALTER TABLE content_quality_check_jobs
    ADD COLUMN cost_amount NUMERIC(14, 6) NULL,
    ADD COLUMN cost_currency VARCHAR(8) NULL;

ALTER TABLE content_quality_check_jobs
    ADD CONSTRAINT ck_content_quality_check_jobs_cost_pair
        CHECK (
            (cost_amount IS NULL AND cost_currency IS NULL)
            OR (cost_amount IS NOT NULL
                AND cost_currency IS NOT NULL
                AND cost_amount >= 0
                AND cost_currency ~ '^[A-Z]{3}$')
        );

CREATE TABLE operating_cost_entries (
    id UUID CONSTRAINT pk_operating_cost_entries PRIMARY KEY,
    campaign_id UUID NULL
        CONSTRAINT fk_operating_cost_entries_campaign
        REFERENCES content_campaigns(id) ON DELETE RESTRICT,
    geo_intervention_id UUID NULL
        CONSTRAINT fk_operating_cost_entries_intervention
        REFERENCES geo_interventions(id) ON DELETE RESTRICT,
    category VARCHAR(32) NOT NULL
        CONSTRAINT ck_operating_cost_entries_category
        CHECK (category IN ('LABOR', 'EXTERNAL_PLACEMENT', 'OTHER')),
    amount NUMERIC(14, 2) NOT NULL
        CONSTRAINT ck_operating_cost_entries_amount_nonneg
        CHECK (amount >= 0),
    currency VARCHAR(8) NOT NULL
        CONSTRAINT ck_operating_cost_entries_currency
        CHECK (currency ~ '^[A-Z]{3}$'),
    incurred_on DATE NOT NULL,
    note VARCHAR(500) NOT NULL DEFAULT '',
    voided_at TIMESTAMPTZ NULL,
    voided_by UUID NULL
        CONSTRAINT fk_operating_cost_entries_voided_by
        REFERENCES users(id) ON DELETE RESTRICT,
    void_reason VARCHAR(300) NULL,
    created_by UUID NOT NULL
        CONSTRAINT fk_operating_cost_entries_created_by
        REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_operating_cost_entries_owner
        CHECK (campaign_id IS NOT NULL OR geo_intervention_id IS NOT NULL),
    CONSTRAINT ck_operating_cost_entries_void_pair
        CHECK (
            (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
            OR (voided_at IS NOT NULL
                AND voided_by IS NOT NULL
                AND void_reason IS NOT NULL
                AND length(btrim(void_reason)) > 0)
        )
);

CREATE INDEX ix_operating_cost_entries_campaign
    ON operating_cost_entries (campaign_id, incurred_on DESC, id DESC)
    WHERE campaign_id IS NOT NULL;

CREATE INDEX ix_operating_cost_entries_intervention
    ON operating_cost_entries (geo_intervention_id, incurred_on DESC, id DESC)
    WHERE geo_intervention_id IS NOT NULL;

CREATE INDEX ix_operating_cost_entries_incurred_on
    ON operating_cost_entries (incurred_on DESC, id DESC);

CREATE INDEX ix_operating_cost_entries_created_by
    ON operating_cost_entries (created_by);

CREATE INDEX ix_operating_cost_entries_voided_by
    ON operating_cost_entries (voided_by)
    WHERE voided_by IS NOT NULL;

CREATE OR REPLACE FUNCTION partsignal_guard_operating_cost_entry() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'operating_cost_entries rows are append-only; void instead of deleting'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.voided_at IS NULL
            AND NEW.voided_at IS NOT NULL
            AND (to_jsonb(NEW) - ARRAY['voided_at', 'voided_by', 'void_reason'])
                = (to_jsonb(OLD) - ARRAY['voided_at', 'voided_by', 'void_reason'])
        THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'operating_cost_entries rows are immutable except one-time voiding'
            USING ERRCODE = '55000';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_operating_cost_entries_immutable
    BEFORE UPDATE OR DELETE ON operating_cost_entries
    FOR EACH ROW EXECUTE FUNCTION partsignal_guard_operating_cost_entry();
