# Frontend V2 Phase 4 — Publication Work List

## Goal

实现 Frontend V2 的 `/publishing/work`，让运营人员在一个列表页查看四项发布运营摘要、待开始内容和非终态 PublicationWork，并从服务端允许的 Ready Item 为明确选择的匹配账号创建 canonical PublicationWork。

## In Scope

- 顶部只展示四项摘要：待开始、进行中、待核验、需处理。
- Ready Queue 展示内容标题、具体平台、Approved Content version、匹配账号和服务端允许时的“开始发布”。
- Active Publication Work Table 固定六列：内容（标题 + Product）、平台 / 账号、当前阶段、最近情况、更新时间、操作。
- `page`、`pageSize`、`status` 进入 canonical URL search params；分页、筛选、排序由服务端完成。
- 只消费服务端 `workflow_stage`、`primary_task`、`available_actions`；每行最多一个 primary，其余动作进入 overflow。
- START 对话框要求用户明确选择 `matching_accounts` 中的账号；请求体只有 `content_version_id` 和 `platform_account_id`。
- START 使用 CSRF、按请求体稳定的 `Idempotency-Key`、pending 防重、结构化错误和 request ID；409 不自动重放。
- 创建成功后采用响应中的 canonical PublicationWork ID，停留列表、回到未筛选第一页并刷新相关服务端投影。
- 补足页面所需的 OpenAPI/backend read model、generated types 和针对性测试。
- 覆盖独立 loading/error/empty、filtered empty、no-account、响应式、keyboard 与 Dialog focus return。

## Out of Scope

- Publication Work Workspace 及 preparation/result/verification/close 表单。
- `/publishing/work/$workId` 页面或占位页面。
- Published Articles、Published Content Issues、Publishing 完整 real-stack E2E、Phase 4 抽象回顾和后续路由。
- 通用 Publication framework、workflow engine、万能 DataTable、workbench context 聚合 endpoint。
- 客户端资格推导、客户端业务 DTO join、客户端 summary 计算、页面层 `Promise.all` 拼装 read model。
- 新状态库、新依赖、数据库迁移、V1 runtime/UI 改造、`frontend/` 删除或重构。

## 已确认的 Contract / Read-model 事实

- `PublicationReadyItem` 已有页面所需的标题/version、平台、账号和服务端动作字段；缺口是当前查询把没有 active matching account 的候选整体过滤掉，页面无法呈现 no-account 状态。
- `PublicationWorkListItem` 缺少 Product compact summary 和 latest event；现有 `latest_verification_*` 不能表达普通“最近情况”。
- summary、ready items、work list 当前均为固定次数批量投影，没有已证实的逐行 N+1 或前端 join。
- 三个 GET surface 不需要共同参与同一个业务决策；跨 HTTP 请求的瞬时差异可接受，START 仍由 POST 在事务锁内重新校验。
- 现有 work list 的服务端分页、单 status filter 和稳定优先级排序足够本页；本任务不增加搜索、复合状态或 Ready Queue 分页。
- `PublicationWorkCreate` 已严格只有两个 UUID；create service 已复核 approved/current content、平台、账号、重复工作和幂等键。

## Requirements

### Read model

- Ready 候选不因缺少可用账号而消失；没有账号时 `matching_accounts=[]`、`available_actions=[]`，有可用账号且满足其他资格时才由服务端返回 `START`。
- `ready_count` 与 Ready Queue 的候选定义一致，因此包含暂时没有可用账号的待开始内容。
- `PublicationWorkListItem` 复用现有 `ContentTaskProductSummary` 增加必填 `product`，复用现有 `PublicationWorkEvent` 增加必填 `latest_event`。
- 有效 PublicationWork 必有 `CREATED` event；投影遇到缺失 event 必须显式失败，不返回猜测或空 fallback。
- work list 新增 Product join 和单次批量 latest-event projection 后仍保持固定查询次数。
- OpenAPI 为三个 GET 补齐认证错误，并为 POST 补齐实际存在的 401/403/404/409/422 structured error responses。

### Page behavior

- Ready Queue 的 START 按钮只由 `available_actions` 中的 `START` 决定；不得根据 ContentVersion status 或账号数量推导资格。
- no-account 只是服务端投影状态的展示；不提供 START，不能临时请求全局账号列表补齐。
- Work 行只把服务端 task/action token 映射为 label 和 canonical future Workspace href；不执行 Workspace command，也不显示通用“查看详情”。
- summary、ready queue、active list 各自请求、各自呈现 loading/error/empty，不组合成页面 DTO。
- 宽表只在 `TableRegion` 内局部横向滚动；375/768/1024/1440 下页面本身不得横向溢出。
- Dialog 使用已有 Base UI focus 管理，关闭后恢复触发器焦点；错误与成功状态使用可感知的 live/alert 语义。

## Acceptance Criteria

- [ ] `PublicationReadyItem` 的字段 shape 保持复用，但查询能返回 no-account 候选，START 完全由服务端 actions 投影。
- [ ] `PublicationWorkListItem` 一次响应足以画出固定六列，包含必填 `product` 和 `latest_event`，前端不做逐行请求或 join。
- [ ] summary、ready items、work list 继续使用三个现有窄 endpoint；没有新增 workbench context。
- [ ] summary 只显示四个蓝图指标；不显示现有 `open_issue_count`，也不从完整 work 集合计算指标。
- [ ] URL canonicalization、direct URL、refresh、Back、Forward、status filter、pagination 和 URL 恢复通过测试。
- [ ] Ready loading/error/empty/no-account、账号明确选择、START 显示规则通过测试。
- [ ] POST 精确发送两个字段并携带 CSRF 和稳定 Idempotency-Key；pending 防重，409 不自动重放。
- [ ] 404/403/409/422 显示结构化信息与 request ID；失败保留账号选择。
- [ ] 成功使用响应中的 canonical ID，回到默认第一页并失效 summary、ready、work lists 和直接受影响的 Content projections。
- [ ] Work Table 的六列、服务端 stage、primary/overflow、全局 empty/filtered empty 和独立错误状态通过 component coverage。
- [ ] 375/768/1024/1440、keyboard、Dialog focus return、console/pageerror/requestfailed audit 通过 production-artifact Playwright。
- [ ] backend targeted tests 直接证明 START_PUBLICATION 创建边界，以及 Product/latest event/no-account/固定查询次数投影。
- [ ] contract-check、generated types、targeted backend/frontend tests、V2 lint/typecheck/build 和 targeted Playwright 均通过。
- [ ] 未实现任何 Out of Scope 项；无新依赖、无数据库迁移、无 V1 runtime/UI 修改。

## Notes

- 完整 approved content → start work → register result → verify real-stack 闭环保留到 Phase 4 Publishing E2E 检查点。
- 本任务当前仅处于 planning；获得批准前不运行 `task.py start`、不创建分支、不修改业务代码。
