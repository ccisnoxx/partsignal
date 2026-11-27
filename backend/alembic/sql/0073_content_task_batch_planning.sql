-- Slice 2C：批量内容任务规划矩阵幂等回执（0073）
-- 纯加法前滚迁移：仅新增追加不可变回执表 content_task_batch_requests，不改写既有任务与历史。

CREATE TABLE content_task_batch_requests (
  id UUID PRIMARY KEY,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key_sha256 VARCHAR(64) NOT NULL,
  request_sha256 VARCHAR(64) NOT NULL,
  campaign_id UUID NULL REFERENCES content_campaigns(id) ON DELETE RESTRICT,
  task_ids UUID[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_content_task_batch_requests_actor_key
    UNIQUE (created_by, request_key_sha256),
  CONSTRAINT ck_content_task_batch_requests_key_sha256
    CHECK (request_key_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_content_task_batch_requests_payload_sha256
    CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_content_task_batch_requests_task_ids_bounds
    CHECK (cardinality(task_ids) BETWEEN 1 AND 100),
  CONSTRAINT ck_content_task_batch_requests_task_ids_nonnull
    CHECK (array_position(task_ids, NULL) IS NULL)
);

CREATE INDEX ix_content_task_batch_requests_created_by
  ON content_task_batch_requests (created_by, created_at);

CREATE INDEX ix_content_task_batch_requests_campaign_id
  ON content_task_batch_requests (campaign_id)
  WHERE campaign_id IS NOT NULL;

CREATE FUNCTION partsignal_guard_content_task_batch_request_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'content task batch request receipt is immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER content_task_batch_requests_immutable_guard
  BEFORE UPDATE OR DELETE ON content_task_batch_requests
  FOR EACH ROW EXECUTE FUNCTION partsignal_guard_content_task_batch_request_immutable();

CREATE TRIGGER content_task_batch_requests_no_truncate
  BEFORE TRUNCATE ON content_task_batch_requests
  FOR EACH STATEMENT EXECUTE FUNCTION partsignal_guard_content_task_batch_request_immutable();
