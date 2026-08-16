# Frontend V2 System Admin E2E

## 状态

- Trellis 状态：`in_progress`；实施与 required validation 已完成。
- 当前结论：**IMPLEMENTED，required validation 已完成，等待提交确认**。
- `frontend-v2-users`、`frontend-v2-system-audit`、`frontend-v2-auth-session-ui` 均已归档并合入 `main`；Auth UI 前置条件已经解除。
- 重新审计与计划已获用户批准；Task 已启动，唯一临时分支为 `codex/frontend-v2-system-admin-e2e`。实施未新增产品能力，未修改 Auth/Users/Audit、OpenAPI 或数据库合同。

## 目标

在既有唯一隔离真实栈中增加一个 desktop Playwright 闭环场景，使用真实临时 PostgreSQL、FastAPI、V2 production build/preview、cookie session 与 CSRF，证明：

1. ADMIN 经 V2 UI 创建 ENGINEER，ENGINEER 经 V2 UI 首次登录并强制改密；
2. 前端 System 入口隐藏和服务端 ADMIN-only 403 同时成立；
3. ADMIN 重置密码后 ENGINEER 旧会话真实失效并返回 `401/AUTH_REQUIRED`；
4. 批量停用同时产生 ENGINEER 成功与唯一 ADMIN 的 `LAST_ADMIN_REQUIRED` 失败；
5. Users mutation 的 Request ID 可追踪到 Audit List 与点击后才加载的 Detail；
6. 临时用户停用、删除后审计历史仍保留；
7. 密码、Cookie、CSRF Token 和请求正文不进入测试产物；
8. 既有脚本在成功或失败后精确清理本次数据库、Redis key、临时存储和进程。

本 Task 只补真实栈证据和最小 fixed-list 接入，不新增产品能力。

## 最新基线与解除阻塞证据

### Auth Session UI

- 归档任务：`.trellis/tasks/archive/2026-08/08-16-frontend-v2-auth-session-ui/`，状态 `completed`；`main` 已包含其实现与归档提交。
- `/login` 的真实可访问名称为：textbox `用户名`、label `/^密码/`、button `登录`。
- `must_change_password=true` 登录后跳转 `/account/security`；页面显示“首次登录必须修改临时密码，完成前不能进入业务页面。”，字段为 `/^当前密码/`、`/^新密码/`，提交按钮为 `确认修改`。
- 改密成功后页面重新调用 `/api/v1/auth/me`，以服务端 canonical session 更新 AuthProvider；`must_change_password=false` 后跳转 `/`。
- 账户菜单 `退出登录` 调用真实 logout、清空 business query 与 session，并由 router 回到 `/login`。该行为已有 `auth-session-real-stack.spec.ts` 覆盖，System 场景不重复编排注销，但最终 fixed list 必须继续包含该 spec。
- 无 Cookie 的 `/auth/me` 返回 204；未知、撤销、过期或停用用户 Cookie 返回 `401/AUTH_REQUIRED`。本场景验证密码重置后的撤销 Cookie 路径。

### Users 与权限

- Users UI 的稳定选择器包括：heading `用户管理`、button `新增用户`、row 内唯一 `@username`、checkbox `选择用户 <username>`、button `批量停用`。
- 新增对话框使用 `用户名`、`显示名称`、`临时密码` 与 `创建用户`；新用户由服务端固定为 enabled、`must_change_password=true`。
- 重置对话框名称为 `重置 <username> 的临时密码`，提交 `重置临时密码`；请求 revision 来自当前行的 canonical User projection。
- 批量结果 UI 为 `批量操作完成：成功 X，失败 Y`，失败项显示 `<username>：<message>（<code>）`。
- ENGINEER 看不到 `系统管理`、`用户管理`、`系统审计`；直接访问两个 System URL 时 URL 保留，heading `无权访问系统管理` 所在 section 获得焦点。
- 服务端权限 owner 是 FastAPI `AdminUser`/`assert_account_types`，前端隐藏入口不作为安全控制。

### 会话、批量和审计

- `reset_user_password` 更新临时密码、恢复 `must_change_password=true`、递增 revision，并撤销目标用户全部未撤销会话。
- `get_optional_current_session` 只把完全缺失 Cookie 视为匿名；已撤销 Cookie 继续严格返回 `401/AUTH_REQUIRED`。
- bulk status 在同一事务内逐项保留预期失败；停用唯一有效 ADMIN 返回 `LAST_ADMIN_REQUIRED`，其他合法项仍可成功并提交。
- Audit List/Options/Detail 都由 ADMIN dependency 保护。列表是七列且无操作列；详情 query 只在 URL 出现 `logId` 后挂载。
- Users 成功 mutation 追加真实 IDENTITY 审计；bulk 只审计成功项，失败项不伪造成功记录。
- `AuditLog.actor_id` 使用 `ON DELETE SET NULL`；AuditLog 不计入禁止用户删除的业务历史，因此 ENGINEER 自助改密审计在用户删除后仍存在，actor 投影变为已删除/未记录语义。

### 真实栈编排

- `deploy/scripts/e2e-local.sh` 已拥有唯一数据库、migration/seed、FastAPI、V2 production preview、Worker/Beat、临时存储、Redis allowlist 与 PID 精确 cleanup 生命周期。
- V2 fixed list 已包含 `auth-session-real-stack.spec.ts`；当前 archived evidence 为 14 条 V2 real-stack 用例，新增本场景后的候选预期为 15 条，最终以实际输出为准。
- `frontend-v2/playwright.config.ts` 在 real-stack 模式关闭 trace，未启用 video；现有 `expectSecretsAbsent` 可递归扫描 `testInfo.outputDir`，失败时只报告相对文件名。

## 功能要求

### ADMIN 与 ENGINEER 生命周期

- ADMIN 必须通过 V2 `/login` UI 建立 cookie session，再通过 Users UI 创建带随机后缀的唯一 ENGINEER。
- ENGINEER 必须在独立 BrowserContext 中经 V2 UI 使用临时密码登录，被引导到 `/account/security`，并通过真实 CSRF 完成首次改密与 canonical session 刷新。
- ENGINEER 改密完成后必须能进入普通业务页面，但看不到 System 导航。
- ADMIN 重置 ENGINEER 密码时必须使用 Users 当前行 revision；重置后 ENGINEER 旧 context 对 `/api/v1/auth/me` 的下一请求必须返回 `401` 且 error code 为 `AUTH_REQUIRED`。
- revision 只读取当前 safe projection并验证单调更新，不在测试中硬编码跨步骤 revision 数值。

### ENGINEER 服务端权限

- 直接访问 `/system/users` 与 `/system/audit` 均显示真实前端 403 区域、保留 URL 并聚焦对应 section。
- ENGINEER 自己的真实 cookie context 必须逐一请求并得到 FastAPI 403：
  - `GET /api/v1/users`；
  - `POST /api/v1/users/bulk-status`（带该会话真实 CSRF）；
  - `GET /api/v1/users/export`；
  - `GET /api/v1/audit-logs`；
  - `GET /api/v1/audit-logs/filter-options`；
  - `GET /api/v1/audit-logs/{auditLogId}`。
- Audit Detail 使用 ADMIN 已观察到的真实 audit id；不得用 route interception、fixture 或客户端判断制造 403。

### Bulk partial、删除与审计链路

- ADMIN 从当前 Users Table 选择新 ENGINEER 与 seed ADMIN，提交页面当前 revision，真实获得 ENGINEER 成功和 ADMIN `LAST_ADMIN_REQUIRED` 失败。
- UI 必须显示成功 1、失败 1 及 `LAST_ADMIN_REQUIRED`；ADMIN session 和唯一有效管理员状态继续有效。
- 安全捕获 create、reset、bulk response 的 `X-Request-ID`；不得监听、保存或输出请求正文和 headers。
- 在 `/system/audit` 通过当前 URL key `requestId` 触发服务端筛选，分别定位 `user.created`、`user.password_reset`、bulk success 的 `user.updated`。
- 至少对 create 完成完整链路：mutation response Request ID → Audit URL/List → 七列表格同一记录 → 点击前无 Detail GET → 点击后唯一 Detail GET → Detail 的 id/request id/target 一致。
- bulk 的最后管理员失败不得出现成功审计；成功 ENGINEER 状态变更审计必须存在。
- ENGINEER 停用后其既有审计仍可读取；随后 ADMIN 通过 Users UI 删除该用户，并再次通过 Audit UI 验证 `user.password_changed` 历史仍存在且 actor 显示已删除/未记录语义。

### 敏感信息与产物

- 复用 `expectSecretsAbsent`，不创建第二套扫描器或通用 E2E helper。
- ADMIN 密码、ENGINEER 创建临时密码、首次改密密码、重置临时密码、两个 context 的 cookie value 与实际使用的 CSRF token 只保存在测试进程内存中；在 `finally` 统一作为 secret 值扫描 `testInfo.outputDir`，从不回显具体值。
- 不启用 trace/video/screenshot，不 attach，不导出 storage state，不注册 request-body/header listener，不调用 `postData()`；发送权限验证所需 request body 不等于记录请求正文。
- runtime error 收集、失败 helper 和断言消息只包含固定标签、HTTP method、pathname、status；不得 dump response body、request body、headers、Cookie 或 CSRF。
- safe response、Audit List/Detail、DOM、URL、local/session storage 和经过敏感值检测的浏览器错误均不得包含任何 password sentinel 或 raw `change_summary`。

### 隔离和清理

- 只在 `e2e-local.sh` 既有 V2 fixed list 追加一个 spec 路径；不创建新脚本、Make target、Playwright config、webServer 或数据库 owner。
- 新 System spec 不新增 Celery、存储或 Provider 依赖；完整脚本继续为既有其他场景启动它们。
- 新建 ENGINEER BrowserContext 必须在 `finally` 关闭；ADMIN fixture context 由 Playwright Test Runner 回收。
- shell `EXIT` trap 无论测试成功或失败都必须停止本次 PID、清理 allowlisted Redis keys、drop 本次唯一数据库、删除本次临时存储并释放固定端口。
- 不清空共享 Redis、不删除外部 PostgreSQL/Redis 容器、不终止未知 PID，不使用 `kill-all`/`close-all`。

## 精确实施文件范围

| 文件 | 预期职责 |
| --- | --- |
| `frontend-v2/tests/e2e/system-admin-real-stack.spec.ts` | 单个真实 ADMIN/ENGINEER 生命周期、403、session revoke、bulk partial、Audit lazy detail、历史保留与 secret scan 场景 |
| `deploy/scripts/e2e-local.sh` | 仅在现有 V2 fixed list 追加新 spec |
| `docs/frontend-v2/07-migration-plan.md` | 实现与最终 gate 通过后记录 Phase 7 实际结果 |
| `docs/frontend-v2/08-testing-quality-and-acceptance.md` | 实现与最终 gate 通过后记录权限、审计、敏感信息和 cleanup 实际证据 |
| 当前 Task 的 `prd.md`、`design.md`、`implement.md` 与 implementation evidence | 保存批准范围和实际验证结果，不记录秘密 |

预计不修改 Auth/Users/Audit 产品源码、backend、OpenAPI、database contract、Playwright config、Makefile、package manifest/lockfile、ADR 或 `.trellis/spec/`。若实现需要超出该范围，停止并重新请求批准。

## 明确排除项

- 新产品能力或修改 Auth、Users、Audit 行为；
- OpenAPI、数据库 schema/contract、migration 或权限模型变更；
- fixture、Mock API、固定成功路径、测试 endpoint 或 `page.route`；
- 新 E2E 编排框架、page object、DSL、万能 helper、第二生命周期脚本；
- System 抽象回顾、Phase 8 Workbench、响应式重复真实栈覆盖；
- 完整 `make verify`、push、PR、Git 历史改写或未经确认的 commit。

## 可观察验收标准

- [x] AC0：Auth Session UI 已完成、验证、归档并重新审计；本 Task 已解除阻塞并启动。
- [x] AC1：用户批准规划后才运行 `task.py start` 并创建唯一临时分支 `codex/frontend-v2-system-admin-e2e`。
- [x] AC2：新增单个 desktop real-stack spec，不导入 strict fixture、不拦截 API，由既有 V2 production preview 运行。
- [x] AC3：ADMIN 经 V2 UI 登录并创建唯一 ENGINEER；ENGINEER 在独立 context 经 V2 UI 登录、强制改密和 canonical session 刷新。
- [x] AC4：ENGINEER 看不到 System 导航；两个 System URL 显示并聚焦 403；六个 ADMIN-only API 均由真实 FastAPI 返回 403。
- [x] AC5：ADMIN 以当前 revision 重置密码；ENGINEER 撤销 Cookie 的下一次 `/auth/me` 返回 `401/AUTH_REQUIRED`。
- [x] AC6：真实 bulk response 与 UI 同时显示 ENGINEER 成功 1、ADMIN `LAST_ADMIN_REQUIRED` 失败 1，ADMIN 会话和状态仍有效。
- [x] AC7：create/reset/bulk 的 Request ID 均可由 Audit UI 服务端筛选定位，且 create 完成 List → lazy Detail 同记录证据链。
- [x] AC8：停用与删除临时 ENGINEER 后相关审计仍可读取；`user.password_changed` 的 actor 投影符合已删除/未记录语义。
- [x] AC9：Auth 既有 real-stack 继续证明 logout；新场景证明 reset 后 invalid session，未重复实现 Auth 编排。
- [x] AC10：所有 password、cookie value、CSRF token 和请求正文均未进入产物或失败输出；artifact scan 通过。
- [x] AC11：当前 diff 的独立诊断通过；两份未改动 component harness 共 8 条既有 `AuthProvider` 缺失失败已单独归因。最终 fail-fast 为 V2 `15 passed`、V1 `52 passed`、退出码 `0`、耗时 `417s`。
- [x] AC12：`E2E_CLEANUP` 继续由既有 EXIT trap 负责；最终候选运行后临时数据库、Redis DB 14、storage、PID 和固定端口无本次残留。
- [x] AC13：代码、Task 文档、Phase 文档和实际验证一致；`git diff --check` 与 Trellis validation 通过。

## 停止条件

出现任一情况立即停止实现，不以 fallback 或测试绕过掩盖：

- 当前 Auth/Users/Audit/API 行为与上述已审计合同不符；
- 需要修改产品代码、backend、contract、migration 或权限模型才能通过；
- owner 不唯一、出现未知端口/PID/Redis key，或 cleanup 不能证明只删除本次资源；
- secret 或请求正文进入失败输出或 artifact；
- 删除被真实业务历史规则阻止，或 Audit projection 无法证明历史保留。

只有 selector、wait、断言、secret scan 调用和既有 fixed-list 接入属于本 Task 可修范围；其余问题单独报告，不自动扩大范围。
