ALTER TABLE geo_collection_profiles
    ADD COLUMN last_test_error_code varchar(64),
    ADD COLUMN last_test_error_summary varchar(500),
    ADD COLUMN test_attempt_id uuid,
    ADD CONSTRAINT ck_geo_collection_profiles_test_error CHECK (
        (last_test_error_code IS NULL AND last_test_error_summary IS NULL) OR
        (last_test_status = 'FAILED' AND last_test_error_code IS NOT NULL
         AND last_test_error_summary IS NOT NULL)),
    ADD CONSTRAINT ck_geo_collection_profiles_test_attempt CHECK (
        test_attempt_id IS NULL OR (last_test_status = 'UNTESTED' AND NOT is_active));

-- 上游已经持有自己的锁；这里只按稳定 UUID 获取当前 Profile，不反向锁上游。
CREATE FUNCTION geo_invalidate_profile_tests(ids uuid[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE profile_id uuid;
BEGIN
    FOR profile_id IN SELECT id FROM geo_collection_profiles
        WHERE id = ANY(ids) AND collection_mode = 'API' ORDER BY id FOR UPDATE
    LOOP
        UPDATE geo_collection_profiles SET
            last_test_status='UNTESTED', last_tested_at=NULL,
            last_test_error_code=NULL, last_test_error_summary=NULL,
            test_attempt_id=NULL, is_active=false, revision=revision+1,
            updated_at=greatest(updated_at, clock_timestamp())
        WHERE id=profile_id AND (last_test_status<>'UNTESTED' OR last_tested_at IS NOT NULL
            OR last_test_error_code IS NOT NULL OR last_test_error_summary IS NOT NULL
            OR test_attempt_id IS NOT NULL OR is_active);
    END LOOP;
END $$;

-- 旧 API 测试没有本次诊断的凭据/能力保证；只失效当前资格，保留全部历史快照。
SELECT geo_invalidate_profile_tests(array_agg(id)) FROM geo_collection_profiles
    WHERE collection_mode='API';

CREATE FUNCTION geo_reset_profile_test_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.collection_mode <> 'API' THEN RETURN NEW; END IF;
    -- 模型删除先失效资格，再由既有 FK 成对解绑；FK 不虚构第二个 revision。
    IF pg_trigger_depth()>1 AND NEW.ai_channel_id IS NULL AND NEW.ai_model_id IS NULL
        AND to_jsonb(NEW)-ARRAY['ai_channel_id','ai_model_id'] =
            to_jsonb(OLD)-ARRAY['ai_channel_id','ai_model_id'] THEN
        RETURN NEW;
    END IF;
    IF ROW(NEW.name,NEW.adapter_key,NEW.ai_channel_id,NEW.ai_model_id,NEW.language_code,
           NEW.region_code,NEW.login_state,NEW.web_search_policy,NEW.settings_json)
       IS DISTINCT FROM
       ROW(OLD.name,OLD.adapter_key,OLD.ai_channel_id,OLD.ai_model_id,OLD.language_code,
           OLD.region_code,OLD.login_state,OLD.web_search_policy,OLD.settings_json) THEN
        NEW.last_test_status='UNTESTED'; NEW.last_tested_at=NULL;
        NEW.last_test_error_code=NULL; NEW.last_test_error_summary=NULL;
        NEW.test_attempt_id=NULL; NEW.is_active=false;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_collection_profile_00_test BEFORE UPDATE ON geo_collection_profiles
    FOR EACH ROW EXECUTE FUNCTION geo_reset_profile_test_configuration();

CREATE FUNCTION geo_invalidate_dependency_profile_tests() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids uuid[]; dependency_id uuid;
BEGIN
    dependency_id := OLD.id;
    IF TG_TABLE_NAME='ai_channels' THEN
        IF TG_OP='UPDATE' AND ROW(NEW.base_url,NEW.protocol_type,NEW.timeout_seconds,
               NEW.api_key_ciphertext,NEW.is_enabled) IS NOT DISTINCT FROM
             ROW(OLD.base_url,OLD.protocol_type,OLD.timeout_seconds,
               OLD.api_key_ciphertext,OLD.is_enabled) THEN RETURN NEW; END IF;
        SELECT array_agg(id) INTO ids FROM geo_collection_profiles
            WHERE ai_channel_id=dependency_id;
    ELSIF TG_TABLE_NAME='ai_models' THEN
        IF TG_OP='UPDATE' AND ROW(NEW.model_id,NEW.request_parameters,NEW.is_enabled,
               NEW.test_status,NEW.last_tested_at) IS NOT DISTINCT FROM
             ROW(OLD.model_id,OLD.request_parameters,OLD.is_enabled,
               OLD.test_status,OLD.last_tested_at) THEN RETURN NEW; END IF;
        SELECT array_agg(id) INTO ids FROM geo_collection_profiles
            WHERE ai_model_id=dependency_id;
    ELSE
        IF ROW(NEW.surface_kind,NEW.compliance_status,NEW.capabilities,NEW.is_active)
            IS NOT DISTINCT FROM
           ROW(OLD.surface_kind,OLD.compliance_status,OLD.capabilities,OLD.is_active)
           THEN RETURN NEW; END IF;
        SELECT array_agg(id) INTO ids FROM geo_collection_profiles
            WHERE engine_surface_id=dependency_id;
    END IF;
    PERFORM geo_invalidate_profile_tests(ids);
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_channel_profile_tests BEFORE UPDATE OR DELETE ON ai_channels
    FOR EACH ROW EXECUTE FUNCTION geo_invalidate_dependency_profile_tests();
CREATE TRIGGER geo_model_profile_tests BEFORE UPDATE OR DELETE ON ai_models
    FOR EACH ROW EXECUTE FUNCTION geo_invalidate_dependency_profile_tests();
CREATE TRIGGER geo_surface_profile_tests BEFORE UPDATE ON geo_engine_surfaces
    FOR EACH ROW EXECUTE FUNCTION geo_invalidate_dependency_profile_tests();

CREATE FUNCTION geo_invalidate_header_profile_tests() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE channel_id uuid; ids uuid[];
BEGIN
    IF TG_OP='UPDATE' AND to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
    IF TG_OP='DELETE' THEN channel_id:=OLD.channel_id; ELSE channel_id:=NEW.channel_id; END IF;
    SELECT array_agg(id) INTO ids FROM geo_collection_profiles WHERE ai_channel_id=channel_id;
    PERFORM geo_invalidate_profile_tests(ids);
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_header_profile_tests AFTER INSERT OR UPDATE OR DELETE ON ai_channel_headers
    FOR EACH ROW EXECUTE FUNCTION geo_invalidate_header_profile_tests();
