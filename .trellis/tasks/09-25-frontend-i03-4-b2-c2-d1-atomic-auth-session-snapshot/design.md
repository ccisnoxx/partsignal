# I03-4-B2-C2-D1 设计

## 权威 owner

- 静态 API authority 是 `contracts/openapi.yaml`；`AuthSession` 增加必填 `session_binding`，新增 `GET /api/v1/auth/session`。登录响应复用同一 schema。
- PostgreSQL `SessionRecord` 与它 joined-load 的 `User` 是认证 snapshot authority。`GET /auth/session` 的依赖以一条 SELECT 同时解析 session 与 user；route 只从该 record 验证本次请求携带的 CSRF Cookie并形成响应。
- `backend/app/security.py` 唯一拥有公开 binding 推导：`HMAC-SHA256(session_secret, "partsignal-session-binding-v1:" + session_uuid)`。binding 不能作为任何认证、CSRF 或数据库查找输入。
- 前端 `AuthProvider` 唯一拥有 session Query、认证读取 generation、命令 transition 与 principal boundary commit；`principal-epoch.ts` 继续只拥有主体 epoch，不吸收 session binding。

## 原子性与交错

- 一个 `/auth/session` 请求只产生一个完整 snapshot；session Cookie 与 CSRF Cookie 不属于同一 `SessionRecord` 时返回 `403 CSRF_INVALID`，不返回半个 user 或 token。
- 每个普通 Query 读取在发起时推进本地单调 generation。新读取、登录、退出或改密开始时都会使旧读取 generation 失效；旧响应即使忽略 AbortSignal 迟到，也会在 principal boundary 与 Query 写入前被拒绝。
- 登录响应直接包含 binding；改密成功后通过同一原子 endpoint 读取新 user projection。认证命令的 transition commit 继续关闭并取消所有并发 auth reads。
- principal identity 不含 session binding、CSRF token 或非权限 revision。同一用户换 session 或刷新 CSRF 只替换 auth Query；用户 ID、account type、active、must-change 或 workflow stage 变化才推进 epoch。

## 兼容与安全

- `/auth/me` 与 `/auth/csrf` 保留已有服务端行为，供现有直接调用兼容；canonical frontend 和更新后的 fixture 不再将它们组合成 session。
- 不修改 `SessionRecord` schema，不增加持久化 generation，不引入 Redis/TTL/retry 猜一致性。
- 返回 schema 使用 `additionalProperties: false`，测试显式断言不存在 `id`、`token`、`token_hash`、`csrf_hash` 等 session secret 字段。

## 验证边界

- backend integration 使用两个真实 `SessionRecord`、Cookie 置换与账号更新证明原子投影/错误语义；并发客户端场景使用显式 barrier/deferred，不以 sleep 猜顺序。
- frontend 使用 deferred HTTP promises 控制 snapshot/命令返回次序，并复用真实 QueryClient principal continuation 断言 cache 清理与 continuation 失效。
- real-stack 只运行 auth-session owner 场景，使用现有数据库、Redis DB 14、端口和临时资源隔离；结束后核对所有相关资源为零。

## 实际结果

- 新增 canonical `GET /api/v1/auth/session`；有效 session 返回严格 `AuthSession`，匿名返回 `204`，无效 session 返回 `401 AUTH_REQUIRED`，CSRF Cookie 与已解析 record 不匹配返回 `403 CSRF_INVALID`。静态和 runtime OpenAPI 均把该读取表达为 optional authentication。
- 登录与 session read 共用 `present_auth_session()`；公开 binding 是 `HMAC-SHA256(SESSION_SECRET, "partsignal-session-binding-v1:" + SessionRecord.id)` 的 64 位小写十六进制值。它只用于客户端识别完整 snapshot，不进入 principal identity、认证、CSRF 或数据库查询。
- 前端对完整 wire snapshot 做严格 Zod 校验；缺失/多余字段、非法用户权限字段、空或过长 CSRF、非法 binding 均在任何 principal commit 和 Query 写入前失败。
- 每次 read 分配递增 generation；登录、退出和改密 transition 会使并发读取失效。主体变化的实际提交顺序为 principal epoch → 清理全部非 auth QueryCache → 发布新 auth session。
- 未修改 `SessionRecord` 表结构，未新增迁移、Redis 身份状态或客户端权限推测。
