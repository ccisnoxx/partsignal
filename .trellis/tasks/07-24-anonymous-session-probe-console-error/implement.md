# 实施计划

## Phase 1 — 拆分匿名与无效会话契约

### 必须修改

- `contracts/openapi.yaml`
  - `paths./api/v1/auth/me.get.responses`
  - 保留 200/401，增加 204“当前无会话”。
- `backend/app/deps.py`
  - `get_current_session` 附近的会话解析所有者。
  - 增加最小可选会话依赖；无 Cookie 返回 `None`，有 Cookie 复用现有严格校验。
- `backend/app/routers/identity.py`
  - `get_current_user`
  - 可选会话为 `None` 时返回空 204，有效会话仍调用 `present_user`。
- `backend/tests/integration/test_identity_management.py`
  - 增加无 Cookie 204/空响应体、有效会话 200、失效会话 401 的相邻断言。

### 生成文件

- `frontend/src/shared/api/schema.d.ts`
  - 运行 `npm --prefix frontend run api:generate`，禁止手改。

### 最小验证

```bash
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend \
  pytest backend/tests/integration/test_identity_management.py -k "auth or session"
npm --prefix frontend run api:generate
make contract-check
```

### 停止条件与回滚点

- 无效、撤销、过期或停用会话只要有一项变成 204，立即停止并回滚。
- 其他使用 `CurrentSession` / `CurrentUser` 的路由若改变行为，说明依赖边界放置错误，禁止继续。

## Phase 2 — 显式消费匿名状态

### 必须修改

- `frontend/src/features/auth/AuthProvider.tsx`
  - `currentUser.queryFn`：204 映射为 `null`，200 继续 `unwrap`，401 继续抛错。
  - `csrf.enabled` 与 `isLoading`：只对真实用户启用 CSRF 查询。
  - `user`、`isAuthenticated`、`error` 和 `refresh` 现有公开形状不变。
- `frontend/src/features/auth/LoginPage.test.tsx`
  - GET `/auth/me` 模拟 204，POST 登录失败仍模拟 401。
  - 断言登录页可用、未请求 `/auth/csrf`、错误凭据仍显示真实服务端错误。

### 不修改

- `frontend/src/shared/api/client.ts`
- `LoginPage.tsx` 登录提交与成功跳转
- `ProtectedRoute.tsx`
- query key、Cookie、localStorage 或额外认证状态源

### 最小验证

```bash
npm --prefix frontend exec -- vitest run \
  src/features/auth/LoginPage.test.tsx
npm --prefix frontend run typecheck
```

### 停止条件与回滚点

- TanStack Query 数据不得为 `undefined`；匿名必须使用局部 `null`。
- 匿名 204 后若仍请求 `/auth/csrf`，停止并修正启用条件，不允许吞掉 CSRF 401。
- 已登录用户访问 `/login` 若不再重定向，停止并回滚。

## Phase 3 — 固化匿名浏览器契约

### 必须修改

- `frontend/tests/e2e/theme.spec.ts`
  - 新增“匿名登录页无失败会话探测”测试。
  - 导航前监听 `console.error`、`pageerror`、`requestfailed`。
  - 等待 `/auth/me`，断言 204、登录表单可用、未发生 `/auth/csrf` 请求。
  - 不使用账号、不写业务数据、不添加 401 allowlist。

### 相关回归

- 既有 `frontend/tests/e2e/mvp-flow.spec.ts` 的登录、会话撤销和强制改密流程必须回归，
  但预计不修改该文件。

### 最小验证

```bash
npm --prefix frontend exec -- playwright test \
  tests/e2e/theme.spec.ts -g "匿名登录页"
```

完整认证纵向回归按项目脚本运行：

```bash
deploy/scripts/e2e-local.sh
```

### 停止条件与回滚点

- 测试若通过过滤 401、延后监听或预置登录态规避匿名分支，视为无效。
- 正常匿名之外的认证失败不得从 console/request 断言中被全局忽略。

## Phase 4 — 质量门禁与人工复核

```bash
make contract-check
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check \
  backend/app/deps.py \
  backend/app/routers/identity.py \
  backend/tests/integration/test_identity_management.py
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run test
```

人工复核：

1. 使用全新匿名会话直达 `/login`。
2. 确认 `/auth/me` 为 204、无 `/auth/csrf`、登录表单可用，控制台无 error/warning。
3. 使用真实管理员登录，确认工作台、CSRF 与登出正常。
4. 清除/失效会话后确认受保护路由仍回到登录页；不放宽真正的 401。
5. 若另行部署，再通过真实公网域名做同一只读验收；部署不是本任务的自动动作。

## AC mapping

| AC | 实施步骤 | 证据 |
|---|---|---|
| AC1 | Phase 1 | 无 Cookie 后端集成测试：204 + 空响应体 |
| AC2 | Phase 1 | 有效/失效会话集成测试：200/401 |
| AC3 | Phase 2、3 | LoginPage 单元测试 + 匿名 Playwright 运行时断言 |
| AC4 | Phase 2、3 | 已登录直达登录页回归 |
| AC5 | Phase 1、3、4 | 受保护路由、登录返回、登出和强制改密 E2E |
| AC6 | Phase 1、2、3 | 无效 Cookie 401 + 不使用 allowlist |
| AC7 | Phase 1、4 | 生成类型、contract-check、typecheck、认证回归 |

## Final file scope

预计必须修改：

1. `contracts/openapi.yaml`
2. `backend/app/deps.py`
3. `backend/app/routers/identity.py`
4. `backend/tests/integration/test_identity_management.py`
5. `frontend/src/shared/api/schema.d.ts`（生成）
6. `frontend/src/features/auth/AuthProvider.tsx`
7. `frontend/src/features/auth/LoginPage.test.tsx`
8. `frontend/tests/e2e/theme.spec.ts`

预计只回归、不修改：

- `frontend/src/features/auth/LoginPage.tsx`
- `frontend/src/app/ProtectedRoute.tsx`
- `frontend/tests/e2e/mvp-flow.spec.ts`

不新增认证端点、状态源、源文件、抽象或依赖。任务保持 `planning`，本计划获批前不得运行
`task.py start`。
