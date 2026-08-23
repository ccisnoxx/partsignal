# Research: Workbench backend 当前实施候选自审

- Query: 核对 `backend/app/schemas/workbench.py` 当前候选是否严格符合已批准 `implement.md`，是否造成 schema/service owner 漂移、公共合同变化或遗漏 P0/P1，并结合已记录的 contract/lint/typecheck/integration/build 结果判定。
- Scope: internal
- Date: 2026-08-24

## Findings

未发现 finding。

- `backend/app/schemas/workbench.py:110-117` 当前只保留 `WorkbenchAggregate` 的 response fields 与 `recent_attention_items.max_length=10`，原重复排序 validator 已删除；这精确符合 `.trellis/tasks/08-23-frontend-v2-workbench-abstraction-review/implement.md:19-21` 和 `design.md:31-36,66-69`。
- `WorkbenchRate.validate_rate` 与 `WorkbenchWindow.validate_window` 仍分别位于 `backend/app/schemas/workbench.py:62-91`，只保护 ratio/null/window 数据完整性，没有接管 attention 排序。
- attention 稳定排序仍唯一位于 `backend/app/services/workbench.py:394-401`；service 继续在 `:403-474` 形成完整 `WorkbenchAggregate`，未发现 schema/service owner 漂移。
- 当前 schema 字段、类型、required/max-items shape 未变化；删除 model-level 顺序断言不会改变 OpenAPI JSON Schema。已记录 `make contract-check` PASS，支持无 runtime/OpenAPI/generated contract drift。
- 已记录 `make lint` PASS、`make typecheck` PASS；删除 validator 后没有无效 import、类型或静态质量回归。
- 已记录 `make test-integration` PASS：`120 passed in 177.96s`；现有 Workbench integration 继续从 observable service 输出冻结 top-10 稳定排序、GEO current tail、`0/0 -> null`、安全字段与固定查询次数。
- 已记录 `make build` PASS：backend、V1 image 与 V2 build 全部成功；仅有既有 V2 `>500KB` chunk warning，未归因本次 backend schema 删除，不构成 P0/P1。
- 当前任务 `research/audit.md:35` 与 `research/backend-audit.md` 中 A08/B08 的 “open/计划关闭” 是实施前 finding baseline；当前候选已经按计划关闭。最终 closeout 应在实际门禁证据区记录关闭状态，不应改写原始研究发现的历史语境。

## Files Found

- `backend/app/schemas/workbench.py` — 当前唯一 backend 产品改动：删除重复 attention 排序 validator。
- `backend/app/services/workbench.py` — 未改的 Workbench 聚合与排序业务 owner。
- `.trellis/tasks/08-23-frontend-v2-workbench-abstraction-review/{prd.md,design.md,implement.md}` — 已批准 owner、精确变更与验证合同。
- `.trellis/tasks/08-23-frontend-v2-workbench-abstraction-review/research/{audit.md,backend-audit.md}` — A08/B08 基线 finding 与建议处置。

## Related Specs

- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:261-285` — Workbench service 聚合、排序、GEO null 与 V1 隔离合同。
- `docs/frontend-v2/09-architecture-decisions.md:301-318` — ADR-046 backend 唯一 owner。
- `.trellis/spec/backend/quality-guidelines.md` — backend 检查边界。

## Caveats / Not Found

- 本轮按父任务要求未重跑命令；结论使用主会话回传的实际结果：contract-check/lint/typecheck/integration/build 均 PASS。
- 当前只覆盖已完成的五个阶段。`make test-unit`、`make e2e`、dev/prod Compose config、唯一 `make verify` 与 post-check 尚不在本回传证据内，因此本研究不能单独判定 Phase 8 Exit Gate=`MET`。
- 未发现 backend P0/P1、公共合同 blocker、V1 兼容变化或需独立 Task 的问题。残余风险仅是最终全仓阶段尚待完成，以及最终 Task evidence 需把 A08/B08 从实施前 baseline 明确闭环为 closed。
