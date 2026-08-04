# 全站业务表格操作流程重设计：实施计划

## 1. 启动门禁

- [ ] 用户明确批准最新 `prd.md`、`design.md`、`implement.md`，并允许提交规划文件后执行 `task.py start`。
- [ ] 规划文件提交到 `main`；确认主工作目录仍在 `main` 且除本任务预期内容外干净。只有确需同步远端且工作树干净时才执行 `git pull --ff-only origin main`。
- [ ] 执行 `python3 ./.trellis/scripts/task.py start 08-04-table-action-columns-missing-audit-fix`，确认状态为 `in_progress`。
- [ ] 使用 `trellis-before-dev` 重新读取本任务三份规划、`research/target-action-matrix.md`、相关 `.trellis/spec/`、OpenAPI、数据库合同和将要修改的完整代码。
- [ ] 实现阶段保持单任务顺序推进。该变更的数据库约束、OpenAPI 和前端消费必须同版交付，不拆成会产生临时双合同的子任务。

## 2. 实施阶段

### 阶段 A：合同与数据库基础

- [ ] 先更新 `contracts/openapi.yaml` 和 `contracts/database.md`，固定 D1—D11 的状态、`workflow_stage`、`primary_task`、命令请求/响应和错误合同。
- [ ] 新增 `backend/alembic/versions/0035_business_workflow_primary_tasks.py`：
  - 删除事实版本草稿状态并增加单产品待审核唯一索引；歧义数据以 `55000` 阻断。
  - 增加 `content_tasks.current_content_version_id`、内容 `ABANDONED` 状态、单任务待审核唯一索引和归属守卫。
  - 增加 `publication_works.content_task_id`、版本切换事件字段和核验内容版本快照；确定性回填旧数据。
  - 增加 `content_task_geo_sources` 及其不可变来源约束。
  - 明确拒绝有损降级。
- [ ] 同步 ORM：`backend/app/models/product_facts.py`、`content.py`、`publication.py`；仅在模型所有者中表达新约束，不创建重复状态表。
- [ ] 在 `backend/tests/integration/test_migrations.py` 覆盖：合法数据前滚、事实草稿阻断、多待审核/多主线歧义阻断、当前版本与发布快照回填、约束守卫和有损降级拒绝。
- [ ] 运行迁移目标检查：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_migrations.py -k business_workflow
```

回滚点：迁移测试未证明前滚和阻断边界前，不进入服务与前端改造；不对共享或已部署数据库手工修补数据。

### 阶段 B：产品事实与内容单主线

- [ ] 更新 `backend/app/schemas/product_facts.py`、`content.py`：移除事实 `DRAFT`/版本级 `SUBMIT`，增加原子事实提交、当前内容版本、`ABANDONED`、领域阶段和主任务 typed union。
- [ ] 更新 `backend/app/services/product_facts.py` 与 `backend/app/routers/product_facts.py`：工作区提交直接创建待审核快照，并投影产品下一步。
- [ ] 更新 `backend/app/services/review_policy.py`、`review.py`：退回结论终止原版本，且只允许任务当前内容版本审核。
- [ ] 更新 `backend/app/services/content_planning.py`、`content_production.py`、`content_lineage.py`、`projections.py` 与对应 router：人工稿、AI 结果、自然化、修订和放弃统一推进任务当前指针；待发布资格只认当前批准版本。
- [ ] 新增或调整后端测试，至少覆盖：
  - 事实一步提交、单待审核和退回后新版本。
  - 内容当前指针、旧版本拒绝、修订放弃恢复、并发/乐观锁和旧批准版本不能新发布。
  - 产品、任务、作业、版本在相同表面状态但不同关联事实下返回不同精确主任务。
  - 列表投影查询次数不随行数线性增长。
- [ ] 运行阶段检查：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_generation.py \
  backend/tests/unit/test_workflow_projections.py
```

回滚点：若不能在一个所有者中保持当前内容指针与审核/生成一致，停止并回到模型设计，不在前端增加状态兜底。

### 阶段 C：发布改稿与 GEO 优化回流

- [ ] 更新 `backend/app/schemas/publication.py`、`services/publication.py`、`publication_queries.py`、`routers/publication.py`：
  - 增加同任务、同平台批准版本切换命令和 `expected_revision` 守卫。
  - 每次切换追加前后版本事件，每次核验冻结当时内容版本。
  - 完成成果从成功核验读取最终版本，终态拒绝切换。
  - 发布工作、成果和内容问题投影目标矩阵中的主任务。
- [ ] 更新 `backend/app/schemas/geo_files.py`、`services/geo_observation.py`、`routers/observation.py` 和内容任务创建服务：
  - 为观测、平台表现、内容排行、覆盖明细和问题条目投影主任务。
  - 增加 GEO 优化任务命令；重新计算异常、拒绝宽泛/过期/数据不足来源，并与内容任务原子保存 typed 来源快照。
- [ ] 在 `backend/tests/integration/test_publication_workflow.py` 覆盖版本切换、失败后复核、成功冻结、显式关闭和越权/过期 revision。
- [ ] 在 `backend/tests/unit/test_geo_insights.py` 及新的业务集成用例中覆盖可创建优化、只下钻、补充观测、来源快照和客户端伪造拒绝。
- [ ] 运行阶段检查：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_geo_insights.py \
  backend/tests/unit/test_security_and_publication.py
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_publication_workflow.py
```

回滚点：核验若不能精确追到当时版本，或 GEO 命令需要信任客户端指标，则不得进入 UI 实现。

### 阶段 D：配置治理投影

- [ ] 更新 `backend/app/schemas/configuration.py`、`common.py` 和配置/身份服务：
  - AI 渠道、模型和模型发现按配置、验证、启用、运行阶段投影主任务。
  - 影响 AI 调用合同的修改统一失效测试结论；启用命令再次校验。
  - 平台按停用、人工可用但系统生成未配置、正常运营投影主任务。
  - Header、日志、平台类型、发布账号和用户返回固定或治理主任务，继续复用既有引用、自己和最后管理员保护。
- [ ] 更新 `backend/app/services/ai_configuration.py`、`platform_configuration.py`、`identity.py`、`audit_logs.py`、`projections.py` 与对应 routers；不新增通用治理引擎。
- [ ] 在现有配置、身份和投影测试中覆盖 D11 的各阶段、配置失效和命令最终守卫。
- [ ] 运行阶段检查：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_configuration_audit.py \
  backend/tests/unit/test_identity_schemas.py \
  backend/tests/unit/test_workflow_projections.py
```

### 阶段 E：生成客户端类型并改造 25 张表

- [ ] 执行 `make contract-generate`，只从 OpenAPI 生成 `frontend/src/shared/api/schema.d.ts`。
- [ ] 产品事实：更新 `ProductsPage.tsx`、`ProductFactsPage.tsx` 及测试，落实原子提交、审核/修订/创建任务入口。
- [ ] 内容生产：更新 `ContentTasksPage.tsx`、`ContentEditorPage.tsx`、`RevisionForm.tsx` 及测试，落实任务/作业/版本主任务、单主线和放弃流程。
- [ ] 发布：更新 `PublicationsPage.tsx` 及测试，落实待发布、工作、成果、问题的阶段主操作、版本切换与产品级观测入口。
- [ ] GEO：更新 `GeoObservationsPage.tsx`、`GeoObservationForm.tsx`、`GeoTopicsPage.tsx`、`GeoInsightsPage.tsx` 及测试；覆盖计数改为非表格概览，覆盖明细和优化任务使用权威筛选/预填。
- [ ] 配置治理：更新 `AIChannelsPage.tsx`、`AIChannelDetailPage.tsx`、`ModelDiscoveryModal.tsx`、`PlatformsPage.tsx`、`PlatformTypesPage.tsx`、`AuditLogPage.tsx`、`SettingsPage.tsx`、`UserManagementPage.tsx` 及测试。
- [ ] 仅在需要时调整 `frontend/src/shared/components/enumLabels.tsx`、`frontend/src/styles/workspace.css`；不新增全站 action registry 或重复详情页。
- [ ] 所有领域映射穷尽 typed `primary_task`；主操作、更多菜单、危险确认、移动等价、键盘名称、焦点返回和错误反馈符合目标矩阵。
- [ ] 运行前端阶段检查：

```bash
npm --prefix frontend exec -- vitest run \
  src/features/product-facts/ProductsPage.test.tsx \
  src/features/product-facts/ProductFactsPage.test.tsx \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/content-editor/ContentEditorPage.test.tsx \
  src/features/publications/PublicationsPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/geo-observations/GeoInsightsPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx \
  src/features/configuration/AuditLogPage.test.tsx \
  src/features/users/UserManagementPage.test.tsx
```

回滚点：前端若需要读取 `status`、`is_active` 或角色来补主任务，先修服务端投影，不接受 UI 兼容分支。

### 阶段 F：业务 E2E、文档和规范收口

- [ ] 更新 `frontend/tests/e2e/mvp-flow.spec.ts`，覆盖事实提交、内容退回新修订、发布改稿切换、核验失败继续、复核成功、显式关闭、成果观测和 GEO 优化回流。
- [ ] 更新 `frontend/tests/e2e/cross-page-visual-convergence.spec.ts` 的目标 25 表清单：逐篇文章输入矩阵不设操作列，其余业务行都有真实主操作；检查桌面/移动和 200% 缩放等价。
- [ ] 更新 `frontend/tests/e2e/ai-channel-management.spec.ts`，覆盖 D11 配置治理阶段和真实测试确认。
- [ ] 更新 `docs/GEO多平台内容运营系统方案设计.md`、`docs/GEO系统前后端技术与部署方案.md`、`docs/architecture.md`，删除与 D1—D11 冲突的旧设计。
- [ ] 更新 `.trellis/spec/backend/available-actions-contract.md` 和 `.trellis/spec/frontend/component-guidelines.md`；通过 `trellis-update-spec` 记录稳定合同，不复制整张任务矩阵。
- [ ] 对所有新增/实质修改的 Python、TypeScript 和文档执行 touched-scope 中文注释、docstring、日志、异常与失效说明检查。

## 3. 必需验证

本任务改变共享 OpenAPI、数据库约束、权限和核心状态转换，因此完整验证属于完成门禁：

```bash
make verify
```

`make verify` 必须实际通过合同检查、后端/前端 lint、mypy/TypeScript、完整单元与集成测试、后端/前端镜像构建、真实 Playwright E2E 和 Compose 配置检查。失败只修复能证明由本任务引入且属于本范围的问题；同一失败没有新证据时不得重复盲修。

此外检查：

- [ ] `python3 ./.trellis/scripts/task.py validate 08-04-table-action-columns-missing-audit-fix` 通过。
- [ ] 迁移歧义用例明确返回 PostgreSQL `55000`，合法旧数据确定性回填且历史未被改写。
- [ ] OpenAPI 生成文件无手工差异，前后端所有主任务 token 穷尽。
- [ ] `git diff --check` 通过；人工审查 diff 无症状补丁、重复状态逻辑、静默 fallback、宽泛异常吞噬、未说明行为变化或无关文件。

## 4. 可选发布前检查

以下不替代必需验证，留给后续生产上线任务或明确要求时执行：

```bash
make test-deploy-scripts
npm --prefix frontend run perf:production
```

- 在预发布备份后运行实际数据预检和迁移演练。
- 按 `research/target-action-matrix.md` 做一轮人工 25 表业务验收和权限验收。
- 确认生产数据库目标、备份、维护窗口、上一镜像和恢复步骤后再部署。

## 5. 完成与提交门禁

- [ ] 使用 `trellis-check` 按 PRD、设计、目标矩阵和相关 specs 做全范围检查并修复本任务问题。
- [ ] 确认代码、OpenAPI、数据库合同、业务/技术设计、测试与中文状态一致；若某文档无需更新，记录理由。
- [ ] 向用户展示精确提交范围和 commit message，取得确认后才暂存并提交到 `main`；不包含未识别脏文件。
- [ ] 不自动推送。用户明确要求后才推送 `main`。
- [ ] 提交完成后执行 `/trellis:finish-work` 的收尾与归档流程；若归档或 session journal 会产生 Trellis bookkeeping commit，执行前先说明。
