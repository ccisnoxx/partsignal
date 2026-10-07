CREATE TABLE geo_analysis_jobs (
    analysis_revision_id uuid PRIMARY KEY,
    lease_token uuid,
    lease_expires_at timestamptz,
    claimed_at timestamptz,
    last_dispatch_attempt_at timestamptz,
    dispatch_attempt_count integer NOT NULL DEFAULT 0,
    CONSTRAINT fk_geo_analysis_jobs_revision FOREIGN KEY (analysis_revision_id)
        REFERENCES geo_analysis_revisions(id) ON DELETE RESTRICT,
    CONSTRAINT ck_geo_analysis_jobs_lease CHECK (
        (lease_token IS NULL) = (lease_expires_at IS NULL) AND
        (lease_token IS NULL OR (claimed_at IS NOT NULL AND lease_expires_at > claimed_at))),
    CONSTRAINT ck_geo_analysis_jobs_dispatch CHECK (
        dispatch_attempt_count >= 0 AND ((dispatch_attempt_count = 0) = (last_dispatch_attempt_at IS NULL)))
);
CREATE INDEX ix_geo_analysis_jobs_expiry ON geo_analysis_jobs(lease_expires_at) WHERE lease_token IS NOT NULL;
CREATE INDEX ix_geo_analysis_jobs_dispatch ON geo_analysis_jobs(last_dispatch_attempt_at,analysis_revision_id);

CREATE TABLE geo_citation_classifications (
    analysis_revision_id uuid NOT NULL,
    citation_id uuid NOT NULL,
    source_category varchar(32) NOT NULL,
    subject_id uuid,
    PRIMARY KEY (analysis_revision_id,citation_id),
    CONSTRAINT fk_geo_citation_classifications_revision FOREIGN KEY (analysis_revision_id)
        REFERENCES geo_analysis_revisions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_geo_citation_classifications_citation FOREIGN KEY (citation_id)
        REFERENCES geo_answer_citations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_geo_citation_classifications_subject FOREIGN KEY (subject_id)
        REFERENCES geo_subjects(id) ON DELETE RESTRICT,
    CONSTRAINT ck_geo_citation_classifications_category CHECK (
        source_category IN ('OWNED','COMPETITOR','INDUSTRY_MEDIA','DISTRIBUTOR','COMMUNITY',
            'SOCIAL','SEARCH_ENGINE','ACADEMIC_OR_INSTITUTIONAL','OTHER','UNKNOWN'))
);
CREATE INDEX ix_geo_citation_classifications_citation ON geo_citation_classifications(citation_id);
CREATE INDEX ix_geo_citation_classifications_subject ON geo_citation_classifications(subject_id);
