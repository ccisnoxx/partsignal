# Frontend V2 Publication Workspace — Implementation Plan

## 1. 实施顺序

1. 确认主工作目录是最新、干净的 `main`，激活 Core，并创建已明确授权的临时分支 `codex/frontend-v2-publication-workspace-core`；OpenAPI 变更只机械更新获批的 V1 generated schema 文件。
2. 运行 Core targeted validation、Visual QA、`trellis-check` 和自审；展示 diff/commit plan 并取得确认后才 commit 或 merge。
3. 把已接受的 Core 合并到 `main`，删除其临时分支；随后激活 Verification，并从新的干净 `main` 创建 `codex/frontend-v2-publication-verification`。
4. 运行 Verification targeted validation、Visual QA、`trellis-check` 和自审；展示 diff/commit plan 并取得确认后才 commit 或 merge。
5. 把已接受的 Verification 合并到 `main`，删除其临时分支；随后运行父任务 integration gate，核对 OpenAPI、generated types、代码、测试、database contract 与 V2 docs。
6. 不 push。运行 Trellis archive/session bookkeeping 前，先解释其可能产生的 bookkeeping commit。

## 2. 子任务所有权

### 2.1 Core

- Workspace Context 与 core error contracts。
- Route/hash/shell/approved content/package/preparation/platform review/result/evidence/event/close surfaces。
- 共享 DirtyGuard full-URL 修复。
- Real-stack Flow A：preparation 与 result registration，终点为 `AWAITING_VERIFICATION`。

### 2.2 Verification

- 消费服务端投影的 switch candidate，并完善 verification/switch error contracts。
- Failed/passed verification、version switch、verification history、terminal readonly handoff。
- Real-stack Flow B：failed verification → approved replacement → switch → result/verify → `COMPLETED`。

## 3. 父任务最终集成门禁

两个子任务通过后必须运行：

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py \
  -q

npm --prefix frontend-v2 run test -- \
  src/design-system/forms/dirty-guard.test.tsx \
  src/domains/publication/publication.api.test.ts \
  src/domains/publication/publication-workspace.model.test.ts \
  src/domains/publication/publication-workspace-page.test.tsx

npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/publication-workspace.spec.ts

DATABASE_URL=<local-postgres-url> REDIS_URL=<exclusive-local-redis-url> \
  deploy/scripts/e2e-local.sh

git diff --check
```

`deploy/scripts/e2e-local.sh` must be updated to include the new real-stack spec in its V2 gate and remains the sole database/storage lifecycle owner. The existing script does not support selecting one V2 real-stack spec, so the required command deliberately runs the isolated real-stack gate instead of adding a task-only selector.

## 4. 可选全仓验证

```bash
make test-integration
npm --prefix frontend-v2 run e2e
make verify
```

这些命令是可选门禁，因为本能力限定于 Publication Workspace，且明确排除完整 Publishing E2E checkpoint。若共享合同或核心状态变更证明影响更广，则在 closeout 前把对应命令升级为必需并记录原因。

## 5. 父任务 closeout 清单

- [ ] Both child tasks are complete and independently validated.
- [ ] Context is one request/one snapshot/fixed SQL count; no browser join or global filter remains.
- [ ] All command/error/immutable-history guarantees match OpenAPI and database contract.
- [ ] Implementation 与权威 V2 blueprint 中都不存在 `Target Section`。
- [ ] Static Publishing Instruction 未被表示为 business data。
- [ ] 未引入新 dependency、global store、generic framework、未批准 branch 或无关变更。
- [ ] Diff 只包含已识别的任务文件，文档变更与实现一致。
- [ ] 剩余 Out of Scope 的 Article/GEO 工作被明确说明，未创建 placeholder implementation。
