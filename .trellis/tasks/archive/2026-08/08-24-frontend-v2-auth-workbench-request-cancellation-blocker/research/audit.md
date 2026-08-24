# A26 Auth / Workbench Request Cancellation 静态审计

## 1. 当前结论

Phase A 已取得唯一运行时失败证据：`navigate-to-system-users + GET + /api/v1/workbench + net::ERR_ABORTED`。真实登录、首次改密、System 403、logout 204 与最终 `/login` 流程均通过，证据确认 owner 是硬导航取消旧 document 的在途 Workbench GET，而不是 logout 的 QueryClient 清理或服务端业务失败。

用户再次确认后，A26 已按 test collector owner 实施并完成 Required Validation；当前状态为 resolved pending commit/archive。Phase 8 Exit Gate 未在本 Task 重跑，仍保持 `NOT_MET`。

## 2. 归档证据

- abstraction review `research/audit.md:53`：A26 仅记录 `requestfailed: GET /api/v1/workbench`，明确要求独立 Task 先确认时点和 errorText。
- 同文档 `:130-145`：`make e2e` 为 V2 real-stack `15 passed, 1 failed`，数据库/storage/Redis/ports cleanup 完整；A25/A26 使 Phase 8=`NOT_MET`。
- A25 归档 audit `:113-121`：A26 未被 fixture 修复触碰，禁止笼统忽略 `ERR_ABORTED` 或 Workbench GET。

## 3. Auth → Workbench → System → logout 静态链

- `auth-provider.tsx:109-119`：login 成功先清业务 cache，再写 canonical auth session。
- `routes/login.tsx:22-27`：按服务端 `must_change_password` 进入 security 或 `/`。
- `auth-provider.tsx:121-132`：改密 204 后重读 auth/me + auth/csrf，并写回 canonical session。
- `routes/account/security.tsx:17-22`：刷新后的 user 解除 must-change 时 navigate `/`。
- `routes/_app/index.tsx:8-12`：根 loader 在 query 不存在时 fire-and-forget prefetch。
- `workbench-page.tsx:18-36`：页面对同一 query 使用 `useQuery`；heading 在 pending UI 也存在。
- `auth-session-real-stack.spec.ts:41-50`：heading 可见后 `page.goto('/system/users')`，再点击 logout。
- `auth-provider.tsx:68-79`：logout 204 后 remove 非 auth query，再把 auth session 设为 null。
- `providers.tsx:15-19`：非空 user 变 null 后 Router invalidate。

## 4. TanStack / transport 证据

- `frontend-v2/package.json` 与 installed package：React Query / Query Core `5.101.4`。
- query-core `queryCache.ts:143-156`：remove 会 destroy query 并从 cache 删除。
- query-core `query.ts:253-263`：destroy 使用 silent cancel。
- query-core `queryClient.ts:274-289`：cancelQueries 默认 revert 并等待匹配 query cancellation。
- query-core `query.ts:447-480,531-548`：内部 AbortSignal 只有被 queryFn 读取并交给 transport 才影响真实 fetch。
- `workbench.api.ts:8-19`：queryFn 未消费 context signal，直接调用 `api.GET`。

因此，不能把 observed browser event 静态归因于 `removeQueries`；也不能仅凭 page.goto 顺序认定它一定是正常取消。

## 5. E2E 与敏感信息边界

- `auth-session-real-stack.spec.ts:10-12` 已关闭 trace，finally 使用 `expectSecretsAbsent` 扫描初始/新密码。
- `deploy/scripts/e2e-local.sh` 使用 production build/preview、真实数据库/API/Redis/storage，并在 EXIT trap 中精确清理。
- `.trellis/spec/infra/e2e-isolation.md:25-43` 要求定向 spec 复用同一隔离生命周期，Playwright failure 只记录 method/pathname；不得回显完整 URL、query 或 credential。

## 6. 已关闭的证据缺口

1. 唯一 `requestfailed` 发生在 `navigate-to-system-users` phase。
2. 精确四元组为 `GET /api/v1/workbench`、`errorText=net::ERR_ABORTED`。
3. 同一次运行只有这一条 runtime failure，严格 collector 的最终断言因此失败。
4. 真实登录、首次改密、auth session/CSRF 重读、System 403、logout 204 与最终 `/login` 断言全部通过；没有 HTTP 或业务失败证据。
5. 最终 owner 是 test collector：硬导航替换旧 document 时取消仍在途的 Workbench GET。没有证据支持修改 production Auth/query lifecycle。

## 7. Phase A 定向诊断执行结果（2026-08-24）

已按批准范围在 `auth-session-real-stack.spec.ts` 增加 spec-local phase 与脱敏 `method/pathname/errorText` 记录；没有增加 ignore/filter，也没有修改 production。随后仅执行一次：

```bash
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/auth-session-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh
```

结果：命令在 `deploy/scripts/e2e-local.sh:4` 的参数校验阶段以 exit code `1` 结束，当前 shell 未设置必填 `DATABASE_URL`。脚本尚未计算 root/资源变量，未进入 environment preflight、`mktemp`、cleanup trap、数据库创建、Redis 检查、服务启动、production build 或 Playwright，因此：

- 没有 phase/method/pathname/errorText 运行时证据；
- 没有测试结果或 `expectSecretsAbsent` 结果；
- 没有创建 database、Redis state、storage、进程或监听端口；
- 因资源尚未创建，本次没有 cleanup status 输出，也没有遗留资源需要清理；
- 脚本在第一个必填变量处停止，`REDIS_URL` 是否已配置未被本次命令验证。

按 `implement.md` 的停止条件，代码/环境未变化时没有重跑同一失败命令。A26 仍为 open，production owner 与 test collector owner 都未确认；不得实施 production 修复或 cancellation filter。

### 用户授权后的单次环境重试

用户随后明确授权从项目现有配置中仅加载 `DATABASE_URL` 与 `REDIS_URL`，不输出或回显值。重试使用 backend venv 的 dotenv 解析能力，只把这两个键复制到子进程环境；两键均存在，未从 `.env` 加载其他配置。

同一定向命令只重试一次，随后在 `e2e-environment.py` preflight 以 exit code `1` 停止：配置中的 Redis URL 使用 logical DB 0，而 E2E 隔离合同强制使用非 0 独占 logical DB。该失败发生在 `mktemp`、cleanup trap、E2E database 和服务进程创建之前，因此仍然：

- 没有启动真实栈或 Playwright，没有 phase/errorText；
- 没有测试或 `expectSecretsAbsent` 结果；
- 没有创建 database、Redis state、storage、进程或端口资源，无 cleanup status；
- 没有改写 Redis URL、选择猜测的 logical DB 或再次重跑。

环境停止条件再次成立。A26 保持 open，临时 instrument 保留在授权分支；下一步需要用户明确提供或授权一个已确认空闲、非 0、独占的 Redis logical DB，不能由本任务自行猜测。

### 已验证空闲 logical DB 后的 Phase A 运行

用户指出可由任务自行寻找空闲非 0 logical DB 后，本轮没有盲选编号：先从项目 Compose 配置读取权威宿主机端口映射，再只读检查候选 DB 1–13，避开项目已占用的 14/15。DB 7 同时满足 `DBSIZE=0`、外部客户端数为 0，并通过现有 `e2e-environment.py` preflight；连接值未输出，也未改写项目配置。

随后仅执行一次批准的定向真实栈诊断。唯一运行时失败为：

```text
phase=navigate-to-system-users method=GET pathname=/api/v1/workbench errorText=net::ERR_ABORTED
```

结果与边界：

- Playwright 为 `1 failed`（907ms），唯一失败来自严格 `runtimeErrors` 最终断言；没有增加 cancellation filter。
- anonymous auth、login 200、change-password 204、session/CSRF 重读、System 403 页面与焦点、logout 204、最终 `/login` 断言均通过。
- `expectSecretsAbsent` 完成，没有新增失败或 secret 命中。
- cleanup 完整：DB 7 状态为 `deleted`，监听端口均为 `released`，临时数据库为 `dropped`，storage 为 `removed`；服务进程与 worker 均正常退出。
- 未运行 typecheck/lint，未提交，也未修改 production。

Phase A 至此完成并停止。证据满足 test collector owner 的决策门；候选修复只能在再次批准后，于本 spec 内按上述四元组做窄识别，并补足 Workbench 成功响应或内容断言。A26 在修复和验证完成前继续保持 open。

## 8. Phase B1 实施与验证结果（2026-08-24）

用户再次确认 test collector owner 后，仅修改 `auth-session-real-stack.spec.ts`：

- `requestfailed` 只有在 `phase=navigate-to-system-users`、method=`GET`、pathname=`/api/v1/workbench`、errorText=`net::ERR_ABORTED` 四项同时匹配时识别为已证实的导航取消。
- 其他 phase、method、pathname、errorText 组合以及 `console.error`、`pageerror` 继续进入 `runtimeErrors`。
- 首次 `/` → `/system/users` 的取消路径保持；System 403 与焦点断言后重新进入 `/`，精确等待 Workbench GET，断言 HTTP 200 与成功态“需要处理”，再执行 logout。
- 既有 change-password/logout 两个 204 Auth POST 的 endpoint-local 识别保持原样；B1 未新增或扩大该豁免。

Required Validation：

- 定向真实栈：`1 passed (1.6s)`；真实 login 200、change-password/logout 204、System 403、Workbench GET 200 与最终 `/login` 均通过。
- `expectSecretsAbsent` 无命中或附加失败；trace 保持关闭。
- cleanup：Redis DB 7 `status=deleted`、全部监听端口 `status=released`、临时数据库 `status=dropped`、storage `status=removed`；Uvicorn 与 worker 正常退出。
- `npm --prefix frontend-v2 run typecheck`：通过。
- `npm --prefix frontend-v2 run lint`：通过。
- `git diff --check`：通过。
- `task.py validate`：通过。
- 独立 Trellis quality check：B1 代码无 finding、未产生 reviewer edit。

没有修改 production、backend、合同、数据库 schema、旧 frontend、Workbench aggregate/UI、共享 helper 或其他测试。完整 `make e2e`、`make verify` 与 Phase 8 recheck 按既定范围留给所有 blocker 关闭后的独立 gate；因此本 Task 的修复已验证，但 Phase 8 完成状态未改变。
