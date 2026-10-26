CREATE FUNCTION geo_citation_observation_valid(v jsonb, count integer) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF v IS NULL THEN RETURN true; END IF;
    IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF NOT v ?& ARRAY['status','missing_reason'] OR EXISTS (
        SELECT 1 FROM jsonb_object_keys(v) key WHERE key <> ALL(ARRAY['status','missing_reason']))
        OR COALESCE(v->>'status' NOT IN ('COMPLETE','NONE','PARTIAL','UNKNOWN'),true)
        THEN RETURN false; END IF;
    IF v->>'status' IN ('PARTIAL','UNKNOWN') THEN
        IF jsonb_typeof(v->'missing_reason') IS DISTINCT FROM 'string'
            OR length(v->>'missing_reason') NOT BETWEEN 1 AND 2000
            OR length(btrim(v->>'missing_reason', U&'\0009\000A\000B\000C\000D\001C\001D\001E\001F\0020\0085\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000'))=0
            THEN RETURN false; END IF;
    ELSIF v->'missing_reason' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
    RETURN (v->>'status'<>'COMPLETE' OR count>0)
        AND (v->>'status' NOT IN ('NONE','UNKNOWN') OR count=0);
END $$;
ALTER TABLE geo_answer_snapshots ADD COLUMN citation_observation jsonb;
ALTER TABLE geo_answer_snapshots ADD CONSTRAINT ck_geo_answers_citation_observation
    CHECK(geo_citation_observation_valid(citation_observation,citation_count));

CREATE OR REPLACE FUNCTION geo_manual_draft_valid(v jsonb) RETURNS boolean
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
            'screenshot_file_id','citations','collected_at','citation_observation'])) THEN RETURN false; END IF;
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
    IF v ? 'citation_observation' AND NOT geo_citation_observation_valid(
        v->'citation_observation',jsonb_array_length(v->'citations')) THEN RETURN false; END IF;
    RETURN true;
END $$;

