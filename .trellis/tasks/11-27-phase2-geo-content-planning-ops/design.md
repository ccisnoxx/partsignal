# Phase 2 架构与契约设计

## 全局不变量

1. **Contract-first**：所有 API 变先更新 `contracts/openapi.yaml` 与 `contracts/database.md`，再由 `make contract-generate` 生成前端类型，最后以 `make contract-check` 验证运行时与静态契约零漂移。
2. **PostgreSQL 唯一权威**：所有状态转换、不可变触发器、唯一性与并发锁由 PostgreSQL 裁决；不建第二份可变待办表或冗余 Campaign 归属字段。
3. **服务端动作权威**：所有新旧聚合的 `workflow_stage`、`primary_task`、`available_actions` 均由服务端投影，前端做穷尽映射，不按状态/角色反推资格。
4. **用户删除护栏**：所有新增 `ON DELETE RESTRICT` 的 `users.id` 外键必须同步加入 `backend/app/services/identity.py` 的 `_user_business_reference_counts`。
5. **审计闭合登记**：所有新增低敏审计动作必须同时登记在 `backend/app/audit_types.py` 与 `frontend/src/domains/audit/audit.model.ts`，不得记录自由文本、密钥或 PII。

---

## Slice 2A：`0071_product_fact_ops_metadata`

### 数据库设计
- `products` 新增可空列：
  - 可变治理态：`source_owner VARCHAR(160)`、`next_review_at TIMESTAMPTZ`、`last_reviewed_at TIMESTAMPTZ`、`last_reviewed_by UUID REFERENCES users(id) ON DELETE RESTRICT`（约束 `(last_reviewed_at IS NULL) = (last_reviewed_by IS NULL)`）。
  - 工作区草稿暂存列：`facts_source_reference TEXT`、`facts_verified_at TIMESTAMPTZ`、`facts_applicable_region VARCHAR(160)`、`facts_content_restrictions TEXT`、`facts_approved_claims_summary TEXT`。
  - 索引：`ix_products_next_review_at`（partial `WHERE next_review_at IS NOT NULL`）、`ix_products_last_reviewed_by`（partial `WHERE last_reviewed_by IS NOT NULL`）。
- `fact_versions` 新增可空冻结列：
  - `source_reference TEXT`、`verified_at TIMESTAMPTZ`、`applicable_region VARCHAR(160)`、`content_restrictions TEXT`、`approved_claims_summary TEXT`。
- 更新触发器 `partsignal_guard_fact_version()`：上述 5 列变更均触发 `55000` 异常（`fact version payload is immutable`）。
- Downgrade 固定以 `55000` 拒绝销毁运营元数据历史。

### 业务规则与 API
- `ProductFactsFreshness`: `UNSET`（`next_review_at IS NULL`）、`OVERDUE`（`next_review_at <= now`）、`FRESH`（`next_review_at > now`）。
- `product_workflow()`：比较 `latest` 与 `product` 的正文、分级以及 5 项冻结字段；仅修改可变治理态（`source_owner`、`next_review_at`、`confirm-review`）不会导致 `FACT_APPROVED` 退回 `FACTS_EDITING`。
- `PUT /api/v1/products/{product_id}/facts`：扩展 `ProductFactsDraftUpdate` 接受全部 7 项可选运营元数据（字符串 trim 后空白归一为 `null`），受 `facts_revision` 乐观锁保护。
- `POST /api/v1/products/{product_id}/facts/confirm-review`：
  - 接收 `ProductFactsConfirmReviewRequest(expected_revision, next_review_at)`；
  - 锁 `Product FOR UPDATE`，要求 `ACTIVE` 且存在已批准 `FactVersion`、`facts_revision == expected_revision`、`next_review_at > db_now`；
  - 更新 `next_review_at`、`last_reviewed_at=db_now`、`last_reviewed_by=actor.id`、`facts_revision += 1`，追加审计 `product_facts.review_confirmed`，返回最新 `ProductFactsDraft`。
- `ProductFactsDraft.available_actions` 扩展为 `SAVE | SUBMIT_REVIEW | CONFIRM_REVIEW`（存在已批准事实且产品 `ACTIVE` 时包含 `CONFIRM_REVIEW`）。
- `ProductOut` / `ProductListItem` 暴露 `source_owner`、`next_review_at`、`facts_freshness`；`FactVersionOut` 暴露 5 项冻结字段。
- AI 出站隔离：`create_generation_job` 仍只读 `FactVersion.body_markdown`，`source_owner` 与 `source_reference` 不进入 `GenerationJob.input_snapshot`。

---

## Slice 2B – 2D 契约概要（后续切片详设）

- **Slice 2B（`0072_content_planning_layer`）**：`content_campaigns` + 4 张 N:M 表、`query_topics.is_active/description`、`content_tasks.campaign_id`、`content_brief_snapshots`（1:1 不可变触发器 + 受控删除上下文）。
- **Slice 2C（`0073_content_task_batch_planning`）**：`content_task_batch_requests` 批量幂等回执表 + `batch-preview`（`REPEATABLE READ`）+ `batch`（原子提交）。
- **Slice 2D（`0074_assignments_sla_inbox`）**：5 聚合分派与 SLA 字段 + 非终态可变/终态冻结触发器 + `GET /api/v1/workbench/inbox` 单次一致读聚合。
