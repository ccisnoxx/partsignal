# Frontend V2 System Admin E2E — Implementation Evidence

日期：2026-08-17（Asia/Shanghai）

## 变更范围

- 新增 `frontend-v2/tests/e2e/system-admin-real-stack.spec.ts`：一个真实 ADMIN/ENGINEER 生命周期场景。
- `deploy/scripts/e2e-local.sh`：在既有 V2 fixed list 追加上述 spec；未改变 lifecycle、端口、数据库、Redis、storage 或 EXIT trap owner。
- 更新当前 Task 与 Phase 7 验收文档；未修改产品源码、backend、OpenAPI、数据库合同、依赖、Playwright config 或 Makefile。

## 独立诊断

- `bash -n deploy/scripts/e2e-local.sh`：exit `0`。
- E2E database/environment Python scripts `py_compile`：exit `0`。
- `npm --prefix frontend-v2 run api:check`：通过。
- `npm --prefix frontend-v2 run typecheck`：通过。
- `npm --prefix frontend-v2 run lint`：通过。
- `npm --prefix frontend-v2 run build`：通过；只有既有 chunk warning。
- Auth/Users/Audit strict Playwright：`22 passed`。
- identity/audit PostgreSQL integration nodes：`6 passed / 6.18s`。
- 禁止模式检查：无 `page.route`、`route.fulfill`、`postData(`、`allHeaders(`、`storageState`、`testInfo.attach` 或 `page.screenshot`。

Targeted component 命令为非零：未改动的 `user-list-page.test.tsx` 7 条与 `system-audit-page.test.tsx` 1 条均在各自独立重跑中稳定报 `useAuth 必须在 AuthProvider 内使用`。失败发生于归档 Auth UI 后未同步包装 provider 的 component harness，不属于本 Task diff；production artifact 与最终真实栈均通过，因此未跨 owner 修改。

## 最终 fail-fast 编排

入口：向 `deploy/scripts/e2e-local.sh` 注入宿主可访问的本地 PostgreSQL URL 与独占 Redis DB 14；未启用 shell trace，未记录 credential URL。

- V2 real-stack：`15 passed (1.2m)`；新增场景 `2.8s`。
- V1 E2E：`52 passed (5.5m)`。
- 总退出码：`0`。
- 总耗时：`417s`。

新增场景观察到：六个 ADMIN-only API 返回真实 `403`；password reset 后旧 ENGINEER session 的 `/api/v1/auth/me` 返回 `401/AUTH_REQUIRED`；bulk 为 ENGINEER 成功 1 与 seed ADMIN `LAST_ADMIN_REQUIRED` 失败 1；create/reset/bulk Request ID 均进入 Audit List，create 记录在点击前无 Detail 请求、点击后只加载对应 Detail；ENGINEER 删除后改密审计仍存在且 actor 采用 deleted projection。

## 敏感信息与清理

- password、Cookie value、CSRF token 与 request body 未进入测试产物或失败输出。
- real-stack trace 关闭；未生成 video、screenshot、storage state 或 attachment。
- EXIT trap：Redis DB 14 本次 key 已删除；固定六端口已释放；临时数据库 `partsignal_e2e_20260817_20828` 已 drop；临时 storage 已移除。
- 事后只读核验：Redis DB 14 `0` key、临时数据库匹配数 `0`、storage 不存在、`8000/9001/5173/4173/4174/19009` 全部空闲。

按任务约束未运行 `make verify`；该检查保留给 System 抽象回顾或发布门禁。
