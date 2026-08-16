# Frontend V2 System Admin E2E — Design

## 1. 设计结论

采用现有能力能覆盖目标的最小结构：**一个原生 Playwright real-stack spec + 既有 shell fixed list 的一行接入 + 两处 Phase 文档结果更新**。

Auth Session UI 已归档并重新审计，本设计不再阻塞。用户已批准实施；Task 已启动并在唯一临时分支 `codex/frontend-v2-system-admin-e2e` 完成设计范围内的实现与验证。

## 2. 复用结论

| 关注点 | 当前权威实现 | 设计决定 |
| --- | --- | --- |
| Auth UI | `/login`、`/account/security`、AuthProvider canonical refresh、route guard、logout 均已交付 | 直接按真实 accessible name 操作，不增加 Auth helper |
| Users UI | 当前 User projection 提供 revision/actions；create/reset/bulk/delete 已有稳定对话框和 mutation | 核心成功操作全部走 UI |
| Permissions | App Shell 隐藏 System；`_admin` route 显示并聚焦 403；FastAPI `AdminUser` 是最终 authority | 同时证明 UX 与真实 API 403 |
| Audit UI | `requestId` URL filter、七列表格、按 `logId` lazy Detail | 复用页面行为，不增加查询 DSL |
| Session revoke | reset 撤销目标用户所有 server session；撤销 Cookie 的 `/auth/me` 返回 401 | 用 ENGINEER 原 context 的下一请求直接证明 |
| Bulk partial | backend 对预期失败逐项保留，唯一 ADMIN 触发 `LAST_ADMIN_REQUIRED` | 从当前表格选择新 ENGINEER + seed ADMIN |
| Audit history | `AuditLog.actor_id ON DELETE SET NULL`；AuditLog 不阻止用户删除 | 删除后读取 ENGINEER 自助改密历史 |
| Secret scan | `tests/e2e/secret-artifact.ts` 已有递归 bytes scan | 直接复用，不新建 scanner |
| Orchestration | `e2e-local.sh` 已拥有 DB/Redis/storage/PID/ports/preview cleanup | fixed list 只追加一个路径 |

不创建 page object、fixture、通用 response layer、新 Playwright config 或第二 orchestration；现有本地 helper 只服务本 spec 的可读性和安全失败消息。

## 3. 单场景状态序列

新文件：`frontend-v2/tests/e2e/system-admin-real-stack.spec.ts`。只定义一个闭环 test，使两个 context、用户状态、Request ID、secret 与 cleanup 由一个 owner 管理。

| 步骤 | 操作与可观察证据 | 服务端 canonical 结果 |
| --- | --- | --- |
| 1 | ADMIN 在 `/login` 填 `用户名`/`密码`，点击 `登录`，打开 `/system/users` | ADMIN cookie session 有效 |
| 2 | 点击 `新增用户`，通过真实对话框创建带随机后缀 ENGINEER；仅读 safe response 和 `x-request-id`，再由 ADMIN safe Audit List read 取得该记录的真实 audit id | enabled、must-change；获得 user id、当前 revision 与权限验证用 audit id |
| 3 | `browser.newContext()` 创建 ENGINEER owner；经 `/login` 使用临时密码 | 跳转 `/account/security`，cookie session 建立 |
| 4 | 填 `/^当前密码/`、`/^新密码/`，点击 `确认修改` | change-password 成功；`/auth/me` refresh 后 must-change=false、revision 单调增加 |
| 5 | 检查普通工作台可达且 `系统管理`/`用户管理`/`系统审计` 均不存在 | ENGINEER 普通业务 session 有效 |
| 6 | 依次访问 `/system/users`、`/system/audit` | URL 保留，`无权访问系统管理` section 聚焦 |
| 7 | ENGINEER context 获取本会话 CSRF（仅内存），逐一请求六个 ADMIN-only API | 六个真实 403；Detail 使用 ADMIN 先前观察到的真实 audit id |
| 8 | ADMIN 回 Users，按唯一 username 找行并打开 reset 对话框 | reset 使用页面当前 revision；返回 safe projection/request id |
| 9 | ENGINEER 原 context 请求 `/api/v1/auth/me` | 401，error code `AUTH_REQUIRED` |
| 10 | ADMIN 在 enabled 列表勾选 `选择用户 <engineer>` 与 `选择用户 admin`，确认 `批量停用 2 个用户？` | ENGINEER disabled；seed ADMIN 失败 `LAST_ADMIN_REQUIRED` |
| 11 | 检查 role=status 文案、失败条目和 ADMIN `/auth/me` | UI 成功 1/失败 1；ADMIN 仍 enabled/session valid |
| 12 | 用 create/reset/bulk request id 逐个打开 `/system/audit?requestId=...` | 三类成功 mutation 可追踪；bulk 失败项无成功审计 |
| 13 | 对 create 行断言七列表头；点击前 Detail GET=0，点击该行后只发出该 audit id 的 Detail GET | List/Detail id、request id、target 一致，projection safe |
| 14 | 回 Users 的 disabled 视图，通过 UI 删除临时 ENGINEER | User 与级联 Session 删除；AuditLog 保留 |
| 15 | Audit UI 以 action `user.password_changed` + target id 定位原记录 | 记录仍存在，actor 为已删除/未记录语义 |
| 16 | `finally` 获取仍在内存中的 CSRF/cookie value 作为扫描目标，调用 `expectSecretsAbsent`，关闭 ENGINEER context | 不导出 storage，不回显 secret；context owner 关闭 |
| 17 | shell `EXIT` trap | 停本次 PID、清 Redis allowlist、drop unique DB、删 storage、释放端口 |

核心 create/login/change/reset/bulk/delete 全部通过 V2 UI。API request 仅用于权限、session canonical 状态和安全只读证据，不直接制造核心成功状态。

## 4. 真实选择器与路由合同

### Auth

- Login：`getByRole('textbox', { name: '用户名' })`、`getByLabel(/^密码/)`、button `登录`。
- Forced change：URL `/account/security`；说明文案“首次登录必须修改临时密码，完成前不能进入业务页面。”；labels `/^当前密码/`、`/^新密码/`；button `确认修改`。
- Logout：既有 `auth-session-real-stack.spec.ts` 使用账户 menuitem `退出登录`，最终 fixed list 保留该独立证据；新 System spec 不重复退出流程。
- Invalid session：ENGINEER 原 context 直接请求 `/api/v1/auth/me`，断言 HTTP 401 与 envelope `AUTH_REQUIRED`，不以页面重定向替代。

### Users

- Page heading `用户管理`；create button/dialog `新增用户`；dialog 内 `用户名`、`显示名称`、`临时密码`、button `创建用户`。
- 行通过唯一 `@<username>` 所在 row 定位，不使用行号或固定 UUID。
- Reset action/button `重置临时密码`；dialog accessible name `重置 <username> 的临时密码`。
- Selection checkbox `选择用户 <username>`；bulk button `批量停用`；dialog `批量停用 2 个用户？`。
- Partial status：`批量操作完成：成功 1，失败 1`；失败项同时包含 seed ADMIN username、服务端 message 与 `LAST_ADMIN_REQUIRED`。
- Delete：disabled row overflow 的 `删除用户`；dialog `删除用户“<username>”？`。

### System/Audit

- ENGINEER 403 heading `无权访问系统管理`，断言其祖先 section focused。
- Audit heading `系统审计`；更多筛选 summary `更多筛选`；Request ID 输入 `Request ID`。
- 表格精确断言七列表头：时间、操作者、模块、动作、对象、结果、Request ID；不存在操作列。
- 行 accessible name 为 `查看审计详情：<localized action>`；点击后 desktop complementary `审计详情` 出现。
- 详情关闭按钮 `关闭审计详情`；只断言注册字段、同一 id/request id/target 和删除 actor 文案，不依赖 raw JSON。

## 5. Context、Cookie 与 CSRF owner

### ADMIN context

- 使用 Playwright Test Runner 提供的默认 desktop `page/context`，继承 external V2 base URL 和 real-stack trace policy。
- 通过 UI login 建立 cookie；ADMIN API read/health 检查共享同一 cookie jar。
- Runner teardown 回收，不导出 storage state。

### ENGINEER context

- 使用 `browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })` 创建唯一额外 context，并在 `finally` 精确关闭。
- 登录、首次改密、页面 403 和 API 403/401 均使用该 context，不复制 ADMIN cookie 或 CSRF。
- API request 使用 `PARTSIGNAL_E2E_API_BASE_URL` 的绝对 URL；cookie 按 host 共享，不把 V2 preview port 错当成 FastAPI。
- CSRF 通过真实 `/api/v1/auth/csrf` 获取，只留在局部内存；bulk 403 request 发送 `X-CSRF-Token`，证明认证后的 ADMIN-only 拒绝路径。

两个 context 只通过数据库中的真实用户状态关联，不共享 auth object 或 storage state。

## 6. Bulk partial 的确定性

- 每次脚本创建唯一新库；seed 只有一个有效 ADMIN `admin`。既有 real-stack specs 不创建额外 ADMIN。
- 新 ENGINEER 和 seed ADMIN 都从当前 Users response/row 获取 id 与 revision，不硬编码 revision 数值。
- UI checkbox 对所有可见行开放，因此即使最后管理员的 `available_actions` 不含单项 `DISABLE`，仍会把两项真实提交给 bulk endpoint。
- backend 对 items 按 UUID 加锁；不论顺序，停用 ENGINEER 不改变管理员数，停用唯一 ADMIN 必然产生 `LAST_ADMIN_REQUIRED`。
- response 与 UI 断言按 user id/username 匹配，不依赖数组或表格偶然顺序。

## 7. Request ID → Audit List → lazy Detail

1. 点击 mutation 前用 `page.waitForResponse` 匹配 method + pathname，不注册 request listener 读取 body/headers。
2. 成功 response 仅读 status、合同 safe JSON 与 `x-request-id`；失败 helper 只报告 method/path/status/固定标签。
3. 导航 `/system/audit?requestId=<encoded>`，让现有 route model 补齐 page/pageSize/time window 并向 API 映射 `request_id`。
4. 等待真实 List GET，断言其 query 与列表唯一记录的 request id/action/target。
5. 点击前统计目标 Detail pathname 的 GET 次数为 0；点击行后等待一次真实 Detail response。
6. Detail 的 id、request_id、target_id 与 List/mutation response 一致，且不出现 password/raw `change_summary`。
7. reset 与 bulk 重复 List 级追踪；bulk request id 下只出现成功 ENGINEER 的 `user.updated`，没有唯一 ADMIN 成功记录。
8. 删除后以 action + target id 查找 `user.password_changed`，证明 actor 被 SET NULL 后历史仍可投影。

## 8. Sensitive artifact 设计

- 复用 `expectSecretsAbsent(testInfo.outputDir, secrets)`；不修改或复制其递归读取逻辑。
- secret 集合包括：seed ADMIN password、ENGINEER create temporary password、changed password、reset temporary password、实际 CSRF token 和两个 context 中非空 cookie value。
- Cookie/CSRF 只在 `finally` 扫描前从 context/endpoint 读入内存；不得 serialize、attach、log、写 metadata 或拼入 assertion message。
- page/runtime listeners先在内存比较 secret；命中时仅设置固定错误标签，不保存原始 message。`requestfailed` 只记录 method/path。
- 不启用 trace/video/screenshot，不 `attach`，不调用 `storageState`、`postData`、`allHeaders`，不监听 request body。
- safe response/GET body、DOM、URL、localStorage/sessionStorage 与 runtime error 经 secret 检测；产物最终再以 byte scan 兜底。
- 扫描失败只由既有 helper 输出相对 artifact 文件名，不显示命中的 secret。

## 9. 文件与边界

| 文件 | 最小职责 |
| --- | --- |
| `frontend-v2/tests/e2e/system-admin-real-stack.spec.ts` | 单个闭环 real-stack test 和仅供该文件使用的安全小 helper |
| `deploy/scripts/e2e-local.sh` | fixed V2 list 追加 spec 路径 |
| `docs/frontend-v2/07-migration-plan.md` | gate 通过后记录 Phase 7 事实 |
| `docs/frontend-v2/08-testing-quality-and-acceptance.md` | gate 通过后记录测试与 cleanup 事实 |
| 当前 Trellis task artifacts | 规划、实际命令与结果；不记录 secret |

依赖但预计不修改：`frontend-v2/tests/e2e/secret-artifact.ts`、`frontend-v2/playwright.config.ts`、Auth/Users/Audit 源码与 tests、backend identity/audit、contracts。

若 diff 需要新依赖、产品代码、backend、contract、migration、Playwright config、Makefile、第二脚本或 `.trellis/spec`，说明当前设计前提失效，必须停止并重新审批。

## 10. Cleanup matrix

| 资源 | Owner | 成功/失败清理与证据 |
| --- | --- | --- |
| PostgreSQL `partsignal_e2e_<date>_<pid>` | `e2e-local.sh` / `e2e-database.py` | EXIT trap 精确 force/drop；`E2E_CLEANUP ... status=dropped`，事后只读确认不存在 |
| Redis logical DB | 调用方批准的独占非零 DB / `e2e-environment.py` | 仅删 allowlisted keys并断言无本次状态；不 FLUSH |
| `mktemp` storage | shell | 前缀校验后删除；cleanup 输出 status=removed |
| API、fake AI、V1/V2、storage ports | shell 精确 PID | kill/wait 本次 PID，事后确认 8000/9001/5173/4173/4174/19009 释放 |
| Celery worker/beat | shell 精确 PID | EXIT trap stop/wait；新 System spec 不新增 worker |
| ADMIN context | Playwright fixture | Runner teardown |
| ENGINEER context | 当前 test | `finally context.close()` |
| 临时 user/session/audit | 唯一临时 DB | UI 停用/删除证明业务闭环；最终 drop DB 仅负责环境隔离 |

未知端口 owner、Redis key/client 或数据库命名不满足 allowlist 时立即失败，不自动终止或删除外部资源。

## 11. 失败归因

- selector、wait、局部安全 helper、fixed-list 接入：属于本 Task，可最小修正。
- Auth/Users/Audit/API/权限/session/revision/delete/projection 行为偏差：产品或 backend blocker，停止并报告，不在测试中 fallback。
- cleanup owner 不唯一或 secret 泄漏：立即停止，不重跑掩盖。
- 最终 fail-fast gate 意外失败：先完成尚可安全独立执行的诊断并统一归因；代码、配置或环境未改变前不重复同一失败命令。
- 无关既有 V1/real-stack failure：报告真实 owner，不扩大修复范围。

## 12. 实施与 Git 门禁

1. 规划已获用户批准；primary workspace 在 clean `main` 上启动，不 pull/push。
2. 已运行 `task.py start` 并创建唯一临时分支 `codex/frontend-v2-system-admin-e2e`；没有其他 branch/worktree。
3. inline 实施、验证与 diff review 已完成；未 push、未建 PR、未改写历史。
4. 用户已确认单一 work commit plan，并授权随后运行 Trellis archive/bookkeeping 收尾。
5. 后续 merge/branch cleanup 仍按单独门禁执行。

本 Task 不做 System 抽象回顾，也不运行 `make verify`。
