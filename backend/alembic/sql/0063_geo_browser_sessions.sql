-- GEO-802 只保存加密引用与不可逆撤销事实，不保存任何会话正文或密文。
ALTER TABLE geo_collection_profiles ADD COLUMN session_revision integer NOT NULL DEFAULT 0;
ALTER TABLE geo_collection_profiles ADD CONSTRAINT ck_geo_collection_profiles_session_revision
    CHECK (session_revision >= 0 AND (collection_mode = 'BROWSER' OR session_revision = 0));
CREATE FUNCTION geo_browser_profile_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.session_revision <> 0 THEN
        RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='ck_geo_browser_profile_session_initial',
            MESSAGE='browser session revision must start at zero';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.session_revision IS DISTINCT FROM OLD.session_revision
        AND NEW.session_revision <> OLD.session_revision + 1 THEN
        RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='ck_geo_browser_profile_session_step',
            MESSAGE='browser session revision must increment once';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_browser_profile_revision_guard BEFORE INSERT OR UPDATE ON geo_collection_profiles
    FOR EACH ROW EXECUTE FUNCTION geo_browser_profile_revision_guard();

CREATE TABLE geo_browser_sessions (
    id uuid CONSTRAINT pk_geo_browser_sessions PRIMARY KEY,
    profile_id uuid NOT NULL CONSTRAINT fk_geo_browser_sessions_profile
        REFERENCES geo_collection_profiles(id) ON DELETE RESTRICT,
    cipher_sha256 varchar(64) NOT NULL,
    expires_at timestamptz NOT NULL,
    health varchar(16) NOT NULL,
    last_checked_at timestamptz NOT NULL,
    created_by uuid NOT NULL CONSTRAINT fk_geo_browser_sessions_creator
        REFERENCES users(id) ON DELETE RESTRICT,
    revoked_by uuid CONSTRAINT fk_geo_browser_sessions_revoker
        REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    purged_at timestamptz,
    CONSTRAINT ck_geo_browser_sessions_digest CHECK (cipher_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_geo_browser_sessions_expiry CHECK (expires_at > created_at),
    CONSTRAINT ck_geo_browser_sessions_health CHECK
        (health IN ('AVAILABLE','EXPIRED','REVOKED','MISSING','UNREADABLE')),
    CONSTRAINT ck_geo_browser_sessions_revocation CHECK
        ((revoked_at IS NULL AND revoked_by IS NULL AND health <> 'REVOKED' AND purged_at IS NULL)
        OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND health IN ('REVOKED','EXPIRED'))),
    CONSTRAINT ck_geo_browser_sessions_revoked_time CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CONSTRAINT ck_geo_browser_sessions_purged_time CHECK (purged_at IS NULL OR purged_at >= revoked_at)
);
CREATE UNIQUE INDEX uq_geo_browser_sessions_current_profile ON geo_browser_sessions(profile_id)
    WHERE revoked_at IS NULL;
CREATE INDEX ix_geo_browser_sessions_profile_created ON geo_browser_sessions(profile_id, created_at, id);

CREATE FUNCTION geo_browser_session_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE mode text;
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='browser session revocation history is immutable';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT collection_mode INTO mode FROM geo_collection_profiles WHERE id=NEW.profile_id;
        IF mode IS DISTINCT FROM 'BROWSER' THEN
            RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='ck_geo_browser_sessions_profile_mode',
                MESSAGE='browser session requires browser profile';
        END IF;
        IF NEW.revoked_at IS NOT NULL OR NEW.purged_at IS NOT NULL THEN
            RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='ck_geo_browser_sessions_initial',
                MESSAGE='browser session requires unrevoked initial state';
        END IF;
    ELSE
        IF ROW(NEW.id,NEW.profile_id,NEW.cipher_sha256,NEW.expires_at,NEW.created_by,NEW.created_at)
            IS DISTINCT FROM ROW(OLD.id,OLD.profile_id,OLD.cipher_sha256,OLD.expires_at,OLD.created_by,OLD.created_at)
            OR NEW.last_checked_at < OLD.last_checked_at THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='browser session identity is immutable';
        END IF;
        IF OLD.revoked_at IS NOT NULL AND
            ROW(NEW.revoked_at,NEW.revoked_by,NEW.health,NEW.last_checked_at)
            IS DISTINCT FROM ROW(OLD.revoked_at,OLD.revoked_by,OLD.health,OLD.last_checked_at) THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='browser session revocation is irreversible';
        END IF;
        IF OLD.purged_at IS NOT NULL AND NEW.purged_at IS DISTINCT FROM OLD.purged_at THEN
            RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='browser session purge is irreversible';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_browser_session_guard BEFORE INSERT OR UPDATE OR DELETE ON geo_browser_sessions
    FOR EACH ROW EXECUTE FUNCTION geo_browser_session_guard();
CREATE TRIGGER geo_browser_session_truncate_guard BEFORE TRUNCATE ON geo_browser_sessions
    FOR EACH STATEMENT EXECUTE FUNCTION geo_browser_session_guard();
