# System Admin E2E 审计记录

## 结论

Users、Audit、identity backend 与唯一 real-stack orchestration 已具备目标闭环所需合同；当前唯一阻塞来自 V2 Auth 产品层：文档规划了 `/login` 与 `/account/security`，真实 route tree、AuthProvider 和账户菜单尚未实现它们。

本 Task 不应使用 API login + API change-password 代替真实 V2 UI，也不应顺手实现 Auth 页面。建议独立 `frontend-v2-auth-session-ui` blocker。

## 启动证据

- 主工作目录：`main`，创建 Task 前 clean；`main` ahead origin，按授权未 pull/push。
- `frontend-v2-system-users`、`frontend-v2-system-audit`：均位于 `.trellis/tasks/archive/2026-08/`，对应归档提交已在 main。
- 创建前无 active Trellis Task。
- 无 `codex/frontend-v2-system-admin-e2e` 本地/远程分支，无额外 worktree。
- 当前 Task 由 `task.py create` 创建，保持 `planning`；未 `start`、未创建分支。

## Auth blocker 证据

1. `docs/frontend-v2/02-information-architecture-and-routing.md:104-105,147` 明确规划 `/login`、`/account/security` 与 `login.tsx`。
2. `frontend-v2/src/routes/` 实际文件清单没有 login/account route；`routeTree.gen.ts` 只有 System Users/Audit 等已实现路由。
3. `frontend-v2/src/app/auth/auth-provider.tsx:14-23,33-84` 只加载 `auth/me`、`auth/csrf`，支持 refresh/signOut；没有 signIn/changePassword。
4. `frontend-v2/src/app/layout/app-shell.tsx:224-275` 的 Account Menu 只有退出。
5. `backend/app/services/identity.py:399-428` 规定新用户默认 `must_change_password=true`。
6. `backend/app/deps.py:47-57` 对 must-change session 只放行 me/csrf/change-password/logout，其他受保护请求返回 `PASSWORD_CHANGE_REQUIRED`。

因此新用户可以由后端登录，但无法通过 V2 UI 建立会话并完成强制首次改密；这是产品流程缺失，不是 E2E selector 缺口。

## Backend 与删除审计结论

- `identity.py:360-396` 自助改密保留当前 session、撤销其他 session、清除 must-change 并写 `user.password_changed`。
- `identity.py:652-690` ADMIN reset 需要 expected revision，写入新 hash、重新设置 must-change 并撤销目标全部 session；响应 User 不含密码。
- `identity.py:557-594` bulk 在共享锁内按 UUID 稳定处理，逐项收集批准错误；`LAST_ADMIN_REQUIRED` 由共同 owner 决定。
- `identity.py:74-111` 用户业务引用统计不含 AuditLog。
- `models/identity.py:69-112` AuditLog append-only，actor FK 删除时 `SET NULL`；因此 ENGINEER 自己的 password-changed audit 不会成为 deletion blocker，删除后历史仍可读取。
- Integration tests 已分别验证临时密码/403、reset/delete、bulk invariant、Audit safe projection/ENGINEER 403、成功-only 审计。

## Orchestration 结论

- `deploy/scripts/e2e-local.sh:17-89` 创建进程唯一数据库和 `mktemp` storage；40-79 行 EXIT trap 精确清理。
- 91-118 行 migration/seed 后启动真实 FastAPI、storage、fake AI、Celery、V1/V2 production preview。
- 134-147 行在同一 V2 production preview 中串行运行既有 7 个 real-stack spec 文件（13 个 test），统一 `foundation-desktop`。
- 只需在该 fixed list 追加一个 System spec。无需第二 config、webServer、数据库或 cleanup owner。
- 新 System spec 本身不消费 Celery/storage/provider；完整脚本仍因既有 AI/Publishing/GEO specs 启动这些共享依赖，不为 System 额外启动任何服务。
- `frontend-v2/playwright.config.ts:4-30` 外部 baseURL 时不启动第二 webServer，real-stack 时 trace 关闭，workers=1。

## Existing real-stack patterns 取舍

已逐份阅读全部 `*-real-stack.spec.ts`：

- 复用：`PARTSIGNAL_E2E_REAL_STACK` skip、generated schema、path/method response matcher、production baseURL、随机后缀、safe final projection、browser error capture、现有单 owner cleanup。
- 不复用现有通用 `responseBody` 的失败 `.text()` 行为，因为 System 场景包含密码请求；新 helper 必须不 dump body。
- 不复用 AI Channel 对 request/response 的广泛捕获方式；System 只捕获 safe GET bodies 与明确 mutation response，绝不捕获 POST body/header。
- 新增的唯一必要结构是一个 test-local secret scan helper；使用 Node stdlib，不抽成 framework。
- 多用户并发需要一个额外 BrowserContext；现有 specs 大多单 page，但 Playwright 原生 context 已足够，不增加 fixture。

## 规划选择

- 一个 spec、一个 test：使跨 context 用户生命周期与 secret owner 连续，不依赖 test 间顺序或共享 state。
- 新建用户而不是复用 seed ENGINEER：能真实证明 create、temporary password、first change、reset、bulk、delete 与审计。
- 选择新 ENGINEER + seed ADMIN 作为 bulk targets：在唯一新数据库中稳定产生 one success + `LAST_ADMIN_REQUIRED`，不依赖 UUID/行顺序。
- UI 删除前不让 ENGINEER 创建业务对象；其 Auth/Audit 历史允许 actor nullable，预期不会阻止删除。
- Request ID 从 success response header 读取，只用于 Audit query；不打印、不与 secret 放在同一输出。
- strict fixture suites 继续拥有响应式与细粒度页面合同，real-stack 只跑 desktop。

## Stop recommendation

当前规划可评审，但不得进入实施。先单独授权并完成 `frontend-v2-auth-session-ui`；完成后重新核对真实 selector/redirect/session refresh，再批准本 Task start 和临时分支。
