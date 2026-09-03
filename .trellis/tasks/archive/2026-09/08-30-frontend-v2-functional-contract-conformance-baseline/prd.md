# Frontend V2 功能合同一致性基线

## Goal

建立 Frontend V2 37 条 canonical 路由的功能合同一致性基线，逐路由对照信息架构、业务流程、服务端 read model、命令资格、权限、状态转换、OpenAPI、generated client 与现有测试，形成可审阅的差距矩阵和独立后续 Task 依赖顺序。本 Task 只审计和计划，不修改业务代码、公共合同、数据库结构或生产数据。

## Final Closeout State

本审计已完成并通过最终集成核对。37 条 canonical 路由仍全部存在，冻结 OpenAPI、FastAPI runtime document 与 generated client 当前一致；父 Task 的六个直属修复子任务均已归档为 `completed`，且 parent 关系正确。最初推荐的 P0 `publication-verification-final-authority` 也已作为独立 Task 完成。

父 Task 的完成表示“审计闭集、证据分层、缺口分类和后续 Task 边界已交付”，不表示矩阵中的所有后续项都已实施，也不表示 2026-08-30 的线上验收从 `FAIL` 改为 `PASS`。`integrity-error-domain-mapping` 按用户要求继续暂缓，未在本次收尾中创建或启动；其他未实施项仍保持独立后续工作。

## Authoritative Inputs

- 根 `AGENTS.md`、`frontend/AGENTS.md`、`backend/AGENTS.md`。
- `docs/frontend-v2/02-information-architecture-and-routing.md`。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`。
- `docs/frontend-v2/04-design-system-and-interaction-spec.md`。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`。
- `docs/frontend-v2/06-code-architecture-and-project-structure.md`。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`。
- `docs/frontend-v2/09-architecture-decisions.md`。
- `contracts/openapi.yaml` 与 `contracts/database.md`。
- 当前 `frontend/src/app`、`frontend/src/routes`、`frontend/src/domains`、`frontend/src/design-system`、`frontend/src/shared/api`。
- 对应 backend router、read model、command、permission、状态转换实现和当前相关测试。

## Requirements

1. 以 `docs/frontend-v2/02-information-architecture-and-routing.md` 的 37 条 canonical 路由为闭集，不把 legacy redirect 当成新的 V2 页面。
2. 每条路由至少记录：页面 Pattern、业务目标、当前实现状态、API/read model、`workflow_stage`/`primary_task`/`available_actions` 来源、前端业务推导或接口拼接、URL 与 loading/empty/error/conflict/permission 行为、immutable/readonly 要求、测试覆盖、缺口严重度、独立后续 Task。
3. 明确区分观察事实、基于合同的判断和仍需运行时验证的残余风险；不得把 fixture E2E 当成真实后端证据。
4. 对服务端最终权威执行专项核验：命令不得仅依赖前端隐藏动作；read model 与 command guard 必须对权限、revision、状态转换和 immutable 历史保持一致。
5. 对 OpenAPI 与 generated client 执行只读同步核验，并识别 runtime contract checker 未覆盖的响应合同边界。
6. 将当前可复现的 `/geo/topics` `page_size` HTTP 绑定 422 作为已知 P1 阻塞项，冻结根因、影响面、最小修复 owner 与部署后复验要求；本 Task 不修复。
7. 每个后续 Task 只拥有一个可评审目标；合同决策、服务端修复、前端修复和测试收口不得混成一个总修复 Task。
8. 给出依赖顺序，并按数据完整性、服务端最终权威、可复现流程阻塞、可恢复一致性、测试覆盖的顺序排序。

## Severity

- `P0`：可把错误事实写入不可变历史、形成不可逆或高成本纠正的数据完整性风险。
- `P1`：主流程当前被阻断，或服务端最终权威、并发/权限/合同边界存在可实质改变业务结果的缺口。
- `P2`：业务可完成但错误恢复、缓存新鲜度、状态呈现、导航或合同一致性有明确偏差。
- `P3`：文案、元数据、验证粒度或非阻断测试覆盖缺口。
- `符合`：本轮证据未发现需要独立修复的实质偏差；不等于证明不存在所有缺陷。

## Deliverables

- `research/route-conformance-matrix.md`：37 路由逐项矩阵、跨路由缺口、已知 blocker、后续 Task 依赖和首个实施 Task 精确验收标准。
- `design.md`：审计判定方法、权威来源和 Task 拆分原则。
- `implement.md`：本审计 Task 的执行与验证计划；不包含代码修复步骤。

## Non-goals

- 不进行视觉风格重做、品牌设计、Figma、配色或动效优化。
- 不修改前端、后端、OpenAPI、数据库合同、迁移、部署配置或生产数据。
- 不修复本轮发现的任何问题，不创建后续实现 Task，不执行生产写请求。
- 不做无关重构，不把 P2/P3 顺手并入 P0/P1 修复。
- 不用本地 fixture 或 mock 成功替代真实 HTTP/数据库边界证明。

## Acceptance Criteria

- [x] 完整阅读用户指定的 9 份 Frontend V2 文档/合同和根 `AGENTS.md`，并补读前后端专项 `AGENTS.md`。
- [x] 37 条 canonical 路由均进入 conformance matrix，且矩阵覆盖用户要求的 12 个维度。
- [x] 审计前端路由、domain、design-system/shared API、generated client、后端 read/command/permission/state owner 和现有测试。
- [x] `contracts/openapi.yaml` 与 `frontend/src/shared/api/generated/schema.d.ts` 的只读再生成 diff 为零；合同与生成类型均为 128 个 path。
- [x] 冻结 `/geo/topics` 当前 422 的根因、影响、测试漏网原因和独立修复验收标准，未实施修复。
- [x] 标出发布换版后核验的 P0 数据完整性缺口、GEO optimization 并发 P1、全局错误合同 P1 及前端主要 P1/P2。
- [x] 每个缺口映射到一个独立后续 Task 或明确的合同决策 Task，并给出依赖顺序。
- [x] 推荐第一个实施 Task，并给出可直接写入其 PRD 的精确验收标准。
- [x] 本 Task 未修改业务代码、公共合同、数据库、生产数据或现有用户改动。
- [x] 最终核对确认六个直属子任务均已归档完成，当前 37 路由闭集和合同/generated 一致性未回退。
- [x] 最终收尾只更新本 Task 文档和 Trellis 状态，不修改产品代码、公共合同、generated client、测试、数据库合同或业务设计文档。

## Review Gate

审计材料和处置边界已完成人工 review；用户于 2026-09-03 授权继续核对并收尾本 Task。后续实现仍必须使用独立 Task，本次归档不顺手处理任何未完成缺口，也不启动 `integrity-error-domain-mapping`。
