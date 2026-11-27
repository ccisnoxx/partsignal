-- Slice 3D: 公开页面健康检查配置与不可变追加检查历史

ALTER TABLE platform_profiles
    ADD COLUMN health_check_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN health_check_interval_hours INTEGER NOT NULL DEFAULT 24,
    ADD COLUMN health_check_anomaly_threshold INTEGER NOT NULL DEFAULT 2;

ALTER TABLE platform_profiles
    ADD CONSTRAINT ck_platform_profiles_health_interval
        CHECK (health_check_interval_hours BETWEEN 1 AND 720),
    ADD CONSTRAINT ck_platform_profiles_health_threshold
        CHECK (health_check_anomaly_threshold BETWEEN 1 AND 10);

CREATE TABLE published_article_health_checks (
    id UUID CONSTRAINT pk_published_article_health_checks PRIMARY KEY,
    published_article_id UUID NOT NULL
        CONSTRAINT fk_published_article_health_checks_article
        REFERENCES published_articles(id) ON DELETE RESTRICT,
    checked_url TEXT NOT NULL
        CONSTRAINT ck_published_article_health_checks_url_nonempty
        CHECK (length(btrim(checked_url)) > 0),
    final_url TEXT NULL,
    status VARCHAR(32) NOT NULL
        CONSTRAINT ck_published_article_health_checks_status
        CHECK (status IN ('HEALTHY', 'FETCH_BLOCKED', 'CONFIRMED_ANOMALY')),
    http_status INTEGER NULL
        CONSTRAINT ck_published_article_health_checks_http_status
        CHECK (http_status IS NULL OR (http_status BETWEEN 100 AND 599)),
    redirect_count INTEGER NOT NULL DEFAULT 0
        CONSTRAINT ck_published_article_health_checks_redirect_count
        CHECK (redirect_count >= 0),
    redirected BOOLEAN NOT NULL DEFAULT false,
    page_title TEXT NULL,
    title_matches BOOLEAN NULL,
    body_similarity DOUBLE PRECISION NULL
        CONSTRAINT ck_published_article_health_checks_body_similarity
        CHECK (body_similarity IS NULL OR (body_similarity >= 0.0 AND body_similarity <= 1.0)),
    has_noindex BOOLEAN NOT NULL DEFAULT false,
    canonical_url TEXT NULL,
    canonical_matches BOOLEAN NULL,
    anomaly_reasons JSONB NOT NULL DEFAULT '[]'::jsonb
        CONSTRAINT ck_published_article_health_checks_reasons_array
        CHECK (jsonb_typeof(anomaly_reasons) = 'array'),
    fetch_error_code VARCHAR(64) NULL,
    auto_opened_issue_id UUID NULL
        CONSTRAINT fk_published_article_health_checks_issue
        REFERENCES published_content_issues(id) ON DELETE SET NULL,
    triggered_by UUID NULL
        CONSTRAINT fk_published_article_health_checks_triggered_by
        REFERENCES users(id) ON DELETE RESTRICT,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ix_published_article_health_checks_article_checked
    ON published_article_health_checks (published_article_id, checked_at DESC, id DESC);

CREATE INDEX ix_published_article_health_checks_triggered_by
    ON published_article_health_checks (triggered_by)
    WHERE triggered_by IS NOT NULL;

CREATE INDEX ix_published_article_health_checks_auto_issue
    ON published_article_health_checks (auto_opened_issue_id)
    WHERE auto_opened_issue_id IS NOT NULL;

CREATE OR REPLACE FUNCTION partsignal_guard_published_article_health_check() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- 仅豁免删除 PublishedContentIssue 触发的 FK ON DELETE SET NULL 级联置空
        IF pg_trigger_depth() > 1
            AND NEW.auto_opened_issue_id IS NULL
            AND OLD.auto_opened_issue_id IS NOT NULL
            AND (to_jsonb(NEW) - ARRAY['auto_opened_issue_id'])
                = (to_jsonb(OLD) - ARRAY['auto_opened_issue_id'])
        THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'published_article_health_checks rows are immutable'
            USING ERRCODE = '55000';
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF current_setting('partsignal.published_article_delete_id', true)
            = OLD.published_article_id::text
        THEN
            RETURN OLD;
        END IF;
        IF EXISTS (
            SELECT 1
            FROM publication_works w
            WHERE w.id = OLD.published_article_id
              AND w.content_task_id::text
                  = current_setting('partsignal.content_task_delete_id', true)
        ) THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'published_article_health_checks rows are immutable'
            USING ERRCODE = '55000';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_published_article_health_checks_immutable
    BEFORE UPDATE OR DELETE ON published_article_health_checks
    FOR EACH ROW EXECUTE FUNCTION partsignal_guard_published_article_health_check();
