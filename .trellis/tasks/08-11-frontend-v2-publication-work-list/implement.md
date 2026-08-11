# 实施计划

## 1. Gate 与执行顺序

- [x] 用户批准后运行 `task.py start`，并创建授权临时分支 `codex/frontend-v2-publication-work-list`。
- [x] 修改 `contracts/openapi.yaml`，明确 no-account Ready 语义、WorkList product/latest event 和 structured errors。
- [x] 修改唯一 backend projection owner 与 schema，保持现有 create command 的事务复核边界。
- [x] 增加 targeted projection/command test，证明 no-account、Product/latest event、固定查询次数和 START 边界。
- [x] 生成 V1/V2 OpenAPI types；只同步合同要求的最小 V1 typed test fixture，不改 V1 runtime/UI。
- [x] 实现 Publication domain model/API/page/dialog、thin routes、navigation 与 generated route tree。
- [x] 增加 V2 model/API/component tests 和 generated-type production-artifact Playwright fixture/spec。
- [x] 更新直接相关权威文档/spec并完成 Visual QA。
- [x] 运行最终 required validation、完成 `trellis-check` 和 diff 自审。
- [x] 报告结果；提交前展示 commit plan 并等待确认，不自动 push、merge、archive 或删分支。

## 2. Backend / contract implementation

1. OpenAPI：
   - `PublicationWorkListItem` 必填 `product: ContentTaskProductSummary`、`latest_event: PublicationWorkEvent`；
   - Ready/summary 描述明确 no-account 候选与四项页面用法；
   - 三个 GET 和 create POST 补实际 structured error responses。
2. Schema：复用 `ContentTaskProductSummary`、`PublicationWorkEventOut`，不创建新 DTO。
3. Query：
   - 从 Ready/summary 候选条件移除 active account `EXISTS`；actions 根据批量 matching accounts 由服务端投影；
   - work context join Product；
   - 当前页 work IDs 批量读取 latest event，排序 `(created_at DESC, id DESC)`；
   - 缺 event 显式 `PUBLICATION_CONTEXT_INCOMPLETE`；
   - 维持服务端 status filter、pagination 和现有稳定排序。
4. Command：不改请求体、不增加 fallback；保留现有 advisory lock、CSRF、幂等、approved/current/platform/account/duplicate 复核。

## 3. Frontend V2 implementation

1. `publication-work.model.ts`：URL schema、API params、status/event/action label registry、canonical href、时间与 empty 判定。
2. `publication.api.ts`：三个 query options/query keys、create mutation、structured error mapping；全部类型直接来自 generated schema。
3. `start-publication-dialog.tsx`：明确账号 Select、稳定 Idempotency-Key、pending 防重、CSRF、错误/request ID、focus return。
4. `publication-work-page.tsx`：四项本地摘要、Ready Queue、固定六列表格、status toolbar、pagination、独立页面状态和成功提示。
5. routes/navigation：`publishing`/`work` metadata、index search canonicalization、route composition 层 Content invalidation；不注册 `$workId` route。
6. responsive/a11y：复用 `TableRegion` 局部滚动和 Base UI primitives；无新 CSS 时不修改全局 stylesheet。

## 4. 预计修改文件

### 必需

- `contracts/openapi.yaml`
- `backend/app/schemas/publication.py`
- `backend/app/services/publication_queries.py`
- `backend/tests/integration/test_publication_workflow.py`
- `frontend/src/shared/api/schema.d.ts`
- `frontend-v2/src/shared/api/generated/schema.d.ts`
- `frontend-v2/src/app/navigation.ts`
- `frontend-v2/src/app/navigation.test.ts`
- `frontend-v2/src/routeTree.gen.ts`
- `frontend-v2/src/routes/_app/publishing/route.tsx`
- `frontend-v2/src/routes/_app/publishing/work/route.tsx`
- `frontend-v2/src/routes/_app/publishing/work/index.tsx`
- `frontend-v2/src/domains/publication/publication.api.ts`
- `frontend-v2/src/domains/publication/publication.api.test.ts`
- `frontend-v2/src/domains/publication/publication-work.model.ts`
- `frontend-v2/src/domains/publication/publication-work.model.test.ts`
- `frontend-v2/src/domains/publication/publication-work.test-fixtures.ts`
- `frontend-v2/src/domains/publication/start-publication-dialog.tsx`
- `frontend-v2/src/domains/publication/publication-work-page.tsx`
- `frontend-v2/src/domains/publication/publication-work-page.test.tsx`
- `frontend-v2/tests/e2e/fixtures/publication.fixture.ts`
- `frontend-v2/tests/e2e/publication-work-list.spec.ts`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `.trellis/spec/backend/publication-workbench-guidelines.md`

### 条件性

- `frontend/src/features/publications/PublicationsPage.test.tsx`：仅当新 required generated fields 导致 V1 typed fixture 无法 typecheck 时，补最小 fixture；禁止修改 V1 runtime/UI。
- Frontend V2 全局样式：只有现有 `TableRegion`/tokens 不能满足已证实的局部滚动或响应式问题时才改；当前预计不需要。

### 明确不修改

- `contracts/database.md`：没有表、约束、状态机或不可变历史规则变化。
- `backend/app/services/publication.py`：现有 START command 已完成所需事务内复核，无证据要求改写。
- `frontend/` runtime/UI、Phase 4 后续 routes、依赖清单、数据库 migrations。

## 5. Required validation

### 5.1 Contract 与 generated types

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check
```

V1/V2 都从同一 OpenAPI 生成；`contract-check` 必须证明 runtime schema 与两套 generated schema 无漂移。

### 5.2 Backend targeted projection / START boundary

计划新增并精确运行以下测试节点：

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py::test_publication_work_list_read_model_and_start_boundary \
  -q
```

最高价值 START 证明由真实 PostgreSQL integration test 完成：approved/current content、匹配且 active account、重复 work/content identity、稳定幂等重放与 canonical response；不重复完整 register result → verify 闭环。

### 5.3 Lint、typecheck 与 targeted frontend tests

```bash
make lint typecheck

(cd frontend && npx vitest run \
  src/features/publications/PublicationsPage.test.tsx)

npm --prefix frontend-v2 run test -- \
  src/app/navigation.test.ts \
  src/domains/content/content-task-actions.test.ts \
  src/domains/publication/publication.api.test.ts \
  src/domains/publication/publication-work.model.test.ts \
  src/domains/publication/publication-work-page.test.tsx

npm --prefix frontend-v2 run build
```

V2 tests必须覆盖：generated-type fixture、URL canonicalization、status/page/pageSize、四项 summary、Ready empty/no-account、账号选择、稳定 key/CSRF/pending 防重、success/409/403/404/422/request ID、固定六列、server stage/primary/overflow 和三个独立 surface 状态。

### 5.4 Production-artifact Playwright / Visual QA

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/publication-work-list.spec.ts
git diff --check
```

同一 targeted spec 使用 generated schemas 和严格 API fixture，覆盖：

- direct URL、refresh、Back、Forward；
- status filter、pagination、URL 恢复；
- Ready 创建成功、409 单次请求、结构化错误；
- 375/768/1024/1440 的 summary/queue/table 和 `TableRegion` 局部滚动；
- keyboard-only account selection、Escape/Tab、Dialog trigger focus return；
- `console.error`、`pageerror`、非预期 `requestfailed` 与未声明 API 审计。

Playwright config 默认运行 production build artifact；临时 `playwright-cli` Visual QA 使用独占 `publication-work-visual` session，完成后关闭并验证无残留。

## 6. Optional full-suite validation

```bash
make test-integration
npm --prefix frontend-v2 run e2e
make verify
```

本任务只改变一个 Publication read/command boundary，targeted PostgreSQL + production-artifact 测试直接证明需求；完整 suite 和 Publishing real-stack 闭环留作共享合同回归、发布准备或 Phase 4 E2E checkpoint，不作为本任务默认完成门槛。

## 7. 风险、停止条件与回滚

- 新 required fields 若迫使修改 V1 runtime/UI，立即停止并报告；不扩大兼容层、不把字段降为 optional。
- 新 backend 查询若查询次数随行数增长，停止前端实施，先在唯一 projection owner 修正。
- 若三个 GET 出现能改变命令资格的真实 snapshot 一致性缺口，停止并重新评审合同；不能直接加万能 context。
- 任何 required check 重复失败必须先取得新的 root-cause evidence；不修无关 full-suite 失败。
- 回滚以一个无 migration 的合同/投影/V2 页面提交单元完成；不会触碰已批准内容或发布历史。

## 8. 完成前检查

- [x] contract、backend projection、generated types、V2 page/tests 和直接文档一致。
- [x] comments/docstrings/developer-visible text 的 touched scope 已完成中文检查。
- [x] diff 无无关编辑、无新依赖、无 V1 runtime/UI、无 Workspace/后续路由。
- [x] required validation 全绿，Visual QA 和 `trellis-check` 完成。
- [x] 提交前向用户展示精确 commit plan 并等待确认；不 push。

## 9. 实际验证结果

- `make contract-check`：FastAPI/OpenAPI 与 V1/V2 generated types 一致。
- targeted PostgreSQL integration：`test_publication_work_list_read_model_and_start_boundary` 通过。
- `make lint typecheck`：backend Ruff/mypy、V1/V2 ESLint/TypeScript 全部通过。
- V1 Vitest 完整单元段：`28 files / 203 tests passed`，包含更新后的 Publications typed fixture；计划中的 targeted 命令已改为在 `frontend/` 工作目录直接调用 Vitest，避免 npm 把文件参数误传给 `node --test` visual-contract runner。
- V2 targeted：`5 files / 19 tests passed`；production build 通过。
- Publication production-artifact Playwright：mobile + desktop `8 passed`，覆盖 375/768/1024/1440、URL 历史、START/409、三 surface 状态、focus 与浏览器错误审计。
- `playwright-cli` Visual QA：375/768/1024/1440 与 375 Dialog 人工检查通过；独占 session 已关闭且 `list --all --json` 确认无浏览器残留。
- `git diff --check` 通过。
