-- Slice 3A：PlatformPrompt 不可变版本化、平台显式绑定版本与 GenerationJob 版本归因。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TABLE platform_prompt_versions (
    id UUID NOT NULL,
    prompt_id UUID NOT NULL,
    version INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    template_markdown TEXT NOT NULL,
    template_sha256 VARCHAR(64) NOT NULL,
    change_summary TEXT NOT NULL DEFAULT '',
    revision INTEGER NOT NULL DEFAULT 0,
    published_at TIMESTAMPTZ NULL,
    published_by UUID NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_platform_prompt_versions PRIMARY KEY (id),
    CONSTRAINT fk_platform_prompt_versions_prompt_id_platform_prompts
        FOREIGN KEY (prompt_id) REFERENCES platform_prompts (id) ON DELETE CASCADE,
    CONSTRAINT fk_platform_prompt_versions_published_by_users
        FOREIGN KEY (published_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT fk_platform_prompt_versions_created_by_users
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
    CONSTRAINT uq_platform_prompt_versions_prompt_version UNIQUE (prompt_id, version),
    CONSTRAINT ck_platform_prompt_versions_version_positive CHECK (version >= 1),
    CONSTRAINT ck_platform_prompt_versions_revision_nonnegative CHECK (revision >= 0),
    CONSTRAINT ck_platform_prompt_versions_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT ck_platform_prompt_versions_markdown_nonempty CHECK (btrim(template_markdown) <> ''),
    CONSTRAINT ck_platform_prompt_versions_sha256 CHECK (template_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_platform_prompt_versions_change_summary_len CHECK (length(change_summary) <= 500),
    CONSTRAINT ck_platform_prompt_versions_publish_pair CHECK (
        (status = 'DRAFT' AND published_at IS NULL AND published_by IS NULL)
        OR (status IN ('PUBLISHED', 'ARCHIVED') AND published_at IS NOT NULL AND published_by IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_platform_prompt_versions_one_draft
    ON platform_prompt_versions (prompt_id)
    WHERE status = 'DRAFT';

CREATE INDEX ix_platform_prompt_versions_prompt_status
    ON platform_prompt_versions (prompt_id, status);

CREATE INDEX ix_platform_prompt_versions_created_by
    ON platform_prompt_versions (created_by);

CREATE INDEX ix_platform_prompt_versions_published_by
    ON platform_prompt_versions (published_by)
    WHERE published_by IS NOT NULL;

ALTER TABLE platform_profiles
    ADD COLUMN platform_prompt_version_id UUID NULL,
    ADD CONSTRAINT fk_platform_profiles_platform_prompt_version_id_platform_prompt_versions
        FOREIGN KEY (platform_prompt_version_id) REFERENCES platform_prompt_versions (id) ON DELETE RESTRICT,
    ADD CONSTRAINT ck_platform_profiles_prompt_version_requires_prompt CHECK (
        platform_prompt_version_id IS NULL OR platform_prompt_id IS NOT NULL
    );

CREATE INDEX ix_platform_profiles_prompt_version
    ON platform_profiles (platform_prompt_version_id)
    WHERE platform_prompt_version_id IS NOT NULL;

ALTER TABLE generation_jobs
    ADD COLUMN platform_prompt_version_id UUID NULL,
    ADD CONSTRAINT fk_generation_jobs_platform_prompt_version_id_platform_prompt_versions
        FOREIGN KEY (platform_prompt_version_id) REFERENCES platform_prompt_versions (id) ON DELETE RESTRICT;

CREATE INDEX ix_generation_jobs_prompt_version_status
    ON generation_jobs (platform_prompt_version_id, status)
    WHERE platform_prompt_version_id IS NOT NULL;

-- 存量 PlatformPrompt 无损回填为不可变 v1 已发布版本，并回填平台绑定。
INSERT INTO platform_prompt_versions (
    id,
    prompt_id,
    version,
    status,
    template_markdown,
    template_sha256,
    change_summary,
    revision,
    published_at,
    published_by,
    created_by,
    created_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    p.id,
    1,
    'PUBLISHED',
    p.template_markdown,
    encode(sha256(convert_to(p.template_markdown, 'UTF8')), 'hex'),
    '迁移初始发布版本',
    0,
    p.updated_at,
    p.updated_by,
    p.updated_by,
    p.created_at,
    p.updated_at
FROM platform_prompts p;

UPDATE platform_profiles pp
SET platform_prompt_version_id = v.id
FROM platform_prompt_versions v
WHERE pp.platform_prompt_id IS NOT NULL
  AND v.prompt_id = pp.platform_prompt_id
  AND v.version = 1;

-- 不可变 Prompt 版本守卫：发布后正文永久只读，已绑定或已用于生成的版本严禁删除或误归档。
CREATE OR REPLACE FUNCTION partsignal_guard_platform_prompt_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'DRAFT' THEN
            RETURN OLD;
        END IF;
        IF current_setting('partsignal.allow_unused_prompt_delete', true) = 'on' THEN
            IF EXISTS (
                SELECT 1 FROM generation_jobs WHERE platform_prompt_version_id = OLD.id
            ) OR EXISTS (
                SELECT 1 FROM platform_profiles WHERE platform_prompt_version_id = OLD.id
            ) THEN
                RAISE EXCEPTION 'referenced platform_prompt_version cannot be deleted'
                    USING ERRCODE = '55000';
            END IF;
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'published or archived platform_prompt_version is immutable and cannot be deleted'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.id <> OLD.id
        OR NEW.prompt_id <> OLD.prompt_id
        OR NEW.version <> OLD.version
        OR NEW.created_by <> OLD.created_by
        OR NEW.created_at <> OLD.created_at
    THEN
        RAISE EXCEPTION 'platform_prompt_version identity columns are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.status = 'DRAFT' THEN
        IF NEW.status NOT IN ('DRAFT', 'PUBLISHED') THEN
            RAISE EXCEPTION 'DRAFT platform_prompt_version may only stay DRAFT or transition to PUBLISHED'
                USING ERRCODE = '55000';
        END IF;
        IF NEW.revision <> OLD.revision + 1 THEN
            RAISE EXCEPTION 'platform_prompt_version update must increment revision by 1'
                USING ERRCODE = '55000';
        END IF;
        RETURN NEW;
    END IF;

    -- PUBLISHED / ARCHIVED 后正文与发布元数据永久不可变
    IF NEW.template_markdown IS DISTINCT FROM OLD.template_markdown
        OR NEW.template_sha256 IS DISTINCT FROM OLD.template_sha256
        OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
        OR NEW.published_at IS DISTINCT FROM OLD.published_at
        OR NEW.published_by IS DISTINCT FROM OLD.published_by
    THEN
        RAISE EXCEPTION 'published platform_prompt_version body and metadata are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.status = 'DRAFT' THEN
        RAISE EXCEPTION 'published or archived platform_prompt_version cannot revert to DRAFT'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.status = OLD.status THEN
        RAISE EXCEPTION 'published or archived platform_prompt_version cannot be updated in place'
            USING ERRCODE = '55000';
    END IF;

    IF NEW.status = 'ARCHIVED' AND OLD.status <> 'ARCHIVED' THEN
        IF EXISTS (
            SELECT 1 FROM platform_profiles WHERE platform_prompt_version_id = OLD.id
        ) THEN
            RAISE EXCEPTION 'bound platform_prompt_version cannot be archived'
                USING ERRCODE = '55000';
        END IF;
    END IF;

    IF NEW.revision <> OLD.revision + 1 THEN
        RAISE EXCEPTION 'platform_prompt_version status transition must increment revision by 1'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_platform_prompt_versions_guard
    BEFORE UPDATE OR DELETE ON platform_prompt_versions
    FOR EACH ROW
    EXECUTE FUNCTION partsignal_guard_platform_prompt_version();

-- 平台绑定版本守卫：所绑定版本必须归属同一 PlatformPrompt 且为已发布状态。
CREATE OR REPLACE FUNCTION partsignal_guard_platform_profile_prompt_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_prompt_id UUID;
    v_status VARCHAR(20);
BEGIN
    IF NEW.platform_prompt_version_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT prompt_id, status
    INTO v_prompt_id, v_status
    FROM platform_prompt_versions
    WHERE id = NEW.platform_prompt_version_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'platform_prompt_version_id does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF v_prompt_id IS DISTINCT FROM NEW.platform_prompt_id THEN
        RAISE EXCEPTION 'platform_prompt_version_id must belong to platform_prompt_id'
            USING ERRCODE = '55000';
    END IF;

    IF v_status <> 'PUBLISHED' THEN
        RAISE EXCEPTION 'platform_prompt_version_id must reference a PUBLISHED version'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_platform_profiles_prompt_version_guard
    BEFORE INSERT OR UPDATE OF platform_prompt_id, platform_prompt_version_id ON platform_profiles
    FOR EACH ROW
    EXECUTE FUNCTION partsignal_guard_platform_profile_prompt_version();
