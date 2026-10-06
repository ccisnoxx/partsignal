CREATE FUNCTION geo_manual_draft_valid(v jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c jsonb; k text; pos integer[] := '{}';
BEGIN
    IF jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT v ?& ARRAY[
        'answer_text','answer_format','source_product','source_model','source_version',
        'web_search_observed','raw_payload_summary','raw_payload_file_id',
        'screenshot_file_id','citations','collected_at']
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(v) key WHERE key <> ALL(ARRAY[
            'answer_text','answer_format','source_product','source_model','source_version',
            'web_search_observed','raw_payload_summary','raw_payload_file_id',
            'screenshot_file_id','citations','collected_at'])) THEN RETURN false; END IF;
    IF jsonb_typeof(v->'answer_text') IS DISTINCT FROM 'string'
        OR length(v->>'answer_text') > 1048576
        OR COALESCE((v->>'answer_format') NOT IN ('TEXT','MARKDOWN','HTML_TEXT'),true)
        OR NOT geo_raw_summary_valid(v->'raw_payload_summary')
        OR jsonb_typeof(v->'web_search_observed') NOT IN ('boolean','null')
        OR jsonb_typeof(v->'citations') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOREACH k IN ARRAY ARRAY['source_product','source_model','source_version'] LOOP
        IF jsonb_typeof(v->k) <> 'null' AND (jsonb_typeof(v->k) <> 'string'
            OR length(btrim(v->>k))=0
            OR btrim(v->>k, U&'\0009\000A\000B\000C\000D\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000') <> v->>k
            OR length(v->>k) > CASE WHEN k='source_product' THEN 160 ELSE 200 END)
            THEN RETURN false; END IF;
    END LOOP;
    IF NOT geo_snapshot_uuids(v, '{}', ARRAY['raw_payload_file_id','screenshot_file_id']) THEN RETURN false; END IF;
    IF v->'collected_at' <> 'null'::jsonb THEN
        -- 应用保存 UTC 微秒表示；格式与日期都校验，避免非法JSON破坏后续读模型。
        IF jsonb_typeof(v->'collected_at') IS DISTINCT FROM 'string'
            OR (v->>'collected_at') !~
            '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{6}\+00:00$'
            THEN RETURN false; END IF;
        BEGIN
            PERFORM (v->>'collected_at')::timestamptz;
        EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
        END;
    END IF;
    IF jsonb_array_length(v->'citations') > 1000 THEN RETURN false; END IF;
    FOR c IN SELECT value FROM jsonb_array_elements(v->'citations') LOOP
        IF jsonb_typeof(c) IS DISTINCT FROM 'object'
            OR NOT c ?& ARRAY['original_url','position','title','extraction_source']
            OR EXISTS (SELECT 1 FROM jsonb_object_keys(c) key
                WHERE key <> ALL(ARRAY['original_url','position','title','extraction_source']))
            OR jsonb_typeof(c->'original_url') IS DISTINCT FROM 'string'
            OR length(c->>'original_url') NOT BETWEEN 1 AND 2083
            OR (c->>'original_url') !~* '^https?://[^/?#]+'
            OR substring(c->>'original_url' FROM '(?i)^https?://([^/?#]+)') LIKE '%@%'
            OR (c->>'original_url') ~ '[[:space:][:cntrl:]\\]'
            OR (c->>'original_url') ~* '%([01][0-9a-f]|7f)'
            OR (c->>'original_url') ~ '%(?![0-9a-fA-F]{2})'
            OR (c->>'extraction_source') IS DISTINCT FROM 'MANUAL'
            OR jsonb_typeof(c->'position') IS DISTINCT FROM 'number'
            OR (c->>'position') !~ '^[0-9]+$'
            OR (c->>'position')::numeric NOT BETWEEN 1 AND 1000
            OR (jsonb_typeof(c->'title') <> 'null' AND (jsonb_typeof(c->'title') <> 'string'
                OR length(c->>'title') > 2000)) THEN RETURN false; END IF;
        IF (c->>'position')::integer=ANY(pos) THEN RETURN false; END IF;
        pos:=array_append(pos,(c->>'position')::integer);
    END LOOP;
    RETURN true;
END $$;

CREATE TABLE geo_manual_drafts (
    run_id uuid NOT NULL,
    draft_revision integer NOT NULL,
    draft jsonb NOT NULL,
    screenshot_file_id uuid,
    raw_payload_file_id uuid,
    updated_by uuid NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT pk_geo_manual_drafts PRIMARY KEY(run_id),
    CONSTRAINT fk_geo_manual_drafts_run FOREIGN KEY(run_id) REFERENCES geo_observation_runs(id) ON DELETE RESTRICT,
    CONSTRAINT fk_geo_manual_drafts_screenshot FOREIGN KEY(screenshot_file_id) REFERENCES file_records(id) ON DELETE RESTRICT,
    CONSTRAINT fk_geo_manual_drafts_raw FOREIGN KEY(raw_payload_file_id) REFERENCES file_records(id) ON DELETE RESTRICT,
    CONSTRAINT fk_geo_manual_drafts_actor FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT ck_geo_manual_drafts_revision CHECK(draft_revision >= 1),
    CONSTRAINT ck_geo_manual_drafts_payload CHECK(geo_manual_draft_valid(draft)),
    CONSTRAINT ck_geo_manual_drafts_files CHECK(
        (draft->>'screenshot_file_id')::uuid IS NOT DISTINCT FROM screenshot_file_id AND
        (draft->>'raw_payload_file_id')::uuid IS NOT DISTINCT FROM raw_payload_file_id AND
        (screenshot_file_id IS NULL OR raw_payload_file_id IS NULL OR screenshot_file_id <> raw_payload_file_id))
);
CREATE INDEX ix_geo_manual_drafts_screenshot_file ON geo_manual_drafts(screenshot_file_id);
CREATE INDEX ix_geo_manual_drafts_raw_file ON geo_manual_drafts(raw_payload_file_id);
CREATE INDEX ix_geo_manual_drafts_actor ON geo_manual_drafts(updated_by);

CREATE TABLE geo_manual_submissions (
    identity_hash varchar(64) NOT NULL,
    request_hash varchar(64) NOT NULL,
    run_id uuid NOT NULL,
    answer_snapshot_id uuid NOT NULL,
    submitted_by uuid NOT NULL,
    run_revision integer NOT NULL,
    draft_revision integer NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT pk_geo_manual_submissions PRIMARY KEY(identity_hash),
    CONSTRAINT uq_geo_manual_submissions_run UNIQUE(run_id),
    CONSTRAINT uq_geo_manual_submissions_answer UNIQUE(answer_snapshot_id),
    CONSTRAINT fk_geo_manual_submissions_run FOREIGN KEY(run_id) REFERENCES geo_observation_runs(id) ON DELETE RESTRICT,
    CONSTRAINT fk_geo_manual_submissions_answer FOREIGN KEY(answer_snapshot_id) REFERENCES geo_answer_snapshots(id) ON DELETE RESTRICT,
    CONSTRAINT fk_geo_manual_submissions_actor FOREIGN KEY(submitted_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT ck_geo_manual_submissions_hashes CHECK(identity_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_geo_manual_submissions_revisions CHECK(run_revision >= 1 AND draft_revision >= 0)
);
CREATE INDEX ix_geo_manual_submissions_actor ON geo_manual_submissions(submitted_by);

CREATE FUNCTION geo_guard_manual_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r geo_observation_runs%ROWTYPE; f file_records%ROWTYPE; target uuid; count_files integer:=0;
BEGIN
    target:=CASE WHEN TG_OP='DELETE' THEN OLD.run_id ELSE NEW.run_id END;
    SELECT * INTO r FROM geo_observation_runs WHERE id=target FOR UPDATE;
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
CREATE TRIGGER geo_manual_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_manual_drafts
    FOR EACH ROW EXECUTE FUNCTION geo_guard_manual_draft();

CREATE FUNCTION geo_guard_manual_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r geo_observation_runs%ROWTYPE; answer_run uuid;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION '人工正式提交身份不可修改或删除'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_manual_submissions_immutable';
    END IF;
    SELECT * INTO r FROM geo_observation_runs WHERE id=NEW.run_id FOR UPDATE;
    SELECT run_id INTO answer_run FROM geo_answer_snapshots WHERE id=NEW.answer_snapshot_id;
    IF r.id IS NULL OR answer_run IS DISTINCT FROM NEW.run_id
        OR r.input_snapshot->'profile'->>'collection_mode' <> 'MANUAL'
        OR r.status <> 'COLLECTED' OR r.revision <> NEW.run_revision
        OR EXISTS(SELECT 1 FROM geo_manual_drafts WHERE run_id=NEW.run_id) THEN
        RAISE EXCEPTION '正式提交必须对应同运行的完整人工证据和已提交版本'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_manual_submissions_complete';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_manual_submission_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_manual_submissions
    FOR EACH ROW EXECUTE FUNCTION geo_guard_manual_submission();
