# I03-4-B2-C2-D2 System Admin 原子 session 审计修复记录

## 根因

- canonical `/api/v1/auth/session` 只有 AuthProvider 的 Query owner。
- 密码重置使旧 session 失效后，`engineerPage.reload()` 的新 document mount 发起一次规范化 session read 并收到预期 `401 AUTH_REQUIRED`，页面收敛到 `/login`。
- 测试随后调用通用 `login()`；该 helper 无条件再次 `page.goto('/login')`，触发第二个 document mount 和第二次 401。诊断时第二个 401 明确出现在第一份 document 的 fetch 栈证据采集之后、登录 POST 之前。
- 因此问题不是 TanStack Query focus refetch、重复 Provider owner、认证 ABA 或迟到响应，而是测试编排中的冗余导航；旧 `/auth/me` allowlist 同时遗漏了 D1 已落地的 canonical endpoint。

## 最小修复

1. `login()` 增加默认仍导航的可选参数，只有 reset 恢复路径传入 `{ navigate: false }`。
2. `reset-invalid-session` 的精确允许响应改为 `GET /api/v1/auth/session` 401。
3. 在现有 traffic multiset 中增加同 phase/origin/method/path/status 且 `attempts=1`、`responses=1` 的断言。
4. 保留 request-context 的 `/api/v1/auth/me` 401、`AUTH_REQUIRED`、页面登录收敛、无 alert 和 secret artifact 扫描。

## 定向验证

- `npm --prefix frontend run typecheck`：退出 0。
- `frontend/node_modules/.bin/eslint tests/e2e/system-admin-real-stack.spec.ts`：退出 0。
- `npm --prefix frontend run test -- --run tests/helpers/real-stack-runtime.test.ts`：1 file / 13 tests passed。
- `PARTSIGNAL_E2E_SPEC=tests/e2e/system-admin-real-stack.spec.ts deploy/scripts/e2e-local.sh`：1/1 passed，secret scan clean，退出 0；数据库、Redis、对象存储和固定端口全部由正式 runner 清理。
- 定向验证不替代新的 detached clean-checkout 完整 `make verify`。
