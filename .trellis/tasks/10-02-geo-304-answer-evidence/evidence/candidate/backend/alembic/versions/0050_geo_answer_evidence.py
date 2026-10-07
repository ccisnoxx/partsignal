"""新增不可变原始回答、引用和受控文件关系；不实现采集命令。"""

from pathlib import Path

from alembic import op

revision = "0050_geo_answer_evidence"
down_revision = "0049_geo_batch_creation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM geo_observation_runs WHERE collected_at IS NOT NULL
            OR status IN ('COLLECTED','ANALYZING','NEEDS_REVIEW','COMPLETED')) THEN
            RAISE EXCEPTION '0050 发现无原始证据的采集历史；需明确证据迁移，禁止补空回答'
                USING ERRCODE='55000';
        END IF;
    END $$;""")
    sql_dir = Path(__file__).resolve().parents[1] / "sql"
    op.execute((sql_dir / "0050_geo_answer_functions.sql").read_text())
    # 冻结 DDL，不导入运行时 ORM。
    op.execute("""

CREATE TABLE geo_answer_snapshots (
	id UUID NOT NULL,
	run_id UUID NOT NULL,
	prompt_text TEXT NOT NULL,
	answer_text TEXT NOT NULL,
	answer_sha256 VARCHAR(64) GENERATED ALWAYS AS (geo_answer_sha256(answer_text)) STORED NOT NULL,
	answer_format VARCHAR(16) NOT NULL,
	source_product VARCHAR(160),
	source_model VARCHAR(200),
	source_version VARCHAR(200),
	web_search_observed BOOLEAN,
	raw_payload_summary JSONB NOT NULL,
	raw_payload_file_id UUID,
	screenshot_file_id UUID,
	citation_count INTEGER NOT NULL,
	collected_at TIMESTAMP WITH TIME ZONE NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_geo_answer_snapshots PRIMARY KEY (id),
	CONSTRAINT uq_geo_answers_run UNIQUE (run_id),
    CONSTRAINT ck_geo_answers_text CHECK (prompt_text ~ '[^[:space:]]' AND answer_text ~ '[^[:space:]]' AND length(answer_text) <= 1048576),
	CONSTRAINT ck_geo_answers_format CHECK (answer_format IN ('TEXT','MARKDOWN','HTML_TEXT')),
	CONSTRAINT ck_geo_answers_sources CHECK ((source_product IS NULL OR length(btrim(source_product)) > 0) AND (source_model IS NULL OR length(btrim(source_model)) > 0) AND (source_version IS NULL OR length(btrim(source_version)) > 0)),
	CONSTRAINT ck_geo_answers_summary CHECK (geo_raw_summary_valid(raw_payload_summary)),
	CONSTRAINT ck_geo_answers_citation_count CHECK (citation_count BETWEEN 0 AND 1000),
	CONSTRAINT ck_geo_answers_files CHECK (raw_payload_file_id IS NULL OR screenshot_file_id IS NULL OR raw_payload_file_id <> screenshot_file_id),
	CONSTRAINT fk_geo_answers_run FOREIGN KEY(run_id) REFERENCES geo_observation_runs (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_answers_raw_file FOREIGN KEY(raw_payload_file_id) REFERENCES file_records (id) ON DELETE RESTRICT,
	CONSTRAINT fk_geo_answers_screenshot_file FOREIGN KEY(screenshot_file_id) REFERENCES file_records (id) ON DELETE RESTRICT
)

;
CREATE INDEX ix_geo_answers_raw_file ON geo_answer_snapshots (raw_payload_file_id);
CREATE INDEX ix_geo_answers_screenshot_file ON geo_answer_snapshots (screenshot_file_id);

CREATE TABLE geo_answer_citations (
	id UUID NOT NULL,
	answer_snapshot_id UUID NOT NULL,
	position INTEGER NOT NULL,
	occurrences INTEGER[] NOT NULL,
	original_url TEXT NOT NULL,
	normalized_url TEXT NOT NULL,
	hostname VARCHAR(253) NOT NULL,
	title TEXT,
	extraction_source VARCHAR(24) NOT NULL,
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
	CONSTRAINT pk_geo_answer_citations PRIMARY KEY (id),
	CONSTRAINT uq_geo_citations_url UNIQUE (answer_snapshot_id, normalized_url),
	CONSTRAINT uq_geo_citations_position UNIQUE (answer_snapshot_id, position),
	CONSTRAINT ck_geo_citations_url CHECK (geo_citation_url_valid(original_url, normalized_url, hostname)),
	CONSTRAINT ck_geo_citations_occurrences CHECK (geo_citation_occurrences_valid(position, occurrences)),
	CONSTRAINT ck_geo_citations_source CHECK (extraction_source IN ('STRUCTURED','DOM','TEXT','MANUAL')),
	CONSTRAINT ck_geo_citations_title CHECK (title IS NULL OR length(title) <= 2000),
	CONSTRAINT fk_geo_citations_answer FOREIGN KEY(answer_snapshot_id) REFERENCES geo_answer_snapshots (id) ON DELETE RESTRICT
)

;

    """)
    op.execute((sql_dir / "0050_geo_answer_guards.sql").read_text())


def downgrade() -> None:
    op.execute("""DO $$ BEGIN
        RAISE EXCEPTION '0050 原始回答与证据不可安全降级；保留历史并前向修复'
            USING ERRCODE='55000';
    END $$;""")
