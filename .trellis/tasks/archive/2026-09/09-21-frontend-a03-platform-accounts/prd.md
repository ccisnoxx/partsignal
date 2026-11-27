# A03 平台工作区账号区

## Goal

验收 `/settings/platforms/$platformId?tab=accounts` 的按需账号列表与 revision/blocker 命令。

## Requirements

- 前置 A02 已按本轮证据完成；权威为平台工作区合同、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`、任务清单 A03 与 OpenAPI。
- Accounts query 只在 active tab 读取，按当前 platform scope 隔离；创建、编辑、启停、删除均使用当前账号 projection/revision/blocker，409 仅成功显式 reload 解冻。
- mobile/desktop 共享动作语义，不跨平台串数据；敏感账号字段按安全 projection 展示，失败与未知 action 显式。

## Acceptance Criteria

- [x] page/model/API 与 PostgreSQL 直接测试覆盖按需读取、scope 隔离、revision、blocker、409 与命令失效。
- [x] 当前 production artifact 严格 fixture mobile/desktop 覆盖 Accounts URL、命令、错误、focus 与四档布局。
- [x] 记录实际代码、独立复核、残余风险及 A04/A11 后继；检查实际 diff/工作树。

## 本轮实施与验证证据

- `frontend/src/domains/configuration/platform-workspace-page.tsx` 保持 Accounts active-tab lazy query 与 platform scope；账号 DELETE 409 以 `Set<accountId>` 页面级冻结，关闭重开仍冻结，成功 exact reload/成功删除/目标消失只清对应 ID。DELETE 204 先接受并关闭 Dialog，再异步刷新消费者；刷新失败显示可重试 Notice，禁止重复 DELETE。
- 直接 page/model 回归 **23/23**；当前 production artifact `frontend/tests/e2e/platform-workspace.spec.ts` mobile/desktop **20/20**，包含删除 409 关闭重开、失败 reload 与 A/B hold 隔离；平台账号 PostgreSQL 集成测试 **4/4**，全局 `npm run typecheck`、所属 ESLint、`git diff --check` 通过。
- 独立高风险复核未发现阻断；残余仅为 strict E2E 尚未单独扩展到 A/B 分别重开后的视觉断言，直接回归已覆盖 Set 隔离、409 reload 与消费者失效失败。

## Notes

- 复杂交互的设计与实施顺序见同目录 `design.md`、`implement.md`。
