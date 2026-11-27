# I03-4-B2-C2-D1 原子认证快照与跨 session 交错防护

## Goal

建立原子认证 session snapshot 合同与实现，阻断跨 session 拼接、ABA 和迟到认证响应，并完成定向验证、独立高风险复核与本地修复提交。

## Requirements

- `contracts/openapi.yaml` 增加原子 `GET /api/v1/auth/session` 读取合同；一次响应中的 `user`、`csrf_token` 与 `session_binding` 必须来自同一次解析的 `SessionRecord` 和同一 PostgreSQL statement snapshot。
- `session_binding` 是以部署 session secret 对内部 Session UUID 做域分离 HMAC 的公开不透明值；不得返回 Session UUID、session token、token hash、CSRF hash 或其他可重放/推导凭据。
- 不新增数据库字段、迁移或 Redis 身份状态；复用 `SessionRecord.id` 作为稳定内部 session identity，用户权限事实继续唯一来自 PostgreSQL `users`。
- AuthProvider 的默认 session 读取只调用原子 endpoint，不再拼接 `/auth/me` 与 `/auth/csrf`；旧 endpoint 仅保留已存在的兼容调用，不作为客户端一致性路径。
- 每次认证读取分配单调 generation；只有最新读取且未被登录、退出或改密 transition 取代的 snapshot 能在返回前推进 principal boundary。主体变化顺序固定为先推进 principal epoch、再清除全部非 auth QueryCache、最后发布新 session。
- `authBoundaryIdentity` 只包含实际主体/权限边界：用户 ID、account type、active、must-change 与 workflow stage；同一主体普通 revision、CSRF 或 session binding 更新不得推进 principal epoch或清理业务缓存。
- 401 `AUTH_REQUIRED` 收敛为匿名；网络错误、5xx、CSRF 结构错误和其他响应显式失败，不保留混合 session，也不静默转匿名。
- 确定性 deferred/barrier 测试覆盖 ADMIN→ENGINEER、匿名、A→B、A→B→A、旧 refresh 与登录/退出/改密交错，以及既有 paused retry、offline resume、mutation callback 和 callback 内 await continuation 边界。
- 本会话只执行受影响合同、后端、前端、真实栈和资源/secret 定向检查；不得运行完整 `make verify`、完整测试全集、全量 Playwright、远端 CI、部署或 I04。

## Acceptance Criteria

- [x] OpenAPI、runtime schema、generated TypeScript types 与后端响应一致；原子 snapshot 不暴露 Session UUID、session/token hash、CSRF hash 或其他秘密。
- [x] session 已撤销、用户停用/删除、Cookie 替换或 CSRF 不匹配时返回既有结构化认证错误；账号类型、revision 与 must-change 更新返回当前权威投影。
- [x] AuthProvider 只消费 `/auth/session`；ADMIN→ENGINEER/匿名/另一用户推进 principal epoch 并清除业务缓存，同主体 refresh 更新 CSRF/binding 且保留 cache/continuation。
- [x] A→B 与 ABA 不能形成 `user=A + csrf=B`，迟到 refresh 不能覆盖新登录、已退出状态或改密后 snapshot。
- [x] principal epoch、QueryClient mutation、offline/paused retry、迟到 callback 与 callback 内 await 的定向回归通过，且测试以 deferred/barrier 控制阶段、不依赖 sleep。
- [x] 受影响 contract、backend unit/integration、frontend Vitest/ESLint/typecheck、auth-session real-stack、secret artifact、资源清理和 `git diff --check` 均通过并记录数量/skip/退出码。
- [x] fresh `critical_reviewer` 对完整 D1 diff 给出 `NO BLOCKER`；D1 形成一个本地修复提交，候选与原检出区 clean，父任务链保持 `in_progress`。

## Notes

- 父任务：`.trellis/tasks/09-25-frontend-i03-4-b2-c2-auth-session-cross-snapshot-blocker/`。
- 固定起点：commit `6aaf05a5ad5371493bb20c95b5cbdb5908a27cf9`、tree `8a07b055bcb9f8d2b4038f7e31ac5fab71c815e1`；上一会话留下的 C2/blocker Trellis 记录属于本次提交范围，必须保留。
- D1 定向修复与独立复核已完成；完整 clean-checkout `make verify` 与 I03 总体收尾明确留给下一独立任务。
