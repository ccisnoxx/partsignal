# 修复匿名登录页会话探测控制台 401

## Goal

匿名用户直接打开 `/login` 是正常入口。页面必须判断当前是否已有有效会话，但正常的“没有会话”
不得表现为失败资源或浏览器控制台错误；有效、失效和受保护请求的认证安全语义必须保持明确。

## Confirmed facts

- 2026-07-24 对真实部署 `https://geo.962850.xyz/login` 使用两个全新匿名浏览器会话验收，
  均稳定出现 `GET /api/v1/auth/me → 401`。
- Chrome 控制台同步记录
  `Failed to load resource: the server responded with a status of 401`，每次首次加载一条。
- 登录表单、主题和后续真实登录仍可用；问题仅是正常匿名探测被 HTTP 错误承载。
- `frontend/src/features/auth/AuthProvider.tsx` 在所有路由启动时请求 `/api/v1/auth/me`；
  `backend/app/deps.py:get_current_session` 在 Cookie 缺失、失效、撤销、过期或账号停用时统一抛出 401。
- 登录后用户信息、强制改密、权限和会话撤销仍以服务端为唯一权威，本任务不得用前端 Cookie 猜测替代服务端判断。

## Requirements

### R1 — 正常匿名状态不得污染控制台

没有会话 Cookie 的客户端读取 `/api/v1/auth/me` 时，API 必须使用成功类的无内容结果表达“当前匿名”，
登录页不得产生失败请求、`console.error` 或 `pageerror`。

### R2 — 认证状态必须继续由服务端确认

前端仍必须通过服务端探测区分匿名与已登录，不得读取 HttpOnly Cookie、缓存猜测身份、跳过有效会话检查，
或让已登录用户停留在登录表单。

### R3 — 无效会话和受保护接口继续失败

- 携带失效、撤销、过期会话 Cookie或已停用账号时，`/auth/me` 仍返回 401。
- 其他受保护 API 在没有会话时仍返回 401。
- 401 触发的现有会话过期处理、CSRF 清理和登录跳转保持不变。

### R4 — 匿名状态不得触发 CSRF 请求

前端把 `/auth/me` 的无内容结果映射为明确匿名状态，且不得继续请求
`/api/v1/auth/csrf`；已登录时 CSRF 获取、登录、登出和强制改密流程保持不变。

### R5 — 契约、生成类型和测试同步

`contracts/openapi.yaml`、后端依赖与路由、生成 TypeScript 类型、AuthProvider、单元/集成/E2E
测试必须描述同一 200/204/401 状态机。

## Acceptance Criteria

- [ ] AC1：无会话 Cookie 时，`GET /api/v1/auth/me` 返回 204 且响应体为空。
- [ ] AC2：有效会话仍返回 200 和当前 `User`；失效、撤销、过期或停用会话仍返回 401。
- [ ] AC3：匿名直接打开 `/login` 时表单可用，网络中无 `/auth/csrf` 请求，控制台无 error/warning、无 `pageerror` 或失败请求。
- [ ] AC4：已登录用户直接打开 `/login` 仍由服务端识别并跳转到工作台。
- [ ] AC5：匿名访问受保护路由仍进入登录页，登录成功后返回目标路由；登出和强制改密流程不变。
- [ ] AC6：真正的认证失败仍显式进入现有 401/过期处理，不增加 401 allowlist 或全局错误抑制。
- [ ] AC7：OpenAPI、生成类型和前后端 200/204/401 判断一致，契约、类型、认证集成与浏览器测试通过。

## Out of scope

- 不改变登录凭据、密码策略、会话 TTL、Cookie 属性、CSRF 算法、权限模型或审计。
- 不把其他受保护接口的匿名 401 改为成功响应。
- 不修改登录页视觉、主题、文案或布局。
- 不新增认证状态端点、前端存储、Cookie 解析、依赖或通用错误抑制器。
- 不与自然化 Prompt 的 404 修复合并；两个任务独立规划、验证和回滚。

## Blocking questions

无。任务保持 `planning`，需在最终计划获批后另行执行 `task.py start`。
