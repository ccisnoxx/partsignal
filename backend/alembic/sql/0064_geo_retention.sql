CREATE TABLE geo_manual_draft_tombstones (
    run_id uuid PRIMARY KEY,
    draft_revision integer NOT NULL,
    draft_updated_at timestamptz NOT NULL,
    retention_days integer NOT NULL,
    purged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT fk_geo_draft_tombstones_run FOREIGN KEY(run_id)
        REFERENCES geo_observation_runs(id) ON DELETE RESTRICT,
    CONSTRAINT ck_geo_draft_tombstones_policy CHECK (
        draft_revision >= 1 AND retention_days BETWEEN 1 AND 3650),
    CONSTRAINT ck_geo_draft_tombstones_age CHECK (
        purged_at >= draft_updated_at + retention_days * interval '24 hours')
);
CREATE INDEX ix_geo_manual_drafts_retention ON geo_manual_drafts(updated_at,run_id);
CREATE INDEX ix_file_records_unscheduled_retention ON file_records(verified_at,id)
    WHERE status='VERIFIED' AND cleanup_after IS NULL;

CREATE FUNCTION geo_guard_draft_tombstone() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r geo_observation_runs%ROWTYPE; d geo_manual_drafts%ROWTYPE;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION '草稿清理墓碑不可修改或删除'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_draft_tombstones_immutable';
    END IF;
    SELECT * INTO r FROM geo_observation_runs WHERE id=NEW.run_id FOR UPDATE;
    SELECT * INTO d FROM geo_manual_drafts WHERE run_id=NEW.run_id FOR UPDATE;
    IF NOT FOUND OR r.status NOT IN ('FAILED','CANCELLED','BUDGET_BLOCKED')
        OR r.external_call_state <> 'NOT_STARTED'
        OR r.input_snapshot->'profile'->>'collection_mode' <> 'MANUAL'
        OR EXISTS(SELECT 1 FROM geo_answer_snapshots WHERE run_id=NEW.run_id)
        OR NEW.draft_revision IS DISTINCT FROM d.draft_revision
        OR NEW.draft_updated_at IS DISTINCT FROM d.updated_at
        OR clock_timestamp() < d.updated_at + NEW.retention_days * interval '24 hours' THEN
        RAISE EXCEPTION '只能清理到期、无已提交回答的终态人工草稿'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_draft_tombstones_eligible';
    END IF;
    NEW.purged_at := clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER geo_draft_tombstone_guard BEFORE INSERT OR UPDATE OR DELETE
    ON geo_manual_draft_tombstones FOR EACH ROW EXECUTE FUNCTION geo_guard_draft_tombstone();
CREATE TRIGGER geo_draft_tombstone_no_truncate BEFORE TRUNCATE
    ON geo_manual_draft_tombstones FOR EACH STATEMENT EXECUTE FUNCTION geo_guard_draft_tombstone();

CREATE FUNCTION geo_check_draft_purged() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS(SELECT 1 FROM geo_manual_drafts WHERE run_id=NEW.run_id) THEN
        RAISE EXCEPTION '草稿墓碑必须与清理在同一事务提交'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_draft_tombstones_complete';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_draft_tombstone_complete AFTER INSERT
    ON geo_manual_draft_tombstones DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION geo_check_draft_purged();

CREATE OR REPLACE FUNCTION geo_guard_manual_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r geo_observation_runs%ROWTYPE; f file_records%ROWTYPE; target uuid; count_files integer:=0;
BEGIN
    target:=CASE WHEN TG_OP='DELETE' THEN OLD.run_id ELSE NEW.run_id END;
    SELECT * INTO r FROM geo_observation_runs WHERE id=target FOR UPDATE;
    IF TG_OP='DELETE' AND r.status IN ('FAILED','CANCELLED','BUDGET_BLOCKED')
        AND r.external_call_state='NOT_STARTED'
        AND r.input_snapshot->'profile'->>'collection_mode'='MANUAL'
        AND NOT EXISTS(SELECT 1 FROM geo_answer_snapshots WHERE run_id=target)
        AND EXISTS(SELECT 1 FROM geo_manual_draft_tombstones t WHERE t.run_id=target
            AND t.draft_revision=OLD.draft_revision AND t.draft_updated_at=OLD.updated_at) THEN
        RETURN OLD;
    END IF;
    IF NOT FOUND OR r.input_snapshot->'profile'->>'collection_mode' <> 'MANUAL'
        OR r.status <> 'PENDING' OR r.external_call_state <> 'NOT_STARTED'
        OR EXISTS(SELECT 1 FROM geo_answer_snapshots WHERE run_id=target) THEN
        RAISE EXCEPTION '人工草稿只能编辑待录入运行'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_manual_drafts_editable';
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    IF TG_OP='INSERT' AND NEW.draft_revision <> 1 THEN
        RAISE EXCEPTION '草稿初次版本必须为1'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_manual_drafts_revision';
    END IF;
    IF TG_OP='UPDATE' THEN
        IF ROW(NEW.run_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.run_id,OLD.created_at) THEN
            RAISE EXCEPTION '草稿身份不可更改'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_manual_drafts_identity';
        END IF;
        IF (NEW.draft IS DISTINCT FROM OLD.draft AND NEW.draft_revision <> OLD.draft_revision+1)
            OR (NEW.draft IS NOT DISTINCT FROM OLD.draft AND NEW IS DISTINCT FROM OLD) THEN
            RAISE EXCEPTION '草稿实际修改必须递增独立版本，同值保持原样'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_manual_drafts_revision';
        END IF;
    END IF;
    FOR f IN SELECT * FROM file_records WHERE id=ANY(ARRAY[NEW.screenshot_file_id,NEW.raw_payload_file_id])
        ORDER BY id FOR UPDATE LOOP
        count_files:=count_files+1;
        IF f.uploader_id <> NEW.updated_by OR f.status <> 'VERIFIED' OR f.verified_at IS NULL
            OR f.access_level NOT IN ('INTERNAL','RESTRICTED') OR f.sha256 !~ '^[0-9a-f]{64}$' OR f.size<1
            OR (f.id=NEW.screenshot_file_id AND (f.category <> 'OPERATION_SCREENSHOT'
                OR f.content_type NOT IN ('image/png','image/jpeg','image/webp') OR f.size>10485760))
            OR (f.id=NEW.raw_payload_file_id AND (f.category <> 'EVIDENCE'
                OR f.content_type <> 'text/plain' OR f.size>52428800)) THEN
            RAISE EXCEPTION '草稿证据文件资格无效'
                USING ERRCODE='23514', CONSTRAINT='ck_geo_manual_drafts_file_eligible';
        END IF;
        UPDATE file_records SET cleanup_after=NULL WHERE id=f.id;
    END LOOP;
    IF count_files <> (NEW.screenshot_file_id IS NOT NULL)::integer + (NEW.raw_payload_file_id IS NOT NULL)::integer THEN
        RAISE EXCEPTION '草稿证据文件不存在或重复'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_manual_drafts_file_eligible';
    END IF;
    RETURN NEW;
END $$;
