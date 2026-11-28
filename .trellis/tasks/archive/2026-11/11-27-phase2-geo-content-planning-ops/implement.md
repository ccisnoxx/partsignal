# Phase 2 实施记录

## 切片进度

- [x] Slice 2A：产品事实运营元数据与新鲜度治理（`0071_product_fact_ops_metadata`）
- [x] Slice 2B：内容策划层（`0072_content_planning_layer`）
- [x] Slice 2C：批量任务规划矩阵（`0073_content_task_batch_planning`）
- [x] Slice 2D：统一任务分派、SLA 与运营收件箱（`0074_assignments_sla_inbox`）

## Slice 2A 验证证据（2026-11-27）

- 根合同与前端类型：`make contract-generate && make contract-check` 通过（`OpenAPI 类型与根合同一致`）。
- 后端静态与定向单元测试：
  - `ruff check backend` 通过；
  - `mypy --config-file backend/pyproject.toml backend/app` 通过（275 source files zero issues）；
  - `pytest backend/tests/unit/test_product_fact_ops_metadata.py backend/tests/unit/test_workflow_projections.py backend/tests/unit/test_contract.py -k "fact_workspace or fact_review or product or ops_metadata or freshness"`：27 passed；
  - 全量 `pytest backend/tests/unit`：4012 passed；7 项基线既有失败（`256` 操作数快照漂移与 `0070` `citation_observation` 单元测试，均非本切片引入），1 项受 Slice 2A 影响的 `test_fact_workspace_contract_is_a_complete_single_read_model` 已更新并通过。
- 真实 PostgreSQL 集成测试（临时独占 PG 17 实例，已自动停库清理）：
  - `pytest -v backend/tests/integration/test_product_fact_ops_metadata.py backend/tests/integration/test_product_detail.py`：23 passed（覆盖 `0001 -> 0071` 全链迁移、`0071` 降级 `55000` 拒绝、5 项 `FactVersion` 冻结列触发器防篡改、`confirm-review` 全路径、`USER_IN_USE` 护栏及 `build_generation_input` 无内部字段泄露）。
- 前端检查与测试：
  - `npm --prefix frontend run lint`、`npm --prefix frontend run typecheck` 通过；
  - `npm --prefix frontend run test -- src/domains/product/ src/domains/audit/ src/app/layout/app-shell.test.tsx src/domains/geo-catalog/catalog-commands.test.tsx src/domains/geo-opportunities/opportunity-publication-repair.test.tsx`：161 passed。
- 独立只读风险复核与整改：
  - 无 P0 缺陷；已全部修复复核提出的 2 项 P1（`confirm_product_facts_review` 沿 `Product -> FactVersion` 锁序加 `FOR SHARE` 阻断并发 `retire/delete` 竞态；前端未编辑时间戳透传原始 ISO 亚秒字符串防误回退 `FACTS_EDITING`）与 2 项 P2（HTTP 读投影统一使用 PostgreSQL `db_utc_now`、`ConfirmReviewDialog` 收敛禁用与 `Select` 禁用态补齐），并复跑全套契约与集成测试通过。

## Slice 2B 验证证据（2026-11-27）

- 根合同与前端类型：`make contract-generate && make contract-check` 通过（`OpenAPI 类型与根合同一致`）；`routeTree.gen.ts` 已更新 4 条 `/content/campaigns*` 路由。
- 后端静态与定向单元测试：
  - `ruff check backend`、`mypy --config-file backend/pyproject.toml backend/app`（279 source files）全绿；
  - `pytest -q backend/tests/unit/test_content_planning_layer.py backend/tests/unit/test_workflow_projections.py` 与受影响 `test_contract.py` 全部通过（27 passed）。
- 真实 PostgreSQL 17 集成测试（临时独占实例，已自动停库清理）：
  - `test_content_planning_layer.py`、`test_content_task_creation.py`、`test_content_task_detail.py`、`test_content_editor_context.py`、`test_product_fact_ops_metadata.py`、`test_geo_opportunity_actions.py`、`test_geo_publication_repair_options.py` 全部通过（覆盖 `0001 -> 0072` 迁移、`0072` 降级 `55000` 拒绝、活动状态机与范围校验、Brief 不可变与受控删除、`PublishedArticle` 派生归因、`USER_IN_USE` 与资源删除阻断）。
- 前端检查与测试：
  - `npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`（0 warnings）通过；
  - `cd frontend && npx vitest run src/domains/campaigns/ src/domains/content/ src/domains/configuration/platform-list.model.test.ts src/domains/geo/query-topic-list.model.test.ts src/domains/geo/geo.api.test.ts src/domains/geo/geo-insights-page.test.tsx src/domains/audit/ src/domains/geo-opportunities/opportunity-business.test.tsx src/domains/geo-opportunities/opportunity-publication-repair.test.tsx` 全部通过。
- 独立只读风险复核与整改：
  - 无 P0 缺陷；已全部修复复核提出的 5 项 P1（`platform-list.model.ts` 补齐 `CONTENT_CAMPAIGN` 阻断标签、`update_content_campaign` 锁后校验 `observed_revision/observed_owner_id`、`CampaignDetailPage` 冻结编辑/删除弹窗 `revision`、`CampaignForm` 合并已停用/已归档历史绑定项、`ContentTaskListPage` 补齐 `campaignId` 筛选提示与重置）与 6 项 P2（`0072` 关联触发器加 `FOR SHARE`、`User` 排序加锁、`ACTIVE/resume` 范围完整性校验、`NewContentTaskPage` 活动 handoff 提示与 `productId` 同步/Brief 长度校验与 4 段错误定位、编辑弹窗选项加载失败重试态）及 `ContentBriefPanel` GEO 数值目标率展示，复跑 PG 17 集成测试、契约检查及前端单测全部通过。

## Slice 2C 验证证据（2026-11-27）

- 根合同与前端类型：`make contract-generate && make contract-check` 通过（`OpenAPI 类型与根合同一致`）；`routeTree.gen.ts` 已新增 `/_app/content/tasks/batch` 路由。
- 后端静态与定向单元测试：
  - `ruff check backend`、`mypy --config-file backend/pyproject.toml backend/app` 全绿；
  - `pytest -q backend/tests/unit/test_content_batch_planning.py` 全通。
- 真实 PostgreSQL 17 集成测试（临时独占实例，已自动停库清理）：
  - `test_content_batch_planning.py`、`test_content_planning_layer.py`、`test_content_task_creation.py` 共 15 项全绿（覆盖 `0001 -> 0073` 迁移、`0073` 降级 `55000` 拒绝、不可变回执表 UPDATE/DELETE/TRUNCATE 触发器、硬阻断/未确认软告警整批回滚、不同角度同三元组并存、幂等重放与冲突、`EXISTING_ACTIVE_TASK` / `RECENT_PUBLISHED_ARTICLE` / `FACT_OVERDUE` / `PLATFORM_MISSING_PROMPT` 告警、`USER_IN_USE` 与草稿活动删除保护）。
- 前端检查与测试：
  - `npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`（0 warnings）通过；
  - `cd frontend && npx vitest run src/domains/content/content-batch.model.test.ts src/domains/campaigns/ src/domains/audit/`：51 passed。
- 独立只读风险复核与整改：
  - 无 P0 缺陷；已全部修复复核提出的 3 项 P1（`create_content_task_batch` 入口接入 `current_actor_command` 消除 `SessionRecord ↔ User` 死锁与资格 TOCTOU、`_content_task_read_snapshot` 补齐 `db.autoflush = False` 避免 `40001` 序列化故障、前端提交成功后立即清空旧预览/`acknowledgeWarnings` 并增加同步双击锁防重复创建）与 5 项 P2（`0073` 补齐 `BEFORE TRUNCATE`/`lock_timeout`/`array_position` 非空元素约束与 ORM 部分索引、修正跨产品 `fact_version_id` 泄漏、前端补齐 Brief 显式长度/条目校验、派生收敛失效选项与切活动受众同步、`<Link>` 与 `<DirtyGuard>`），复跑契约与 PG 17 集成测试全绿。

## Slice 2D 验证证据（2026-11-27）

- 根合同与前端类型：`make contract-generate && make contract-check` 通过（`FastAPI 运行时操作与 OpenAPI 完整契约一致`，`OpenAPI 类型与根合同一致`）。
- 后端静态与定向单元测试：
  - `uv --directory backend run ruff check app tests/unit/test_work_assignments_and_inbox.py tests/integration/test_assignments_sla_inbox.py tests/integration/test_product_fact_ops_metadata.py` 通过（All checks passed）；
  - `uv --directory backend run mypy --config-file pyproject.toml app` 通过（285 source files zero issues）；
  - `uv --directory backend run pytest -q tests/unit/test_work_assignments_and_inbox.py tests/unit/test_content_batch_planning.py tests/unit/test_workflow_projections.py`：27 passed。
- 真实 PostgreSQL 17 集成测试（临时独占实例，已自动停库清理）：
  - `test_assignments_sla_inbox.py`：2 passed（覆盖 `0001 -> 0074` 全链迁移、`0074` 降级 `55000` 拒绝、5 类聚合软归属分派与 CAS/no-op 锁释放、保留已停用历史负责人更新 SLA 与新派停用人 422、`FactVersion`/`ContentTask`/`PublicationWork`/`PublishedContentIssue`/`GeoOpportunity` 终态冻结触发器、`GeoOpportunity` 规则冻结优先级 422、`submit-review`/`request-changes` 同事务改派交接、运营收件箱 8 分桶聚合与畸形时区 422、`work_assignment.updated` 低敏审计无 `blocked_reason` 泄露、`USER_IN_USE` 10 列新外键保护）；
  - 同轮回归运行 `test_workbench.py`（3/3）、`test_content_review.py`（19/19）、`test_publication_workflow.py`（81/81）、`test_product_fact_ops_metadata.py`（1/1）、`test_content_planning_layer.py`（1/1）、`test_content_batch_planning.py`（1/1），共计 108 项全部通过。
- 前端检查与测试：
  - `npm --prefix frontend run typecheck`、`npm --prefix frontend run lint`（0 warnings）通过；
  - `cd frontend && npx vitest run src/domains/workbench/ src/domains/product/fact-review-page.test.tsx src/domains/content/content-task-detail-page.test.tsx src/domains/content/content-review-page.test.tsx src/domains/publication/publication-workspace-page.test.tsx src/domains/publication/published-content-issue-workspace-page.test.tsx src/domains/geo-opportunities/opportunity-business.test.tsx src/domains/audit/`：126 passed。
- 独立只读风险复核与整改：
  - 无 P0 缺陷；已全部修复复核提出的 5 项 P1（`transition_content_version` 修正为 `ContentTask -> ContentVersion` 锁序消除与草稿写路径的 AB-BA 死锁；放行保留已停用历史负责人调整 SLA/no-op 而继续禁止新派停用人；`_resolve_timezone` 补捕获 `ValueError` 返回 422；`WorkAssignmentDialog` 设为 `staleTime: 0`、显式呈现成员加载/重试与 409 刷新按钮、收紧 `PrincipalContinuation` 与保存中防关闭；`PublicationWorkspacePage` 的 `onUpdated` 捕获刷新错误写入 `readError`）与 4 项 P2（no-op 立即 `db.rollback()` 释放行锁；前端未改时间保留原精确 `due_at` 且非法值显式报错，收件箱按检测时区对齐展示；收件箱透传 `AbortSignal` 并以 `keepPreviousData`/`—` 消除切 Tab 假 `0` 闪动；清理 `contracts/openapi.yaml` 重复 `RequestIdHeader` 并统一 4 模型 12 条 `CheckConstraint` 命名），并修复集成回归捕获的 `_content_task_payload` 漏出 6 个分派列导致 `ContentTaskListItem` `extra_forbidden` 缺陷。
