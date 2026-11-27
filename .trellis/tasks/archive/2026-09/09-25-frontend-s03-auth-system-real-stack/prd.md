# S03 Auth 与 System 真实业务闭环

## Goal

验收 Auth 与 System 的真实业务闭环：创建用户、强制改密、权限拒绝、reset 会话失效、bulk partial 与审计追溯。

## Requirements

- 前置 F03、S01、S02 已按本轮证据完成。权威为 Auth/System blueprint、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`、任务清单 S03、OpenAPI 与数据库合同。
- 使用真实 PostgreSQL、production frontend 与实际会话/cookie；创建用户后强制改密，reset 后旧会话失效，ADMIN/ENGINEER 权限由后端最终裁决。
- bulk partial 与单用户命令的成功/失败审计可追溯；临时密码、session/token、secret 不进入日志、trace、URL、fixture 或产物。
- 不用开发适配器伪装身份或固定成功；真实失败保留 request ID 与恢复路径。

## Acceptance Criteria

- [x] PostgreSQL/后端集成与 production real-stack 覆盖创建/强制改密/reset/旧会话失效/权限/bulk partial/audit。
- [x] 敏感值扫描、trace 关闭、命令/审计请求次数与响应边界得到本轮证据。
- [x] 记录实际代码、独立复核、残余风险及 W01/I01 后继；检查实际 diff/工作树。

## Notes

- 真实栈设计与实施顺序见同目录 `design.md`、`implement.md`。

## 本轮实施与验证证据

- `AuthProvider` 将匿名 `204`、失效会话 `401` 与网络/服务故障分开处理，并以认证读取 generation、活动认证命令 barrier 和 canonical commit 防止登录、退出、改密与 `/auth/me` 竞态把旧身份写回。principal/capability 边界变化会清除业务查询缓存并重新裁决路由。
- Auth production real-stack 证明创建/登录、强制改密、管理员 reset、旧 Cookie 被服务端拒绝、重新登录改密与退出后匿名恢复；System production real-stack 证明创建、编辑、两次改密、reset、bulk partial、删除、权限拒绝和安全审计 Detail。两项均为本轮 `1 passed`，最终输出 `E2E_SECRET_SCAN status=clean`、`E2E_RESULT playwright=0 secret_scan=0`。
- 浏览器运行时按请求发生时 phase 记录安全的 `method/path/status` 精确 multiset；Auth 覆盖全部写方法，System 覆盖全部写方法及 `/api/v1/audit-logs` 读取，不保存响应正文、原始 console、page error 或 secret。共享 session helper 在登录响应后立即登记 CSRF/session cookie，并在结束路径重新登记。
- `e2e-local.sh`、数据库生命周期 helper 与 Python process-group supervisor 保证 reporter/后代退出后才扫描，扫描后才清理；缺失/非目录/空/损坏 `.last-run.json` 均 fail closed。部分数据库创建失败按实际已创建资源清理，INT/TERM 保留 130/143，顽固后代升级 SIGKILL，post-wait 阶段不再向数值 PID/PGID 发信号。
- 直接证据：frontend 4 文件 44 测试；process-group 4 测试；数据库 helper 5 测试；lifecycle 与数据库 fault harness；targeted PostgreSQL auth/identity/audit 4 测试；frontend typecheck、owned ESLint、shell/Python syntax 均通过。
- 最终资源核验：隔离 E2E 数据库 0，生产 `partsignal` 数据库仍存在；Redis DB 14 keys 0；端口 8000/9001/4174/19009 均释放；临时 storage、supervisor/reporter/Playwright/Vite 相关进程无残留。`git diff --check` 通过，原检出区保持干净。
- 独立 critical review 在最后补丁后重读当前控制流与 direct tests，确认 `worker.wait()` 后立即 `worker_pid = None`，handler 在 `None` 时只记录 signal，结论为 **NO BLOCKER**。
- 其余七条业务 real-stack spec 已接入同一 secret session helper，并通过类型、lint 和 helper 直接测试；它们未在 S03 逐条重跑，完整浏览器候选由 I02 执行。S03 已满足 W01/I01 前置。
