"""创建幂等与批次主体引用；不修改已冻结的 Batch/Run 输入。"""

from alembic import op

revision = "0049_geo_batch_creation"
down_revision = "0048_geo_batches_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
CREATE TABLE geo_batch_creation_requests (
    identity_hash VARCHAR(64) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    batch_id UUID NOT NULL,
    CONSTRAINT pk_geo_batch_creation_requests PRIMARY KEY (identity_hash),
    CONSTRAINT uq_geo_batch_creation_requests_batch UNIQUE (batch_id),
    CONSTRAINT ck_geo_batch_creation_requests_hashes CHECK (
        identity_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT fk_geo_batch_creation_requests_batch FOREIGN KEY (batch_id)
        REFERENCES geo_observation_batches(id) ON DELETE RESTRICT
);
CREATE TABLE geo_batch_subjects (
    batch_id UUID NOT NULL,
    subject_id UUID NOT NULL,
    role VARCHAR(16) NOT NULL,
    CONSTRAINT pk_geo_batch_subjects PRIMARY KEY (batch_id, subject_id),
    CONSTRAINT ck_geo_batch_subjects_role CHECK (role IN ('PRIMARY','COMPETITOR','REFERENCE')),
    CONSTRAINT fk_geo_batch_subjects_batch FOREIGN KEY (batch_id)
        REFERENCES geo_observation_batches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_geo_batch_subjects_subject FOREIGN KEY (subject_id)
        REFERENCES geo_subjects(id) ON DELETE RESTRICT
);
CREATE INDEX ix_geo_batch_subjects_subject ON geo_batch_subjects(subject_id, batch_id);
-- 从权威快照回填；引用缺失由 FK 明确失败，不丢弃或猜测历史。
INSERT INTO geo_batch_subjects(batch_id, subject_id, role)
SELECT b.id, (s->>'subject_id')::uuid, s->>'role'
FROM geo_observation_batches b,
     LATERAL jsonb_array_elements(b.plan_snapshot->'subjects') s;

CREATE FUNCTION geo_creation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'GEO 创建身份与历史引用不可修改或删除'
        USING ERRCODE='23514', CONSTRAINT='ck_geo_creation_immutable';
END $$;
CREATE TRIGGER geo_creation_request_immutable BEFORE UPDATE OR DELETE
ON geo_batch_creation_requests FOR EACH ROW EXECUTE FUNCTION geo_creation_immutable();
CREATE TRIGGER geo_batch_subject_immutable BEFORE UPDATE OR DELETE
ON geo_batch_subjects FOR EACH ROW EXECUTE FUNCTION geo_creation_immutable();

CREATE FUNCTION geo_batch_subject_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b geo_observation_batches%ROWTYPE;
BEGIN
    SELECT * INTO b FROM geo_observation_batches WHERE id=NEW.batch_id FOR UPDATE;
    IF NOT FOUND OR b.status <> 'PLANNED' OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(b.plan_snapshot->'subjects') s
        WHERE s->>'subject_id'=NEW.subject_id::text AND s->>'role'=NEW.role
    ) THEN
        RAISE EXCEPTION '批次主体引用必须在创建期间匹配冻结配置'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_batch_subjects_snapshot';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_batch_subject_insert BEFORE INSERT ON geo_batch_subjects
FOR EACH ROW EXECUTE FUNCTION geo_batch_subject_insert_guard();

CREATE FUNCTION geo_batch_subject_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot jsonb;
BEGIN
    SELECT plan_snapshot INTO snapshot FROM geo_observation_batches WHERE id=NEW.id;
    IF (SELECT count(*) FROM geo_batch_subjects WHERE batch_id=NEW.id)
        <> jsonb_array_length(snapshot->'subjects') THEN
        RAISE EXCEPTION '批次主体引用不完整'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_batch_subjects_complete';
    END IF;
    RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER geo_batch_subjects_complete AFTER INSERT ON geo_observation_batches
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION geo_batch_subject_complete_guard();

CREATE FUNCTION geo_creation_request_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM geo_observation_batches
                   WHERE id=NEW.batch_id AND trigger_type='MANUAL') THEN
        RAISE EXCEPTION '手工幂等身份只能引用手工批次'
            USING ERRCODE='23514', CONSTRAINT='ck_geo_creation_request_manual';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER geo_creation_request_insert BEFORE INSERT ON geo_batch_creation_requests
FOR EACH ROW EXECUTE FUNCTION geo_creation_request_insert_guard();
    """)


def downgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            RAISE EXCEPTION '0049 创建身份与历史引用不可安全降级；保留历史并使用前向修复'
                USING ERRCODE='55000';
        END $$;
    """)
