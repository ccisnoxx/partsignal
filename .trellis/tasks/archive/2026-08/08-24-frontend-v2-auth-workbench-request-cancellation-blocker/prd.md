# Frontend V2 Auth Workbench Request Cancellation Blocker

## 1. 目标

只关闭 Workbench abstraction review finding A26：安全确认 Auth 真实栈中 `GET /api/v1/workbench` 的 `requestfailed` 发生时点、`request.failure().errorText` 与唯一 owner，并在保留严格运行时错误审计和身份缓存隔离的前提下实施最小修复。

## 2. 背景与已确认事实

- 父 Task：`.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/`。
- A25 已由归档 Task `08-24-frontend-v2-workbench-root-fixture-convergence-blocker` 关闭；当前 Phase 8 唯一开放 P1 是 A26，Exit Gate 仍为 `NOT_MET`。
- abstraction review 的唯一观察值是 `requestfailed: GET /api/v1/workbench`；当次测试未记录 `errorText` 或 phase，因此不能从归档日志判断事件发生在离开 Workbench 还是 logout。
- `auth-session-real-stack.spec.ts` 在首次改密后进入 `/`，随后用 `page.goto('/system/users')` 做整页导航，再从 System 403 页面触发 logout。
- Workbench route loader 会 fire-and-forget `prefetchQuery`；页面以同一 query options 调用 `useQuery`。页面 heading 可见不等于 aggregate GET 已完成。
- logout 成功后 `AuthProvider` 同步 `removeQueries` 全部非 auth query，再把 auth session 写为 `null`；`AppRouter` 观察到身份从非空变空后 invalidate Router，受保护路由回到 `/login`。
- 本地安装 `@tanstack/react-query/@tanstack/query-core` 均为 `5.101.4`。`removeQueries` 会 destroy query，`destroy()` 会 silent cancel retryer；`cancelQueries` 默认 `revert: true`。底层 fetch 只有在 queryFn 消费并传递 `AbortSignal` 时才会被 TanStack 的 abort controller 中止；当前 Workbench queryFn 未读取 query context 的 `signal`。
- 上述静态事实使“`page.goto` 导航取消”更可能，但不能替代真实浏览器时点与 `errorText` 证据。

## 3. Requirements

### R1. 单次安全诊断

- 规划批准并启动 Task 后，只在 `auth-session-real-stack.spec.ts` 增加临时 phase 标记和脱敏失败记录。
- 诊断只记录 `phase`、HTTP method、URL pathname 与 `request.failure()?.errorText`；不得记录完整 URL、query、headers、body、Cookie、CSRF、密码或 storage state。
- 只运行一次指定真实栈 spec；保留 production preview、真实 FastAPI/PostgreSQL、secret scan 与 database/Redis/storage/process/port cleanup。
- 证据写入 `research/audit.md` 和 `design.md` 后立即停止，向用户报告并等待 owner/方案确认。

### R2. 唯一 owner 与最小修复

- 若事件只在明确的导航或 logout phase 中发生，且 method/path/errorText 精确为经验证的预期生命周期取消，可在 real-stack collector 仅识别该四元组。
- 不得忽略所有 `net::ERR_ABORTED`、所有 Workbench GET、所有导航期失败或所有 Auth no-content 请求；既有两个 204 Auth POST 的 endpoint-local 识别保持不变，B1 不得新增或扩大它。
- 若证据指向错误的 production Auth/query lifecycle，只在其权威 owner 做根因修复，并增加 `auth-provider.test.tsx` 回归；修改前继续以本地 5.101.4 类型/源码为 API 依据。
- 若证据不能唯一归因，保持 A26 开放并停止，不以 catch/filter 让 gate 变绿。

### R3. 行为与安全保持

- logout 必须继续调用真实服务端 endpoint，携带 canonical CSRF，清理上一身份全部业务 query，并把 session 置空后回到 `/login`。
- login、首次改密、ENGINEER 访问 admin route 的真实 403、cookie/session 与最终 logout 断言保持。
- `console.error`、`pageerror`、非预期 `requestfailed`、错误状态、非预期 endpoint、method、phase 或 `errorText` 仍使测试失败。
- Playwright 的 `requestfailed` 不覆盖 HTTP 4xx/5xx；最终测试必须继续通过真实页面/响应结果证明 Workbench 与 Auth endpoint 没有错误状态，不能把窄 cancellation 识别冒充 HTTP 状态审计。
- trace 保持关闭；不启用 video/storage state，不增加共享 cancellation/filter framework。

## 4. Acceptance Criteria

- [x] 一次定向诊断记录到唯一 `phase + method + pathname + errorText`，且输出和产物通过 secret scan。
- [x] `research/audit.md` 与 `design.md` 明确区分静态事实、运行时证据和唯一 owner。
- [x] 用户在诊断结果后明确批准 production owner 或 test collector owner 的最小方案。
- [x] 仅经证明的生命周期取消被窄识别；任一真实网络错误或其他四元组继续失败。
- [x] Auth login → forced change → Workbench → System 403 → logout → `/login` 真实流程通过。
- [x] 上一身份业务缓存清理、服务端 logout、cookie、CSRF 与 Router 跳转语义未削弱。
- [x] Required Validation 全部通过，并保存 secret scan 与精确 cleanup 证据。
- [x] 未修改 backend、OpenAPI、generated types、数据库、旧 frontend、Workbench aggregate/UI/canonical href 或 Phase 8 完成状态。

## 5. Out of Scope

- A25、Phase 8 最终 recheck/`MET`、`make verify`、完整 `make e2e` 与 Phase 9。
- 通用 Query cancellation、Auth cleanup、Playwright runtime-error filter 或 shared test helper framework。
- Workbench aggregate/read-model/UI/业务合同/canonical href、其他真实栈 spec、backend、contracts、generated types、数据库、部署协议和旧 frontend。只有 production 证据证明 transport signal 是根因时，才在第二次批准后加入 `workbench.api.ts` 的最小 queryFn 变更。
- pull、push、PR、Git 历史改写或未获批准的额外重构。
