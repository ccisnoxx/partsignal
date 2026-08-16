# Frontend V2 Auth Session UI — Design

## 1. 设计结论

采用一个既有 owner、三个路由状态边界：`AuthProvider` 继续负责 canonical session Query 与 logout，`useAuthActions` 直接负责含密码的 login/change 调用；`/login`、`/account/security` 是 App Shell 外的表单路由；`/_app` 只在 canonical session 可进入业务区时渲染 App Shell。

不新增 auth store、API wrapper 层、redirect 参数或通用表单框架。后端状态仍是唯一权威，前端每次改密成功后必须 refresh，不能本地推导成功状态。

## 2. 单一不变量

```text
AuthProvider session Query (user + csrf)
              |
              +--> /login
              +--> /account/security
              +--> /_app route boundary --> AppShell --> child routes
```

所有 route decision 读取同一个 Auth session Query：顶层表单页面通过 `useAuth()` 读取当前值，共同业务边界通过 `getAuthRouteUser(queryClient)` 读取同一 cache。密码只在受控表单和 async 调用栈内短暂存在；Query cache 只保存 AuthSession，不保存 LoginRequest 或 ChangePasswordRequest。

## 3. 会话状态与路由

| canonical 状态 | `/login` | `/account/security` | `/_app/*` |
| --- | --- | --- | --- |
| loading | loading surface | loading surface | loading surface；不渲染 App Shell |
| auth error | 可重试错误 | 可重试错误 | 可重试错误 |
| anonymous | 登录表单 | 进入 `/login` | 进入 `/login` |
| user + must-change | 进入 `/account/security` | 修改密码表单 | 进入 `/account/security` |
| user + active | 进入 `/` | 自助修改密码表单 | 渲染 App Shell |

重定向只使用固定内部 route，不接受 URL/search 中的任意目标，因此没有 open redirect 分支。登录或改密成功后的 landing 固定为 `/`；System E2E 可随后导航目标页面。

## 4. AuthProvider 变更

在独立 `useAuthActions` 中增加：

- `signIn(payload: LoginRequest): Promise<AuthUser>`；
- `changePassword(payload: ChangePasswordRequest): Promise<void>`。

`signIn` 直接调用 generated OpenAPI client：

1. POST `/api/v1/auth/login`；
2. 失败沿用现有结构化 `requestError`；
3. 成功先清除非 Auth Query，避免上一身份的 server state 泄漏；
4. 把 `{ user, csrfToken }` 写入现有 `authSessionQueryKey`；
5. 返回 User，让 Login 页面只决定固定内部 landing。

`changePassword`：

1. 要求当前 session 与 CSRF 存在，否则显式失败；
2. POST `/api/v1/auth/change-password`，header 使用当前 `X-CSRF-Token`；
3. 成功后调用现有 session refetch；
4. refetch 失败则保留错误，不把本地 user 改成 active。

两个方法都不用 `useMutation`，避免密码变量进入 TanStack Query mutation cache。表单使用 React Hook Form 的 `isSubmitting` 管理 pending；logout 保留现有 mutation，因为它不含密码。

## 5. 页面与文件边界

建议的最小产品结构：

```text
src/app/auth/auth-provider.tsx
src/domains/auth/login-page.tsx
src/domains/auth/account-security-page.tsx
src/routes/login.tsx
src/routes/account/security.tsx
src/routes/_app/route.tsx
src/app/layout/app-shell.tsx
```

- route 文件只做 route registration 与 domain page 组合。
- Auth domain 页面拥有表单 schema、可访问性和提交反馈；两个短表单保持各自内聚，不抽象一套 speculative auth-form framework。
- `_app/route.tsx` 是整个业务树共同认证边界；不在每个业务页面重复 guard。
- `AccountMenu` 只增加 Link，不拥有改密状态。
- `routeTree.gen.ts` 由既有 TanStack Router build/plugin 更新，不手写第二 route map。

## 6. 表单与错误行为

### Login

- Zod schema exact 对齐 `username minLength=1`、`password minLength=8`。
- password input 默认隐藏，toggle 有明确 accessible name。
- `handleSubmit` await `auth.signIn`；成功后依据返回 User 的 `must_change_password` 导航固定 route。
- API error 显示为 form-level alert；字段值保留供用户修正，不打印 payload。

### Account Security

- Zod schema exact 对齐 old/new password 的 minLength=8；不增加 confirm 或猜测的复杂度规则。
- `handleSubmit` await `auth.changePassword`；成功后 reset 表单并导航 `/`。
- 失败保留在当前页面，form-level alert 可聚焦/播报；旧密码错误不转换成假成功。

两个页面复用现有 Input、Button 与表单 primitive；responsive 只依赖 CSS，不增加 viewport JS。

## 7. App 路由边界

`_app/route.tsx` 在渲染 `AppShell` 前依序处理 loading、error、anonymous、must-change、active。这样匿名或 must-change 状态不会 mount child route，也不会发起业务 query。

既有 `_admin` 仍只负责已登录用户的 ADMIN/ENGINEER UX 边界；服务端继续最终返回 403。Auth Task 不复制 ADMIN 判断。

`providers.tsx` 只在 authenticated → anonymous 的退出转换后 invalidation；登录和改密页面在 canonical session 已写回后执行固定导航。Router 在 auth loading/error 时不挂载，且每个 `AppRouter` 实例创建一个 router，避免测试或多次挂载共享历史状态；不引入事件总线。

## 8. 测试设计

### Unit/component

- `auth-provider.test.tsx`：anonymous；login exact payload、cache replacement；login error；change exact payload/CSRF/refetch；logout cache clear。
- `providers.test.tsx`：anonymous `/` 进入 `/login`；auth error 显式 retry；active session 渲染 App Shell；must-change 不渲染 App Shell。
- Auth page tests：8 字符边界、first-invalid focus、toggle、pending、server error、success landing。
- `app-shell.test.tsx`：Account Menu 的修改密码 Link 与既有 logout。

### Strict production artifact

新增 `tests/e2e/auth-session.spec.ts`，使用 spec-local 小型状态 fixture，只声明 Auth endpoints；未声明业务 API 返回 501。两种 viewport 验证 login/forced-change/self-service/logout 与 no-AppShell boundary。由于 request 含密码，spec 显式 `trace: 'off'`，不导出 storage state。

`foundation.fixture.ts` 改为显式 active ADMIN session，并声明 me/csrf，使原 Foundation smoke 继续专注 App Shell，而不是与新的 Auth smoke 重复。

### Real stack

新增一个 desktop `auth-session-real-stack.spec.ts` 并接入既有 `deploy/scripts/e2e-local.sh` fixed list：

1. 使用 seed ENGINEER 环境变量在 `/login` UI 登录；
2. 由真实状态进入 `/account/security`；
3. 使用进程内随机新密码经 UI 完成改密；
4. 直接访问 `/system/users` 得到既有 focusable 403；
5. 从账户菜单退出并回到 `/login`。

不使用 `page.request` 完成 login/change/logout，不创建用户或第二 context。脚本现有 EXIT trap 继续拥有数据库、Redis、进程、storage 与固定端口；spec 只拥有浏览器 page 和内存密码。

## 9. 文档与 contract

- 实现后更新 `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md` 的实际 Phase 7/Auth 验收证据。
- `02-information-architecture-and-routing.md` 已包含目标 routes，无需重复改写；只有实际行为与其不一致时才更新。
- AuthProvider 单一 owner、Query server-state 与 top-level route 结构都已由现有 V2 架构约束建立，不新增 ADR。实现后同步修正既有 frontend quality 与 infra E2E isolation spec 中已过期的 Foundation/real-stack 清单，不创建新规范。
- OpenAPI、database contract 与 backend 不变；若实际实现需要变更，停止并重新规划。

## 10. Git 与任务门禁

- 本 Task 保持 `planning`，等待用户评审并单独批准实现后才运行 `task.py start`。
- 项目当前采用 `main` 单分支工作流；不创建 `codex/*` 或其他开发分支，不 push。
- 完成实现与 required validation 后先展示 commit plan，获得确认才 commit。
- archive 前说明可能产生 Trellis bookkeeping commit，并另行遵守确认门禁。
- 本 Task 归档后只解除 E2E blocker，不自动启动 `frontend-v2-system-admin-e2e`。
