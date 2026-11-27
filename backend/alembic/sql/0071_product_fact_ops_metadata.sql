-- Slice 2A：产品事实运营元数据与新鲜度治理（0071）
-- 历史数据保持 NULL，不回填猜测值；FactVersion 5 项冻结字段纳入不可变触发器保护。

ALTER TABLE products
    ADD COLUMN source_owner VARCHAR(160),
    ADD COLUMN next_review_at TIMESTAMPTZ,
    ADD COLUMN last_reviewed_at TIMESTAMPTZ,
    ADD COLUMN last_reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT,
    ADD COLUMN facts_source_reference TEXT,
    ADD COLUMN facts_verified_at TIMESTAMPTZ,
    ADD COLUMN facts_applicable_region VARCHAR(160),
    ADD COLUMN facts_content_restrictions TEXT,
    ADD COLUMN facts_approved_claims_summary TEXT;

ALTER TABLE products
    ADD CONSTRAINT ck_products_source_owner_trimmed
        CHECK (
            source_owner IS NULL
            OR (length(btrim(source_owner)) BETWEEN 1 AND 160 AND source_owner !~ '^[[:space:]]|[[:space:]]$')
        ),
    ADD CONSTRAINT ck_products_last_review_pair
        CHECK ((last_reviewed_at IS NULL) = (last_reviewed_by IS NULL)),
    ADD CONSTRAINT ck_products_facts_source_reference_bounds
        CHECK (
            facts_source_reference IS NULL
            OR (length(btrim(facts_source_reference)) BETWEEN 1 AND 500 AND facts_source_reference !~ '^[[:space:]]|[[:space:]]$')
        ),
    ADD CONSTRAINT ck_products_facts_applicable_region_bounds
        CHECK (
            facts_applicable_region IS NULL
            OR (length(btrim(facts_applicable_region)) BETWEEN 1 AND 160 AND facts_applicable_region !~ '^[[:space:]]|[[:space:]]$')
        ),
    ADD CONSTRAINT ck_products_facts_content_restrictions_bounds
        CHECK (
            facts_content_restrictions IS NULL
            OR (length(btrim(facts_content_restrictions)) BETWEEN 1 AND 4000 AND facts_content_restrictions !~ '^[[:space:]]|[[:space:]]$')
        ),
    ADD CONSTRAINT ck_products_facts_approved_claims_summary_bounds
        CHECK (
            facts_approved_claims_summary IS NULL
            OR (length(btrim(facts_approved_claims_summary)) BETWEEN 1 AND 4000 AND facts_approved_claims_summary !~ '^[[:space:]]|[[:space:]]$')
        );

CREATE INDEX ix_products_next_review_at
    ON products (next_review_at)
    WHERE next_review_at IS NOT NULL;

CREATE INDEX ix_products_last_reviewed_by
    ON products (last_reviewed_by)
    WHERE last_reviewed_by IS NOT NULL;

ALTER TABLE fact_versions
    ADD COLUMN source_reference TEXT,
    ADD COLUMN verified_at TIMESTAMPTZ,
    ADD COLUMN applicable_region VARCHAR(160),
    ADD COLUMN content_restrictions TEXT,
    ADD COLUMN approved_claims_summary TEXT;

ALTER TABLE fact_versions
    ADD CONSTRAINT ck_fact_versions_source_reference_bounds
        CHECK (
            source_reference IS NULL
            OR (length(btrim(source_reference)) BETWEEN 1 AND 500 AND source_reference !~ '^[[:space:]]|[[:space:]]$')
        ),
    ADD CONSTRAINT ck_fact_versions_applicable_region_bounds
        CHECK (
            applicable_region IS NULL
            OR (length(btrim(applicable_region)) BETWEEN 1 AND 160 AND applicable_region !~ '^[[:space:]]|[[:space:]]$')
        ),
    ADD CONSTRAINT ck_fact_versions_content_restrictions_bounds
        CHECK (
            content_restrictions IS NULL
            OR (length(btrim(content_restrictions)) BETWEEN 1 AND 4000 AND content_restrictions !~ '^[[:space:]]|[[:space:]]$')
        ),
    ADD CONSTRAINT ck_fact_versions_approved_claims_summary_bounds
        CHECK (
            approved_claims_summary IS NULL
            OR (length(btrim(approved_claims_summary)) BETWEEN 1 AND 4000 AND approved_claims_summary !~ '^[[:space:]]|[[:space:]]$')
        );

CREATE OR REPLACE FUNCTION partsignal_guard_fact_version() RETURNS trigger AS $$
BEGIN
  IF NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.body_markdown IS DISTINCT FROM OLD.body_markdown
     OR NEW.classification IS DISTINCT FROM OLD.classification
     OR NEW.source_reference IS DISTINCT FROM OLD.source_reference
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.applicable_region IS DISTINCT FROM OLD.applicable_region
     OR NEW.content_restrictions IS DISTINCT FROM OLD.content_restrictions
     OR NEW.approved_claims_summary IS DISTINCT FROM OLD.approved_claims_summary
     OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'fact version payload is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'PENDING_REVIEW'
     AND NEW.status IN ('PENDING_REVIEW', 'APPROVED', 'CHANGES_REQUESTED')) OR
    (OLD.status = 'APPROVED' AND NEW.status IN ('APPROVED', 'RETIRED')) OR
    (OLD.status = NEW.status)
  ) THEN
    RAISE EXCEPTION 'invalid fact version transition' USING ERRCODE = '55000';
  END IF;
  IF (OLD.status <> 'PENDING_REVIEW' OR NEW.status <> 'APPROVED')
     AND (NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
    RAISE EXCEPTION 'fact approval metadata is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
