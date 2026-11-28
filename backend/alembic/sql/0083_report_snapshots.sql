-- Slice 1D: 领导效果看板冻结周/月报快照与修订链（完全不可变）

CREATE TABLE geo_report_snapshots (
    id UUID CONSTRAINT pk_geo_report_snapshots PRIMARY KEY,
    report_kind VARCHAR(16) NOT NULL
        CONSTRAINT ck_geo_report_snapshots_kind CHECK (report_kind IN ('WEEKLY', 'MONTHLY', 'CUSTOM')),
    title VARCHAR(200) NOT NULL
        CONSTRAINT ck_geo_report_snapshots_title CHECK (length(btrim(title)) BETWEEN 1 AND 200),
    period_from TIMESTAMPTZ NOT NULL,
    period_to TIMESTAMPTZ NOT NULL,
    data_cutoff_at TIMESTAMPTZ NOT NULL,
    filter_scope JSONB NOT NULL,
    core_cohort_snapshot JSONB NOT NULL,
    dashboard_payload JSONB NOT NULL,
    evidence_run_ids UUID[] NOT NULL DEFAULT '{}'::UUID[],
    summary_notes TEXT NOT NULL DEFAULT ''
        CONSTRAINT ck_geo_report_snapshots_notes CHECK (length(summary_notes) <= 8000),
    revision_no INT NOT NULL DEFAULT 1
        CONSTRAINT ck_geo_report_snapshots_rev CHECK (revision_no >= 1),
    supersedes_snapshot_id UUID NULL
        CONSTRAINT fk_geo_report_snapshots_supersedes REFERENCES geo_report_snapshots(id) ON DELETE RESTRICT,
    correction_reason TEXT NULL,
    created_by UUID NOT NULL
        CONSTRAINT fk_geo_report_snapshots_creator REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_geo_report_snapshots_period CHECK (period_to > period_from),
    CONSTRAINT ck_geo_report_snapshots_supersedes_chain CHECK (
        (supersedes_snapshot_id IS NULL AND revision_no = 1 AND correction_reason IS NULL)
        OR (
            supersedes_snapshot_id IS NOT NULL
            AND revision_no > 1
            AND supersedes_snapshot_id <> id
            AND length(btrim(COALESCE(correction_reason, ''))) BETWEEN 1 AND 1000
        )
    )
);

CREATE UNIQUE INDEX uq_geo_report_snapshots_supersedes_once
    ON geo_report_snapshots (supersedes_snapshot_id)
    WHERE supersedes_snapshot_id IS NOT NULL;
CREATE INDEX ix_geo_report_snapshots_period_created
    ON geo_report_snapshots (period_from DESC, created_at DESC, id);
CREATE INDEX ix_geo_report_snapshots_creator
    ON geo_report_snapshots (created_by);

CREATE OR REPLACE FUNCTION partsignal_guard_report_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'frozen report snapshot table % cannot be modified or deleted', TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_geo_report_snapshots_immutable
    BEFORE UPDATE OR DELETE ON geo_report_snapshots
    FOR EACH ROW EXECUTE FUNCTION partsignal_guard_report_snapshot_immutable();
CREATE TRIGGER trg_geo_report_snapshots_no_truncate
    BEFORE TRUNCATE ON geo_report_snapshots
    FOR EACH STATEMENT EXECUTE FUNCTION partsignal_guard_report_snapshot_immutable();
