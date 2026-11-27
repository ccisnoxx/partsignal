# A07 AI 渠道列表

## Goal

验收 `/settings/ai` 的 ADMIN-only 渠道列表、服务端筛选分页、安全摘要与管理命令。

## Requirements

- 前置 F04/F05 已按本轮证据完成，A01 不构成本项代码前置。权威为 `docs/frontend-v2/11-frontend-redevelopment-task-list.md` A07、`03-page-and-workflow-blueprint.md` 配置页、`05-business-actions-state-and-api-contract.md` AI 渠道合同、`08-testing-quality-and-acceptance.md` 对应门禁及 OpenAPI。
- 列表展示服务端安全摘要与筛选分页，不回显 API key/credential/header secret。ADMIN-only 前端路由与后端最终权限同时生效。
- 创建、启停、删除只使用服务端动作/revision。启用确认采用当前 exact query 的有效目标；pending 不重复派发。409 保留 request ID 和冻结状态，只有显式成功重读后恢复，失败或被动刷新不解冻。
- 删除 204 后旧缓存行不得继续提供动作；成功失效渠道列表及相关实际消费者，读失败应显式保留诊断。secret 不进入可持久缓存或日志。

## Acceptance Criteria

- [x] backend/contract、model/page/API 直接测试证明权限、安全摘要、分页、revision/409 与 secret 边界。
- [x] 当前 production artifact 严格 fixture 在 mobile/desktop 覆盖 URL、状态、管理命令、确认交错、失败重载和四档布局。
- [x] 记录实际代码、当前证据、独立复核、残余风险及 A08 后继，检查 diff/工作树。

## Notes

- A07 与 A01 在不同页面 owner 并行准备；根合同由主代理维护。历史门禁不算本轮结果。

## 本轮实施与验证证据

- 初次只读审计确认列表 409 可被复用确认/被动状态更新绕过、pending 启用可重复提交，以及 DELETE 204 后刷新失败留下旧缓存行。页面 owner 在 `frontend/src/domains/configuration/ai-channel-list-page.tsx` 将命令意图绑定 ID/命令/exact query scope，确认时重读服务端投影；同步命令锁、409 显式成功 reload、成功 DELETE 后先取消旧读取并移除各列表缓存目标。直接测试在 `ai-channel-list-page.test.tsx` 覆盖这些交错。
- 独立高风险复核另确认创建 API Key 在 pending `useMutation` variables 留于共享 MutationCache。主代理将创建请求改为私有请求状态、同步提交锁、卸载清理及迟到响应保护；新增 pending/卸载前后 MutationCache、QueryCache、DOM 不含 sentinel 的直接测试。复核再次确认 P1 已解除。创建成功但工作区交接拒绝时，页面只保存不含密钥的 canonical 响应并提供“重新打开渠道”动作，不重发 POST；此补丁也经独立窄范围复核。
- 实际代码/回归限 `ai-channel-list-page.tsx`、其直接测试、`frontend/tests/e2e/fixtures/ai-channels.fixture.ts` 和 `frontend/tests/e2e/ai-channel-list.spec.ts` 四个文件。隔离 PostgreSQL `test_ai_channel_management.py` **8/8**；model/page **20/20**；当前 production artifact 严格浏览器 mobile/desktop **12/12**，新增 DELETE 409 显式 reload 失败/成功、删除后 GET 503 旧行不可复活。`npm run typecheck`、所属四文件 ESLint、`git diff --check` 均通过；E2E WebServer 从当前源码构建 production artifact。
- 未对所有网络取消交错和整个应用的 secret 消费者做全局审计；A08/A09/A10 将分别审查 Workspace secret、Model 与 Usage/Logs。工作树其余修改属本轮其他子任务和 S01 并行 owner，均保留。下一项按已满足的 F 前置进入 A08。
