# 技术设计

## 1. Invariant

`AuthSession` Query 是认证用户、CSRF 与 `must_change_password` route decision 的唯一 owner。Router context 中的 `AuthContextValue` 是渲染 view，不是 `beforeLoad` 的替代数据源。所有 generated-route component tests 必须同时构造这两个一致投影。

## 2. 最小边界

新增 `frontend-v2/src/test/auth-session.ts`，导出单一函数：

```ts
createAuthenticatedTestQueryClient(auth: AuthContextValue): QueryClient
```

函数只做三件事：验证完整登录上下文、创建当前测试已统一使用的 retry-disabled QueryClient、使用 canonical key/type 写入 Auth session。它不创建 Router、history、Provider、render result、用户 fixture 或 API mock。

`frontend-v2/src/app/auth/auth-provider.tsx` 只把既有私有 `AuthSession` 加入 type-only export；既有 runtime export 和行为不变。

## 3. Consumer migration

- 21 个导入 generated `routeTree` 的 domain route tests 将 `new QueryClient(...)` 替换为 `createAuthenticatedTestQueryClient(actualAuthContext)`。
- Users/Audit 删除本地 null guard 和直接 `setQueryData`，统一使用 helper。
- 需要 auth variant 的 Configuration harness 传当前函数参数；其余传文件内现有 auth constant。
- `QueryClientProvider`、Router context、TooltipProvider、entry URL、mock 与断言保持原样。

## 4. 依赖方向

```text
domain test harness
  -> src/test/auth-session.ts
       -> app/auth/auth-provider.tsx (canonical type + key)
       -> TanStack Query
```

这是 test-only dependency，不进入 runtime bundle，也不让 `shared`/Design System 反向依赖 domain 或 Auth。

## 5. Compatibility and rollback

- 无 API、数据、权限、路由或 bundle 行为变化；无需迁移或 feature flag。
- 任一定向测试显示 helper 无法表达真实 harness 差异时，停止批量迁移并回滚本任务未提交 diff；不通过增加 options、factory variants 或 fallback 扩大 helper。
- 回滚单位为新增 helper、type-only export 与 21 个机械 consumer 替换，不影响 `ab748d02` 已确认的 production 修正。

## 6. 明确不做

- 不抽象完整 render/router/provider harness。
- 不把 Auth view 改为 route guard owner。
- 不 mock `getAuthRouteUser`、redirect 或 `useAuth`。
- 不修改任何业务测试断言、fixture payload、E2E 或 Phase 7 文档。
