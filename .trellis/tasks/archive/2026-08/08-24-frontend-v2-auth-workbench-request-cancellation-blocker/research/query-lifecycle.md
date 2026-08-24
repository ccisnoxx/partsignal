# Research: TanStack Query 与 Auth / Workbench 请求生命周期

- Query: 核实本地 TanStack Query `removeQueries`、`cancelQueries`、Query destruction 与 `AbortSignal` 语义，并静态梳理 login / 首次改密 → Workbench → System → logout 的 production 调用链；区分现有证据可确定与不可确定的事实，不预设 owner。
- Scope: mixed
- Date: 2026-08-24

## Findings

### 1. 文件范围

- `frontend-v2/package.json:22-28`：声明 TanStack Query / Router 依赖范围。
- `frontend-v2/package-lock.json:3882-3904,9152-9159`：锁定 `@tanstack/query-core`、`@tanstack/react-query` 和 `openapi-fetch` 的实际版本。
- `frontend-v2/node_modules/@tanstack/query-core/src/queryClient.ts:245-253,276-288,350-378`：本地锁定版本中 cache remove、query cancel 和 prefetch 的实现。
- `frontend-v2/node_modules/@tanstack/query-core/src/queryCache.ts:144-163`：cache removal / clear 到 `Query.destroy()` 的调用链。
- `frontend-v2/node_modules/@tanstack/query-core/src/query.ts:253-263,362-380,400-418,444-488,535-549`：Query cancel、destroy、observer removal、同请求复用与 `AbortController` 的精确语义。
- `frontend-v2/node_modules/@tanstack/query-core/src/retryer.ts:83-123,148-205`：Retryer cancel/reject/onCancel 与已 settle 后忽略底层 Promise 结果的实现。
- `frontend-v2/node_modules/openapi-fetch/src/index.d.ts:109-134`：request options 接受除 `body/headers` 外的 `RequestInit`，因此类型上支持 `signal`。
- `frontend-v2/node_modules/openapi-fetch/src/index.js:110-123,168-172`：request init 进入 `Request` 和最终 `fetch` 的实现。
- `frontend-v2/src/shared/api/client.ts:1-8`：全局 generated HTTP client；没有全局取消 middleware。
- `frontend-v2/src/app/query-client.ts:1-3`：production module 级唯一 `QueryClient`。
- `frontend-v2/src/app/providers.tsx:10-25,28-37`：认证完成前不挂 Router；Router context 复用同一 QueryClient；退出后 invalidate。
- `frontend-v2/src/app/auth/auth-provider.tsx:27-37,45-94,105-134`：canonical Auth session、业务 query 清理、登录、改密与退出 owner。
- `frontend-v2/src/app/auth/auth-provider.test.tsx:76-147`：已有退出、跨身份 cache 清理和首次改密测试；没有在途 query / signal 测试。
- `frontend-v2/src/routes/login.tsx:11-27`：登录后的 `/account/security` 或 `/` 导航。
- `frontend-v2/src/routes/account/security.tsx:12-35`：改密后等待服务端 session，再导航 `/`。
- `frontend-v2/src/routes/_app/route.tsx:7-29`：认证 / must-change 共同保护边界及 App Shell 挂载条件。
- `frontend-v2/src/routes/_app/index.tsx:6-14`：Workbench loader 的 fire-and-forget prefetch。
- `frontend-v2/src/domains/workbench/workbench.api.ts:8-19`：Workbench 单 query key、单 GET、retry 与 stale 配置。
- `frontend-v2/src/domains/workbench/workbench-page.tsx:22-36,39-47,144-159`：页面复用同一 query，且 loading / success 都渲染“工作台”一级标题。
- `frontend-v2/src/routes/_app/_admin/route.tsx:7-18`：System ADMIN 父路由边界。
- `frontend-v2/src/routes/_app/_admin/system.users.tsx:11-49`：System Users 子路由 loader 和页面 composition。
- `frontend-v2/src/domains/identity/user.api.ts:29-49`：System Users GET query；同样没有消费 `AbortSignal`。
- `frontend-v2/src/app/layout/app-shell.tsx:224-274`：账户菜单等待 `auth.signOut()`，失败保留在当前页面。
- `frontend-v2/tests/e2e/auth-session-real-stack.spec.ts:14-53`：当前真实栈顺序和丢失 phase / `errorText` 的 requestfailed collector。
- `frontend-v2/tests/e2e/auth-session.spec.ts:110-163`：fixture Auth 流程；fixture 响应足够快，不能证明真实 GET 的取消时序。
- `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-abstraction-review/research/audit.md:52-53,130-144`：A26 原始 finding、失败 gate 与未确定 owner 的归档证据。

### 2. 锁定版本与 API 表面

1. `package.json` 声明 `@tanstack/react-query: ^5.101.4`（`frontend-v2/package.json:26`），lockfile 和本地包实际均为 `5.101.4`；`@tanstack/query-core` 也精确为 `5.101.4`（`frontend-v2/package-lock.json:3882-3899`）。
2. HTTP client `openapi-fetch` 精确为 `0.17.0`（`frontend-v2/package-lock.json:9152-9159`）。它的 `FetchOptions` 合并 `RequestInit`，所以调用 `api.GET(path, { signal })` 在当前类型和实现上均受支持（`node_modules/openapi-fetch/src/index.d.ts:109-134`；`src/index.js:110-123,168-172`）。
3. production `queryClient` 没有 default options、cache hook 或自定义 cancellation 行为，只是 `new QueryClient()`（`frontend-v2/src/app/query-client.ts:1-3`）。
4. 全仓定向搜索确认 `workbenchQueryOptions` 只有两个 production consumer：route loader 与 `WorkbenchPage`；没有第三个 Workbench query owner（`routes/_app/index.tsx:4,9`；`domains/workbench/workbench-page.tsx:7,23`）。

### 3. `removeQueries`、`cancelQueries` 与 Query destruction 的精确语义

#### 3.1 `removeQueries`

本地 `5.101.4` 的调用链为：

```text
QueryClient.removeQueries(filters)              queryClient.ts:245-253
  → QueryCache.findAll(filters)
  → QueryCache.remove(query)                    queryCache.ts:144-155
  → query.destroy()                             queryCache.ts:148
  → query.cancel({ silent: true })              query.ts:259-263
  → retryer.cancel(...)
  → reject CancelledError + onCancel            retryer.ts:88-94
  → abortController.abort()                     query.ts:541-549
  → cache Map 删除 query                        queryCache.ts:150-154
```

- `removeQueries` 返回 `void`，不会等待底层 transport 完成（`queryClient.ts:245-253`）。
- 它不区分 active / inactive；匹配到的 active 或 in-flight Query 都会先 destroy 再从 cache 删除。
- Query 层的 Retryer 会 settle 为 cancellation；底层 Promise 此后完成时，Retryer 的 `resolve/reject` 因已经 settled 而忽略结果（`retryer.ts:85-94,111-123,161-167`）。因此已销毁 Query 不会靠迟到响应重新写回原 cache entry。
- `destroy()` 调用 `AbortController.abort()` 不等于浏览器 fetch 一定中止。只有 transport 实际收到这个 `signal`，abort 才能传播到网络层。

#### 3.2 `cancelQueries`

- 本地实现匹配 Query 后调用 `query.cancel({ revert: true, ...options })`，等待所有 Query cancel Promise，并吞掉 cancellation error 后 resolve（`queryClient.ts:276-288`）。本地 TypeScript 返回类型明确为 `Promise<void>`，可 `await`。
- 它保留 Query cache entry；默认 `revert: true`，与 `removeQueries` 的“销毁并删除 cache entry”不是同一操作。
- 与 `removeQueries` 一样，是否真正中止浏览器请求取决于 query function 是否把 Query context 的 `signal` 交给 transport。
- TanStack 当前在线 `latest` QueryClient 文档把 `cancelQueries` 的 Returns 写成“不返回”，与本地 `5.101.4` 源码 / 类型不一致；本任务设计必须以 lockfile + 本地安装源码为准，不能用 latest 文档覆盖当前 patch 的实际返回合同。

#### 3.3 普通组件卸载 / observer removal

- `QueryObserver.destroy()` 会从当前 Query 移除 observer（`queryObserver.ts:131-136`）。
- 最后一个 observer 移除时：若 query function 已读取 `signal`，Query cancel 当前 Retryer；若没有读取，则只 `cancelRetry()`，允许当前 Promise 继续并把成功结果留在 cache（`query.ts:362-377`）。
- 因此，“SPA 离开 Workbench 导致 `useQuery` 卸载”本身不会让当前 Workbench transport 中止：当前 query function 没有读取 context `signal`。

#### 3.4 Workbench transport 当前没有接入 Query signal

- Query Core 给每个 query function context 暴露延迟 getter `signal`；只有读取 getter 才把 `#abortSignalConsumed` 设为 true（`query.ts:444-479`）。
- Workbench 的 `queryFn` 签名为无参数 `async () => ...`，调用 `api.GET('/api/v1/workbench')` 时没有传 `signal`（`frontend-v2/src/domains/workbench/workbench.api.ts:8-16`）。
- System Users query 也使用无参数 queryFn，并且 `api.GET('/api/v1/users', ...)` 没有 signal（`frontend-v2/src/domains/identity/user.api.ts:36-49`）。
- 对 `frontend-v2/src/**/*.{ts,tsx}` 的定向搜索没有找到任何 query function 消费 `{ signal }` 或把 `signal` 传入 `api.GET` 的实现。这是当前代码事实，不代表应在本 blocker 推广全局 cancellation 改造。

结论：当前 production `removeQueries` 能同步清理上一身份的 business Query cache，并在 Query 层 cancel Retryer；它不能单独保证对应浏览器 HTTP 请求物理中止。普通 route unmount 则连 Query Retryer 都不会取消当前请求，只会停止 retry。两者必须与硬导航导致的 document teardown 分开讨论。

### 4. login / 首次改密 → Workbench 的静态链路

#### 4.1 初始 session 与 Router 挂载

1. `AppProviders` 在唯一 production QueryClient 下挂 `AuthProvider`（`providers.tsx:28-37`）。
2. `AuthProvider` 以 `['auth', 'session']` 执行 `loadAuthSession`：先 GET `/auth/me`，非匿名再 GET `/auth/csrf`（`auth-provider.tsx:45-66`）。
3. 探测完成前 `AppRouter` 不挂载 Router，明确避免受保护 child loader 提前请求业务数据（`providers.tsx:21-25`）。
4. `_app` 的 `beforeLoad` 从同一 QueryClient 读取 canonical session；匿名跳 `/login`，must-change 跳 `/account/security`（`routes/_app/route.tsx:7-14`）。

#### 4.2 登录

1. `LoginRoute` 调 `signIn`；POST login 成功后，先 `clearBusinessQueries`，再写 canonical session（`routes/login.tsx:11-27`；`auth-provider.tsx:109-119`）。
2. `clearBusinessQueries` 删除首段不是 `auth` 的全部 Query，因此上一身份 Workbench / System / domain cache 都不保留（`auth-provider.tsx:27-34`）。
3. Login 依据服务端返回的 `must_change_password` 显式导航 `/account/security` 或 `/`（`routes/login.tsx:24-27`）。`AppRouter` 自身只在 authenticated → anonymous 时 invalidate，不负责登录后的这次导航（`providers.tsx:13-19`）。

#### 4.3 首次改密

1. `changePassword` 使用当前 session 的 CSRF POST，成功后重新执行 `/auth/me` + `/auth/csrf`，再用服务端响应整体替换 session；浏览器不自行解除 must-change（`auth-provider.tsx:121-133`）。
2. `AccountSecurityRoute` 等 `auth.user.must_change_password` 变为 false 后显式导航 `/`（`routes/account/security.tsx:16-23,29-35`）。
3. must-change session 期间不会挂业务 App Shell；共同 `_app` 边界也会重定向，因此按 production 静态路径，首次改密之前不应有 Workbench query（`routes/_app/route.tsx:7-29`）。

#### 4.4 Workbench loader 与 page 共用一个在途 Query

1. 到达 `/` 后，route loader 创建 `workbenchQueryOptions()`；cache 中尚无该 key 时调用 `void queryClient.prefetchQuery(options)`，没有 await（`routes/_app/index.tsx:8-12`）。
2. `prefetchQuery` 内部执行 `fetchQuery`，但自身把成功 / 失败都投影为 `Promise<void>`（Query Core `queryClient.ts:350-378`）。route 又显式 `void`，所以导航不等待 aggregate。
3. `WorkbenchPage` 紧接着对同一个 `['workbench', 'aggregate']` 调 `useQuery`（`workbench-page.tsx:22-24`；`workbench.api.ts:8-19`）。Query 已在 fetch 时，Query Core 返回现有 Retryer Promise，不开启第二个 GET（`query.ts:400-418`）。
4. `WorkbenchPage` 的 loading 分支和成功分支都渲染 level-1 “工作台”：loading 在 `workbench-page.tsx:144-150`，成功在 `:39-47`。因此 E2E 的 `heading('工作台').toBeVisible()`（`auth-session-real-stack.spec.ts:41-42`）只能证明页面进入 Workbench surface，不能证明 `GET /api/v1/workbench` 已完成。

### 5. Workbench → System 的静态链路

1. 真实栈 Auth 测试在“工作台”标题可见后立刻执行 `page.goto('/system/users')`（`auth-session-real-stack.spec.ts:41-44`）。这是整页 document navigation，不是 App Shell 的 TanStack `<Link>` SPA navigation。
2. 由于标题可能来自 loading 分支，执行 `page.goto` 时 Workbench GET 完全可能仍在途。旧 document 被替换时，浏览器可以取消它拥有的 fetch；此路径不依赖 TanStack Query 是否消费 signal。
3. 新 document 会重新执行 module，并创建新的 module-level QueryClient / AuthProvider（`query-client.ts:1-3`；`providers.tsx:28-37`）。旧 document 的 Workbench Query cache 不会成为新 document 的 cache。
4. `/system/users` 位于 `_admin` 父路由下。父 `beforeLoad` 先检查 canonical user 的 `account_type`，ENGINEER 命中 not-found / 403 surface（`routes/_app/_admin/route.tsx:7-18,20-34`）。Users child 自己才声明 `userListQueryOptions` prefetch（`routes/_app/_admin/system.users.tsx:11-28`）。当前真实栈断言证明最终渲染父级 forbidden surface（`auth-session-real-stack.spec.ts:43-46`）；现有 collector 没有记录 phase，也没有独立记录 Users GET，故不把“child loader 必然未运行”升级为本研究的运行时事实。
5. 对照 fixture Auth 测试，流程同样在 Workbench 后 `page.goto('/system/users')`，但 Workbench fixture 是本地立即 fulfill；该 suite 通过不能排除真实 backend aggregate 仍在途时被导航取消（`auth-session.spec.ts:139-153`）。

### 6. System → logout 的静态链路

1. Forbidden surface 仍位于 `_app` 的 `AppShell` 内，因此账户菜单可用（`routes/_app/route.tsx:25-29`；`auth-session-real-stack.spec.ts:44-49`）。
2. 菜单 handler `await auth.signOut()`；失败只显示当前页面错误，不伪造退出成功（`app-shell.tsx:242-249,251-274`）。
3. logout mutation 先使用 canonical CSRF POST `/auth/logout`；只有 HTTP 成功才进入 `onSuccess`（`auth-provider.tsx:68-80`）。
4. `onSuccess` 的顺序固定为：

```text
clearBusinessQueries(queryClient)                auth-provider.tsx:77
queryClient.setQueryData(['auth','session'], null) auth-provider.tsx:78
```

   因此上一身份业务 cache 在 auth session 变匿名前已同步移除；不能通过延迟清理交换这个数据隔离顺序。
5. session 写 null 后 `AuthProvider` rerender；`AppRouter` effect 观察 authenticated → anonymous 并调用 `router.invalidate()`（`providers.tsx:13-19`），共同 `_app` 边界同时具备匿名 `<Navigate>` / redirect（`routes/_app/route.tsx:7-13,18-23`），最终回 `/login`。
6. 若 logout 发生时某个 business Query 仍在当前 document 内 active / in-flight，`clearBusinessQueries` 会对它执行本文件第 3.1 节的 destroy + cache removal。但在当前真实栈脚本中，System 是通过 `page.goto` 建立的新 document；静态代码没有证明这个新 QueryClient 中存在 Workbench query。现有 requestfailed collector 又没有 phase，故仍不能仅凭失败字符串把 observed Workbench event 归给 logout。

### 7. 当前证据可以确定的事实

- Workbench route loader 是 fire-and-forget prefetch，页面与它共享同 key / 同在途 Promise，不产生第二个 Workbench GET。
- “工作台”标题可见不证明 aggregate 成功；真实栈随后立即硬导航，存在明确的在途窗口。
- Workbench 和 System Users query 都未消费 Query `AbortSignal`；普通 component unmount 不会由 TanStack 中止当前 transport。
- `removeQueries` 会 destroy Query、cancel Retryer 并同步删除 cache；它能满足跨身份 cache 清理，但当前 queryFn 形状不能保证网络 transport 中止。
- logout 成功后，business cache 清理先于 auth session 写 null；随后 Router invalidate / protected route 回登录页。
- 当前真实栈 collector 只保留 `method + pathname`，没有记录 `request.failure()?.errorText` 或 lifecycle phase（`auth-session-real-stack.spec.ts:21-27`）。
- 归档 A26 证据只证明最终数组包含 `requestfailed: GET /api/v1/workbench`，没有保存可用于 owner 决策的时点或 errorText（归档 `research/audit.md:53`）。

### 8. 当前证据不能确定的事实

- 不能确定已观察到的 Workbench `requestfailed` 发生在首次改密后的第一次 `/`、`page.goto('/system/users')`、logout，还是事件投递的其他时间点。
- 不能确定 `request.failure().errorText` 是否为 `net::ERR_ABORTED`；现有 collector 根本没有读取该值。
- 不能确定真实栈运行中 Workbench response 在“工作台”标题断言前还是后完成。
- 不能据现有证据确认唯一 root owner 是 production Auth/query lifecycle 还是 real-stack runtime collector。
- 不能安全添加“忽略所有 `ERR_ABORTED`”或“忽略所有 Workbench GET”的规则；真实 DNS、连接、协议、服务退出等错误仍可能表现为 requestfailed，必须保留 method + pathname + exact errorText + phase 的窄决策门。
- 本研究没有启动真实栈，未产生新的 Playwright `requestfailed` 证据，也没有检查浏览器 timing / CDP network event。

### 9. 对规划阶段的直接约束（不预设 owner）

- 第一实施阶段仍需按用户要求做一次定向、安全诊断：phase label 必须在进入 `/`、调用 `page.goto('/system/users')`、打开 logout 菜单、触发 logout 前后更新；失败记录只含 phase、method、pathname、`request.failure()?.errorText`。
- 在拿到该证据前，不应修改 `auth-provider.tsx`、`workbench.api.ts` 或添加 requestfailed filter。
- 如果实际事件属于硬导航中旧 document 的精确 `GET /api/v1/workbench` + 精确 `net::ERR_ABORTED`，production Query signal 改造并不能阻止 document teardown，owner 决策应回到 phase-aware collector 边界。
- 如果实际事件由同 document 中 `clearBusinessQueries` / Query lifecycle 触发且行为不符合数据隔离或请求合同，再评估 production 最小修正；不得把 `cancelQueries` + `removeQueries` 机械叠加成两套清理，因为 `removeQueries` 已经 destroy / cancel Query。
- 不建立通用 cancellation framework；当前 blocker 只有一个 observed endpoint 和一个现有 Auth collector，先让真实证据选择最小 owner。

## Code Patterns

### 现有正确 pattern：跨身份先删业务 cache，再写 session

```ts
clearBusinessQueries(queryClient);
queryClient.setQueryData(authSessionQueryKey, null);
```

证据：`frontend-v2/src/app/auth/auth-provider.tsx:76-79`。该顺序保护上一身份数据，不应为消除测试噪声而延迟。

### 当前 Workbench pattern：loader 与 page 共享 query，但不消费 signal

```ts
void context.queryClient.prefetchQuery(options);
const aggregate = useQuery(workbenchQueryOptions());
```

证据：`frontend-v2/src/routes/_app/index.tsx:8-12`；`frontend-v2/src/domains/workbench/workbench-page.tsx:22-24`。共享 query 是正确的最小 server-state owner；取消缺口必须先由真实 phase 证据证明，不从“没有 signal”自动推导 production bug。

### 当前测试 gap：错误事件缺少 phase 与 errorText

```ts
if (!noContentAuthPost) runtimeErrors.push(`requestfailed: ${request.method()} ${pathname}`);
```

证据：`frontend-v2/tests/e2e/auth-session-real-stack.spec.ts:21-27`。它能发现失败 endpoint，但无法区分导航取消与真实网络错误。

## External References

- 本地锁定 `@tanstack/query-core@5.101.4` / `@tanstack/react-query@5.101.4`；package repository 指向 `https://github.com/TanStack/query`。本研究以随安装包提供的 `src/` 为当前 patch 权威。
- TanStack 官方 QueryClient reference：`https://tanstack.com/query/latest/docs/reference/QueryClient`。它确认 `cancelQueries` 用于取消匹配 query、`removeQueries` 用于从 cache 删除匹配 query；但 latest 页面当前返回合同与本地 `5.101.4` 类型存在差异，因此只作概念交叉检查。
- TanStack 官方 Query Cancellation guide：`https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation`。官方语义同样要求 query function 消费提供的 `AbortSignal`，transport 才能响应取消。
- 本地锁定 `openapi-fetch@0.17.0`；package repository 指向 `https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-fetch`。本地 `FetchOptions` / 实现证明无需新增依赖即可传原生 `AbortSignal`；是否应传由诊断后的 owner 决策决定。

## Related Specs

- `.trellis/spec/frontend/state-management.md:19-38`：TanStack Query 是 server state owner；不得新增第二全局状态源。
- `.trellis/spec/frontend/quality-guidelines.md` 中“V1/V2 根质量入口与 V2 Foundation Smoke”：未知 `requestfailed` 必须失败，只允许有精确原因的已知 aborted 路径。
- `.trellis/spec/infra/e2e-isolation.md:20-40,42-78`：真实栈定向 spec、production preview、secret 与 cleanup 合同。
- `frontend-v2/AGENTS.md`“状态所有权”：server state 归 TanStack Query；Route 只负责 loader / permission / composition。
- `docs/frontend-v2/01-technical-architecture.md:74-88`：aggregate / server state 归 TanStack Query，URL / local state 不应混入 Query。
- `docs/frontend-v2/07-migration-plan.md:500-506`：Phase 8 首页只消费专用 aggregate，不从分页 endpoint 拼装。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:364-376,386-392`：Auth canonical session、退出 cache 清理、Workbench real-stack 与敏感失败输出边界。
- Phase 8 abstraction review `research/audit.md:53`：A26 必须先确认时点和 errorText，不能笼统忽略 Workbench GET。

## Caveats / Not Found

- 本研究开始时 Task PRD 尚未收敛；当前最终 `prd.md` 已吸收用户正式要求、父任务和 A26 归档 finding，仍等待用户批准后才能进入诊断实施。
- 没有读取或修改 `implement.jsonl` / `check.jsonl`；符合 Trellis research role isolation。
- 没有修改产品代码、spec、docs、测试或归档任务；唯一写入是本研究文件。
- 没有运行 Git 命令、测试、build、浏览器或真实栈。
- 没有证明 observed event 的 phase / errorText / owner；这些仍是本 blocker 第一诊断阶段的停止门。
