# I03-4-B1 调用清单与覆盖结论

## 搜索范围

对 `frontend/src/**/*.{ts,tsx}` 搜索并逐项区分 `setQueryData/setQueriesData`、`invalidateQueries/removeQueries`、`mutateAsync`、直接写 API、`onCanonical/adoptCanonical` 与 mutation 完成后的导航。生产应用只有 `app/query-client.ts` 创建 AppProviders 使用的 QueryClient；其余 `new QueryClient()` 命中均为测试或不承载认证业务写入的 Storybook 外壳。

## 权威 owner

| 类别 | 真实 owner / 消费者 | 覆盖方式 |
| --- | --- | --- |
| 认证主体 | `app/auth/auth-provider.tsx` | `authBoundaryIdentity` 改变时先推进 per-QueryClient principal epoch，再移除全部非 auth query，最后提交新 session；同主体 revision/CSRF refresh 不推进。认证 transition epoch 继续只处理认证命令互斥。 |
| 普通 TanStack mutation | 所有生产 `useMutation` / `mutateAsync` 消费者 | canonical `createAppQueryClient()` 的 MutationCache 在 `onMutate` 捕获 continuation；自定义 `PrincipalMutation.setOptions()` 同步包装每一次 options 写入，连同 `canRun()` 复核覆盖首次执行、Observer options 更新、离线恢复与 paused retry。旧主体 completion 在 callback 前抛出 stale，且先移除旧 mutation 的 `onSuccess/onError/onSettled`。认证 owner mutation以 metadata 显式豁免。 |
| AI Channel Workspace canonical | `ai-channel-workspace-page.tsx` | configuration、API Key、Header、lifecycle、删除与 canonical reload/handoff 都携带同一 continuation；每个 await 后、cache/local state/callback 前复核。 |
| AI Channel model canonical | `ai-channel-models-section.tsx` | discovery、test、toggle、delete、create/update model、reload 与 consumer refresh 携带 continuation；canonical/local status/cache refresh 前复核。 |
| AI Channel list/callback/navigation | `ai-channel-list-page.tsx`、`routes/_app/_admin/settings.ai.tsx` | command、create、canonical cache、consumer invalidation、delete projection与导航显式传递 continuation；跨 await 后再次复核。 |
| 配置、身份与 Prompt | `platform-*`、`prompt-*`、`identity/user-list-page.tsx` | 对所有 `mutateAsync`、异步 mutation callback 和直接 create/reset 写入携带同一 continuation；每个 await 后、列表刷新、canonical adoption、表单状态与 callback 前复核。生产唯一 `mutate(..., { onSettled })` per-call callback 在调用点额外守卫。 |
| Content / Product / GEO | 对应 domain page、workspace 与 lifecycle owner | async mutation callback、`mutateAsync`、删除/新建/修订/AI 生产链均携带发起时 continuation；内部 await 后再次检查。GEO Observation 与 Product Delete 各有一个“callback 已进入后才切换主体”的 deferred 回归测试。 |
| Publication | work/article/issue workspace、actions 与 routes | 发布命令、accepted-command 同步、跨域 content projection invalidate 与 issue/navigation callback 传递同一 continuation；route callback 在 invalidate 后、导航前再次检查。 |
| 多段文件写入 | `platform-workspace-page.tsx`、`geo-evidence-upload.tsx`、`publication-evidence-upload.tsx` | upload intent、对象传输、complete/abort/candidate 各异步阶段之间复核；旧主体不继续下一段请求，也不采用 verified/candidate response 或调用父级 callback。 |

## 不需要额外页面 guard 的命中

- `auth-provider.tsx` 的 login/logout/change-password/session refresh 属于主体权威 owner，使用独立 auth transition guard；logout 的 TanStack mutation带 `authPrincipalBoundary` metadata，避免由旧主体业务规则反向阻断认证切换。
- `useQuery` loader、query option 与只读 `refetch/fetchQuery` 不产生写命令；其 canonical QueryCache 写入由 Query owner 管理。AI Channel mutation 后显式 reload 仍在同一个 principal continuation 内复核。
- API 模块中的 `api.POST/PUT/PATCH/DELETE` 只负责 HTTP 与响应解析，不直接写 QueryCache、导航或调用 UI success callback；guard 位于拥有 continuation 的调用 owner，而不是低层 API client。
- 测试文件中的 `setQueryData/invalidateQueries/new QueryClient` 是夹具或断言，不是生产 continuation。认证集成夹具改用 `createAppQueryClient()`；直接上传消费者测试补齐真实 QueryClientProvider。
- 用户触发的纯搜索参数导航不来自 mutation completion，不属于本阻断。

## 验收重点

- 共享 MutationCache 测试证明旧主体 success/error/settled callback 均不执行，`mutateAsync` 以专用 stale 错误拒绝；精确在 `continue` 通知内（`canRun()` 已放行而 retryer 尚未读取函数）执行真实 MutationObserver options 覆盖时，离线恢复与 paused retry 均不能再次调用原始 mutationFn；同主体 refresh 正常成功。
- AppProviders deferred 集成测试覆盖 API Key PUT 与 configuration PATCH 的 ADMIN→ENGINEER、匿名、另一用户六个反例，并断言全部非 auth QueryCache 为空、无 cache write/invalidate、无导航/成功状态。
- 同一 ADMIN 的 session revision 与 CSRF refresh 后，PUT/PATCH canonical response 仍采用。
- 修改消费者的直接组件测试共 32 个文件、380 个测试通过；QueryClient 精确恢复/retry 竞态 7/7 通过。最终 fresh critical_reviewer 另行运行前端完整 Vitest 91 个文件、774 个测试，以及完整 lint、typecheck、`git diff --check`，全部通过并给出 `NO BLOCKER`。
