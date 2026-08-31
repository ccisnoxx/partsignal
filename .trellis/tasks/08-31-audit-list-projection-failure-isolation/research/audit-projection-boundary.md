# Audit 列表投影失败边界审计

## 1. 审计结论

根因是严格 label allowlist 的 throwing API 被直接用于两个 React render 集合：`AuditRow` 和动作 `SelectItem`。未知 action 不会使 list/filter-options query 失败，而会在 query 成功后的同步 render 中抛错，最终由 `/system/audit` route `errorComponent` 捕获。Detail 已有局部 strict projection result，不是本次根因。

## 2. 权威合同

- `contracts/openapi.yaml:3598-3600`：`AuditLog.action` 为 `string`，不是 enum。
- `contracts/openapi.yaml:3629-3635`：`AuditLogFilterOptions.actions` 为 `string[]`。
- `AuditLog` list schema 只含 metadata、actor、action、target、outcome、request、time，不含 `changes`、`facts` 或 `change_summary`。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md` 与 `.trellis/spec/frontend/state-management.md:1066-1124`：list/options/detail 是三个独立 GET；detail lazy；七列；未知 action/field/value 必须安全失败；不得 raw JSON。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`：服务端持有筛选/分页/权限，AI Runtime 复用全局 Audit Detail owner。
- `contracts/database.md`：Audit append-only；本 Task 不改变持久化、保留或删除规则。

## 3. 当前代码证据

| 表面 | 数据路径 | 投影位置 | 当前结果 |
| --- | --- | --- | --- |
| List | `auditListQueryOptions` -> `logs.data.items` | `system-audit-page.tsx:191-193` | 任一 unknown action 在 `AuditRow` render 抛错 |
| Filter options | `auditFilterOptionsQueryOptions` -> `options.data.actions` | `system-audit-page.tsx:223-224, 275` | API unknown 或 current URL unknown 在 options render 抛错 |
| Detail | `auditDetailQueryOptions` -> `AuditDetailContent` | `audit-detail-content.tsx:81-97` | `try/catch` 转为详情局部失败 |
| Route | `SystemAuditPage` render error | `system.audit.tsx:32-34` | 整个路由被 `RouteError` 替换 |

`auditActionLabels` 位于 `audit.model.ts:166-181`；`auditActionLabel` 在 `audit.model.ts:194-197` 查不到 label 时抛出包含原 token 的 Error。

## 4. 三个 query 的既有隔离

- list key：`['audit', 'list', apiParams]`
- options key：`['audit', 'filter-options']`
- detail key：`['audit', 'detail', auditLogId]`

三者拥有独立 queryFn、错误文案和 cache identity，均为 `retry: false`、`retryOnMount: false`、`staleTime: 30_000`。`logId` 不进入 list API params。route loader 只预取 list 与 options；System Audit 只在 `logId` 存在时挂载 detail；AI Runtime 使用 `enabled: target !== undefined` 的共享 detail query。

因此修复不能把未知 action 变成整个 query 的 error，也不需要改 query key、API owner 或 route loader。

## 5. 共享 owner 影响

全仓生产 `auditActionLabel` 调用者只有：

1. System Audit row：`system-audit-page.tsx:192`
2. System Audit action options：`system-audit-page.tsx:275`
3. 共享 Audit Detail projector：`audit-detail-content.tsx:85`
4. AI Channel Runtime list：`ai-channel-runtime-section.tsx:152`

System Audit 与 AI Runtime 共同使用 `auditDetailQueryOptions`、`AuditDetailContent`、`OutcomeBadge`、`actorLabel` 和 `formatTime`。本 Task 只能为 System Audit list/options 增加 non-throwing local projection consumer；不能改变共享 Detail 的 key、renderer 或字段 registry，也不能重构 Runtime。

## 6. 当前测试证据与缺口

已有：

- model 覆盖 canonical search、时间转换、已登记 action 和未知 action throw。
- component 覆盖七列、Enter lazy detail、Escape focus restore、时间校验。
- E2E 覆盖 canonical URL、server 参数、Enter/Space/history、deleted actor、outcome 三态、related entry、detail 409、越界、四宽度和 ENGINEER 403。
- fixture teardown 拒绝未允许 `console.error`、`pageerror`、request failure 和未声明 API。

缺口：

- fixture list/options 只包含已登记 action，没有 mixed row 或 unknown option。
- component/E2E 不能证明一个坏行不会触发 route error。
- current URL unknown action 会由 `actionOptions` 补回并直接抛错，没有局部反馈或清除测试。
- stale-data 分支、已打开合法 detail 遇到 mixed refresh、坏行无 detail request 尚无直接证明。
- 现有 sentinel 负向断言没有把 sentinel 作为不受信任输入注入，因此不能证明浏览器 surface 不泄漏。

## 7. 最小边界判断

仅以“单条 AuditRow”作为边界不够，因为 filter-options 是独立 query 和独立 render 集合；仅以“筛选区”作为边界也会让一个坏 option 隐藏所有合法动作筛选项。最小权威边界应分别是：

- 单条 AuditRow 的 action label projection。
- 单个 filter action option 的 label projection，以及 current URL action 的 unavailable selection 状态。

二者复用 Audit domain 的同一个 strict、non-throwing 判别式 projector，但不建立全站 abstraction。

## 8. 审计期间未执行

- 未运行 `task.py start`。
- 未修改 frontend/backend/contracts/database/production data。
- 未运行 Vitest、Playwright 或全仓 gate；当前阶段只有文档与代码只读审计，精确命令已冻结在 `implement.md`。
- 未修改或归档 `08-30-v2-live-readonly-acceptance` 和 parent baseline。
