# U06 内容问题工作区

## Goal

验收 `/publishing/issues/$issueId` 的一致上下文、修复依据、修复任务、解决记录与不可变历史。

## Requirements

- 前置 U05、F06 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 5.6 节、`05-business-actions-state-and-api-contract.md` Issue Workspace 合同、`11-frontend-redevelopment-task-list.md` U06 和 OpenAPI。
- 首屏单次 workspace-context 包含 Issue、不可变 Article 和可空 repair task；五个 canonical hash 章节。Fact 候选仅打开 CREATE_REPAIR_TASK 后按需读取 repair-context。
- CREATE_REPAIR_TASK 和 RESOLVE 是独立服务端动作；修复任务不等于问题已解决。命令按服务端 token、revision 和候选资格提交；409/后台变更保留输入、停止旧命令，并提供可达的显式刷新，不自动重放。
- 成功后采用 canonical 服务端投影并刷新列表、成果、摘要和内容投影；问题、成果、解决记录和事件历史只读且身份不一致显式失败。

## Acceptance Criteria

- [x] 组件/模型测试覆盖单读、按需候选、创建/解决、409 与后台刷新、终态和身份失败。
- [x] 当前候选浏览器覆盖五章节、创建→修复→解决交接、URL/错误/宽度与焦点；真实栈闭环在 U07 独立验收。
- [x] 记录实际代码、验收证据和 U07 下一步。

## Notes

- 本项拥有 Issue Workspace 与直接测试，根合同和服务端工作流不变。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`published-content-issue-workspace-actions.tsx` 以 Issue revision、阶段、动作 token 与 repair task 身份冻结已打开草稿；后台撤销动作时仍保留 Dialog，409 后取消 Dialog 仍可从底部操作区显式重载。保留修复草稿时，重载同时读取 Workspace 与 repair context，即使 Issue revision 不变也淘汰旧 Fact 候选。CREATE_REPAIR_TASK 与 RESOLVE 各自提交服务端修订号；POST 到完整 Context 确认期间锁定命令。POST 成功但读取失败时保留已提交状态和输入，阻止重复提交。`published-content-issue-workspace-page.tsx` 在命令后显式 refetch 完整 Context、验证 Issue/Article/repair 身份及命令结果，再刷新消费者；路由 Issue ID 变化时重建动作状态。未改根 API/数据库合同。
- 直接测试 `published-content-issue-workspace-page.test.tsx` 9/9 通过，覆盖首屏单读、按需候选、精确 payload/CSRF、409 后关闭并双 Context 重载、同 revision 的候选资格变化、后台终态撤销、POST 成功而 GET 失败、延迟 GET 期间防重复、已解决记录缺失显式失败。`npm run typecheck`、定向 ESLint、`git diff --check` 通过。
- 当前候选生产预览 `published-content-issues.spec.ts` 移动/桌面 6/6 通过，覆盖 Article→Issue、创建修复与解决彼此独立、OPEN/RESOLVED/ALL 列表投影、canonical hash/URL 与五档宽度；构建有既存大 chunk 提示。独立只读复核发现并验证修复“关闭弹窗后的 repair 候选未刷新”阻断，最终确认 `refetch()` 在禁用的 Query 上仍强制刷新；同 revision 候选变化亦有新增直接测试。浏览器 fixture 不替代 U07 真实栈。
- 下一步 U07：在当前候选 production artifact + 隔离 FastAPI/PostgreSQL/Redis/对象存储执行 Publishing Flow A/B，核对冻结历史和跨域交接；U02 后补完整 Context 风险修复须先完成独立复核与相关回归。
