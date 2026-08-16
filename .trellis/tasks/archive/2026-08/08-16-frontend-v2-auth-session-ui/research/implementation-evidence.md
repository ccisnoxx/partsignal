# Auth Session UI 实施证据

## 实现结果

- `/login` 通过 generated Login contract 建立 cookie session，并按服务端 `must_change_password` 进入固定内部路由。
- `/account/security` 使用当前 canonical CSRF 提交 generated ChangePassword contract，成功后重新读取服务端 User/CSRF；不在客户端推导状态。
- `_app` 共同边界在 anonymous/must-change 时阻止 App Shell 和子路由 loader；账户菜单提供自助改密与退出。
- ENGINEER 直接进入 System 路由保留 URL、聚焦 403 且不运行子 route loader；服务端仍是权限最终权威。
- password 只存在于表单和 direct async 调用栈，不进入 TanStack mutation cache、URL、storage、日志、trace/video 或 Playwright output。
- 同步更新既有 frontend quality 与 infra E2E isolation spec，使 Foundation active session fixture、专用 Auth fixture 和唯一 real-stack fixed list 与实现一致；没有新增平行规范。

## Required validation

| 检查 | 实际结果 |
| --- | --- |
| targeted Vitest（AuthProvider、providers、App Shell、Login、Account Security） | `5 files / 23 tests` 通过 |
| strict production-artifact Auth + Foundation，mobile/desktop | `4 passed` |
| `npm --prefix frontend-v2 run api:check` | 通过 |
| `npm --prefix frontend-v2 run lint` | 通过 |
| `npm --prefix frontend-v2 run typecheck` | 通过 |
| `npm --prefix frontend-v2 run build` | 通过；仅保留既有 Markdown editor 大 chunk warning |
| `bash -n deploy/scripts/e2e-local.sh` | 通过 |
| backend identity PostgreSQL integration node | `1 passed / 2.20s` |
| 唯一隔离入口 V2 real-stack | `14 passed` |
| 唯一隔离入口 V1 E2E | `52 passed / 5.5m` |
| 唯一隔离入口退出 | exit `0` |

strict 与 real-stack Auth spec 均显式关闭 trace，并在 finally 递归扫描当前 Playwright output；未发现测试密码。首次 DB 0 preflight 按既有安全规则拒绝执行，改用独占 Redis container 的非零 DB 1 后完成唯一候选运行，不涉及产品失败。

## Cleanup

唯一入口 EXIT trap 实际报告：Redis DB 1 的本次 key 已删除；`8000/9001/5173/4173/4174/19009` 全部释放；临时数据库已 drop；临时对象存储已移除。调用方随后清理独占 Redis container，运行后没有 `partsignal-auth-e2e-redis-*` container。

## 交付门禁

实现尚未提交或归档。`frontend-v2-system-admin-e2e` 保持 `planning`；Auth Task 归档后仍须重新审计真实 selector/redirect，并由用户单独批准后才能开始。
