-- Slice 1B: 统一文章与多 URL 发布台账、产品轻量资料与 AI 生成快照

ALTER TABLE products
    ADD COLUMN summary TEXT NOT NULL DEFAULT '',
    ADD COLUMN datasheet_url TEXT NULL,
    ADD COLUMN facts_updated_at TIMESTAMPTZ NULL,
    ADD COLUMN facts_updated_by UUID NULL
        CONSTRAINT fk_products_facts_updated_by REFERENCES users(id) ON DELETE RESTRICT,
    ADD CONSTRAINT ck_products_summary_len CHECK (length(summary) <= 2000),
    ADD CONSTRAINT ck_products_datasheet_url
        CHECK (datasheet_url IS NULL OR (length(datasheet_url) <= 2000 AND datasheet_url ~ '^https?://[^[:space:]]+$')),
    ADD CONSTRAINT ck_products_facts_updated_pair
        CHECK ((facts_updated_at IS NULL) = (facts_updated_by IS NULL));

CREATE INDEX ix_products_facts_updated_by
    ON products (facts_updated_by) WHERE facts_updated_by IS NOT NULL;

CREATE TABLE product_material_attachments (
    product_id UUID NOT NULL
        CONSTRAINT fk_product_materials_product REFERENCES products(id) ON DELETE RESTRICT,
    file_id UUID NOT NULL
        CONSTRAINT fk_product_materials_file REFERENCES file_records(id) ON DELETE RESTRICT,
    display_label VARCHAR(200) NOT NULL DEFAULT '',
    created_by UUID NOT NULL
        CONSTRAINT fk_product_materials_creator REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_product_material_attachments PRIMARY KEY (product_id, file_id),
    CONSTRAINT ck_product_materials_label CHECK (length(display_label) <= 200)
);

CREATE INDEX ix_product_materials_creator ON product_material_attachments (created_by);

CREATE TABLE articles (
    id UUID CONSTRAINT pk_articles PRIMARY KEY,
    product_id UUID NOT NULL
        CONSTRAINT fk_articles_product REFERENCES products(id) ON DELETE RESTRICT,
    parent_article_id UUID NULL
        CONSTRAINT fk_articles_parent REFERENCES articles(id) ON DELETE RESTRICT,
    title TEXT NOT NULL
        CONSTRAINT ck_articles_title CHECK (length(btrim(title)) BETWEEN 1 AND 300),
    summary TEXT NOT NULL DEFAULT ''
        CONSTRAINT ck_articles_summary CHECK (length(summary) <= 2000),
    body_markdown TEXT NOT NULL
        CONSTRAINT ck_articles_body CHECK (body_markdown ~ '[^[:space:]]' AND length(body_markdown) <= 524288),
    target_keywords TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    origin_type VARCHAR(24) NOT NULL
        CONSTRAINT ck_articles_origin_type
        CHECK (origin_type IN ('EXTERNAL_AI', 'HUMAN', 'SYSTEM_AI', 'OTHER')),
    external_model_name VARCHAR(160) NULL
        CONSTRAINT ck_articles_external_model
        CHECK (
            (origin_type = 'EXTERNAL_AI' AND (external_model_name IS NULL OR length(btrim(external_model_name)) BETWEEN 1 AND 160))
            OR (origin_type <> 'EXTERNAL_AI' AND external_model_name IS NULL)
        ),
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
        CONSTRAINT ck_articles_status CHECK (status IN ('DRAFT', 'READY', 'PUBLISHED', 'ARCHIVED')),
    current_revision INT NOT NULL DEFAULT 1
        CONSTRAINT ck_articles_current_rev CHECK (current_revision >= 1),
    revision INT NOT NULL DEFAULT 0
        CONSTRAINT ck_articles_opt_rev CHECK (revision >= 0),
    owner_id UUID NOT NULL
        CONSTRAINT fk_articles_owner REFERENCES users(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL
        CONSTRAINT fk_articles_creator REFERENCES users(id) ON DELETE RESTRICT,
    updated_by UUID NOT NULL
        CONSTRAINT fk_articles_updater REFERENCES users(id) ON DELETE RESTRICT,
    source_content_task_id UUID NULL
        CONSTRAINT fk_articles_content_task REFERENCES content_tasks(id) ON DELETE SET NULL,
    source_content_version_id UUID NULL
        CONSTRAINT fk_articles_content_version REFERENCES content_versions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_articles_parent_not_self CHECK (parent_article_id IS NULL OR parent_article_id <> id),
    CONSTRAINT ck_articles_source_task_origin CHECK (
        origin_type IN ('SYSTEM_AI', 'HUMAN') OR (source_content_task_id IS NULL AND source_content_version_id IS NULL)
    )
);

CREATE UNIQUE INDEX uq_articles_source_task
    ON articles (source_content_task_id) WHERE source_content_task_id IS NOT NULL;
CREATE INDEX ix_articles_product_status ON articles (product_id, status, updated_at DESC, id);
CREATE INDEX ix_articles_owner ON articles (owner_id);
CREATE INDEX ix_articles_creator ON articles (created_by);
CREATE INDEX ix_articles_updater ON articles (updated_by);

CREATE TABLE article_revisions (
    id UUID CONSTRAINT pk_article_revisions PRIMARY KEY,
    article_id UUID NOT NULL
        CONSTRAINT fk_article_revisions_article REFERENCES articles(id) ON DELETE RESTRICT,
    revision_no INT NOT NULL CONSTRAINT ck_article_revisions_no CHECK (revision_no >= 1),
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    change_summary TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL
        CONSTRAINT fk_article_revisions_creator REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_article_revisions_article_no UNIQUE (article_id, revision_no)
);

CREATE INDEX ix_article_revisions_creator ON article_revisions (created_by);

CREATE OR REPLACE FUNCTION partsignal_guard_article_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'append-only ledger table % cannot be modified or deleted', TG_TABLE_NAME
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_article_revisions_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON article_revisions
    FOR EACH STATEMENT EXECUTE FUNCTION partsignal_guard_article_append_only();

CREATE TABLE article_publications (
    id UUID CONSTRAINT pk_article_publications PRIMARY KEY,
    article_id UUID NOT NULL
        CONSTRAINT fk_article_publications_article REFERENCES articles(id) ON DELETE RESTRICT,
    article_revision_id UUID NOT NULL
        CONSTRAINT fk_article_publications_article_rev REFERENCES article_revisions(id) ON DELETE RESTRICT,
    platform_profile_id UUID NULL
        CONSTRAINT fk_article_publications_platform REFERENCES platform_profiles(id) ON DELETE SET NULL,
    platform_name_snapshot VARCHAR(160) NOT NULL
        CONSTRAINT ck_article_publications_platform_name CHECK (length(btrim(platform_name_snapshot)) BETWEEN 1 AND 160),
    platform_account_id UUID NULL
        CONSTRAINT fk_article_publications_account REFERENCES platform_accounts(id) ON DELETE SET NULL,
    platform_account_label_snapshot VARCHAR(160) NULL,
    actual_title TEXT NOT NULL
        CONSTRAINT ck_article_publications_title CHECK (length(btrim(actual_title)) BETWEEN 1 AND 300),
    final_url TEXT NOT NULL
        CONSTRAINT ck_article_publications_url CHECK (length(final_url) <= 2083 AND final_url ~ '^https?://[^[:space:]]+$'),
    normalized_url TEXT NOT NULL,
    hostname VARCHAR(253) NOT NULL,
    published_at TIMESTAMPTZ NOT NULL,
    registration_status VARCHAR(24) NOT NULL DEFAULT 'REGISTERED'
        CONSTRAINT ck_article_publications_reg_status CHECK (registration_status IN ('REGISTERED', 'REMOVED')),
    verification_status VARCHAR(24) NOT NULL DEFAULT 'UNVERIFIED'
        CONSTRAINT ck_article_publications_ver_status CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'ISSUE_OPEN')),
    verified_at TIMESTAMPTZ NULL,
    verified_by UUID NULL
        CONSTRAINT fk_article_publications_verifier REFERENCES users(id) ON DELETE RESTRICT,
    source_published_article_id UUID NULL
        CONSTRAINT fk_article_publications_legacy_pub REFERENCES published_articles(id) ON DELETE SET NULL,
    screenshot_file_id UUID NULL
        CONSTRAINT fk_article_publications_screenshot REFERENCES file_records(id) ON DELETE RESTRICT,
    notes TEXT NOT NULL DEFAULT '' CONSTRAINT ck_article_publications_notes CHECK (length(notes) <= 2000),
    revision INT NOT NULL DEFAULT 0 CONSTRAINT ck_article_publications_rev CHECK (revision >= 0),
    registered_by UUID NOT NULL
        CONSTRAINT fk_article_publications_registrar REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_article_publications_verified_fact CHECK (
        (verification_status = 'UNVERIFIED' AND verified_at IS NULL AND verified_by IS NULL)
        OR (verification_status IN ('VERIFIED', 'ISSUE_OPEN') AND verified_at IS NOT NULL AND verified_by IS NOT NULL)
    )
);

CREATE UNIQUE INDEX uq_article_publications_source_published
    ON article_publications (source_published_article_id)
    WHERE source_published_article_id IS NOT NULL;
CREATE UNIQUE INDEX uq_article_publications_active_url
    ON article_publications (normalized_url)
    WHERE registration_status = 'REGISTERED';
CREATE INDEX ix_article_publications_hostname_active
    ON article_publications (hostname, registration_status);
CREATE INDEX ix_article_publications_article_published
    ON article_publications (article_id, published_at DESC, id);
CREATE INDEX ix_article_publications_registrar ON article_publications (registered_by);
CREATE INDEX ix_article_publications_verifier
    ON article_publications (verified_by) WHERE verified_by IS NOT NULL;

CREATE TABLE article_publication_events (
    id UUID CONSTRAINT pk_article_publication_events PRIMARY KEY,
    article_publication_id UUID NOT NULL
        CONSTRAINT fk_article_pub_events_pub REFERENCES article_publications(id) ON DELETE RESTRICT,
    action VARCHAR(32) NOT NULL
        CONSTRAINT ck_article_pub_events_action
        CHECK (action IN ('REGISTERED', 'UPDATED', 'MARKED_REMOVED', 'VERIFIED_SYNCED', 'ISSUE_SYNCED')),
    snapshot_payload JSONB NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    actor_id UUID NOT NULL
        CONSTRAINT fk_article_pub_events_actor REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_article_pub_events_pub_created
    ON article_publication_events (article_publication_id, created_at DESC, id);
CREATE INDEX ix_article_pub_events_actor ON article_publication_events (actor_id);

CREATE TRIGGER trg_article_publication_events_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON article_publication_events
    FOR EACH STATEMENT EXECUTE FUNCTION partsignal_guard_article_append_only();

CREATE TABLE article_ai_generation_snapshots (
    id UUID CONSTRAINT pk_article_ai_gen_snapshots PRIMARY KEY,
    article_id UUID NOT NULL
        CONSTRAINT fk_article_ai_snap_article REFERENCES articles(id) ON DELETE RESTRICT,
    article_revision_id UUID NOT NULL
        CONSTRAINT fk_article_ai_snap_rev REFERENCES article_revisions(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL
        CONSTRAINT fk_article_ai_snap_product REFERENCES products(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(128) NOT NULL
        CONSTRAINT uq_article_ai_snap_idempotency UNIQUE,
    product_facts_classification VARCHAR(16) NOT NULL
        CONSTRAINT ck_article_ai_snap_public CHECK (product_facts_classification = 'PUBLIC'),
    product_facts_markdown_snapshot TEXT NOT NULL,
    prompt_template_version_id UUID NULL
        CONSTRAINT fk_article_ai_snap_prompt REFERENCES platform_prompt_versions(id) ON DELETE SET NULL,
    rendered_messages_snapshot JSONB NOT NULL,
    ai_channel_id UUID NULL
        CONSTRAINT fk_article_ai_snap_channel REFERENCES ai_channels(id) ON DELETE SET NULL,
    ai_model_id UUID NULL
        CONSTRAINT fk_article_ai_snap_model REFERENCES ai_models(id) ON DELETE SET NULL,
    provider_model_snapshot VARCHAR(200) NOT NULL,
    cost_amount NUMERIC(14, 6) NULL,
    cost_currency VARCHAR(8) NULL,
    created_by UUID NOT NULL
        CONSTRAINT fk_article_ai_snap_creator REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_article_ai_snap_cost_pair CHECK (
        (cost_amount IS NULL AND cost_currency IS NULL)
        OR (cost_amount IS NOT NULL AND cost_currency IS NOT NULL AND cost_amount >= 0 AND cost_currency ~ '^[A-Z]{3}$')
    )
);

CREATE INDEX ix_article_ai_snap_article ON article_ai_generation_snapshots (article_id);
CREATE INDEX ix_article_ai_snap_creator ON article_ai_generation_snapshots (created_by);

CREATE TRIGGER trg_article_ai_gen_snapshots_immutable
    BEFORE UPDATE OR DELETE OR TRUNCATE ON article_ai_generation_snapshots
    FOR EACH STATEMENT EXECUTE FUNCTION partsignal_guard_article_append_only();
