-- 固定 UTF8 编码不会随数据库 locale/session 改变；保留正文的全部原始字节。
CREATE FUNCTION geo_answer_sha256(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT encode(sha256(convert_to(value, 'UTF8')), 'hex')
$$;
CREATE FUNCTION geo_raw_summary_valid(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF jsonb_typeof(value) IS DISTINCT FROM 'object'
        OR NOT value ?& ARRAY['schema_version','payload_format','payload_bytes','finish_reason']
        OR value - ARRAY['schema_version','payload_format','payload_bytes','finish_reason'] <> '{}'::jsonb
        OR value->'schema_version' IS DISTINCT FROM '1'::jsonb THEN RETURN false; END IF;
    RETURN (value->'payload_format' = 'null'::jsonb OR value->>'payload_format' IN ('JSON','TEXT','DOM'))
        AND (value->'finish_reason' = 'null'::jsonb OR value->>'finish_reason' IN ('STOP','LENGTH','CONTENT_FILTER','OTHER'))
        AND (value->'payload_bytes' = 'null'::jsonb OR (
            jsonb_typeof(value->'payload_bytes') = 'number'
            AND value->>'payload_bytes' ~ '^(0|[1-9][0-9]{0,7})$'
            AND (value->>'payload_bytes')::numeric <= 52428800));
END $$;
CREATE FUNCTION geo_citation_occurrences_valid(first_position integer, positions integer[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(array_ndims(positions)=1 AND array_lower(positions,1)=1
        AND cardinality(positions) BETWEEN 1 AND 1000 AND positions[1]=first_position
        AND NOT EXISTS (SELECT 1 FROM generate_subscripts(positions,1) i
            WHERE positions[i] IS NULL OR positions[i] NOT BETWEEN 1 AND 1000
                OR (i > 1 AND positions[i] <= positions[i-1])), false)
$$;
CREATE FUNCTION geo_citation_url_valid(original text, normalized text, host text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(length(original) BETWEEN 1 AND 2083 AND length(normalized) BETWEEN 1 AND 2083
        AND length(host) BETWEEN 1 AND 253 AND host=lower(host)
        AND host ~ '^([a-z0-9]([a-z0-9.-]*[a-z0-9])?|[0-9a-f:]*:[0-9a-f:]*)$'
        AND original ~* '^https?://[^/?#]+'
        AND substring(original FROM '(?i)^https?://([^/?#]+)') NOT LIKE '%@%'
        AND original !~ '[[:space:][:cntrl:]\\]' AND normalized !~ '[[:space:][:cntrl:]\\#]'
        AND original !~* '%([01][0-9a-f]|7f)'
        AND normalized ~ '^https?://[^/?#]+/'
        AND substring(normalized FROM '^https?://([^/?#]+)') =
            CASE WHEN host LIKE '%:%' THEN '['||host||']' ELSE host END
            || COALESCE(substring(normalized FROM '^https?://[^/?#]+(:[0-9]+)/'), '')
        AND normalized !~ '^http://[^/?#]+[:]80/' AND normalized !~ '^https://[^/?#]+[:]443/', false)
$$;
