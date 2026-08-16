# Frontend V2 Auth Session UI

## 状态

- Trellis 状态：`in_progress`。
- 任务性质：`frontend-v2-system-admin-e2e` 的独立产品能力 blocker。
- 当前门禁：实现与 Required validation 已完成；尚未提交或归档，等待用户确认 commit plan。
- 原 E2E Task 继续保持 `planning`，在本 Task 交付归档前不得用 API 登录或 API 改密绕过 V2 UI。

## 目标

补齐 V2 已写入信息架构、但尚未交付的认证会话 UI：

1. `/login` 使用既有 Auth contract 建立真实 cookie session；
2. `/account/security` 使用真实 CSRF 完成自助改密；
3. `must_change_password=true` 的会话只能停留在登录安全流程，不能进入业务 App Shell；
4. 匿名用户不能进入 `_app` 业务路由；
5. 普通已登录用户可从账户菜单进入修改密码，并可正常退出。

服务端继续是会话、权限和强制改密的最终权威；前端只负责路由 UX、表单提交和 canonical session 刷新。

## 实施前已验证基线

- `contracts/openapi.yaml` 已定义 LoginRequest、AuthSession、ChangePasswordRequest、logout/me/csrf；无需新增或修改 API。
- `AuthProvider` 已是跨路由唯一会话 owner，使用 `['auth', 'session']` Query 读取 user + CSRF，并实现 logout 后清除业务 Query cache。
- `_app/route.tsx` 实施前无认证边界，匿名访问 `/` 仍会渲染 App Shell。
- V2 route tree 实施前没有 `/login` 与 `/account/security`，Account Menu 只有退出。
- 后端对 must-change session 只放行 me/csrf/change-password/logout，其他受保护 API 返回 `PASSWORD_CHANGE_REQUIRED`。
- 隔离真实栈已 seed 一个 `must_change_password=true` 的 ENGINEER，可用于 V2 UI 的真实 login → change-password → logout 验收。

## 功能要求

### 会话 owner

- 复用并扩展现有 `AuthProvider`，不增加第二 Context、全局 store、localStorage/sessionStorage 或兼容状态。
- `signIn` 必须调用 `/api/v1/auth/login`，将响应中的 User 与 CSRF 写入现有 canonical session Query，并清除可能属于上一身份的非 Auth Query cache。
- `changePassword` 必须使用当前 canonical CSRF 调用 `/api/v1/auth/change-password`，成功后重新读取 canonical session，不能在客户端直接把 `must_change_password` 改成 false。
- 密码不得进入 TanStack Query mutation cache、持久化 storage、URL、console、日志或测试附件；表单提交采用直接 async 调用，pending 由表单原生提交状态管理。
- logout 继续复用现有 owner；成功后匿名状态触发路由边界回到 `/login`。

### `/login`

- 页面位于 App Shell 外，使用现有 design-system primitive、React Hook Form 与 Zod；不增加依赖。
- username 必填；password 最少 8 个字符，与 LoginRequest 一致。
- 支持密码显示/隐藏、首个无效字段聚焦、字段错误、服务端错误、提交 pending 与防重复提交。
- 登录成功后：`must_change_password=true` 进入 `/account/security`；其他会话进入 `/`。
- 已登录用户直接访问 `/login` 时按同一 canonical 状态进入 `/account/security` 或 `/`。
- 本 Task 不增加未经需求确认的 redirect/search 参数；匿名深链完成登录后进入 canonical landing `/`。

### `/account/security`

- 页面位于 App Shell 外，确保强制改密用户不会看到或操作业务导航；已登录普通用户也可从 Account Menu 进入。
- old_password 与 new_password 均至少 8 个字符；只提交合同字段，不增加猜测字段或客户端密码规则。
- 提交必须携带当前 `X-CSRF-Token`；成功后等待 `AuthProvider.refresh()` 完成，再进入 `/`。
- 服务端拒绝时保留页面并显示明确错误；不伪造成功、不静默退出、不清除服务端错误。
- 匿名访问时进入 `/login`；会话读取失败时显示可重试错误，不能把未知状态当作匿名。

### `_app` 路由边界

- auth loading 时显示明确 loading surface，不先渲染业务页面或发起业务数据请求。
- auth error 时显示可重试错误，不进入 App Shell。
- anonymous 时进入 `/login`。
- `must_change_password=true` 时进入 `/account/security`。
- 只有已登录且无需强制改密的用户才能渲染 App Shell；ADMIN/ENGINEER 的细分权限仍由既有子路由与服务端负责。

### 账户菜单

- 增加“修改密码”入口，指向 `/account/security`；保留现有退出行为、pending 与错误反馈。
- 不在菜单里复制强制改密或权限判断。

### 测试与敏感信息

- component/provider tests 覆盖 anonymous、auth error、signIn cache ownership、must-change redirect、change-password CSRF/refresh、validation 与 server error。
- strict production-artifact E2E 覆盖 mobile/desktop 的 login、forced change、regular self-service、logout 与受保护路由，不依赖真实后端；fixture 未声明请求必须失败。
- 单个 desktop real-stack E2E 使用既有 seed ENGINEER 和既有 `e2e-local.sh` owner，证明真实 cookie、CSRF、首次改密、ENGINEER admin 403 与 logout；不得通过 request API 替代这些核心 UI 操作。
- 所有包含密码的 Playwright 场景显式关闭 trace，不启用 video、storage-state 导出或 request-body 记录，并扫描输出目录不得含测试密码 sentinel。

## 范围外

- 后端 identity 行为、数据库、migration、OpenAPI/database contract 或权限模型；
- Users/Audit 产品页面与 `frontend-v2-system-admin-e2e` 的业务闭环；
- SSO、忘记密码、注册、验证码、记住登录、会话列表、设备管理或密码强度扩展；
- 新状态库、通用 auth framework、page-object/DSL、第二 E2E orchestration 或新 Playwright config；
- 任意外部 redirect、深链 return-to 参数或 V1 UI/路由复制；
- Phase 7 abstraction review、Phase 8 Workbench 与仓库级 `make verify`。

## 验收标准

- [x] AC1：`/login` 使用真实 LoginRequest/AuthSession contract 建立 canonical session，已登录访问按 must-change 状态进入正确页面。
- [x] AC2：匿名 `_app` 不渲染 App Shell；must-change session 不能访问业务页面并进入 `/account/security`。
- [x] AC3：`/account/security` 使用 canonical CSRF 提交 exact ChangePasswordRequest，成功后以服务端刷新结果解除 must-change 并进入 `/`。
- [x] AC4：普通已登录用户可从账户菜单进入修改密码；logout 后清除业务缓存并回到 `/login`。
- [x] AC5：login/change-password 的 validation、pending、password toggle、first-invalid focus、server error 和 auth retry 均有可观察测试。
- [x] AC6：密码不进入 Query mutation cache、storage、URL、console、trace/video/request-body artifact 或持久文件。
- [x] AC7：strict fixture production-artifact E2E 在 mobile/desktop 通过，Foundation smoke 改为显式已登录 fixture 后继续验证 App Shell。
- [x] AC8：既有唯一 real-stack owner 中的 desktop Auth 场景通过真实 PostgreSQL/FastAPI/V2 production preview，证明 login → forced change → admin 403 → logout。
- [x] AC9：不新增依赖、第二认证状态、客户端权限权威、兼容字段、mock success 或第二 orchestration；contracts/backend/database 不变。
- [x] AC10：目标 tests、api:check、lint、typecheck、production build、`git diff --check` 与 Trellis validation 通过；实际结果写入 task evidence。
- [ ] AC11：Auth Task 归档合入 main 后，`frontend-v2-system-admin-e2e` 仍由用户另行批准并重新审计，不自动开始。

## 停止条件

出现下列任一情况即停止实现并回到 planning：

- 实际 Auth contract 与已读 OpenAPI/backend 行为不一致；
- 需要修改 API、数据库、权限模型或 server must-change 状态机；
- 需要保存密码、cookie、CSRF 或 request body 才能测试；
- 需要新增跨应用状态层、兼容字段、测试 endpoint 或第二真实栈 owner；
- 真实栈资源 owner/端口/Redis 隔离不明确。
