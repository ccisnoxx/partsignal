-- 0054 冻结 DDL；不从运行时 ORM 导入历史迁移。



CREATE TABLE geo_analysis_revisions (
	id UUID NOT NULL,
	run_id UUID NOT NULL,
	answer_snapshot_id UUID NOT NULL,
	revision INTEGER NOT NULL,
	status VARCHAR(16) DEFAULT 'PENDING' NOT NULL,
	analyzer_type VARCHAR(40) NOT NULL,
	analyzer_version VARCHAR(100) NOT NULL,
	input_snapshot JSONB NOT NULL,
	input_sha256 VARCHAR(64) GENERATED ALWAYS AS (geo_analysis_input_sha256(input_snapshot, analyzer_type, analyzer_version)) STORED NOT NULL,
	confidence_summary JSONB,
	review_required_reasons JSONB DEFAULT '[]'::jsonb NOT NULL,
	error_code VARCHAR(100),
	error_summary VARCHAR(500),
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	finished_at TIMESTAMP WITH TIME ZONE,
	CONSTRAINT pk_geo_analysis_revisions PRIMARY KEY (id),
	CONSTRAINT uq_geo_analysis_run_revision UNIQUE (run_id, revision),
	CONSTRAINT uq_geo_analysis_id_run UNIQUE (id, run_id),
	CONSTRAINT ck_geo_analysis_revision CHECK (revision >= 1),
	CONSTRAINT ck_geo_analysis_status CHECK (status IN ('PENDING','COMPLETED','FAILED')),
	CONSTRAINT ck_geo_analysis_analyzer CHECK (analyzer_type IN ('DETERMINISTIC','HYBRID','EXTERNAL_MODEL') AND analyzer_version ~ '[^[:space:]]'),
	CONSTRAINT ck_geo_analysis_input CHECK (geo_analysis_input_valid(input_snapshot)),
	CONSTRAINT ck_geo_analysis_summary CHECK (geo_analysis_summary_valid(confidence_summary, review_required_reasons)),
	CONSTRAINT ck_geo_analysis_error CHECK ((status = 'FAILED' AND error_code IS NOT NULL AND error_code = 'ANALYSIS_FAILED' AND error_summary IS NOT NULL AND error_summary ~ '[^[:space:]]') OR (status <> 'FAILED' AND error_code IS NULL AND error_summary IS NULL)),
	CONSTRAINT ck_geo_analysis_finish CHECK ((status = 'PENDING') = (finished_at IS NULL) AND (finished_at IS NULL OR finished_at >= created_at) AND (status = 'COMPLETED' OR (confidence_summary IS NULL AND review_required_reasons = '[]'::jsonb))),
	CONSTRAINT fk_geo_analysis_run FOREIGN KEY(run_id) REFERENCES geo_observation_runs (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_analysis_answer FOREIGN KEY(answer_snapshot_id) REFERENCES geo_answer_snapshots (id) ON DELETE RESTRICT
)

;

CREATE INDEX ix_geo_analysis_answer ON geo_analysis_revisions (answer_snapshot_id);

CREATE UNIQUE INDEX uq_geo_analysis_success_input ON geo_analysis_revisions (run_id, input_sha256) WHERE status = 'COMPLETED';


CREATE TABLE geo_analysis_fact_versions (
	analysis_revision_id UUID NOT NULL,
	subject_id UUID NOT NULL,
	fact_version_id UUID NOT NULL,
	CONSTRAINT pk_geo_analysis_fact_versions PRIMARY KEY (analysis_revision_id, subject_id),
	CONSTRAINT uq_geo_analysis_fact_binding UNIQUE (analysis_revision_id, subject_id, fact_version_id),
	CONSTRAINT fk_geo_analysis_facts_analysis FOREIGN KEY(analysis_revision_id) REFERENCES geo_analysis_revisions (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_analysis_facts_subject FOREIGN KEY(subject_id) REFERENCES geo_subjects (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_analysis_facts_version FOREIGN KEY(fact_version_id) REFERENCES fact_versions (id) ON DELETE RESTRICT
)

;

CREATE INDEX ix_geo_analysis_facts_subject ON geo_analysis_fact_versions (subject_id);

CREATE INDEX ix_geo_analysis_facts_version ON geo_analysis_fact_versions (fact_version_id);


CREATE TABLE geo_entity_mentions (
	id UUID NOT NULL,
	analysis_revision_id UUID NOT NULL,
	subject_id UUID NOT NULL,
	mention_count INTEGER NOT NULL,
	first_character_offset INTEGER,
	matched_aliases JSONB NOT NULL,
	confidence NUMERIC(5, 4),
	CONSTRAINT pk_geo_entity_mentions PRIMARY KEY (id),
	CONSTRAINT uq_geo_mentions_analysis_subject UNIQUE (analysis_revision_id, subject_id),
	CONSTRAINT ck_geo_mentions_count CHECK (mention_count >= 1 AND (first_character_offset IS NULL OR first_character_offset >= 0)),
	CONSTRAINT ck_geo_mentions_aliases CHECK (geo_analysis_strings_valid(matched_aliases, 240, 1, NULL)),
	CONSTRAINT ck_geo_mentions_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
	CONSTRAINT fk_geo_mentions_analysis FOREIGN KEY(analysis_revision_id) REFERENCES geo_analysis_revisions (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_mentions_subject FOREIGN KEY(subject_id) REFERENCES geo_subjects (id) ON DELETE RESTRICT
)

;

CREATE INDEX ix_geo_mentions_subject ON geo_entity_mentions (subject_id);


CREATE TABLE geo_recommendations (
	id UUID NOT NULL,
	analysis_revision_id UUID NOT NULL,
	subject_id UUID NOT NULL,
	recommendation VARCHAR(20) NOT NULL,
	rank INTEGER,
	rationale_excerpt TEXT,
	confidence NUMERIC(5, 4),
	CONSTRAINT pk_geo_recommendations PRIMARY KEY (id),
	CONSTRAINT uq_geo_recommendations_analysis_subject UNIQUE (analysis_revision_id, subject_id),
	CONSTRAINT ck_geo_recommendations_kind CHECK (recommendation IN ('RECOMMENDED','CONSIDERED','NOT_RECOMMENDED','UNKNOWN') AND (rank IS NULL OR rank >= 1)),
	CONSTRAINT ck_geo_recommendations_excerpt CHECK (rationale_excerpt IS NULL OR (length(rationale_excerpt) <= 2000 AND rationale_excerpt ~ '[^[:space:]]')),
	CONSTRAINT ck_geo_recommendations_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
	CONSTRAINT fk_geo_recommendations_analysis FOREIGN KEY(analysis_revision_id) REFERENCES geo_analysis_revisions (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_recommendations_subject FOREIGN KEY(subject_id) REFERENCES geo_subjects (id) ON DELETE RESTRICT
)

;

CREATE INDEX ix_geo_recommendations_subject ON geo_recommendations (subject_id);


CREATE TABLE geo_claim_assessments (
	id UUID NOT NULL,
	analysis_revision_id UUID NOT NULL,
	subject_id UUID NOT NULL,
	fact_version_id UUID,
	claim_kind VARCHAR(40) NOT NULL,
	claim_text TEXT NOT NULL,
	claim_sha256 VARCHAR(64) GENERATED ALWAYS AS (geo_answer_sha256(claim_text)) STORED NOT NULL,
	verdict VARCHAR(16) NOT NULL,
	severity VARCHAR(16) NOT NULL,
	fact_excerpt TEXT,
	explanation TEXT NOT NULL,
	confidence NUMERIC(5, 4),
	CONSTRAINT pk_geo_claim_assessments PRIMARY KEY (id),
	CONSTRAINT fk_geo_claims_fact_binding FOREIGN KEY(analysis_revision_id, subject_id, fact_version_id) REFERENCES geo_analysis_fact_versions (analysis_revision_id, subject_id, fact_version_id) ON DELETE RESTRICT,
	CONSTRAINT ck_geo_claims_kind CHECK (claim_kind IN ('IDENTITY','PARAMETER','PACKAGE','TEMPERATURE_GRADE','CERTIFICATION','LIFECYCLE_STATUS','APPLICATION','REPLACEMENT_RELATION','COMPATIBILITY_CONDITION','OTHER')),
	CONSTRAINT ck_geo_claims_result CHECK (verdict IN ('ACCURATE','PARTIAL','INCORRECT','UNJUDGEABLE') AND severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
	CONSTRAINT ck_geo_claims_evidence CHECK (fact_version_id IS NOT NULL OR (verdict = 'UNJUDGEABLE' AND fact_excerpt IS NULL)),
	CONSTRAINT ck_geo_claims_text CHECK (length(claim_text) <= 2000 AND claim_text ~ '[^[:space:]]' AND length(explanation) <= 2000 AND explanation ~ '[^[:space:]]' AND (fact_excerpt IS NULL OR (length(fact_excerpt) <= 2000 AND fact_excerpt ~ '[^[:space:]]'))),
	CONSTRAINT ck_geo_claims_confidence CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
	CONSTRAINT fk_geo_claims_analysis FOREIGN KEY(analysis_revision_id) REFERENCES geo_analysis_revisions (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_claims_subject FOREIGN KEY(subject_id) REFERENCES geo_subjects (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_claims_fact FOREIGN KEY(fact_version_id) REFERENCES fact_versions (id) ON DELETE RESTRICT
)

;

CREATE INDEX ix_geo_claims_analysis ON geo_claim_assessments (analysis_revision_id);

CREATE INDEX ix_geo_claims_fact ON geo_claim_assessments (fact_version_id);

CREATE INDEX ix_geo_claims_subject_result ON geo_claim_assessments (subject_id, verdict, severity, id);


CREATE TABLE geo_run_reviews (
	id UUID NOT NULL,
	run_id UUID NOT NULL,
	analysis_revision_id UUID NOT NULL,
	decision VARCHAR(16) NOT NULL,
	correction_payload JSONB,
	comment TEXT NOT NULL,
	reviewer_id UUID NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_geo_run_reviews PRIMARY KEY (id),
	CONSTRAINT fk_geo_reviews_analysis_run FOREIGN KEY(analysis_revision_id, run_id) REFERENCES geo_analysis_revisions (id, run_id) ON DELETE RESTRICT,
	CONSTRAINT ck_geo_reviews_decision CHECK ((decision = 'CONFIRMED' AND correction_payload IS NULL) OR (decision = 'CORRECTED' AND correction_payload IS NOT NULL AND geo_review_corrections_valid(correction_payload) AND comment ~ '[^[:space:]]')),
	CONSTRAINT ck_geo_reviews_comment CHECK (length(comment) <= 2000),
	CONSTRAINT fk_geo_reviews_run FOREIGN KEY(run_id) REFERENCES geo_observation_runs (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_reviews_reviewer FOREIGN KEY(reviewer_id) REFERENCES users (id) ON DELETE RESTRICT
)

;

CREATE INDEX ix_geo_reviews_current ON geo_run_reviews (run_id, analysis_revision_id, created_at DESC, id DESC);

CREATE INDEX ix_geo_reviews_reviewer ON geo_run_reviews (reviewer_id);

ALTER TABLE geo_observation_runs ADD COLUMN current_analysis_revision_id UUID;
ALTER TABLE geo_observation_runs ADD CONSTRAINT fk_geo_runs_current_analysis FOREIGN KEY(current_analysis_revision_id,id) REFERENCES geo_analysis_revisions(id,run_id) ON DELETE RESTRICT;
CREATE INDEX ix_geo_runs_current_analysis ON geo_observation_runs(current_analysis_revision_id);
