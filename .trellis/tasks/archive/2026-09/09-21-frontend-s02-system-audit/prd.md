# S02 系统审计

## Goal

验收 `/system/audit` 的 ADMIN-only 审计列表、URL 筛选分页、按需安全 Detail 与响应式详情展示。

## Requirements

- 前置 F03/F05 已按本轮证据完成；权威为 Users/Audit blueprint、`05-business-actions-state-and-api-contract.md`、`08-testing-quality-and-acceptance.md`、OpenAPI 与任务清单 S02。
- 列表只消费服务端 metadata projection，URL 持有可恢复筛选与 `logId`；首屏不逐行拉取 Detail，不读取 Users 或业务实体补字段。
- Detail 仅在用户打开时读取安全字段；桌面使用 Pane、移动使用 Sheet；未知字段显式错误，关闭后焦点返回触发按钮，权限与 404/失败保持明确。

## Acceptance Criteria

- [x] model/page/API 与 PostgreSQL 直接测试覆盖筛选、分页、权限、metadata 投影、按需 Detail、错误与未知字段。
- [x] 当前 production artifact 严格 fixture mobile/desktop 覆盖 URL 恢复、Pane/Sheet、焦点、失败与敏感值边界。
- [x] 记录实际代码、独立复核、残余风险及 S03 后继；检查实际 diff/工作树。

## 本轮实施与验证证据

- `frontend/src/domains/audit/audit.model.ts` 将近三天 UTC 默认窗口改为每次解析/重置使用同一 now 快照；缺失、非法、反向范围均按当前快照回退，避免跨 UTC 午夜复用旧日期。
- 直接 model/page 既有回归与新增跨午夜覆盖 **7/7**；所属 ESLint、`npm run typecheck` 通过。已有当前 production strict fixture 覆盖列表筛选、`logId` lazy Detail、desktop Pane/mobile Sheet、focus/history、unknown action、403/坏详情和四档布局，本轮审计复核确认无 P0/P1。
- 独立只读审计确认列表/Detail query 分离、ADMIN route/backend 权限、敏感值不进 trace/fixture、未知投影显式失败。残余风险为 S03 真实 Auth/System 闭环尚未完成。

## Notes

- 复杂状态与响应式验收的设计、实施顺序见同目录 `design.md`、`implement.md`。
