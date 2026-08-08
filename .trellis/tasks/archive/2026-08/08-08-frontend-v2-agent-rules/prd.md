# Frontend V2 Agent Rules

## Goal

创建精简的 `frontend-v2/AGENTS.md`，让 Frontend V2 特有的架构、状态所有权、服务端动作权威、UI Pattern、开发节奏与质量要求在后续会话中自动生效，同时继续由根 `AGENTS.md` 承担项目通用规则。

## Confirmed Facts

- `frontend-v2/` 当前为空，目录内没有更具体的 `AGENTS.md`。
- 本任务是 `docs/frontend-v2/07-migration-plan.md` 第 5.1 节定义的 Phase 0.1 准备任务。
- 本任务不改变 API、数据库、配置、部署或运行时行为。

## Source Documents

- 根 `AGENTS.md`
- `docs/frontend-v2/07-migration-plan.md` 第 3、4、5.1 节
- `docs/frontend-v2/01-technical-architecture.md`
- `docs/frontend-v2/04-design-system-and-interaction-spec.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/06-code-architecture-and-project-structure.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`

## Requirements

- 只新增 `frontend-v2/AGENTS.md`，不复制根 `AGENTS.md` 的安全、Trellis、Git、语言和通用质量规则。
- 提供后续 V2 Task 的必读入口和最小上下文加载规则。
- 固化已批准的技术栈及 `routes -> domains -> design-system/shared` 依赖方向。
- 明确 Server State、URL State、Form State、Transient UI State 的唯一所有者。
- 明确服务端 `workflow_stage`、`primary_task`、`available_actions` 和 mutation eligibility 权威，Action Registry 只做展示映射。
- 固化 Table、Workspace、不可变 Detail 的边界和页面固定开发节奏。
- 明确直接验证、自审及完成报告要求。
- 明确禁止万能 DataTable、Redux、Next.js、客户端页面状态机和猜测性兼容逻辑。

## Out of Scope

- 初始化 React/Vite 应用或安装依赖。
- 修改 `frontend/`、`backend/`、`contracts/`、部署文件或任何 V2 蓝图。
- 实现 Foundation Bootstrap、Design System、页面、测试或业务能力。
- 创建或启动下一 Trellis task。

## Acceptance Criteria

- [ ] `frontend-v2/AGENTS.md` 存在，内容仅为 V2 目录级规则。
- [ ] 必读入口、技术栈、依赖方向及四类状态所有权完整且与蓝图一致。
- [ ] 服务端动作权威、Action Registry、Table、Workspace、不可变 Detail 规则完整且无客户端业务资格推导。
- [ ] 固定节奏、验证、自审和完成报告要求可直接指导后续会话。
- [ ] 五项禁止模式全部明确，未知契约显式失败而非猜测兼容。
- [ ] 除 Trellis task artifacts 和 `frontend-v2/AGENTS.md` 外没有其他改动。
- [ ] 未提交、push、合并、归档或继续下一 Task。
