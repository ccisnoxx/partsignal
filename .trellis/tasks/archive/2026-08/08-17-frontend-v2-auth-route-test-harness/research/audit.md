# 审计记录

## 1. 已观测失败

System Exit Gate 的独立 Frontend V2 unit 阶段实际得到：

- `60 files passed / 19 failed`
- `311 tests passed / 146 failed`
- 主症状：路由落到 `/login` 后抛出 `useAuth 必须在 AuthProvider 内使用`

本任务规划阶段没有重复运行同一未变更的失败命令；本文件基于已保存门禁证据和当前源码静态审计确定 owner。

## 2. 权威 owner 与根因

- `frontend-v2/src/app/auth/auth-provider.tsx:11-14,27`：`AuthSession` 与 `authSessionQueryKey` 是 Auth session 的唯一 shape/key owner。
- `frontend-v2/src/app/auth/auth-provider.tsx:36-37`：`getAuthRouteUser` 只从 canonical Query cache 读取 route user。
- `frontend-v2/src/routes/_app/route.tsx:8-13`：generated route tree 进入业务路由前以该 Query cache 执行匿名与 `must_change_password` redirect。
- `frontend-v2/src/routes/_app/route.tsx:18-29`：通过 guard 后，layout 才消费 Router context 中的 `auth` view。

失败 harness 只完成后一项：`createRouter`/`RouterProvider` 收到 `auth` view，但 QueryClient 没有 session。Router context 不是 route guard 的第二权威来源，因此 production 行为正确，测试前置条件错误。

## 3. 影响范围

当前 domain tests 中共有 21 个文件导入 generated `routeTree`：

- Audit：`system-audit-page.test.tsx`（已 seed）
- Identity：`user-list-page.test.tsx`（已 seed）
- Configuration（6 个未 seed）：`ai-channel-list-page.test.tsx`、`ai-channel-workspace-page.test.tsx`、`platform-list-page.test.tsx`、`platform-types-page.test.tsx`、`platform-workspace-page.test.tsx`、`prompt-workspace-page.test.tsx`
- Content（5 个未 seed）：`content-editor-page.test.tsx`、`content-review-page.test.tsx`、`content-task-detail-page.test.tsx`、`content-task-list-page.test.tsx`、`content-version-detail-page.test.tsx`
- GEO（2 个未 seed）：`geo-observation-detail-page.test.tsx`、`geo-observation-list-page.test.tsx`
- Product（6 个未 seed）：`fact-history-page.test.tsx`、`fact-review-page.test.tsx`、`fact-version-detail-page.test.tsx`、`fact-workspace-page.test.tsx`、`product-detail-page.test.tsx`、`products-list-page.test.tsx`

19 个未 seed 文件与失败文件数精确一致。它们都使用相同的 `new QueryClient({ defaultOptions: { queries: { retry: false } } })`，并把同一个 `auth` 或 `authContext` 传给 router creation 和 render。

以下测试明确排除：

- `new-product-page.test.tsx`、`new-content-task-page.test.tsx`、`geo-observation-correction-page.test.tsx`、`publication-workspace-page.test.tsx` 自建局部 routeTree，不经过 `/_app` Auth guard。
- `app-shell.test.tsx` 与 Design System form tests 的本地 router 只服务自身组件边界。
- 不创建 QueryClient 或不挂载 routeTree 的 model/component tests。

## 4. 方案比较

### 采用：Auth 专用 test-only QueryClient helper

在 `frontend-v2/src/test/auth-session.ts` 放置一个 helper：

1. 接受当前 harness 实际使用的 `AuthContextValue`；
2. 验证 `user` 与 `csrfToken`；
3. 创建现有 retry 配置的 QueryClient；
4. 以 Auth owner 的 `AuthSession` type 与 `authSessionQueryKey` 写入 session。

21 个真实消费者证明这个前置条件稳定。helper 只统一 Auth Query ownership，不创建 Router、Provider、render、fixture user 或 domain mock。

### 不采用：19 处继续复制 seed

虽然可修复当前失败，但会在每个 harness 重复 null guard、session shape 与写入顺序；当前失败正是跨任务新增 route harness 时遗漏该隐含前置条件，继续复制会保留同类漂移入口。

### 不采用：全局 setup、真实 AuthProvider 或通用 route factory

- `src/test/setup.ts` 无法安全定位每个测试创建的 QueryClient。
- 挂载真实 `AuthProvider` 会把 `/auth/me`、CSRF 与 mutation lifecycle 带入所有 domain component tests，扩大 mock 与失败面。
- 通用 Router/Provider/render factory 会吞并各 domain 的 route entry、Tooltip provider、auth variants 与返回值差异，超出本 blocker 且形成错误抽象。

## 5. 风险与约束

- `platform-*` 与 `ai-channel-list` harness 可传不同 `authContext`；helper 必须 seed 该参数，不能固定 admin constant。
- Users/Audit 已有直接 seed；迁移到 helper 是消除第二种 harness 写法，不改变其历史审计结论。
- helper 位于 test-only 目录；唯一 runtime 文件变化只允许 type-only export `AuthSession`，不得改变 AuthProvider 执行逻辑。
- 不通过删除测试、改用宽松等待、mock redirect、空 CSRF 或 `as` cast 让失败消失。

## 6. 实施验证证据

- 21 个 generated-route harness 均已改用 `createAuthenticatedTestQueryClient`；静态清单显示 `generated=21`、`helper_consumers=21`，domain tests 中没有遗留的 `authSessionQueryKey` 或 Auth session 手写 seed。
- 定向 Vitest：`21 files passed / 158 tests passed`。
- `npm run typecheck`、受影响 23 个 TS/TSX 文件的 ESLint、`git diff --check` 与 Trellis task validation 均通过。
- 未运行完整 Frontend V2 suite、build、E2E 或 `make verify`；这些按批准计划留给 Phase 7 Exit Gate Recheck。
