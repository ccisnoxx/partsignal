-- Slice 4A: GEO R6 之上的干预编排与归因聚合表 geo_interventions

CREATE TABLE geo_interventions (
    id UUID CONSTRAINT pk_geo_interventions PRIMARY KEY,
    opportunity_id UUID NOT NULL
        CONSTRAINT fk_geo_interventions_opportunity
        REFERENCES geo_opportunities(id) ON DELETE RESTRICT,
    campaign_id UUID NULL
        CONSTRAINT fk_geo_interventions_campaign
        REFERENCES content_campaigns(id) ON DELETE RESTRICT,
    title VARCHAR(200) NOT NULL
        CONSTRAINT ck_geo_interventions_title_nonempty
        CHECK (btrim(title) <> '' AND title = btrim(title)),
    hypothesis TEXT NOT NULL
        CONSTRAINT ck_geo_interventions_hypothesis_bounds
        CHECK (btrim(hypothesis) <> '' AND length(hypothesis) <= 2000),
    planned_action_type VARCHAR(40) NOT NULL
        CONSTRAINT ck_geo_interventions_action_type
        CHECK (planned_action_type IN (
            'FACT_REVISION', 'CONTENT_TASK', 'PUBLICATION_REPAIR',
            'ADDITIONAL_MONITORING', 'OTHER'
        )),
    target_metrics JSONB NOT NULL DEFAULT '{}'::jsonb
        CONSTRAINT ck_geo_interventions_target_metrics_object
        CHECK (jsonb_typeof(target_metrics) = 'object'),
    status VARCHAR(20) NOT NULL DEFAULT 'PLANNED'
        CONSTRAINT ck_geo_interventions_status
        CHECK (status IN ('PLANNED', 'ACTIVE', 'EVALUATING', 'CONCLUDED', 'CANCELLED')),
    outcome_verdict VARCHAR(32) NULL
        CONSTRAINT ck_geo_interventions_outcome_verdict
        CHECK (outcome_verdict IS NULL OR outcome_verdict IN (
            'TARGET_MET', 'PARTIAL_IMPROVEMENT', 'NO_IMPROVEMENT', 'INSUFFICIENT_DATA'
        )),
    causal_claim VARCHAR(32) NOT NULL DEFAULT 'NOT_ESTABLISHED'
        CONSTRAINT ck_geo_interventions_causal_claim
        CHECK (causal_claim = 'NOT_ESTABLISHED'),
    baseline_id UUID NULL
        CONSTRAINT fk_geo_interventions_baseline
        REFERENCES geo_retest_baselines(id) ON DELETE RESTRICT,
    decision_id UUID NULL
        CONSTRAINT fk_geo_interventions_decision
        REFERENCES geo_opportunity_decisions(id) ON DELETE RESTRICT,
    assignee_id UUID NULL
        CONSTRAINT fk_geo_interventions_assignee
        REFERENCES users(id) ON DELETE RESTRICT,
    intervened_at TIMESTAMPTZ NULL,
    retest_window_start TIMESTAMPTZ NULL,
    retest_window_end TIMESTAMPTZ NULL,
    concluded_at TIMESTAMPTZ NULL,
    conclusion_note TEXT NOT NULL DEFAULT ''
        CONSTRAINT ck_geo_interventions_conclusion_note_len
        CHECK (length(conclusion_note) <= 2000),
    revision INTEGER NOT NULL DEFAULT 0
        CONSTRAINT ck_geo_interventions_revision_nonneg
        CHECK (revision >= 0),
    created_by UUID NOT NULL
        CONSTRAINT fk_geo_interventions_created_by
        REFERENCES users(id) ON DELETE RESTRICT,
    updated_by UUID NOT NULL
        CONSTRAINT fk_geo_interventions_updated_by
        REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_geo_interventions_retest_window
        CHECK (
            retest_window_start IS NULL
            OR retest_window_end IS NULL
            OR retest_window_start <= retest_window_end
        ),
    CONSTRAINT ck_geo_interventions_conclusion_pair
        CHECK (
            (status = 'CONCLUDED'
                AND outcome_verdict IS NOT NULL
                AND concluded_at IS NOT NULL
                AND length(btrim(conclusion_note)) > 0)
            OR (status <> 'CONCLUDED'
                AND outcome_verdict IS NULL
                AND concluded_at IS NULL)
        )
);

CREATE INDEX ix_geo_interventions_opportunity
    ON geo_interventions (opportunity_id, created_at DESC, id DESC);

CREATE INDEX ix_geo_interventions_campaign
    ON geo_interventions (campaign_id, created_at DESC, id DESC)
    WHERE campaign_id IS NOT NULL;

CREATE INDEX ix_geo_interventions_status_updated
    ON geo_interventions (status, updated_at DESC, id DESC);

CREATE INDEX ix_geo_interventions_assignee
    ON geo_interventions (assignee_id)
    WHERE assignee_id IS NOT NULL;

CREATE INDEX ix_geo_interventions_created_by
    ON geo_interventions (created_by);

CREATE INDEX ix_geo_interventions_updated_by
    ON geo_interventions (updated_by);

CREATE OR REPLACE FUNCTION partsignal_guard_geo_intervention() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'PLANNED' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'only PLANNED geo_interventions may be deleted'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status IN ('CONCLUDED', 'CANCELLED') THEN
            RAISE EXCEPTION 'terminal geo_interventions rows are immutable'
                USING ERRCODE = '55000';
        END IF;
        IF NEW.id <> OLD.id
            OR NEW.opportunity_id <> OLD.opportunity_id
            OR NEW.created_by <> OLD.created_by
            OR NEW.created_at <> OLD.created_at
        THEN
            RAISE EXCEPTION 'geo_interventions identity columns are immutable'
                USING ERRCODE = '55000';
        END IF;
        IF OLD.status IN ('ACTIVE', 'EVALUATING') AND NEW.status = 'PLANNED' THEN
            RAISE EXCEPTION 'active or evaluating geo_interventions cannot revert to PLANNED'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    IF NEW.baseline_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM geo_retest_baselines b
        WHERE b.id = NEW.baseline_id AND b.opportunity_id = NEW.opportunity_id
    ) THEN
        RAISE EXCEPTION 'geo_interventions baseline must belong to the same opportunity'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.decision_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM geo_opportunity_decisions d
        WHERE d.id = NEW.decision_id AND d.opportunity_id = NEW.opportunity_id
    ) THEN
        RAISE EXCEPTION 'geo_interventions decision must belong to the same opportunity'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_geo_interventions_guard
    BEFORE INSERT OR UPDATE OR DELETE ON geo_interventions
    FOR EACH ROW EXECUTE FUNCTION partsignal_guard_geo_intervention();
