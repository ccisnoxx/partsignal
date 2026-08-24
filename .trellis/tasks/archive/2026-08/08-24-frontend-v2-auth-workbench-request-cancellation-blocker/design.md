# Frontend V2 Auth Workbench Request Cancellation Blocker — 技术设计

## 1. 当前设计结论

Phase A 已取得唯一运行时失败四元组：`navigate-to-system-users + GET + /api/v1/workbench + net::ERR_ABORTED`。真实登录、首次改密、System 403、logout 204 与最终 `/login` 流程均通过，证据确认硬导航取消旧 document 的在途 Workbench GET 是唯一 owner；没有证据支持修改 production Auth/query lifecycle。

用户再次确认后，Phase B1 已按候选设计实施：当前 spec 仅识别上述四项同时匹配的取消事件；403 断言后重新进入 `/`，精确等待 `GET /api/v1/workbench`、断言 HTTP 200 和只存在于成功态的“需要处理”二级标题，再执行 logout。没有修改 production、共享 helper 或其他测试。

## 2. 实际调用链

```text
login route
  -> Auth signIn 写入 canonical auth session
  -> must_change_password=true，navigate('/account/security')
  -> changePassword 调用真实 204 endpoint
  -> loadAuthSession 重读 auth/me + auth/csrf
  -> session cache 写入 must_change_password=false
  -> account/security effect navigate('/')
  -> /_app beforeLoad 读取同一 auth cache
  -> Workbench loader fire-and-forget prefetch aggregate
  -> WorkbenchPage useQuery 观察同一 query
  -> heading 可见
  -> Playwright page.goto('/system/users')（整页导航）
  -> ENGINEER admin boundary 显示 403
  -> account menu logout POST 204
  -> clearBusinessQueries(removeQueries 非 auth query)
  -> auth session cache = null
  -> AppRouter invalidate
  -> /_app redirect('/login')
```

关键竞态：Workbench heading 是同步页面结构；它不证明 aggregate fetch 已 resolve。`page.goto` 会替换 document，可能由 Chromium 中止旧 document 的在途请求。

## 3. TanStack Query 5.101.4 语义边界

- `removeQueries` 经 QueryCache `remove()` 调用 `query.destroy()`；destroy 以 `{ silent: true }` cancel retryer。
- `cancelQueries` 对匹配 query 调用 `query.cancel({ revert: true })` 并吞掉 cancellation promise 的 rejection。
- Query cancel 会 abort 内部 controller；只有 queryFn 读取 context `signal` 并把它交给 transport，该 controller 才能中止真实 fetch。
- 当前 Workbench queryFn 直接调用 `api.GET`，未读取/传递 signal。因此不能把 observed browser `requestfailed` 预判为 QueryClient 清理产生的 transport abort。
- 这些语义只用于缩小诊断假设；浏览器事件的 phase/errorText 仍以真实运行证据为准。

## 4. 安全诊断设计

在 `auth-session-real-stack.spec.ts` 内保留局部 phase 字符串，至少区分：

1. `forced-password-change`
2. `workbench`
3. `navigate-to-system-users`
4. `system-forbidden`
5. `logout`
6. `logged-out`

`requestfailed` 只保存：

```text
phase=<label> method=<method> pathname=<pathname> errorText=<errorText>
```

不保存 `request.url()` 原值。诊断运行仍由现有 `expectSecretsAbsent` 和 e2e-local cleanup 负责产物与环境边界。收集一次足以归因的结果后停止，不开启 trace/video。

当前 instrument 已按此设计落入 `auth-session-real-stack.spec.ts`。首次命令只证明 runner 在必填连接变量校验处 fail-fast；第二次命令只证明项目默认 Redis DB 0 不适用于 E2E 隔离。

最终诊断先依据项目 Compose 的权威宿主机映射建立连接，再只读检查 DB 1–13 并选择满足 `DBSIZE=0`、外部客户端数为 0、preflight 通过的 DB 7，避开 14/15。真实栈只运行一次，取得唯一四元组 `navigate-to-system-users + GET + /api/v1/workbench + net::ERR_ABORTED`；严格 collector 之外的 UI、服务端、敏感信息扫描与资源清理均通过。

## 5. 诊断后决策门

### 5.1 Test collector owner

仅当真实证据满足全部条件时采用：

- event phase 是明确包围的导航或 logout 生命周期；
- method=`GET`；
- pathname=`/api/v1/workbench`；
- `errorText` 精确等于观察到的预期 cancellation（预期候选为 `net::ERR_ABORTED`）；
- 同一流程的服务端响应、页面状态和后续 `/login` 断言证明不是 HTTP/业务失败。

最终 collector 只排除这四项同时匹配的事件；其他失败照常进入 `runtimeErrors`。不新增 helper，因为当前只有一个真实消费者。

`requestfailed` 只表示网络层失败，不表示 HTTP 4xx/5xx。最终验证还必须保留 Workbench 成功数据/响应与 Auth 页面结果断言；若现有 heading 不能区分 loading/error/success，仅增加一个 spec-local、endpoint 精确的成功响应或成功内容断言，不建立通用 response audit。

Phase A 已满足以上全部判定条件，因此该方案成为唯一候选 owner。此结论只批准设计收敛，不构成实施授权。

Phase B1 已获得用户确认并完成。实现没有新增 helper：`requestfailed` handler 直接比较 phase、method、pathname 与 errorText；只有四项全部匹配才不进入 `runtimeErrors`。首次导航取消路径保留，随后独立的真实 Workbench 200 与成功态内容断言避免 cancellation 识别掩盖 HTTP/loading/error 失败。

既有 change-password/logout 两个 204 Auth POST 的 endpoint-local 识别保持原样；它不是本次新增，也没有被扩大。B1 新增的 Workbench 识别不能复用该豁免或退化为 Auth/no-content、`ERR_ABORTED`、endpoint 或 phase 任一维度的宽泛过滤。

### 5.2 Production Auth/query owner

若事件发生在错误的 query/session 顺序，或 production 主动取消语义与身份缓存清理不一致：

- 修改 `auth-provider.tsx` 的唯一清理 owner；
- 以 `auth-provider.test.tsx` 证明 active/in-flight business query 的处理、auth cache 次序和上一身份数据不可见；
- 必要时才修改直接相关 query transport 的 signal 传递，不能把 cancellation framework 扩到所有 domain；
- 不通过延迟清理、保留旧 cache 或静默 fallback 避免事件。

### 5.3 无法唯一归因

保留诊断证据，撤销临时 instrument，A26 继续 open；不修改 collector 或 production。

## 6. 精确文件范围

诊断必改：

- `frontend-v2/tests/e2e/auth-session-real-stack.spec.ts`
- 本 Task `research/audit.md`、`design.md`、`implement.md`

最终 test-owner 候选只改：

- `frontend-v2/tests/e2e/auth-session-real-stack.spec.ts`

最终 production-owner 候选最多改：

- `frontend-v2/src/app/auth/auth-provider.tsx`
- `frontend-v2/src/app/auth/auth-provider.test.tsx`
- 只有运行证据与本地 API 证明必须传递 signal 时，才加入直接发起该请求的 query owner；在第二次用户批准前不得加入。

## 7. 回滚与兼容

- 诊断 instrument 与最终改动均只反向应用确切 hunks，不使用 reset、checkout 或历史改写。
- 若定向诊断未唯一归因，移除 instrument 后停止；产品与严格 collector 保持原状。
- 不改变 API、数据库、V1、Workbench aggregate/canonical href 或 Phase 8 gate 文档。
- 临时 instrument 已收敛为获批的 spec-local 四元组识别；当前改动保留在授权分支上供审查，尚未提交。
- Phase A 已用只读校验确认 DB 7 当时空闲，并在 finally 中完成清理；该编号不是持久保留配置，后续运行仍须重新验证独占性。
