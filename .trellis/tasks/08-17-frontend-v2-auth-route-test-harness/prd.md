# Frontend V2 跨 Domain Auth 路由测试基座

## Goal

让所有挂载 generated `routeTree` 的 Frontend V2 component/unit route harness 使用 Auth session Query 的同一权威前置条件，关闭当前跨 Configuration、Content、GEO、Product 的 19 个失败文件；不改变产品运行时、业务断言或 Phase 7 文档结论。

## Background

- System Exit Gate 诊断中，独立 `npm --prefix frontend-v2 run test` 得到 `60 files passed / 19 failed`、`311 tests passed / 146 failed`。
- 19 个失败文件都向 TanStack Router context 注入了 `AuthContextValue`，但没有向 `authSessionQueryKey` 写入 session；`/_app` 的 `beforeLoad` 只从 Query cache 读取用户，因此测试被重定向到 `/login`，随后触发 `useAuth 必须在 AuthProvider 内使用`。
- Users 与 Audit 的两个 generated-route harness 已用 canonical key 修正并通过，证明 production route guard 无需改动；19 个跨 domain 消费者证明 Auth test seed 已达到共享 test-only Pattern 的提升门槛。

## Requirements

1. Auth session Query key 与 session shape 继续由 `frontend-v2/src/app/auth/auth-provider.tsx` 唯一拥有；测试不得复制字符串 key、手写第二套 session type 或 mock `beforeLoad`。
2. 在 `frontend-v2/src/test/` 增加一个职责单一的 authenticated QueryClient helper：创建现有 `retry: false` QueryClient、拒绝缺失 `user`/`csrfToken` 的伪登录上下文，并写入 canonical Auth session。
3. 21 个挂载 generated `routeTree` 的 domain route harness（19 个失败文件及已修正的 Users/Audit）统一复用该 helper；传入可变 `authContext` 的测试必须 seed 本次实际传给 Router 的同一个 context。
4. 自建局部 routeTree、只测组件而不经过 `/_app`、App Shell 或 Design System 的测试保持不变。
5. 不改变 AuthProvider、route guard、Router context 的 runtime 行为，不改变 API mock、测试业务断言、产品代码路径或权限判断。
6. 不新增通用 Router/Provider/render factory，不把 helper 放入 Design System/shared runtime，不修改 OpenAPI、backend、E2E、旧 `frontend/` 或 `docs/frontend-v2/07`、`08`。
7. 本 blocker 只运行自身定向验证；完整 Frontend V2 unit gate 与 `make verify` 留给全部 blocker 合入后的 Phase 7 Exit Gate Recheck。

## Acceptance Criteria

- [x] 21 个 generated-route harness 均通过一个 Auth 专用 test helper 获得 QueryClient 与 canonical session，仓库中不再保留这类 harness 的手写 `setQueryData(authSessionQueryKey, ...)`。
- [x] helper 使用 Auth owner 的 exported type/key；缺失 `user` 或 `csrfToken` 时显式失败，不把匿名或不完整上下文伪装成已登录 session。
- [x] 原 19 个失败文件与 Users/Audit 两个参考文件的定向 Vitest 全部通过，且原有断言不被删除、放宽或重复。
- [x] Frontend V2 typecheck 与受影响文件 ESLint 通过；`git diff --check` 和 Trellis task validation 通过。
- [x] 无 production runtime、API、权限、E2E、旧前端或 Phase 7 Exit Gate 文档变更。

## Out of Scope

- Fact Review 409 revision E2E。
- Platform Types 非管理员 real-stack E2E 编排。
- 完整 Frontend V2 unit suite、`make verify` 与 Phase 7 `MET` 重判。
- 通用 Admin、CRUD、Permission、Audit、Router 或 React Testing Library framework。
- 分支、push、PR、task archive 与 Phase 8。
