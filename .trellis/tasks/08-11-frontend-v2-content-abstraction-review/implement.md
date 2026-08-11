# Frontend V2 Content Abstraction Review — Implementation Plan

> 当前状态：规划已批准，最小实现与相关验证已完成；等待 commit plan 确认。Phase 3 gate 因一个已知范围外 full-suite 失败暂为 `NOT_MET`。

## 1. 启动条件

用户批准本规划后，按顺序执行：

1. 确认主工作目录位于最新、干净的 `main`；如需同步且工作树干净，仅允许 `git pull --ff-only origin main`。
2. 运行本 Task 的 `task.py start`。
3. 从该 `main` 创建临时分支 `codex/frontend-v2-content-abstraction-review`。
4. 再次读取本 Task 的 `prd.md`、`design.md`、`implement.md` 与相关 frontend spec，确认没有上下文漂移。

## 2. 执行步骤

### Step 1 — 提升已证明的 route error Pattern

- 新增 `frontend-v2/src/design-system/workspace/route-error.tsx`。
- 在 `frontend-v2/src/design-system/workspace/workspace-kit.test.tsx` 增加最小测试。
- 替换四个 Content route 的重复 JSX：
  - `src/routes/_app/content/tasks/$taskId.tsx`
  - `src/routes/_app/content/tasks/$taskId_.editor.tsx`
  - `src/routes/_app/content/tasks/$taskId_.review.tsx`
  - `src/routes/_app/content/versions_.$versionId.tsx`
- 保留 route-specific 标题、loader/prefetch/head/composition；不改 query options、page props 或业务行为。

### Step 2 — 局部删除无意义 wrapper

- 在 `content-task-detail-page.tsx` 内联两个现有 `Badge` 调用并删除 `StatusBadge` helper。
- 在 `content-review-page.tsx` 内联两个现有 `Badge` 调用并删除 `StatusBadge` helper/仅供该 helper 使用的 type import。
- 不创建新的 status component 或 registry。

### Step 3 — Targeted validation

按第 5 节顺序运行 required validation。每次失败先归因；只有代码/配置/环境发生足以影响结果的变化后才可重跑。

### Step 4 — Trellis check 与自审

- 使用 `trellis-check` 做 spec、lint/typecheck/test、依赖方向与 diff 一致性检查。
- 自审 `git diff`：确认没有 Product、backend、contract、generated、deployment 或 Phase 4 文件；没有新依赖/第二 DTO/新 registry/wrapper。
- 更新 `audit.md` 的最终 decision/validation 与 `docs/frontend-v2/07-migration-plan.md` 的 Phase 3 exit 状态。

### Step 5 — Phase 3 gate 报告

- 逐条核对第 6 节 gate。
- 判定 `MET` 或 `NOT_MET`，不得用“基本通过”替代。
- 提交前展示 commit plan 与精确文件清单，等待用户确认；不 push。

## 3. 预计修改文件与数量上限

### 代码/测试/权威状态文档：最多 9 个

1. `frontend-v2/src/design-system/workspace/route-error.tsx`（新增）
2. `frontend-v2/src/design-system/workspace/workspace-kit.test.tsx`
3. `frontend-v2/src/routes/_app/content/tasks/$taskId.tsx`
4. `frontend-v2/src/routes/_app/content/tasks/$taskId_.editor.tsx`
5. `frontend-v2/src/routes/_app/content/tasks/$taskId_.review.tsx`
6. `frontend-v2/src/routes/_app/content/versions_.$versionId.tsx`
7. `frontend-v2/src/domains/content/content-task-detail-page.tsx`
8. `frontend-v2/src/domains/content/content-review-page.tsx`
9. `docs/frontend-v2/07-migration-plan.md`

### Trellis 任务产物：不计入上述实现上限

- `.trellis/tasks/08-11-frontend-v2-content-abstraction-review/prd.md`
- `.trellis/tasks/08-11-frontend-v2-content-abstraction-review/audit.md`
- `.trellis/tasks/08-11-frontend-v2-content-abstraction-review/design.md`
- `.trellis/tasks/08-11-frontend-v2-content-abstraction-review/implement.md`
- `.trellis/tasks/08-11-frontend-v2-content-abstraction-review/task.json`（仅由 Trellis workflow 更新必要状态）

若需要第 10 个代码/测试/权威文档文件，立即停止并申请重新批准；不得以“顺手修复”扩张。

## 4. 代码行为约束

- 不改变任何 API path、DTO、query key、mutation、cache invalidation、action registry、status mapping 或 route URL。
- 不改变 `current_content_version_id`、revision、idempotency、CSRF 或 immutable snapshot 行为。
- 不改变页面文案，除非复用时为保持现有 route-specific 标题而显式传入原文案。
- 不修改 fixture/real-stack orchestration；不新增依赖。
- TypeScript/TSX 新增或实质修改的 developer-facing 文本保持中文；不添加显而易见注释。

## 5. Required Validation

按顺序执行以下精确命令：

```bash
npm --prefix frontend-v2 run test -- \
  src/design-system/workspace/workspace-kit.test.tsx \
  src/domains/content/content-task-detail-page.test.tsx \
  src/domains/content/content-review-page.test.tsx

npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/content-task-detail.spec.ts \
  tests/e2e/content-editor.spec.ts \
  tests/e2e/content-review.spec.ts \
  tests/e2e/content-version-detail.spec.ts \
  --project=foundation-desktop

make verify
git diff --check
```

随后执行非命令式 required gate：

- `trellis-check`：spec compliance、依赖方向、代码复用、lint/typecheck/test 结果与 diff 一致性。
- 自审：逐项核对 `audit.md` 15 项检查、文件白名单、无无关修改、无新抽象/依赖。

### 不重复运行的重验证

`deploy/scripts/e2e-local.sh` 的完整 real-stack 不列为本 Task required validation：已归档 Content E2E、AI、Review、Version Detail 结果覆盖真实栈，而计划内 diff 不触及业务数据流。若实现实际触及 API/query/action/current pointer/mutation/snapshot 或部署脚本，规划失效并触发停止，不临时把 real-stack 加入当前范围。

## 6. Phase 3 Exit Gate 判定方法

### `MET`

必须全部满足：

1. CDR-01 与 SL-01 已按批准范围完成，或用户明确批准 no-code 结论。
2. 所有其他 findings 保持正确 owner；defer 项有明确 owner 和 trigger。
3. 第 5 节 required validation、`trellis-check` 和自审全部通过。
4. diff 未改变 Content 业务能力、合同、资格、current pointer 或不可变历史。
5. archived real-stack evidence 仍适用于最终代码；没有新增未覆盖数据流。
6. `docs/frontend-v2/07-migration-plan.md`、任务产物、代码和测试结论一致。
7. 没有未解决 P0/P1/P2 finding 或停止条件。

### `NOT_MET`

任一 `MET` 条件不满足即判 `NOT_MET`，报告：阻塞证据、owner、独立 Task 建议和下一触发条件。不得在本任务夹带 Phase 4 或合同修复。

## 7. 风险与回滚

- route error 复用回归：回退新组件与四个 route 替换即可，无数据影响。
- Badge 内联回归：恢复两个 page-local helper 即可，无合同影响。
- 文档 gate 误判：以验证日志与最终 diff 为准，把状态恢复为 `NOT_MET`。
- 超范围发现：保留 ledger，停止实现，为对应 owner 建议独立 Task。

## 8. Commit Plan Gate

完成验证后先向用户展示：

- 拟提交文件清单与每组目的；
- required validation 实际结果；
- Phase 3 gate 判定；
- 明确未包含的 dirty/unrecognized 文件。

只有用户确认后才提交；不 push。临时分支的合并与删除按用户后续指令执行。

## 9. 执行结果

- Task 已在 `codex/frontend-v2-content-abstraction-review` 启动并实施。
- 9 个批准范围内的代码/测试/权威文档文件完成；Trellis 产物不计入该上限。
- targeted component、typecheck、lint、build、四 route fixture Playwright、`git diff --check` 与相关 Trellis scope check 通过。
- `make verify` 除已知 `app-shell.test.tsx` Product Detail loader mock 缺口外通过；该失败与本 diff 无关，且此前已有相同归档证据。
- 按停止条件未修改 Product/AppShell；Phase 3 gate 判为 `NOT_MET`，建议独立 `frontend-v2-app-shell-product-detail-loader-test`。
- `trellis-update-spec` 判定无需更新长期 spec：既有 component guidelines 已覆盖本次纯 UI/feature ownership 与禁止转发 wrapper 的约束。
- 未重复运行同一失败，未运行完整 real-stack，未新增依赖。
