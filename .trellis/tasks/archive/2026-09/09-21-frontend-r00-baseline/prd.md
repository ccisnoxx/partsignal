# R00 开发基线与候选工作区

## Goal

完成清单 R00：保护现有工作，建立可恢复的本轮候选基线，并为首条 Product Facts 链准备可执行页面卡。

## Requirements

- 记录基准 commit、原工作树与活动任务的归属、候选工作区路径和恢复点，不覆盖其他会话改动。
- 以 `docs/frontend-v2/02-information-architecture-and-routing.md` 第 6 节为全集，建立全站轻量 route/Pattern/现有位置/明显缺口与前置关系清单；legacy route 单列。
- 针对 `/products` 记录页面结果、首屏 read model、mutation、状态 owner、服务端动作和错误、现有实现差距及验收证据。依据 `03` 第 3.1 节、`05` Product 合同、`08` 相关验收与 `contracts/openapi.yaml`。
- 只在启动阶段细查首条业务链；不把当前实现或历史 V2 Gate 直接判定为本轮通过。

## Acceptance Criteria

- [x] 候选工作区和恢复点可定位，原工作树与 GEO 活动任务未被更改。
- [x] `02` 的全部 canonical route 有轻量清单，具体 `/products` 页面卡足以启动 F01 与后续 P01。
- [x] 记录 R00 实际产物、核对方式、未查边界与 F01 下一步；无实质阻塞直接启动 F01。

## Sources

- `docs/frontend-v2/10-frontend-redevelopment-plan.md` 第 3 节
- `docs/frontend-v2/11-frontend-redevelopment-task-list.md` R00
- `docs/frontend-v2/02-information-architecture-and-routing.md` 第 6 节
- `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 3.1 节
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md` Product 段落
- `contracts/openapi.yaml` Product 列表

## 本轮实际交付与证据

- 代码：未修改应用代码；新增本任务 `research/baseline-and-routes.md` 与 `research/products-page-card.md`，父任务记录集成目标。
- 静态核对：`02` 第 6 节 37 个 canonical route，对照清单 37 行；逐项追到 `frontend/src/routes/` 与 Domain 页面入口，未发现缺页。`task.py validate` 通过（两个 jsonl 均为 0 条）。
- 保护性核对：原仓库仍是干净的 `main...origin/main`、HEAD `9100774`；候选 worktree 只有本轮三个 Trellis 任务目录为未跟踪改动。
- 未验证：浏览器行为、真实 API、生产构建和视觉；这些属于 F01、后续 Foundation 与页面任务，不把历史 V2 门禁算作本轮证据。
- 下一项：F01 已建立子任务；R00 无实质阻塞，直接启动 F01。
