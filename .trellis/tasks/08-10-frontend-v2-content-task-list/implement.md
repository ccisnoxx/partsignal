# 实施计划

## 1. 执行顺序

- [x] 激活 task，从干净 `main` 创建 `codex/frontend-v2-content-task-list`。
- [x] 更新 OpenAPI、database contract、migration、Content model/schema/query/projection/router 与 lifecycle delete revision。
- [x] 补 backend unit/integration，证明 projection、搜索/筛选/分页、稳定排序、current pointer、无 N+1 和 lifecycle revalidation。
- [x] 生成 V1/V2 OpenAPI types，完成必要的 V1 删除调用与 fixture 兼容调整。
- [x] 实现 Content search model、query keys/API、typed status/action registry 和 mutations。
- [x] 实现 Content Task List page、Dialog、thin route、navigation metadata 和生成 route tree。
- [x] 增加 component/unit 与 generated-type production-artifact fixture Playwright。
- [x] 更新 02/03/05/07/08/09 和 database contract，运行 required validation、`trellis-check` 与最终 diff 自审。
- [x] 报告结果；不自动 commit、push、archive、merge 或删除分支。

## 2. 预计修改文件

- Contract/backend：`contracts/openapi.yaml`、`contracts/database.md`、新 migration、`models/content.py`、`schemas/content.py`、`routers/planning.py`、Content list query/projection owner及 tests。
- Generated/V1：两套 generated schema、`ContentTasksPage.tsx` 及 typed ContentTask list fixtures/tests。
- V2 App/Content：navigation、content routes、`routeTree.gen.ts`、`content.api.ts`、`content-task-list.model.ts`、`content-task-list-page.tsx`、Dialog 与 colocated tests。
- Playwright：Content generated-type fixture 和 `content-task-list.spec.ts`。
- Docs：Frontend V2 02/03/05/07/08/09。

## 3. Required validation

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check
make lint typecheck

UV_CACHE_DIR=.cache/uv uv run --project backend \
  pytest backend/tests/unit/test_workflow_projections.py \
         backend/tests/unit/test_contract.py -q

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend \
  pytest backend/tests/integration/test_content_task_list.py -q

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend \
  pytest backend/tests/integration/test_publication_workflow.py::test_content_task_delete_and_archive_permanent_delete_lifecycle -q

npm --prefix frontend run test -- \
  src/features/content-tasks/ContentTasksPage.test.tsx \
  src/features/content-editor/ContentEditorPage.test.tsx \
  src/features/configuration/ConfigurationPages.test.tsx

npm --prefix frontend-v2 run test -- \
  src/domains/content/content-task-list.model.test.ts \
  src/domains/content/content-task-list-page.test.tsx

npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/content-task-list.spec.ts
git diff --check
```

## 4. Optional full-suite validation

```bash
npm --prefix frontend run test
npm --prefix frontend-v2 run e2e
make test-integration
make verify
```

只在共享合同回归、发布准备或用户明确要求时运行。失败先归因，不扩展修复无关问题。

## 5. Gate

- 不新增完整 Content real-stack flow；backend 变化由针对性 PostgreSQL integration test 证明。
- required validation、文档一致性、V1 兼容、响应式、可访问性和禁止范围全部通过后才报告实现完成。
- 提交前另给 commit plan 并等待用户确认；不自动 push。
