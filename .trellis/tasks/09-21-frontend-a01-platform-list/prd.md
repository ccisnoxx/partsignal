# A01 平台列表

## Goal

验收 `/settings/platforms` 的服务端 readiness、账号数量、筛选分页、状态与删除命令、角色投影。

## Requirements

- 前置 F04、F05 已按本轮证据完成。权威为 `docs/frontend-v2/05-business-actions-state-and-api-contract.md` §22、`08-testing-quality-and-acceptance.md` §13.12、`11-frontend-redevelopment-task-list.md` A01 和 OpenAPI。
- 读取 `GET /api/v1/platform-profiles` 的 paged read model；展示服务端 readiness 优先级、可用账号数量、全局 summary/type options 与 ADMIN/ENGINEER 动作投影。搜索/筛选/分页由 canonical URL 和服务端处理。
- 删除 Dialog 只存 ID/命令/focus；名称、动作、阻断条件和 revision 从当前 exact query 实时派生，确认前复核。任意删除 409 冻结旧确认，仅显式成功 reload 解除，不自动 replay；删除成功后旧行不能继续作为可执行命令。服务端为权限与状态最终权威。
- 启停使用其既有 command baseline；pending 禁止重复派发，错误和 request ID 不被失败刷新清除。保留焦点与四档布局。

## Acceptance Criteria

- [x] backend contract/PostgreSQL 与 API/model/page 直接测试证明 readiness、筛选、角色、revision 和命令守卫。
- [x] 当前 production artifact 严格 fixture 的 mobile/desktop URL、七列、状态、命令、确认交错、409/reload、焦点和 375/768/1024/1440 通过。
- [x] 记录实际代码、当前证据、独立复核、残余风险及 A02 后继，检查 diff/工作树。

## Notes

- 不以历史 V2 门禁或现有 10/10 基线代替缺失交错场景的本轮验收。

## 本轮实施与验证证据

- 初次基线：model/page 直接测试 **13/13**、隔离 PostgreSQL `test_platform_profile_list.py` **3/3**、production preview 严格浏览器 **10/10**。只读状态审计另外确认三项基线未覆盖的命令交错：DELETE 409 关闭 Dialog 可清除冻结、启用 pending 可重复/跨行派发、已接受命令后列表 GET 失败可暴露旧行操作。
- 实际代码改 `frontend/src/domains/configuration/platform-list-page.tsx`：页面持有 DELETE 409 冻结及已接受命令待新列表确认；同步命令锁覆盖 Primary、overflow、Dialog；显式成功重读解除冲突，失败保留错误与 request ID；删除/启停成功与后续 GET 失败分开呈现，冻结旧写入口。删除末页唯一行时，恢复证据绑定自动返回页的 exact query 与命令前更新计数。保留后端权限、revision 和 blocker 最终裁决。
- 回归改 `frontend/src/domains/configuration/platform-list-page.test.tsx`、`frontend/tests/e2e/fixtures/platforms.fixture.ts`、`frontend/tests/e2e/platform-list.spec.ts`。现在 model/page **15/15**；当前 production artifact 浏览器 mobile/desktop **16/16**，新增 DELETE 409 关闭重开、显式 reload 失败/成功、204 后 GET 503 旧行冻结、末页删除返回上一页恢复命令。`npm run typecheck`、四个所属文件 ESLint、`git diff --check` 均通过；E2E WebServer 由当前源码构建 production artifact。
- 独立只读复核先确认自动翻页与 hold query-key 交接的 P2，修复后再核阅，未发现新增阻断。尚未为已有缓存且旧 GET 迟到的全部交错做独立浏览器矩阵；当前实现先取消旧列表请求再失效并以新成功读取计数解冻。
- A01 实际 diff 限于上述四个文件；工作树中其他 F/P/C/U/G/A07/S01 变更属于本轮其他子任务或并行 owner，均保留。下一项按前置进入 A02 平台工作区，同时 A07/S01 可沿各自已满足的 F 前置并行验收。
