# Frontend V2 Publication Workspace — Implementation Plan

## 1. 实施顺序

1. 确认主工作目录是最新、干净的 `main`，激活 Core，并创建已明确授权的临时分支 `codex/frontend-v2-publication-workspace-core`；OpenAPI 变更只机械更新获批的 V1 generated schema 文件。
2. 运行 Core targeted validation、Visual QA、`trellis-check` 和自审；展示 diff/commit plan 并取得确认后才 commit 或 merge。
3. 把已接受的 Core 合并到 `main`，删除其临时分支；随后激活 Verification，并从新的干净 `main` 创建 `codex/frontend-v2-publication-verification`。
4. 运行 Verification targeted validation、Visual QA、`trellis-check` 和自审；展示 diff/commit plan 并取得确认后才 commit 或 merge。
5. Verification 已合并到 `main` 并删除临时分支。激活 `frontend-v2-publication-action-required-revision`，复用现有 Content Editor/Review 打通修订审批入口并完成真实栈 Flow B。
6. 该依赖子任务通过 targeted validation、`trellis-check` 与用户确认的 commit plan 后提交；随后运行父任务 integration gate，核对 OpenAPI、generated types、代码、测试、database contract 与 V2 docs。
7. 不 push。运行 Trellis archive/session bookkeeping 前，先解释其可能产生的 bookkeeping commit。

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

### 2.3 ACTION_REQUIRED Revision

- 修正 Content Task 共享投影，使 `ACTION_REQUIRED` 能进入现有 revision/editor/review/approval 链。
- 不新增 Content 或 Publication command，不修改合同、数据库或 V1。
- 补完 Verification 中因该投影缺口暂缓的真实栈 Flow B。

## 3. 父任务最终集成门禁

三个子任务通过后必须运行：

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

`deploy/scripts/e2e-local.sh` 已包含 `publication-workspace-real-stack.spec.ts`，继续作为唯一数据库/存储生命周期 owner。Flow B 直接扩展该 spec，不新增 task-only selector 或重复脚本入口。

## 4. 可选全仓验证

```bash
make test-integration
npm --prefix frontend-v2 run e2e
make verify
```

这些命令是可选门禁，因为本能力限定于 Publication Workspace，且明确排除完整 Publishing E2E checkpoint。若共享合同或核心状态变更证明影响更广，则在 closeout 前把对应命令升级为必需并记录原因。

## 5. 最终门禁执行结果

- OpenAPI 双端生成、`make contract-check`、publication workflow 15 项、V2 targeted 16 项、V2 build、fixture E2E 10 项和 `git diff --check` 已通过；generated types 无 diff。
- 隔离真实栈 V2 9/9 通过，含完整 Flow B，且数据库、存储和临时 Redis 均已清理。
- 同一真实栈中 V1 51/52 通过；唯一失败是 `frontend/tests/e2e/mvp-flow.spec.ts:795` 仍期待换版后立即显示“修复并重新核验”。权威服务端合同则要求 `CONTENT_VERSION_CHANGED` 后撤回 `VERIFY`、先 `REGISTER_RESULT`。该 V1 断言在子任务开始前的 `6c664fd5` 已存在，当前授权又禁止修改 V1 runtime/test/page，因此不修改实现、不规避脚本、不归档父任务。

## 6. 父任务 closeout 清单

- [ ] All three child tasks are complete and independently validated.
- [ ] Context is one request/one snapshot/fixed SQL count; no browser join or global filter remains.
- [ ] All command/error/immutable-history guarantees match OpenAPI and database contract.
- [ ] Implementation 与权威 V2 blueprint 中都不存在 `Target Section`。
- [ ] Static Publishing Instruction 未被表示为 business data。
- [ ] 未引入新 dependency、global store、generic framework、未批准 branch 或无关变更。
- [ ] Diff 只包含已识别的任务文件，文档变更与实现一致。
- [ ] 剩余 Out of Scope 的 Article/GEO 工作被明确说明，未创建 placeholder implementation。
