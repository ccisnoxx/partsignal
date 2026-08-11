# Frontend V2 Publication Verification — Implementation Plan

## 1. Contract/backend tests

1. 补齐 verify 和 switch commands 的 OpenAPI 401/403/404/409/422 responses。
2. 除非 targeted test 证明 contract mismatch，否则保持 runtime command semantics 不变；当前 backend 已锁定 work/task、校验 revision/state/candidate 并追加 immutable history。
3. 扩展 integration coverage，覆盖 candidate projection symmetry、repeated failed verification、switch lineage 与 terminal PublishedArticle/ContentTask invariants。

预计文件：

```text
contracts/openapi.yaml
backend/tests/integration/test_publication_workflow.py
frontend/src/shared/api/schema.d.ts
frontend-v2/src/shared/api/generated/schema.d.ts
```

V1 path 复用已于 2026-08-11 获批的机械 generated-file 豁免；V1 运行时代码、测试和页面均不在范围内。

`backend/app/services/publication.py`, `backend/app/services/publication_queries.py`, `backend/app/schemas/publication.py` and `backend/app/routers/publication.py` are expected to remain unchanged after Core. Touch them only if the targeted test identifies a real symmetry or response gap, and document the reason.

## 2. Frontend

1. 在已接受的 publication API owner 中增加 verify/switch API functions。
2. 在已接受的 workspace model 中增加穷尽 verification/switch presentation 与 payload mapping。
3. 用 VerificationSection 和两个 Dialog 替换 Core 的 awaiting-verification handoff。
4. 复用 Core result registration 完成 post-switch re-registration。
5. 扩展 fixture/component/production-artifact coverage，不增加第二个 Context 或 route。

预计文件：

```text
frontend-v2/src/domains/publication/publication.api.ts
frontend-v2/src/domains/publication/publication.api.test.ts
frontend-v2/src/domains/publication/publication-workspace.model.ts
frontend-v2/src/domains/publication/publication-workspace.model.test.ts
frontend-v2/src/domains/publication/publication-workspace-page.tsx
frontend-v2/src/domains/publication/publication-workspace-page.test.tsx
frontend-v2/src/domains/publication/publication-workspace-actions.tsx
frontend-v2/tests/e2e/fixtures/publication.fixture.ts
frontend-v2/tests/e2e/publication-workspace.spec.ts
frontend-v2/tests/e2e/publication-workspace-real-stack.spec.ts
```

若 Core 省略了 `publication-workspace-actions.tsx`，则保留已验证的内聚结构，不要只为匹配本计划而新建该文件。

## 3. 必需验证

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
  backend/tests/integration/test_publication_workflow.py::test_publication_workspace_verification_switch_and_completion \
  backend/tests/integration/test_publication_workflow.py::test_failed_verification_remains_pending_then_completes_and_opens_issue \
  -q
```

新节点必须断言 candidate/command symmetry、no-candidate state、重复 FAILED append-only records、switch event 的 old/new IDs、post-switch result registration、PASSED terminal state、PublishedArticle ID/verification link 和来源 ContentTask completion。现有 broad flow 继续作为回归证据，不得改写为 fixed success。

### Frontend targeted/build

```bash
npm --prefix frontend-v2 run test -- \
  src/domains/publication/publication.api.test.ts \
  src/domains/publication/publication-workspace.model.test.ts \
  src/domains/publication/publication-workspace-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
```

必需断言：仅 token 可打开 Dialog、PASS/FAIL mapping、failed-comment validation、no-candidate correction handoff、candidate 精确性、switch success/409、旧 history 保留、post-switch result 复用、PASSED readonly/cache invalidation、401/403/404/409/422 request IDs 和 focus return。

### Production artifact

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/publication-workspace.spec.ts
```

扩展严格 fixture，使用独立的 failed 与 passed works。断言没有 version-list request、direct/refresh hash restoration、每个 command 仅一次 request、无 conflict replay、375/768/1024/1280/1440/1920、代表性 200% zoom probe、keyboard/Dialog focus 与 runtime error audit。

### Real stack Flow B

扩展 Core 新增的 spec 与脚本入口后，重新运行隔离栈：

```bash
DATABASE_URL=<local-postgres-url> REDIS_URL=<exclusive-local-redis-url> \
  deploy/scripts/e2e-local.sh
```

Flow B 使用独立记录，并通过 V2 UI 证明：first FAILED → 现有 Content workflow 创建/审核/批准替换版本 → Workspace Context 暴露精确 candidate → switch → result registration → PASSED。最终 API read 断言 Work/Task/PublishedArticle/Event/Verification 不可变性。Cleanup 输出必须确认数据库和存储已删除。

### Visual QA / review

- 使用项目 `playwright-cli` skill，以明确命名的 `publication-verification-visual` session 检查 production artifact；覆盖 ACTION_REQUIRED、candidate/no-candidate、completed readonly、light/dark/system、200% zoom、keyboard 与 1280/1920 geometry。
- 报告完成前关闭该命名 session，并确认它不再处于打开状态。
- 运行 `trellis-check`，随后检查 in-scope diff，再展示 commit plan。

### Diff

```bash
git diff --check
git status --short
```

## 4. 可选验证

```bash
make test-integration
npm --prefix frontend-v2 run e2e
make verify
```

完整 Publishing E2E 不属于本任务；除非 shared-contract 证据要求升级，否则这些命令可选。

## 5. 文档 closeout

除非实施改变已接受的 Context/action invariant，否则不需要在 Core 更新之外修改其他权威文档。若确实改变，则在同一变更中更新唯一 owning Trellis spec，不在新文档中复制规则。
