# Frontend V2 System Admin E2E

## 状态

- Trellis 状态：`planning`。
- 当前结论：**BLOCKED**。独立 `frontend-v2-auth-session-ui` 实现候选与 Required validation 已通过，但尚未提交归档；本 Task 继续等待其归档后重新审计与单独实施批准。
- 本轮只完成审计和规划；未运行 `task.py start`，未创建分支，未修改产品代码。

## 目标

在既有唯一隔离真实栈中，为 `/system/users` 与 `/system/audit` 增加一个 desktop Playwright 场景，使用真实临时 PostgreSQL、真实 FastAPI、真实 V2 production build/preview、真实 cookie session 与 CSRF，证明：

1. ADMIN/ENGINEER 的服务端权限边界；
2. 用户创建、首次改密、重置密码、会话撤销、revision 与批量 partial success；
3. Users mutation 的 Request ID 到 Audit List/Detail 的真实追踪；
4. 临时密码不进入安全响应、审计投影、DOM、浏览器输出或测试产物；
5. 测试失败或成功后，既有 owner 精确清理本次数据库、Redis key、临时存储、进程、context 和固定端口。

本 Task 只补真实栈证据和最小编排接入，不新增产品能力。

## 已验证基线

- `frontend-v2-system-users` 与 `frontend-v2-system-audit` 已归档并合入 `main`；两套 strict fixture E2E 已覆盖页面状态、响应式和交互合同。
- Users 后端已统一实现 revision、最后管理员不变量、批量逐项预期失败、状态变更会话撤销、重置密码撤销全部目标会话以及删除历史约束。
- Audit 后端已实现 ADMIN-only List/Options/Detail、列表元数据与安全 Detail 投影；`AuditLog.actor_id` 在用户删除时 `SET NULL`，审计历史保留。
- `deploy/scripts/e2e-local.sh` 已拥有唯一的临时数据库、migration/seed、FastAPI、V2 production preview、进程和存储 cleanup 生命周期；Playwright real-stack 模式统一关闭 trace。
- seed ADMIN 可直接使用；新建用户固定 `must_change_password=true`，服务端只允许其访问 `auth/me`、`auth/csrf`、`auth/change-password` 和 `auth/logout`，因此首次改密是不可绕过的真实状态。

## 前置 blocker（实现候选待归档）

### 原始症状

规划审计时 V2 route tree 没有 `/login` 或 `/account/security`；`AuthProvider` 只读取当前 cookie session 并支持退出，Account Menu 也只有退出入口。因此当时匿名用户无法经 V2 UI 建立 cookie session，新建的 `must_change_password=true` 用户也无法经 V2 UI 完成首次改密。当前 Auth 实现候选已关闭该产品缺口，待提交归档后再作为本 Task 基线重新审计。

### Root owner

V2 Auth/Router 产品能力，而不是 Users、Audit、FastAPI identity contract 或 E2E orchestration。

### 影响

若在本测试中直接用 `page.request.post('/auth/login')` 并再直接调用 `auth/change-password`，会绕过“真实登录流程 + 真实 UI 首次改密”的明确验收目标；若在本 Task 补页面，则会静默扩大到产品能力、路由、AuthProvider 和状态流转，违反范围。

### 解除条件

独立 blocker Task（建议名：`frontend-v2-auth-session-ui`）交付并归档以下能力后，本 Task 重新审计其真实路由和状态行为，再请求实现批准：

- `/login` 通过现有 Auth contract 建立 cookie session；
- `must_change_password=true` 会进入 `/account/security`，不能访问业务页面；
- `/account/security` 通过真实 CSRF 调用 `auth/change-password` 并刷新 canonical session；
- 普通已登录用户可从账户入口进入自助改密；
- 不新增测试绕过、第二权限判断或兼容字段。

该 blocker 已按用户授权单独实施并通过 Required validation，当前等待提交归档；本 Task 不实施它，也不会在 blocker 归档前开始 E2E 实现。

## 功能要求

### ADMIN 与真实用户生命周期

- ADMIN 必须通过 V2 登录 UI 建立自己的 cookie session，然后访问 `/system/users` 和 `/system/audit`。
- ADMIN 必须通过 Users UI 创建本次运行唯一的 ENGINEER；用户名、显示名和测试 identity 使用随机后缀。
- 创建、重置、批量停用、删除均由 V2 UI 发起；测试只从浏览器响应读取安全 response body、status 与 `X-Request-ID`，不得读取或记录 request body。
- 新 ENGINEER 必须在独立 BrowserContext 中通过 V2 登录 UI 使用临时密码，并在 `/account/security` 完成首次改密。
- ADMIN 重置该用户密码时必须提交页面当前 canonical revision；重置后 ENGINEER 原 context 的下一次受保护请求必须返回 `401 AUTH_REQUIRED`。
- 批量停用必须从当前 Users Table 选择新 ENGINEER 与 seed ADMIN，并使用各自行上当前 revision：新 ENGINEER 成功，唯一有效 ADMIN 返回 `LAST_ADMIN_REQUIRED`，UI 显示 `1 succeeded / 1 failed`，ADMIN session 与状态继续有效。
- 批量成功后，ADMIN 通过 V2 UI 删除已停用的新 ENGINEER；删除后其既有审计仍可读取，原 ENGINEER actor 投影为空/已删除用户语义。

### ENGINEER 权限

- ENGINEER 登录且首次改密完成后看不到 System 导航。
- 直接访问 `/system/users`、`/system/audit` 均保留 URL 并把焦点置于 403 区域。
- ENGINEER 自己的真实 cookie context 必须直接请求以下端点并逐一得到服务端 403：
  - Users List；
  - Users Bulk Status（带真实 CSRF）；
  - Users Export；
  - Audit List；
  - Audit Filter Options；
  - Audit Detail。
- 前端隐藏入口只作为 UX 证据；任何 API 403 都不得由 route interception、fixture 或客户端判断制造。

### Audit 与 Request ID

- 分别安全捕获 create、reset、bulk mutation response 的 `X-Request-ID`，不捕获 request body、cookie 或 storage state。
- 通过 `/system/audit` 的 Request ID 服务端筛选定位真实 `user.created`、`user.password_reset` 和 bulk success 的 `user.updated`；失败的最后管理员项不得伪造成功审计。
- 至少对 `user.created` 建立完整证据链：mutation response Request ID → Audit URL/filter → 七列表格同一 Request ID → 点击行才发出唯一 Detail GET → Detail 同一 audit id/request id/target。
- Audit Table 保持七列且无操作列；List 中的 actor/module/action/target/outcome/request ID 来自真实数据库记录。
- Detail 只接受合同允许的 changes/facts/result/error/related 投影，不显示 raw `change_summary`、临时密码或未知字段。

### 敏感信息

- 不输出 admin、ENGINEER、temporary password 或首次改密后的密码。
- 密码只存在测试进程内存和真实请求中；不写入 console、附件名、截图名、异常消息、URL、local/session storage、测试 metadata 或持久文件。
- real-stack trace 继续由 Playwright config 统一关闭；不启用 video，不捕获 request body，不导出 storage state。
- 断言两个测试密码 sentinel 均不出现在创建/重置安全响应、所有捕获的 GET response、Audit List/Detail、DOM、URL、console/pageerror 摘要和 `testInfo.outputDir` 文件中。
- 失败 helper 只报告 HTTP method、pathname、status 和不含机密的断言标签，不 dump response/request body、header、cookie 或 CSRF。

### 隔离和清理

- 只在 `deploy/scripts/e2e-local.sh` 的既有 fixed V2 real-stack list 中追加一个 spec；不创建新脚本、Make target、Playwright config、webServer 或数据库生命周期。
- 新 spec 自身不需要 Celery、对象存储或 Provider，也不得新增这些依赖；完整入口中既有场景仍共享现有 Worker/Beat/storage/fake AI。
- 测试显式关闭其创建的 ENGINEER BrowserContext；ADMIN fixture context 由 Playwright Test Runner 回收。
- 无论场景成功或失败，shell `EXIT` trap 都必须停止本次 PID、精确清理 allowlisted Redis keys、drop 本次唯一数据库、删除本次临时存储，并证明固定端口已释放。
- 不清空共享 Redis，不删除外部 PostgreSQL/Redis 容器，不终止未知 PID，不使用 `kill-all`/`close-all`。

## 范围外

- 修改 Users/Audit 产品 UI、Auth 产品能力或后端 identity/Audit 行为；
- 新 API、migration、权限模型、测试 endpoint、fixture、mock、固定成功适配器或 `page.route`；
- 新依赖、通用 E2E framework、page-object/DSL、第二 orchestration 或新 Playwright config；
- 375/768/1024/1440 重复真实栈覆盖；
- 修改 OpenAPI/database contract；
- Phase 7 abstraction review、Phase 8 Workbench 或 `make verify`。

## 验收标准

- [ ] AC0：独立 Auth UI blocker 已交付并归档，且本 Task 对真实路由重新审计后获得用户实现批准。
- [ ] AC1：新增单个 desktop real-stack spec，不导入 fixture、不拦截 API，并由既有 `e2e-local.sh` 的 V2 production preview 运行。
- [ ] AC2：ADMIN 通过 V2 UI 登录，并经 Users UI 创建唯一 ENGINEER；ENGINEER 在独立 context 中通过 V2 UI 登录和首次改密。
- [ ] AC3：ENGINEER 无 System 导航，两个 System 页面均为可聚焦 403，六个 ADMIN-only API 均由真实 FastAPI 返回 403。
- [ ] AC4：ADMIN 以页面 canonical revision 重置密码；ENGINEER 旧 session 下一次受保护请求返回 401，响应与审计均无密码。
- [ ] AC5：Users Table 真实批量停用稳定得到一个成功和一个 `LAST_ADMIN_REQUIRED`，UI 显示 partial，ADMIN session/最后管理员状态有效。
- [ ] AC6：create/reset/bulk 的真实审计可由 Audit UI 的服务端筛选定位，至少一条 Request ID 完成 List → lazy Detail 同一记录证据链。
- [ ] AC7：Audit 保持七列、无操作列、lazy Detail 与安全 projection；List/Detail/DOM/GET response 无密码和 raw `change_summary`。
- [ ] AC8：临时 ENGINEER 经 V2 UI 停用并删除，用户删除后相关审计历史保留且 actor nullable 投影正确；若真实完整性规则阻止删除，场景失败并报告，不绕过。
- [ ] AC9：trace/video/request body artifact 策略符合现有敏感测试合同；内存扫描和 artifact 文件扫描均未发现两个 password sentinel。
- [ ] AC10：独立诊断全部通过；最终唯一真实栈运行记录实际 exit code、V2/V1 pass 数、耗时、secret scan 与 cleanup 证据。
- [ ] AC11：数据库、Redis allowlisted keys、临时存储、本次进程、两个 browser context 与固定端口均按 owner 清理，无宿主测试数据残留。
- [ ] AC12：只更新 Phase 7 与测试验收文档的实际结果；没有新稳定架构决策时不改 ADR/spec，不改 OpenAPI/database contract。
- [ ] AC13：`git diff --check` 与 Trellis validation 通过；提交、归档、fast-forward merge 和分支删除均遵守用户批准门禁。

## 停止条件

出现以下任一情况立即停止本 Task 的实现，不用兼容逻辑或测试绕过掩盖：

- Auth UI prerequisite 仍缺失或行为与权威 Auth contract 冲突；
- Users/Audit API、权限、revision、会话撤销、删除或 Audit projection 出现生产行为缺陷；
- 需要 migration、contract 或产品 UI 修改才能让场景通过；
- 端口/Redis DB/数据库 owner 不唯一，或发现未知外部进程；
- secret 进入失败输出或 artifact；
- cleanup 不能证明只删除本次资源。

局部测试 selector、断言或既有 orchestration fixed list 接入缺口可在批准范围内最小修正；其他问题单独建 blocker。
