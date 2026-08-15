# Frontend V2 Phase 6 Configuration 抽象回顾与 Exit Gate 审计

## Goal

对 Frontend V2 Phase 6 Configuration 已交付的 Platform、Platform Type、Prompt 与 AI Channel 全部 surface 做最终抽象回顾和退出门禁审计；只关闭有当前代码与测试证据的 P0/P1/P2 缺口，不新增业务能力，不为形式统一引入框架。最终以可追溯证据矩阵给出 Phase 6 `MET` 或 `NOT_MET` 结论。

## Background / Confirmed Facts

- 规划开始前主工作区位于 `main` 且 clean，没有活动 Trellis Task。
- `frontend-v2-ai-channel-configuration-e2e` 已由提交 `52df2e25` 归档到 `.trellis/tasks/archive/2026-08/08-15-frontend-v2-ai-channel-configuration-e2e`，该提交是当前 `main` 的祖先；后续 `a24ca60b` 为当前规划基线。
- Phase 6 的 Platform List、Platform Workspace、Platform Type、Prompt Workspace、AI Channel List/Workspace/Models/Runtime 均已合入 `main`；权威进度记录仍缺最后的抽象回顾与 Exit Gate 结论。
- 最近 Configuration real-stack gate 实际结果为 V2 `13 passed`、指定 V1 `5 passed`，合计 `18 passed`、退出码 `0`；secret/trace 扫描和 PostgreSQL、Redis、临时存储、进程、端口 cleanup 均通过。
- Configuration 的 URL、Query、Form、revision、action、secret 与跨域 cache owner 已由 Frontend V2 蓝图、ADR 和 `.trellis/spec/frontend/state-management.md` 定义；本 Task 不重新设计产品流程。

## Source Documents

- 根 `AGENTS.md`、`frontend-v2/AGENTS.md`
- `docs/frontend-v2/02-information-architecture-and-routing.md`
- `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 7 节
- `docs/frontend-v2/04-design-system-and-interaction-spec.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/06-code-architecture-and-project-structure.md`
- `docs/frontend-v2/07-migration-plan.md` 第 11、16 节
- `docs/frontend-v2/08-testing-quality-and-acceptance.md` 第 13.12–13.20 节
- `docs/frontend-v2/09-architecture-decisions.md` ADR-035–043
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- 已归档 Phase 6 Task，尤其 `frontend-v2-ai-channel-configuration-e2e`

## In Scope

### R1. 建立完整审计证据矩阵

在本 Task 的 `research/audit.md` 逐项记录证据、严重级别、权威 owner、处理决定与验证结果，至少覆盖：

- Platform List、Platform Workspace/Accounts、Platform Type；
- Prompt Library/Editor/Preview；
- AI Channel List、Workspace Core、Models、Usage/Logs/Audit Detail；
- 对应 routes、generated API types、query keys、mutation invalidation、component/model tests、strict fixture E2E、real-stack E2E 与权威文档。

每个 P0/P1/P2 finding 必须有 `file:line` 和可观察影响；没有证据的审美偏好、文件行数、假想复用或未来需求不得成为 finding。

### R2. 回顾抽象与依赖所有权

- 核对固定依赖方向 `routes -> domains -> design-system/shared`，以及跨域 cache composition 是否仍只在 route/application owner。
- 核对重复交互、状态映射、错误映射、query key、action resolver、form/schema 与 UI primitive；优先删除重复或复用现有 owner。
- 只有同一稳定语义已有多个真实消费者且提取后减少重复 owner 时，才允许最小共享抽象；不因两个相似页面或大文件机械提取。
- 明确记录经审计决定保留在 domain-local 的重复，避免把短、不同语义的 mutation/cache/error 流程合并为万能 helper。

### R3. 回顾状态、并发与安全边界

- URL、TanStack Query、RHF 与 local state 必须各有唯一 owner，不得出现第二份 page/tab/filter/revision/dirty 状态。
- `workflow_stage`、`primary_task`、`available_actions`、`deletion` 与 revision 继续由服务端权威投影；前端不得按 status/role/message 重建资格。
- 所有 409/revision conflict 保留草稿或确认上下文、禁止自动 replay，并只在显式 reload 后采用 canonical state。
- API Key 与普通/敏感 Header value 继续 replacement-only，不进入读取响应、Query cache/key、DOM、日志、测试 artifact 或错误详情。
- Configuration mutation 只失效真实消费者，不清空 QueryClient，不改写不可变历史或无关 domain cache。

### R4. 只修复审计证实的 Exit Gate blocker

- P0/P1/P2 只在现有 Phase 6 行为和既定合同内用最小 diff 关闭；允许最终没有生产代码修改。
- 修复必须落在共同 root owner，不给单一路径增加症状补丁、兼容 fallback、silent default 或第二套 DTO。
- 若 blocker 必须改变公共 API、数据库、权限模型、部署、依赖或 Phase 6 产品范围，停止实施并回到 planning；不得在本 Task 自行扩大授权。

### R5. 关闭文档漂移并判定 Exit Gate

- 更新 `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md` 与必要的 ADR/spec，使代码、合同、测试和当前结论一致。
- Phase 6 只有在 Product、Engineering、UX/Accessibility、Architecture、Contract/Data Integrity、Documentation 六类均有证据，且未解决 P0/P1/P2 为 0 时才能标记 `MET`。
- 任一 P0/P1/P2 未关闭或 required validation 未通过时必须标记 `NOT_MET`，列出 owner、影响与后续授权需求，不得用历史通过结果覆盖当前失败。

## Acceptance Criteria

- [ ] `research/audit.md` 覆盖全部 Phase 6 surface、routes、API/query/action/form/cache owner、测试分层和文档，并为每个结论给出 `file:line` 或实际命令证据。
- [ ] 每个审计 finding 都有严重级别、根因、影响、权威 owner 与处理结果；所有 P0/P1/P2 均已关闭，或 Phase 6 明确保持 `NOT_MET`。
- [ ] 没有新增业务能力、第二套 API DTO、全局 Store、事件总线、万能 Settings/Table/CRUD/Workspace/Runtime framework 或新依赖。
- [ ] Platform、Prompt、AI Channel 的 URL/Query/Form/local state、server-driven actions、revision/no-replay、secret 和精准 cache 边界均保持单一 owner。
- [ ] 若需要生产代码修改，使用最小 root-cause diff，并留下能在逻辑回归时失败的最小 component/model test；无真实缺口时生产代码和测试保持不变。
- [ ] Configuration targeted tests 与最终候选级 `make verify` 通过；命令、计数、耗时、失败归因、cleanup 和剩余风险写入 `implement.md`。
- [ ] 权威 Frontend V2 文档、稳定 frontend specs、OpenAPI/generated types 与实现一致；若无需修改合同或数据库文档，closeout 明确说明原因。
- [ ] 最终 Phase 6 Gate 结论只在当前候选证据满足六类 DoD 且未解决 P0/P1/P2 为 0 时写为 `MET`。
- [ ] 提交前展示精确 commit plan 并等待确认；不 push、不创建 PR，不自动开始 Phase 7。

## Out of Scope

- Phase 7 System、Phase 8 Workbench、Phase 9 Cutover 或 V1 删除/重构。
- 新增 Configuration 页面、字段、动作、筛选、Runtime 能力、真实云 Provider 或产品流程。
- 公共 API、数据库 migration、权限模型、deployment、E2E orchestration、secret recorder 或依赖变化；发现真实需要时回到 planning。
- 以文件长度、命名偏好或表面相似为理由拆分页面；补全所有 specs、重写既有测试或统一全部 error/notice helper。
- 把 fixture E2E 冒充真实栈，或机械重做最近已通过且未受变更影响的 secret/cleanup 实验。

## Affected Contracts

- 默认不修改 `contracts/openapi.yaml`、`contracts/database.md`、backend runtime 或 generated types。
- 审计只验证这些权威来源与现有消费者一致；若发现必须改变公共合同，按 R4 停止并重新提交规划。

## Planning Gate

- 当前 Task 保持 `planning`。
- 本轮只提交 `task.json`、`prd.md`、`design.md` 与 `implement.md`；不运行 `task.py start`、不创建实施分支、不修改生产代码。
- 只有用户在看到本轮最终规划摘要后明确批准，才进入 Phase 2。
