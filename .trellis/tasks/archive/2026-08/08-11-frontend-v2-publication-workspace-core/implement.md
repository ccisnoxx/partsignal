# Frontend V2 Publication Workspace Core — Implementation Plan

## 1. Contract 与 backend

1. 增加 Workspace Context schemas 与 OpenAPI route/response/error 声明。
2. 增加 repeatable-read router dependency 和 fixed-query service projection。
3. 在不改变 command semantics 的前提下，补齐 Work GET、Package 和 core commands 的真实错误声明。
4. 增加聚焦 integration assertions，覆盖 Context identity/query count/errors 与 core commands/evidence/close。

预计文件：

```text
contracts/openapi.yaml
backend/app/schemas/publication.py
backend/app/services/publication_queries.py
backend/app/routers/publication.py
backend/tests/integration/test_publication_workflow.py
frontend/src/shared/api/schema.d.ts
frontend-v2/src/shared/api/generated/schema.d.ts
```

用户已批准 `frontend/src/shared/api/schema.d.ts` 的 generated-file 窄豁免，以满足逐字节一致合同检查；其他 V1 文件均不在范围内。

## 2. Frontend route 与 UI

1. 注册 `$workId` route 与 canonical hash handling。
2. 增加 Context query/key、package-on-click 与 core command mutations。
3. 组合现有 Workspace/Detail/Timeline/Form/Markdown primitives；只增加拥有真实职责的 domain components。
4. 实现 browser direct-upload 状态机和 attachment download-on-click。
5. 修复 DirtyGuard full URL comparison，并独立测试。
6. 扩展 publication fixture，增加 workspace production-artifact spec。

预计文件：

```text
frontend-v2/src/routes/_app/publishing/work/$workId.tsx
frontend-v2/src/routeTree.gen.ts
frontend-v2/src/design-system/forms/dirty-guard.tsx
frontend-v2/src/design-system/forms/dirty-guard.test.tsx
frontend-v2/src/domains/publication/publication.api.ts
frontend-v2/src/domains/publication/publication.api.test.ts
frontend-v2/src/domains/publication/publication-workspace.model.ts
frontend-v2/src/domains/publication/publication-workspace.model.test.ts
frontend-v2/src/domains/publication/publication-workspace-page.tsx
frontend-v2/src/domains/publication/publication-workspace-page.test.tsx
frontend-v2/src/domains/publication/publication-workspace-actions.tsx
frontend-v2/src/domains/publication/publication-evidence-upload.tsx
frontend-v2/src/domains/publication/publication-evidence-upload.test.tsx
frontend-v2/tests/e2e/fixtures/publication.fixture.ts
frontend-v2/tests/e2e/publication-workspace.spec.ts
frontend-v2/tests/e2e/publication-workspace-real-stack.spec.ts
deploy/scripts/e2e-local.sh
```

若实施证明四个 Core 表单留在页面中仍内聚且文件可读，则省略 `publication-workspace-actions.tsx`；不要为了文件数量美观拆分 thin wrappers。

## 3. 文档

预计文件：

```text
docs/frontend-v2/03-page-and-workflow-blueprint.md
.trellis/spec/backend/publication-workbench-guidelines.md
.trellis/spec/frontend/state-management.md
```

预计不修改 `contracts/database.md`，因为 Target Section 删除与 append-only publication invariants 已经是权威合同且本任务不改变它们。

## 4. 必需验证

### Contract/generated types

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check
```

### Backend targeted

计划新增并精确运行以下节点：

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py::test_publication_workspace_context_is_consistent_and_bounded \
  backend/tests/integration/test_publication_workflow.py::test_publication_workspace_core_commands_evidence_and_close \
  -q
```

第一个节点必须断言一次 repeatable-read Context、计划中的五条固定查询、account/candidate eligibility、append-only histories、404/409，且数据量增长不增加查询数。第二个节点必须使用真实 PostgreSQL 和 verified object metadata，证明 preparation → review → result 以及一条独立 close work。

### Frontend targeted/build

```bash
npm --prefix frontend-v2 run test -- \
  src/design-system/forms/dirty-guard.test.tsx \
  src/domains/publication/publication.api.test.ts \
  src/domains/publication/publication-workspace.model.test.ts \
  src/domains/publication/publication-evidence-upload.test.tsx \
  src/domains/publication/publication-workspace-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
```

必需断言：单次 Context GET、canonical hashes、仅 token 动作、package/download 按点击请求、upload headers/hash/complete retry、成功后 cache invalidation、409 输入保留/重载、初始/后台错误区分、Core handoff、无横向溢出。

### Production artifact

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/publication-workspace.spec.ts
```

严格 typed fixture 必须覆盖 direct/refresh/Back/Forward、六个 hash、package/upload/core commands、401/403/404/409/422、pending/double-submit、keyboard/focus 以及 375/768/1024/1280/1440/1920。未知 API、console errors、page errors 和 request failures 必须使 spec 失败。

### Real-stack Flow A

把新 spec 加入脚本的 V2 real-stack 列表后运行：

```bash
DATABASE_URL=<local-postgres-url> REDIS_URL=<exclusive-local-redis-url> \
  deploy/scripts/e2e-local.sh
```

Flow A 只允许通过 test API 创建最小前置条件，随后必须使用 V2 UI 完成 preparation、platform review、screenshot upload 和 result registration。最终 API read 可断言 `AWAITING_VERIFICATION`、精确 content hash、attachments 和 events。脚本继续是 database/storage lifecycle 的唯一 owner，并必须证明 cleanup。

### Visual QA / review

- 使用项目 `playwright-cli` skill，以明确命名的 `publication-workspace-core-visual` session 检查 production artifact；覆盖 light/dark/system、200% zoom、reduced motion、keyboard order 与 1280/1920 workspace geometry。
- 报告完成前关闭该命名 session，并确认它不再处于打开状态。
- 运行 `trellis-check`，随后检查 in-scope diff，再展示 commit plan。

### Diff

```bash
git diff --check
git status --short
```

## 5. 可选验证

```bash
make test-integration
npm --prefix frontend-v2 run e2e
make verify
```

除非共享 DirtyGuard 或 OpenAPI 变更证明影响更广，否则这些门禁保持可选。
