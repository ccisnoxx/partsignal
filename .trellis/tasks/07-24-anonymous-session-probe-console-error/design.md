# 技术设计

## 1. Current data flow

```text
匿名访问 /login
  → AuthProvider 启动 getCurrentUser
  → get_current_session 发现无 Cookie
  → /auth/me 返回 401 AUTH_REQUIRED
  → AuthProvider 将错误解释为未认证并展示登录页
  → 浏览器仍记录失败资源 401
```

正常匿名、无效会话和受保护请求当前共享同一 401 表达。修复只拆分 `/auth/me` 的“无 Cookie”分支，
不放宽任何受保护接口。

## 2. Target authentication state machine

`GET /api/v1/auth/me`：

- 无会话 Cookie：`204 No Content`，表示正常匿名。
- 有效会话：`200 application/json`，返回 `User`。
- Cookie 存在但会话失效、撤销、过期或账号停用：`401 ErrorResponse`。

其他依赖 `CurrentSession` / `CurrentUser` 的接口保持现有 401/403 行为。

## 3. Backend ownership

- 在 `backend/app/deps.py` 中复用现有会话解析规则，提供仅供 `/auth/me` 使用的可选会话依赖：
  Cookie 缺失返回 `None`，Cookie 存在时继续走同一套数据库、撤销、过期和停用校验。
- 不复制查询、时间或状态判断；`get_current_session` 与可选依赖必须共享一个解析所有者。
- `backend/app/routers/identity.py:get_current_user` 接收可选会话：
  `None` 返回空 204，有效会话返回现有 `present_user`。
- `contracts/openapi.yaml:getCurrentUser` 同时声明 200、204 和 401。

## 4. Frontend consumption

AuthProvider 的当前用户查询在边界把 204 映射为 `null`，而不是向 TanStack Query 返回
`undefined`：

```text
HTTP 204 → currentUser.data=null → isAuthenticated=false → 登录页
HTTP 200 → currentUser.data=User → isAuthenticated=true → 已登录路由
HTTP 401 → ApiError + 现有 auth-expired 流程
```

CSRF 查询只在 `currentUser.data` 为真实用户时启用。匿名 204 不请求 CSRF；有效登录与刷新仍请求。
不根据当前路由禁用会话探测，因此已登录用户直达 `/login` 的跳转行为保持不变。

## 5. Test strategy

- 后端集成测试分别构造无 Cookie、有效会话和失效会话，验证 204/200/401。
- `LoginPage.test.tsx` 通过 App/AuthProvider 验证 204 映射为匿名、未请求 CSRF、登录失败仍展示真实错误。
- `theme.spec.ts` 增加无需账号的匿名浏览器契约：在 `goto('/login')` 前监听
  `console`、`pageerror`、`requestfailed`，断言 `/auth/me` 为 204、表单可用、无 CSRF 请求和运行时错误。
- 既有身份管理和 MVP 登录/登出 E2E 继续验证有效、失效与受保护请求。

## 6. Compatibility and rollback

- 仅 `/auth/me` 的“完全没有 Cookie”响应从 401 变为 204；无效 Cookie 和所有受保护 API 不变。
- 无数据库迁移、数据回填或部署配置变化。
- 若匿名状态触发 CSRF、无效 Cookie 被视为匿名、或已登录用户不再跳转，立即停止并回滚本任务提交。
