-- 分析边界只保存闭合、无凭据的版本输入，不复制外部请求配置。
CREATE FUNCTION geo_analysis_text_valid(value jsonb, maximum integer, nullable boolean DEFAULT false)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE((nullable AND value = 'null'::jsonb) OR
        (jsonb_typeof(value) = 'string' AND length(value #>> '{}') BETWEEN 1 AND maximum
            AND value #>> '{}' ~ '[^[:space:]]'), false)
$$;
CREATE FUNCTION geo_analysis_number_valid(value jsonb, minimum numeric, maximum numeric,
    integral boolean DEFAULT false, nullable boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF nullable AND value = 'null'::jsonb THEN RETURN true; END IF;
    IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    RETURN value::numeric >= minimum AND (maximum IS NULL OR value::numeric <= maximum)
        AND (NOT integral OR value::text ~ '^(0|[1-9][0-9]*)$');
END $$;
CREATE FUNCTION geo_analysis_strings_valid(value jsonb, maximum integer, minimum_count integer,
    maximum_count integer) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE item jsonb;
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(value) < minimum_count OR (maximum_count IS NOT NULL
        AND jsonb_array_length(value) > maximum_count) THEN RETURN false; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
        IF NOT geo_analysis_text_valid(item, maximum) THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
END $$;
CREATE FUNCTION geo_analysis_input_valid(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c jsonb; p jsonb; item jsonb; child jsonb; ids text[] := '{}'; facts text[] := '{}';
BEGIN
    IF NOT geo_run_snapshot_object(value, ARRAY['schema_version','answer_sha256','subjects',
        'fact_versions','configuration']) OR value->'schema_version' IS DISTINCT FROM '1'::jsonb
        OR NOT geo_snapshot_strings(value, ARRAY['answer_sha256'])
        OR COALESCE(value->>'answer_sha256' !~ '^[0-9a-f]{64}$', true)
        OR jsonb_typeof(value->'subjects') IS DISTINCT FROM 'array'
        OR jsonb_typeof(value->'fact_versions') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(value->'subjects') < 1 THEN RETURN false; END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(value->'subjects') LOOP
        IF NOT geo_run_snapshot_object(item, ARRAY['id','revision','subject_type','role',
                'product_id','parent_subject_id','canonical_name','display_name','aliases','domains'])
            OR NOT geo_snapshot_uuids(item, ARRAY['id'], ARRAY['product_id','parent_subject_id'])
            OR NOT geo_snapshot_revision(item->'revision')
            OR NOT geo_snapshot_strings(item, ARRAY['subject_type','role'])
            OR item->>'subject_type' NOT IN ('OWN_BRAND','OWN_PRODUCT','COMPETITOR_BRAND','COMPETITOR_PRODUCT','REFERENCE_PART')
            OR item->>'role' NOT IN ('PRIMARY','COMPETITOR','REFERENCE')
            OR ((item->>'subject_type' = 'OWN_PRODUCT') <> (item->'product_id' <> 'null'::jsonb))
            OR item->>'id' = ANY(ids)
            OR NOT geo_analysis_text_valid(item->'canonical_name',240)
            OR NOT geo_analysis_text_valid(item->'display_name',321)
            OR jsonb_typeof(item->'aliases') IS DISTINCT FROM 'array'
            OR jsonb_typeof(item->'domains') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
        ids := array_append(ids,item->>'id');
        FOR child IN SELECT * FROM jsonb_array_elements(item->'aliases') LOOP
            IF NOT geo_run_snapshot_object(child, ARRAY['alias','normalized_alias','alias_kind','language_code'])
                OR NOT geo_analysis_text_valid(child->'alias',240)
                OR NOT geo_analysis_text_valid(child->'normalized_alias',240)
                OR NOT geo_snapshot_strings(child, ARRAY['alias_kind'], ARRAY['language_code'])
                OR child->>'alias_kind' NOT IN ('NAME','PART_NUMBER','ABBREVIATION','LEGACY')
                THEN RETURN false; END IF;
        END LOOP;
        FOR child IN SELECT * FROM jsonb_array_elements(item->'domains') LOOP
            IF NOT geo_run_snapshot_object(child, ARRAY['hostname','relation_type'])
                OR NOT geo_snapshot_strings(child, ARRAY['hostname','relation_type'])
                OR NOT geo_analysis_text_valid(child->'hostname',253)
                OR child->>'relation_type' NOT IN ('OWNED','OFFICIAL','DISTRIBUTOR','OTHER')
                THEN RETURN false; END IF;
        END LOOP;
    END LOOP;
    FOR item IN SELECT * FROM jsonb_array_elements(value->'fact_versions') LOOP
        IF NOT geo_run_snapshot_object(item, ARRAY['subject_id','fact_version_id'])
            OR NOT geo_snapshot_uuids(item, ARRAY['subject_id','fact_version_id'])
            OR item->>'subject_id' = ANY(facts)
            OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(value->'subjects') s
                WHERE s->>'id' = item->>'subject_id' AND s->>'subject_type' = 'OWN_PRODUCT')
            THEN RETURN false; END IF;
        facts := array_append(facts,item->>'subject_id');
    END LOOP;
    c := value->'configuration'; p := c->'parameters';
    IF NOT geo_run_snapshot_object(c, ARRAY['rule_set_version','model_name','model_version',
            'prompt_template_version','prompt_sha256','parameters'])
        OR NOT geo_analysis_text_valid(c->'rule_set_version',100)
        OR NOT geo_analysis_text_valid(c->'model_name',200,true)
        OR NOT geo_analysis_text_valid(c->'model_version',100,true)
        OR NOT geo_analysis_text_valid(c->'prompt_template_version',100,true)
        OR NOT geo_snapshot_strings(c, ARRAY[]::text[], ARRAY['prompt_sha256'])
        OR (c->'prompt_sha256' <> 'null'::jsonb AND c->>'prompt_sha256' !~ '^[0-9a-f]{64}$')
        OR ((c->'model_name' = 'null'::jsonb) <> (c->'model_version' = 'null'::jsonb))
        OR ((c->'model_name' = 'null'::jsonb) <> (c->'prompt_template_version' = 'null'::jsonb))
        OR ((c->'model_name' = 'null'::jsonb) <> (c->'prompt_sha256' = 'null'::jsonb))
        OR NOT geo_run_snapshot_object(p, ARRAY['temperature','top_p','max_output_tokens','seed'])
        OR NOT geo_analysis_number_valid(p->'temperature',0,2,false,true)
        OR NOT geo_analysis_number_valid(p->'top_p',0,1,false,true)
        OR NOT geo_analysis_number_valid(p->'max_output_tokens',1,2147483647,true,true)
        OR NOT geo_analysis_number_valid(p->'seed',0,2147483647,true,true)
        OR (c->'model_name' = 'null'::jsonb AND p <> '{"temperature": null,"top_p": null,"max_output_tokens": null,"seed": null}'::jsonb)
        THEN RETURN false; END IF;
    RETURN true;
END $$;
CREATE FUNCTION geo_analysis_summary_valid(summary jsonb, reasons jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE((summary IS NULL OR (geo_run_snapshot_object(summary,
        ARRAY['mentions','recommendations','claims'])
        AND geo_analysis_number_valid(summary->'mentions',0,1,false,true)
        AND geo_analysis_number_valid(summary->'recommendations',0,1,false,true)
        AND geo_analysis_number_valid(summary->'claims',0,1,false,true)))
        AND geo_analysis_strings_valid(reasons,100,0,20), false)
$$;
-- jsonb::text 的数据库规范表示为唯一哈希序列化；数组顺序是冻结输入的一部分。
CREATE FUNCTION geo_analysis_input_sha256(value jsonb, analyzer_type text, analyzer_version text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
    SELECT geo_answer_sha256(jsonb_build_array('geo-analysis-v1',value,analyzer_type,analyzer_version)::text)
$$;
CREATE FUNCTION geo_review_corrections_valid(value jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE category text; item jsonb; ids text[]; identity text; total integer := 0;
BEGIN
    IF NOT geo_run_snapshot_object(value, ARRAY['schema_version','mentions','recommendations','claims','citations'])
        OR value->'schema_version' IS DISTINCT FROM '1'::jsonb THEN RETURN false; END IF;
    FOREACH category IN ARRAY ARRAY['mentions','recommendations','claims','citations'] LOOP
        IF jsonb_typeof(value->category) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
        ids := '{}'; total := total + jsonb_array_length(value->category);
        FOR item IN SELECT * FROM jsonb_array_elements(value->category) LOOP
            IF category = 'mentions' THEN
                IF NOT geo_run_snapshot_object(item, ARRAY['subject_id','mention_count','first_character_offset','matched_aliases'])
                    OR NOT geo_snapshot_uuids(item, ARRAY['subject_id'])
                    OR NOT geo_analysis_number_valid(item->'mention_count',0,2147483647,true)
                    OR NOT geo_analysis_number_valid(item->'first_character_offset',0,2147483647,true,true)
                    OR NOT geo_analysis_strings_valid(item->'matched_aliases',240,0,NULL)
                    THEN RETURN false; END IF;
                IF (item->>'mention_count' = '0' AND (item->'first_character_offset' <> 'null'::jsonb
                    OR item->'matched_aliases' <> '[]'::jsonb)) OR
                    (item->>'mention_count' <> '0' AND jsonb_array_length(item->'matched_aliases') = 0)
                    THEN RETURN false; END IF;
                identity := item->>'subject_id';
            ELSIF category = 'recommendations' THEN
                IF NOT geo_run_snapshot_object(item, ARRAY['subject_id','recommendation','rank','rationale_excerpt'])
                    OR NOT geo_snapshot_uuids(item, ARRAY['subject_id'])
                    OR NOT geo_snapshot_strings(item, ARRAY['recommendation'])
                    OR item->>'recommendation' NOT IN ('RECOMMENDED','CONSIDERED','NOT_RECOMMENDED','UNKNOWN')
                    OR NOT geo_analysis_number_valid(item->'rank',1,2147483647,true,true)
                    OR NOT geo_analysis_text_valid(item->'rationale_excerpt',2000,true)
                    THEN RETURN false; END IF;
                identity := item->>'subject_id';
            ELSIF category = 'claims' THEN
                IF NOT geo_run_snapshot_object(item, ARRAY['claim_assessment_id','verdict','severity','explanation'])
                    OR NOT geo_snapshot_uuids(item, ARRAY['claim_assessment_id'])
                    OR NOT geo_snapshot_strings(item, ARRAY['verdict','severity'])
                    OR item->>'verdict' NOT IN ('ACCURATE','PARTIAL','INCORRECT','UNJUDGEABLE')
                    OR item->>'severity' NOT IN ('LOW','MEDIUM','HIGH','CRITICAL')
                    OR NOT geo_analysis_text_valid(item->'explanation',2000) THEN RETURN false; END IF;
                identity := item->>'claim_assessment_id';
            ELSE
                IF NOT geo_run_snapshot_object(item, ARRAY['citation_id','source_category','subject_id'])
                    OR NOT geo_snapshot_uuids(item, ARRAY['citation_id'],ARRAY['subject_id'])
                    OR NOT geo_snapshot_strings(item, ARRAY['source_category'])
                    OR item->>'source_category' NOT IN ('OWNED','COMPETITOR','INDUSTRY_MEDIA','DISTRIBUTOR',
                        'COMMUNITY','SOCIAL','SEARCH_ENGINE','ACADEMIC_OR_INSTITUTIONAL','OTHER','UNKNOWN')
                    THEN RETURN false; END IF;
                identity := item->>'citation_id';
            END IF;
            IF identity = ANY(ids) THEN RETURN false; END IF;
            ids := array_append(ids,identity);
        END LOOP;
    END LOOP;
    RETURN total > 0;
END $$;
