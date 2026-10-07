"""新增观测配置与闭合JSON合同；不回填旧GEO或实现运行资格。"""

from alembic import op

revision = "0046_geo_surfaces_profiles"
down_revision = "0045_geo_prompt_variants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION geo_configuration_text_valid(value text) RETURNS boolean
        LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
            SELECT length(value) > 0 AND value = btrim(value,
                chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(28)||chr(29)||chr(30)||chr(31)
                ||chr(32)||chr(133)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)
                ||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)
                ||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288))
        $$;
        CREATE FUNCTION geo_surface_capabilities_valid(value jsonb) RETURNS boolean
        LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
        DECLARE keys text[] :=
            ARRAY['answer_text','citations','web_search_signal','model_version','usage','cost'];
                key text;
        BEGIN
            IF jsonb_typeof(value) <> 'object' OR NOT value ?& keys OR value - keys <>
                '{}'::jsonb THEN
                RETURN false;
            END IF;
            FOREACH key IN ARRAY keys LOOP
                IF jsonb_typeof(value -> key) <> 'boolean' THEN RETURN false; END IF;
            END LOOP;
            RETURN value -> 'answer_text' = 'true'::jsonb;
        END $$;
        CREATE FUNCTION geo_profile_settings_valid(mode text, value jsonb) RETURNS boolean
        LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
        DECLARE key text; item jsonb; allowed text[];
        BEGIN
            IF jsonb_typeof(value) <> 'object' THEN RETURN false; END IF;
            CASE mode
                WHEN 'MANUAL' THEN allowed := ARRAY['require_screenshot'];
                WHEN 'API' THEN allowed := ARRAY['temperature','max_output_tokens'];
                WHEN 'BROWSER' THEN allowed := ARRAY['require_screenshot','answer_timeout_seconds'];
                ELSE RETURN false;
            END CASE;
            IF value - allowed <> '{}'::jsonb THEN RETURN false; END IF;
            FOR key, item IN SELECT * FROM jsonb_each(value) LOOP
                IF key = 'require_screenshot' THEN
                    IF jsonb_typeof(item) <> 'boolean' THEN RETURN false; END IF;
                ELSIF item = 'null'::jsonb AND mode = 'API' THEN
                    CONTINUE;
                ELSIF jsonb_typeof(item) <> 'number' THEN
                    RETURN false;
                ELSIF key = 'temperature' THEN
                    IF item::text::numeric NOT BETWEEN 0 AND 2 THEN RETURN false; END IF;
                ELSE
                    IF item::text !~ '^[0-9]+$' THEN RETURN false; END IF;
                    IF key = 'max_output_tokens' AND item::text::numeric NOT BETWEEN 1 AND 65536
                        THEN
                        RETURN false;
                    END IF;
                    IF key = 'answer_timeout_seconds' AND item::text::numeric NOT BETWEEN 10 AND
                        600 THEN
                        RETURN false;
                    END IF;
                END IF;
            END LOOP;
            RETURN true;
        END $$;
    """)
    op.execute("""
        ALTER TABLE ai_models ADD CONSTRAINT uq_ai_models_id_channel UNIQUE (id, channel_id);
    """)
    op.execute("""
        CREATE TABLE geo_engine_surfaces (
            id UUID NOT NULL,
            name VARCHAR(160) NOT NULL,
            slug VARCHAR(100) NOT NULL,
            surface_kind VARCHAR(24) NOT NULL,
            provider_brand VARCHAR(40) NOT NULL,
            website_url TEXT,
            compliance_status VARCHAR(24) DEFAULT 'NOT_REVIEWED' NOT NULL,
            capabilities JSONB NOT NULL,
            is_active BOOLEAN DEFAULT false NOT NULL,
            revision INTEGER DEFAULT 0 NOT NULL,
            first_referenced_at TIMESTAMP WITH TIME ZONE,
            created_by UUID NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            CONSTRAINT pk_geo_engine_surfaces PRIMARY KEY (id),
            CONSTRAINT uq_geo_engine_surfaces_slug UNIQUE (slug),
            CONSTRAINT ck_geo_engine_surfaces_name CHECK (geo_configuration_text_valid(name)),
            CONSTRAINT ck_geo_engine_surfaces_slug CHECK (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
            CONSTRAINT ck_geo_engine_surfaces_kind CHECK (surface_kind IN
                ('CONSUMER_UI','MODEL_API','SEARCH_API','MANUAL_SITE')),
            CONSTRAINT ck_geo_engine_surfaces_provider CHECK (provider_brand IN
                ('OPENAI','ANTHROPIC','GOOGLE','AZURE_OPENAI','ZHIPU','QWEN','CUSTOM')),
            CONSTRAINT ck_geo_engine_surfaces_website CHECK (website_url IS NULL OR
                (length(website_url) BETWEEN 1 AND 2083 AND website_url ~
                '^https?://[^[:space:]/?#@]+(/[^[:space:]?#]*)?$')),
            CONSTRAINT ck_geo_engine_surfaces_compliance CHECK (compliance_status IN
                ('NOT_REVIEWED','APPROVED','REJECTED','SUSPENDED')),
            CONSTRAINT ck_geo_engine_surfaces_capabilities CHECK
                (geo_surface_capabilities_valid(capabilities)),
            CONSTRAINT ck_geo_engine_surfaces_revision CHECK (revision >= 0),
            CONSTRAINT ck_geo_engine_surfaces_reference_time CHECK (first_referenced_at IS NULL
                OR first_referenced_at >= created_at),
            CONSTRAINT fk_geo_engine_surfaces_creator FOREIGN KEY(created_by) REFERENCES users
                (id) ON DELETE RESTRICT
        );
    """)
    op.execute("""
        CREATE INDEX ix_geo_engine_surfaces_active_name ON geo_engine_surfaces (is_active, name,
            id);
    """)
    op.execute("""
        CREATE INDEX ix_geo_engine_surfaces_creator ON geo_engine_surfaces (created_by);
    """)
    op.execute("""
        CREATE TABLE geo_collection_profiles (
            id UUID NOT NULL,
            engine_surface_id UUID NOT NULL,
            name VARCHAR(160) NOT NULL,
            collection_mode VARCHAR(16) NOT NULL,
            adapter_key VARCHAR(100) NOT NULL,
            ai_channel_id UUID,
            ai_model_id UUID,
            language_code VARCHAR(16) NOT NULL,
            region_code VARCHAR(16) NOT NULL,
            login_state VARCHAR(24) NOT NULL,
            web_search_policy VARCHAR(24) NOT NULL,
            settings_json JSONB DEFAULT '{}'::jsonb NOT NULL,
            is_active BOOLEAN DEFAULT false NOT NULL,
            last_test_status VARCHAR(16) DEFAULT 'UNTESTED' NOT NULL,
            last_tested_at TIMESTAMP WITH TIME ZONE,
            revision INTEGER DEFAULT 0 NOT NULL,
            created_by UUID NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
            CONSTRAINT pk_geo_collection_profiles PRIMARY KEY (id),
            CONSTRAINT uq_geo_collection_profiles_surface_name UNIQUE (engine_surface_id, name),
            CONSTRAINT fk_geo_collection_profiles_model_channel FOREIGN KEY(ai_model_id,
                ai_channel_id) REFERENCES ai_models (id, channel_id) MATCH FULL ON DELETE SET
                NULL ON UPDATE RESTRICT,
            CONSTRAINT ck_geo_collection_profiles_name CHECK (geo_configuration_text_valid(name)),
            CONSTRAINT ck_geo_collection_profiles_mode CHECK (collection_mode IN
                ('MANUAL','API','BROWSER')),
            CONSTRAINT ck_geo_collection_profiles_adapter CHECK (adapter_key ~
                '^[a-z][a-z0-9_-]*$' AND (collection_mode <> 'MANUAL' OR adapter_key =
                'manual')),
            CONSTRAINT ck_geo_collection_profiles_model_mode CHECK (collection_mode = 'API' OR
                (ai_channel_id IS NULL AND ai_model_id IS NULL)),
            CONSTRAINT ck_geo_collection_profiles_language CHECK (length(language_code) BETWEEN
                2 AND 16 AND language_code ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$'),
            CONSTRAINT ck_geo_collection_profiles_region CHECK (length(region_code) = 2 AND
                region_code ~ '^[A-Z]{2}$'),
            CONSTRAINT ck_geo_collection_profiles_login CHECK ((collection_mode = 'API' AND
                login_state = 'NOT_APPLICABLE') OR (collection_mode IN ('MANUAL','BROWSER') AND
                login_state IN ('ANONYMOUS','AUTHENTICATED'))),
            CONSTRAINT ck_geo_collection_profiles_search CHECK (web_search_policy IN
                ('UNKNOWN','REQUESTED','REQUIRED','NOT_APPLICABLE')),
            CONSTRAINT ck_geo_collection_profiles_settings CHECK
                (geo_profile_settings_valid(collection_mode, settings_json)),
            CONSTRAINT ck_geo_collection_profiles_test CHECK ((last_test_status = 'UNTESTED' AND
                last_tested_at IS NULL) OR (last_test_status IN ('PASSED','FAILED') AND
                last_tested_at IS NOT NULL)),
            CONSTRAINT ck_geo_collection_profiles_revision CHECK (revision >= 0),
            CONSTRAINT fk_geo_collection_profiles_surface FOREIGN KEY(engine_surface_id)
                REFERENCES geo_engine_surfaces (id) ON DELETE RESTRICT,
            CONSTRAINT fk_geo_collection_profiles_creator FOREIGN KEY(created_by) REFERENCES
                users (id) ON DELETE RESTRICT
        );
    """)
    op.execute("""
        CREATE INDEX ix_geo_collection_profiles_creator ON geo_collection_profiles (created_by);
    """)
    op.execute("""
        CREATE INDEX ix_geo_collection_profiles_model ON geo_collection_profiles (ai_model_id,
            ai_channel_id);
    """)
    op.execute("""
        CREATE INDEX ix_geo_collection_profiles_surface_active ON geo_collection_profiles
            (engine_surface_id, is_active);
    """)
    op.execute("""
        CREATE FUNCTION geo_guard_surface_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE prior jsonb; current_row jsonb; prefix text; changed boolean;
        BEGIN
            prefix := 'ck_' || TG_TABLE_NAME || '_';
            IF TG_OP = 'DELETE' THEN
                IF TG_TABLE_NAME = 'geo_engine_surfaces' AND
                    to_jsonb(OLD) ->> 'first_referenced_at' IS NOT NULL THEN
                    RAISE EXCEPTION '已引用观测面不可删除'
                        USING ERRCODE = '23514', CONSTRAINT = prefix || 'history';
                END IF;
                RETURN OLD;
            END IF;
            current_row := to_jsonb(NEW);
            IF TG_OP = 'INSERT' THEN
                IF NEW.revision <> 0 OR current_row ->> 'first_referenced_at' IS NOT NULL THEN
                    RAISE EXCEPTION '观测配置必须从未引用的revision 0创建'
                        USING ERRCODE = '23514', CONSTRAINT = prefix || 'initial';
                END IF;
                RETURN NEW;
            END IF;
            prior := to_jsonb(OLD);
            IF ROW(NEW.id, NEW.created_by, NEW.created_at)
                IS DISTINCT FROM ROW(OLD.id, OLD.created_by, OLD.created_at) OR
                (TG_TABLE_NAME = 'geo_collection_profiles' AND
                    (current_row -> 'engine_surface_id' IS DISTINCT FROM prior ->
                        'engine_surface_id'
                     OR current_row -> 'collection_mode' IS DISTINCT FROM prior ->
                         'collection_mode')) THEN
                RAISE EXCEPTION '观测配置身份与归属不可变'
                    USING ERRCODE = '23514', CONSTRAINT = prefix || 'identity';
            END IF;
            IF TG_TABLE_NAME = 'geo_engine_surfaces' AND prior ->> 'first_referenced_at' IS NOT NULL
                AND current_row -> 'first_referenced_at' IS DISTINCT FROM prior ->
                    'first_referenced_at' THEN
                RAISE EXCEPTION '首次引用锁存不可改写'
                    USING ERRCODE = '23514', CONSTRAINT = prefix || 'history';
            END IF;
            -- FK 的成对SET NULL仅解绑身份；不伪造配置更新、测试或审计事实。
            IF TG_TABLE_NAME = 'geo_collection_profiles' AND pg_trigger_depth() > 1
                AND current_row ->> 'ai_channel_id' IS NULL AND current_row ->> 'ai_model_id' IS
                    NULL
                AND current_row - ARRAY['ai_channel_id','ai_model_id'] =
                    prior - ARRAY['ai_channel_id','ai_model_id'] THEN
                RETURN NEW;
            END IF;
            changed := current_row - ARRAY['revision','updated_at'] IS DISTINCT FROM
                       prior - ARRAY['revision','updated_at'];
            IF NEW.revision <> OLD.revision + (CASE WHEN changed THEN 1 ELSE 0 END) THEN
                RAISE EXCEPTION '有效配置变更revision必须恰好递增一次'
                    USING ERRCODE = '23514', CONSTRAINT = prefix || 'revision_step';
            END IF;
            IF NEW.updated_at < OLD.updated_at OR
                (NOT changed AND NEW.updated_at IS DISTINCT FROM OLD.updated_at) THEN
                RAISE EXCEPTION '更新时间不得倒退，no-op不得改写时间'
                    USING ERRCODE = '23514', CONSTRAINT = prefix || 'updated_at';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER geo_engine_surface_guard BEFORE INSERT OR UPDATE OR DELETE ON
            geo_engine_surfaces
            FOR EACH ROW EXECUTE FUNCTION geo_guard_surface_configuration();
        CREATE TRIGGER geo_collection_profile_guard BEFORE INSERT OR UPDATE OR DELETE ON
            geo_collection_profiles
            FOR EACH ROW EXECUTE FUNCTION geo_guard_surface_configuration();
    """)


def downgrade() -> None:
    # 显式保留配置与可能已建立的历史；恢复使用前滚修复或迁移前备份。
    op.execute("""
        DO $$ BEGIN
            RAISE EXCEPTION '0046 GEO Surface/Profile 无法安全降级；使用前向修复'
                USING ERRCODE = '55000';
        END $$;
    """)
