# 实施计划

## Phase A — 实施前核对

1. 确认当前 task 为 `08-17-frontend-v2-auth-route-test-harness`、状态 `planning`，用户批准本计划后才运行 `task.py start`。
2. 确认主工作区仍在 `main` 且只有本 task/parent child link 的规划文件为 dirty；不创建临时分支，不 pull/push/PR。
3. 使用 `trellis-before-dev` 重新读取 frontend spec、当前 `prd.md`、`design.md`、本文件与 `research/audit.md`。
4. 完整读取将修改的 Auth owner、test helper 目录和 21 个 route test 文件；确认每个 harness 传入的实际 auth 变量。

## Phase B — 最小实现

1. 在 `auth-provider.tsx` type-only 导出既有 `AuthSession`，不改 runtime。
2. 新建 `src/test/auth-session.ts`，实现无 options 的 `createAuthenticatedTestQueryClient`：
   - 缺少 `user` 或 `csrfToken` 时抛出中文开发者错误；
   - 复用现有 retry-disabled QueryClient 配置；
   - 使用 canonical `AuthSession` 与 `authSessionQueryKey` seed cache。
3. 将 21 个 generated-route harness 的 QueryClient 创建统一替换为 helper；可变 auth harness 传实际参数。
4. 不修改测试名称、业务 mock、assertion、runtime route、API、E2E 或文档。

## Phase C — 独立诊断与修正

工作目录：`frontend-v2/`。

1. 先按 domain 分组运行 21 个受影响文件，集中识别 helper/API 或个别 harness 差异：

```bash
npm run test -- \
  src/domains/audit/system-audit-page.test.tsx \
  src/domains/identity/user-list-page.test.tsx \
  src/domains/configuration/ai-channel-list-page.test.tsx \
  src/domains/configuration/ai-channel-workspace-page.test.tsx \
  src/domains/configuration/platform-list-page.test.tsx \
  src/domains/configuration/platform-types-page.test.tsx \
  src/domains/configuration/platform-workspace-page.test.tsx \
  src/domains/configuration/prompt-workspace-page.test.tsx \
  src/domains/content/content-editor-page.test.tsx \
  src/domains/content/content-review-page.test.tsx \
  src/domains/content/content-task-detail-page.test.tsx \
  src/domains/content/content-task-list-page.test.tsx \
  src/domains/content/content-version-detail-page.test.tsx \
  src/domains/geo/geo-observation-detail-page.test.tsx \
  src/domains/geo/geo-observation-list-page.test.tsx \
  src/domains/product/fact-history-page.test.tsx \
  src/domains/product/fact-review-page.test.tsx \
  src/domains/product/fact-version-detail-page.test.tsx \
  src/domains/product/fact-workspace-page.test.tsx \
  src/domains/product/product-detail-page.test.tsx \
  src/domains/product/products-list-page.test.tsx
```

2. 若失败仍是 Auth precondition owner，修正 helper/consumer；若出现 Fact Review 409 E2E、Platform Types real-stack 或其他独立 owner，记录但不扩围。
3. 同一失败在代码/环境没有相关变化时不重复运行。

## Required Validation

工作目录：`frontend-v2/`，先完成定向 Vitest 再执行静态检查。

```bash
npm run test -- <Phase C 列出的 21 个文件>
npm run typecheck
./node_modules/.bin/eslint \
  src/app/auth/auth-provider.tsx \
  src/test/auth-session.ts \
  src/domains/audit/system-audit-page.test.tsx \
  src/domains/identity/user-list-page.test.tsx \
  src/domains/configuration/ai-channel-list-page.test.tsx \
  src/domains/configuration/ai-channel-workspace-page.test.tsx \
  src/domains/configuration/platform-list-page.test.tsx \
  src/domains/configuration/platform-types-page.test.tsx \
  src/domains/configuration/platform-workspace-page.test.tsx \
  src/domains/configuration/prompt-workspace-page.test.tsx \
  src/domains/content/content-editor-page.test.tsx \
  src/domains/content/content-review-page.test.tsx \
  src/domains/content/content-task-detail-page.test.tsx \
  src/domains/content/content-task-list-page.test.tsx \
  src/domains/content/content-version-detail-page.test.tsx \
  src/domains/geo/geo-observation-detail-page.test.tsx \
  src/domains/geo/geo-observation-list-page.test.tsx \
  src/domains/product/fact-history-page.test.tsx \
  src/domains/product/fact-review-page.test.tsx \
  src/domains/product/fact-version-detail-page.test.tsx \
  src/domains/product/fact-workspace-page.test.tsx \
  src/domains/product/product-detail-page.test.tsx \
  src/domains/product/products-list-page.test.tsx \
  --max-warnings 0
```

仓库根目录：

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate 08-17-frontend-v2-auth-route-test-harness
```

## Optional / Deferred Validation

- 不运行完整 `npm --prefix frontend-v2 run test`：本 blocker 只验证已识别的 21 个 harness；完整 unit gate 留给 Phase 7 Exit Gate Recheck。
- 不运行 build：仅 test-only helper、type-only export 与测试 harness 变更，typecheck 已覆盖编译合同。
- 不运行 E2E、backend、OpenAPI、V1 或 `make verify`：这些属于其他 blocker 或最终 recheck。

## Phase D — 自审与停止条件

1. 检查 diff 只包含 task artifacts、Auth type-only export、一个 test-only helper 与 21 个 harness 替换。
2. 确认无 Router/render framework、options、fallback、cast、mock redirect、业务断言删改或重复测试。
3. 确认所有 generated-route harness 已统一，局部 routeTree tests 未被误改。
4. Required Validation 任一失败且根因不属于本 owner 时停止，报告独立 blocker；不扩范围。
5. 验证通过后报告结果与精确 commit plan，等待用户批准；不自动 commit、push、archive 或开始第三 blocker。

## Commit 范围草案

单一提交，候选信息：

```text
test(frontend-v2): seed auth in generated route harnesses
```

只包含本 task artifacts、parent child link、`auth-provider.tsx` type-only export、`src/test/auth-session.ts` 与 21 个 route test files。最终文件清单以实施后 diff 为准，并在提交前再次请求批准。

## 实施结果

- 已完成 `AuthSession` type-only export、Auth 专用 test helper 与 21 个 generated-route harness 迁移；没有 production runtime 或业务断言变更。
- Required Validation 全部通过：定向 Vitest `21 files / 158 tests`、typecheck、受影响文件 ESLint、`git diff --check`、Trellis task validation。
- 静态自审确认 21 个 generated-route harness 与 21 个 helper consumers 一一对应，局部 routeTree/component tests 保持原有 QueryClient owner。
- 完整 Frontend V2 suite、build、E2E 与 `make verify` 按计划未运行，继续由 Phase 7 Exit Gate Recheck 统一执行。
