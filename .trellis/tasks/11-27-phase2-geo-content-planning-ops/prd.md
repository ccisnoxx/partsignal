# Phase 2: P0 内容策划层与团队协作（方向 A 纯 GEO 内容运营）

## 目标

基于已冻结的“方向 A——纯 GEO 内容运营”产品定位与 12 项已确认架构共识，补齐 PartSignal 的 P0 运营主干能力，使系统从“单点产品+平台生成工具”升级为具备**事实新鲜度治理、活动与问题策划、批量任务矩阵和团队 SLA 收件箱**的完整 GEO 内容运营工作台。

## 范围与四切片拆分

本任务按四个可独立迁移、独立验证的完整垂直切片顺序交付：

1. **Slice 2A（`0071_product_fact_ops_metadata`）：产品事实运营元数据与新鲜度治理**
   - `Product` 维护可变治理态（`source_owner`、`next_review_at`、`last_reviewed_at`、`last_reviewed_by`）及工作区暂存字段；
   - `FactVersion` 提交审核时不可变冻结 5 项内容约束态（`source_reference`、`verified_at`、`applicable_region`、`content_restrictions`、`approved_claims_summary`），受 PostgreSQL 触发器保护；
   - 事实过期（`next_review_at <= now`）提供软告警投影 `facts_freshness` 与轻量“无变更延期复核”命令 `POST /api/v1/products/{product_id}/facts/confirm-review`（记审计但不强迫重走 FactVersion 审批）；
   - `source_owner` 与 `source_reference` 等内部字段严禁出站至第三方 AI；`Product.last_reviewed_by` 纳入 `USER_IN_USE` 停用用户删除引用预检。

2. **Slice 2B（`0072_content_planning_layer`）：内容策划层（`ContentCampaign`、`QueryTopic` 升级与 `ContentBriefSnapshot`）**
   - `content_campaigns` 聚合与 4 张多对多关联表（产品、问题主题、平台、GEO 监测计划），服务端投影 `workflow_stage` / `primary_task` / `available_actions`；
   - `query_topics` 补充 `is_active` / `description` 升级为策划一等对象；
   - `content_tasks.campaign_id` 可空关联；`PublishedArticle` 从 `ContentTask` 派生归属，不双写；
   - 1:1 不可变 `content_brief_snapshots`：新建普通内容任务必填 `QueryTopic` 与核心 Brief 字段（支持从 Campaign 与 `FactVersion.content_restrictions` 预填），创建即冻结；存量历史与无主题修复任务保持兼容。

3. **Slice 2C（`0073_content_task_batch_planning`）：批量任务规划矩阵**
   - `POST /api/v1/content-tasks/batch-preview`（只读 `REPEATABLE READ`）：区分硬阻断（无已批准事实、平台/主题停用、活动范围不匹配、批内完全重复）与软告警（同产品+主题+平台已有活跃任务或近 30 天已发布文章、平台缺 Prompt、事实过期），允许不同角度并存；
   - `POST /api/v1/content-tasks/batch`（全量原子事务 + `content_task_batch_requests` 幂等回执）。

4. **Slice 2D（`0074_assignments_sla_inbox`）：统一任务分派、SLA 与运营收件箱**
   - 5 个主聚合直接落分派与 SLA 字段（待审 `FactVersion`、`ContentTask` 单主线统一责任人并支持提交审核/退回顺手改派、`PublicationWork`、`PublishedContentIssue`、`GeoOpportunity`）；
   - 软归属语义（任意活跃 `ADMIN/ENGINEER` 可代办或改派并记审计），全部新增用户外键接入 `USER_IN_USE` 预检；
   - `GET /api/v1/workbench/inbox` 单次 `REPEATABLE READ` 聚合读模型，工作台升级为真实运营收件箱。

## 明确非目标

- 不实现元器件参数数据库、替代可行性判定或 BOM 推荐算法。
- 不在本阶段修改 `content-markdown-v3` AI 输入契约（Brief 接入 AI 生成与 Prompt 版本化归属第三阶段）。
- 不引入新角色系统（维持 `ADMIN / ENGINEER` 两级权限）。

## 验收标准

- 每个切片均完成根级合同（`contracts/database.md`、`contracts/openapi.yaml`）、Alembic 加法迁移、后端模型/服务/路由、前端类型生成与 UI 实现。
- `make contract-check`、后端 `ruff` / `mypy` / 单元与 PostgreSQL 集成测试、前端 `lint` / `typecheck` / `vitest` 全部通过。
- 涉及持久化、触发器、并发与用户删除护栏的变更需完成独立只读复核与工作区 diff 审查。
