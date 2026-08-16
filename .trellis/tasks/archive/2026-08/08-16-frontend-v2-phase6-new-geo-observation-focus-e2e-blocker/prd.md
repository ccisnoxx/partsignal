# 修复 Frontend V2 Phase 6 New GEO Observation desktop 焦点 E2E blocker

## Goal

关闭当前候选唯一的 New GEO Observation desktop breakpoint/focus P2 blocker；先让完整 Frontend V2 fixture E2E 的 384 项全部无失败，再提前验证 Compose dev/prod 配置，最后只运行一次完整 `make verify` 并据实重新判定 Phase 6 Exit Gate。

## Confirmed Facts

- 规划基线为 `main` at `86465f6ebcb62848f98888ce9d2eff9de3894739`；除当前 planning Task artifacts 外无代码 dirty change，相对 `origin/main` ahead 231，不因此 pull 或 push。
- 前置 Task `frontend-v2-phase6-geo-insights-time-sensitive-e2e-blocker` 已归档并 fast-forward 合入 `main`；其 GEO Insights blocker 已关闭。
- 前置唯一最终候选 `make verify` 已通过合同、静态检查、backend/V1/V2 unit、PostgreSQL integration、三套 production build、V2 real-stack 与 V1 E2E；V2 fixture E2E 为 `356 passed / 27 skipped / 1 failed / 4.4m`。
- 唯一失败位于 `frontend-v2/tests/e2e/new-geo-observation.spec.ts:206` 的 desktop project：同页由 1024px 切到 1440px 后，`GEO platform` 最终焦点收到 `inactive`；mobile project 同场景通过。
- 当前 planning 基线单独运行该场景为 `2 passed / 0 failed / 8.6s`，说明失败不是稳定的 production 行为，而是依赖 breakpoint 更新时序的间歇竞态。
- `WorkspaceShell` 在 1280px 通过 `matchMedia` 与 `useSyncExternalStore` 从 keep-mounted Tabs DOM 切换为三栏 DOM；现有 quality spec 已要求响应式重挂载后重新查询当前节点并等待布局稳定。
- 当前 open P0/P1/P2 为 `0/0/1`，Engineering 与 Phase 6 Exit Gate 为 `NOT_MET`。

## Requirements

### R1. 修复最小权威测试 owner

- 在现有 New GEO Observation 响应式/焦点场景内，viewport 切换后先用 Workspace 的现有可访问性语义确认对应 tabbed 或 desktop 分支已经出现，再执行溢出及焦点断言。
- 保留 `GEO platform` 原生输入的精确 label 与 `toBeFocused()` 断言；不得使用 sleep、blind retry、数组下标、模糊 selector、弱化断言或接受多个结果。
- 复用现有局部测试结构，不新增 helper、通用等待器、依赖或测试抽象。

### R2. 保持 production 与产品行为不变

- 不修改 `WorkspaceShell`、New GEO Observation page/model/API、fixture payload、数据库、权限、部署、依赖或产品能力。
- 375/768/1024 继续使用 tabbed Workspace，1440 继续使用三栏 Workspace；用户可见的响应式、表单、DirtyGuard、导航和焦点能力不变。
- 若实施证据表明 production 本身存在稳定的可访问性或交互缺陷，停止当前测试边界方案并返回规划重新确定 owner。

### R3. 先完成发现性验证，再运行最终门禁

- 先运行精确场景与完整 `new-geo-observation.spec.ts`。
- 再独立运行完整 Frontend V2 fixture E2E，确认 384 个 discovered tests 全部被 accounted，预期为 `357 passed / 27 skipped / 0 failed`，且无其他 blocker。
- 在最终门禁前独立运行 Compose dev/prod `config --quiet`，避免让 fail-fast `make verify` 首次暴露 Compose 配置问题。
- 只有目标、完整 V2 E2E、静态/构建、Compose precheck 全部通过后，才对最终候选运行一次 `make verify`；不把完整门禁用作逐层发现器。

### R4. Gate、证据与生命周期

- 更新 `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md` 和当前 Task evidence；不得修改已归档 Task。
- 记录全部验证的实际 pass/fail/skip、耗时，以及最终门禁 PostgreSQL、Redis、storage、process/container、port cleanup。
- 只有最终候选 `make verify` 完整退出 `0`、cleanup 完整且 open P0/P1/P2 为 `0/0/0`，才将 Phase 6 Exit Gate 从 `NOT_MET` 更新为 `MET`。
- 提交前展示 commit plan 并取得确认；不 push、不创建 PR。归档和 fast-forward 合入 `main` 需另有收尾确认。

## Acceptance Criteria

- [x] 精确场景在 mobile/desktop 两个 project 均通过，且焦点断言保持精确。
- [x] 完整 `new-geo-observation.spec.ts` 为 `14 passed / 0 failed / 0 skipped`。
- [x] 完整 Frontend V2 fixture E2E 的 384 项无失败；实际 pass/skip/failed 与耗时被记录。
- [x] Compose dev/prod 配置在最终 `make verify` 前独立通过。
- [x] production、API、数据库、权限、部署、依赖和产品行为零变化；没有新增 helper、抽象或 fallback。
- [x] V2 API drift、typecheck、lint、production build、contract-check、Task validation 与 diff check 通过。
- [x] 最终 `make verify` 只运行一次，实际阶段计数、总耗时和 cleanup 完整记录。
- [x] `07`、`08` 与当前 Task evidence 对 blocker 和 Gate 的记载一致；Gate 只按最终候选实际结果更新。
- [x] 提交前展示 commit plan 并取得确认；不自动提交、归档、合入或 push。

## Out of Scope

- Phase 7 功能开发或任何新产品能力。
- 修改 `WorkspaceShell` 响应式设计、New GEO Observation production 交互或 API/数据合同。
- 新建通用 Playwright settle helper、全局 retry、兼容 fallback 或额外 orchestration。
- 顺手修复其它页面、测试、样式、依赖、部署或基础设施。
- 自动吸收完整 V2 E2E、Compose 或最终门禁中新出现且与本 Task diff 无因果关系的 blocker。

## Planning Gate

- 当前只完成读取、复现、归因与规划；Task 保持 `planning`。
- 规划批准前不创建分支、不运行 `task.py start`、不修改 production/test/spec/docs 代码。
- 批准后只创建临时分支 `codex/frontend-v2-phase6-new-geo-observation-focus-e2e-blocker` 并进入实施。

## Notes

- 本 Task 是 Phase 6 release gate blocker 修复，不是 Phase 7 功能开发。
