-- 固定 UUID/整数 ASCII 表示与显式 UTF8 编码不依赖会话设置。
-- convert_to 的通用实现为 STABLE；此受限输入函数可安全用于生成列。
CREATE FUNCTION geo_run_cell_key(prompt uuid, profile uuid, repeat_index integer)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT encode(sha256(convert_to(prompt::text || ':' || profile::text || ':' ||
        repeat_index::text, 'UTF8')), 'hex')
$$;

-- 冻结的输入外壳/配置边界；完整业务字段由对应 Pydantic 输入边界校验。
CREATE FUNCTION geo_run_snapshot_object(value jsonb, keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_typeof(value) = 'object' AND value ?& keys
        AND value - keys = '{}'::jsonb, false)
$$;

-- 外壳不仅限制键名，也限制叶子类型，避免把凭据对象藏进普通字符串/身份字段。
CREATE FUNCTION geo_snapshot_strings(value jsonb, required text[], nullable text[] DEFAULT '{}')
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE key text;
BEGIN
    FOREACH key IN ARRAY required LOOP
        IF jsonb_typeof(value->key) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
    END LOOP;
    FOREACH key IN ARRAY nullable LOOP
        IF jsonb_typeof(value->key) IS DISTINCT FROM 'string'
            AND value->key IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
END $$;

CREATE FUNCTION geo_snapshot_uuids(value jsonb, required text[], nullable text[] DEFAULT '{}')
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE key text;
BEGIN
    IF NOT geo_snapshot_strings(value, required, nullable) THEN RETURN false; END IF;
    FOREACH key IN ARRAY required || nullable LOOP
        IF value->key <> 'null'::jsonb AND value->>key !~
            '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
END $$;

CREATE FUNCTION geo_snapshot_revision(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(jsonb_typeof(value) = 'number' AND value::text ~ '^(0|[1-9][0-9]*)$',false)
$$;

CREATE FUNCTION geo_run_input_valid(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE p jsonb; c jsonb; s jsonb; item jsonb; child jsonb; ids text[] := '{}';
BEGIN
    IF NOT geo_run_snapshot_object(value, ARRAY['schema_version','data_classification',
            'prompt','profile','subjects','rule_set_revision'])
        OR value->'schema_version' IS DISTINCT FROM '1'::jsonb
        OR COALESCE(value->>'data_classification' NOT IN ('PUBLIC','INTERNAL','RESTRICTED'), true)
        OR jsonb_typeof(value->'rule_set_revision') IS DISTINCT FROM 'number'
        OR COALESCE(value->>'rule_set_revision' !~ '^[1-9][0-9]*$', true) THEN RETURN false; END IF;
    p := value->'prompt'; c := value->'profile'; s := c->'surface';
    IF NOT geo_run_snapshot_object(p, ARRAY['id','revision','query_topic_id',
            'query_topic_revision','canonical_question','intent_type','prompt_text',
            'mention_mode','priority','language_code','region_code'])
        OR NOT geo_snapshot_strings(p, ARRAY['canonical_question','intent_type','prompt_text',
            'mention_mode','priority','language_code','region_code'])
        OR NOT geo_snapshot_uuids(p, ARRAY['id','query_topic_id'])
        OR COALESCE(p->>'id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$', true)
        OR COALESCE(p->>'query_topic_id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$', true)
        OR jsonb_typeof(p->'prompt_text') IS DISTINCT FROM 'string'
        OR COALESCE(length(btrim(p->>'prompt_text')) NOT BETWEEN 1 AND 8000, true)
        OR jsonb_typeof(p->'revision') IS DISTINCT FROM 'number'
        OR COALESCE(p->>'revision' !~ '^(0|[1-9][0-9]*)$', true)
        OR jsonb_typeof(p->'query_topic_revision') IS DISTINCT FROM 'number'
        OR COALESCE(p->>'query_topic_revision' !~ '^(0|[1-9][0-9]*)$', true)
        THEN RETURN false; END IF;
    IF NOT geo_run_snapshot_object(c, ARRAY['id','revision','name','collection_mode',
            'adapter_key','adapter_version','ai_channel_id','ai_model_id','language_code',
            'region_code','login_state','web_search_policy','settings','surface'])
        OR NOT geo_snapshot_strings(c, ARRAY['name','collection_mode','adapter_key','adapter_version',
            'language_code','region_code','login_state','web_search_policy'])
        OR NOT geo_snapshot_uuids(c, ARRAY['id'], ARRAY['ai_channel_id','ai_model_id'])
        OR COALESCE(c->>'id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$', true)
        OR jsonb_typeof(c->'revision') IS DISTINCT FROM 'number'
        OR COALESCE(c->>'revision' !~ '^(0|[1-9][0-9]*)$', true)
        OR NOT COALESCE(geo_profile_settings_valid(c->>'collection_mode', c->'settings'),false)
        OR (c->>'collection_mode' <> 'API' AND
            (c->'ai_channel_id' <> 'null'::jsonb OR c->'ai_model_id' <> 'null'::jsonb))
        OR ((c->'ai_channel_id' = 'null'::jsonb) <> (c->'ai_model_id' = 'null'::jsonb))
        OR (c->>'collection_mode' = 'MANUAL' AND c->>'adapter_key' <> 'manual')
        OR COALESCE(c->>'collection_mode' NOT IN ('MANUAL','API','BROWSER'),true)
        OR (c->>'collection_mode' = 'API' AND c->>'login_state' <> 'NOT_APPLICABLE')
        OR (c->>'collection_mode' <> 'API' AND c->>'login_state' NOT IN ('ANONYMOUS','AUTHENTICATED'))
        THEN RETURN false; END IF;
    IF NOT geo_run_snapshot_object(s, ARRAY['id','revision','name','surface_kind',
            'provider_brand','compliance_status','capabilities'])
        OR NOT geo_snapshot_strings(s, ARRAY['name','surface_kind','provider_brand','compliance_status'])
        OR NOT geo_snapshot_uuids(s, ARRAY['id'])
        OR NOT geo_snapshot_revision(s->'revision')
        OR NOT COALESCE(geo_surface_capabilities_valid(s->'capabilities'),false)
        THEN RETURN false; END IF;
    IF jsonb_typeof(value->'subjects') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(value->'subjects') < 1 THEN RETURN false; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(value->'subjects') LOOP
        IF NOT geo_run_snapshot_object(item, ARRAY['id','revision','subject_type','role',
                'product_id','parent_subject_id','canonical_name','display_name','aliases','domains'])
            OR NOT geo_snapshot_strings(item, ARRAY['subject_type','role','canonical_name','display_name'])
            OR NOT geo_snapshot_uuids(item, ARRAY['id'], ARRAY['product_id','parent_subject_id'])
            OR NOT geo_snapshot_revision(item->'revision')
            OR COALESCE(item->>'id' !~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$', true)
            OR item->>'id' = ANY(ids)
            OR COALESCE(item->>'role' NOT IN ('PRIMARY','COMPETITOR','REFERENCE'),true)
            OR ((item->>'subject_type' = 'OWN_PRODUCT') <> (item->'product_id' <> 'null'::jsonb))
            OR jsonb_typeof(item->'aliases') IS DISTINCT FROM 'array'
            OR jsonb_typeof(item->'domains') IS DISTINCT FROM 'array'
            THEN RETURN false; END IF;
        ids := array_append(ids, item->>'id');
        FOR child IN SELECT * FROM jsonb_array_elements(item->'aliases') LOOP
            IF NOT geo_run_snapshot_object(child, ARRAY['alias','normalized_alias',
                    'alias_kind','language_code'])
                OR NOT geo_snapshot_strings(child, ARRAY['alias','normalized_alias','alias_kind'],
                    ARRAY['language_code']) THEN RETURN false; END IF;
        END LOOP;
        FOR child IN SELECT * FROM jsonb_array_elements(item->'domains') LOOP
            IF NOT geo_run_snapshot_object(child, ARRAY['hostname','relation_type'])
                OR NOT geo_snapshot_strings(child, ARRAY['hostname','relation_type'])
                THEN RETURN false; END IF;
        END LOOP;
    END LOOP;
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(value->'subjects') t
        WHERE t->>'role' = 'PRIMARY');
END $$;

CREATE FUNCTION geo_batch_snapshots_valid(p jsonb, r jsonb, source uuid) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb; identity jsonb;
BEGIN
    IF NOT geo_run_snapshot_object(p, ARRAY['schema_version','plan_id','plan_revision',
            'name','description','subjects','prompt_variant_ids','collection_profile_ids',
            'repeat_count','schedule_kind','cron_expression','timezone','budget_limit','rule_set_revision'])
        OR NOT geo_snapshot_strings(p, ARRAY['name','description','schedule_kind','timezone'],
            ARRAY['cron_expression','budget_limit'])
        OR NOT geo_snapshot_uuids(p, ARRAY[]::text[], ARRAY['plan_id'])
        OR NOT geo_run_snapshot_object(r, ARRAY['schema_version','rule_set_revision'])
        OR p->'schema_version' IS DISTINCT FROM '1'::jsonb
        OR r->'schema_version' IS DISTINCT FROM '1'::jsonb
        OR r->'rule_set_revision' IS DISTINCT FROM p->'rule_set_revision'
        OR jsonb_typeof(r->'rule_set_revision') IS DISTINCT FROM 'number'
        OR COALESCE(r->>'rule_set_revision' !~ '^[1-9][0-9]*$',true)
        OR ((source IS NULL) <> (p->'plan_id' = 'null'::jsonb))
        OR (source IS NOT NULL AND p->>'plan_id' IS DISTINCT FROM source::text)
        OR ((p->'plan_id' = 'null'::jsonb) <> (p->'plan_revision' = 'null'::jsonb))
        OR (source IS NOT NULL AND (jsonb_typeof(p->'plan_revision') <> 'number'
            OR p->>'plan_revision' !~ '^(0|[1-9][0-9]*)$'))
        OR jsonb_typeof(p->'subjects') IS DISTINCT FROM 'array'
        OR jsonb_typeof(p->'prompt_variant_ids') IS DISTINCT FROM 'array'
        OR jsonb_typeof(p->'collection_profile_ids') IS DISTINCT FROM 'array'
        THEN RETURN false; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(p->'subjects') LOOP
        IF NOT geo_run_snapshot_object(item, ARRAY['subject_id','role'])
            OR NOT geo_snapshot_uuids(item, ARRAY['subject_id'])
            OR NOT geo_snapshot_strings(item, ARRAY['role']) THEN RETURN false; END IF;
    END LOOP;
    FOR identity IN SELECT * FROM jsonb_array_elements(p->'prompt_variant_ids')
        UNION ALL SELECT * FROM jsonb_array_elements(p->'collection_profile_ids') LOOP
        IF NOT geo_snapshot_uuids(jsonb_build_object('id', identity), ARRAY['id'])
            THEN RETURN false; END IF;
    END LOOP;
    RETURN COALESCE(jsonb_array_length(p->'subjects') > 0
        AND jsonb_array_length(p->'prompt_variant_ids') > 0
        AND jsonb_array_length(p->'collection_profile_ids') > 0
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(p->'subjects') s WHERE s->>'role'='PRIMARY')
        AND jsonb_typeof(p->'repeat_count') = 'number'
        AND p->>'repeat_count' ~ '^([1-9]|10)$', false);
END $$;
