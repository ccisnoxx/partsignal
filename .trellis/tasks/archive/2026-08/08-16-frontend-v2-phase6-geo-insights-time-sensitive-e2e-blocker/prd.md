# 修复 Frontend V2 Phase 6 GEO Insights 时间敏感 E2E blocker

## Goal

关闭当前候选唯一的 GEO Insights fixture E2E P2 blocker，同时保持 production 的 UTC 最近 30 日默认周期、筛选 URL、Reset 与浏览器历史语义不变；完成唯一最终候选门禁后据实重新判定 Frontend V2 Phase 6 Exit Gate。

## Confirmed Facts

- 规划基线为 `main` at `3df7b5e8c046434aa5eea39ded91a54b1e0741bb`，除当前 planning Task 外无 dirty change；相对 `origin/main` ahead 228，不因此 pull 或 push。
- 前置 Task `frontend-v2-phase6-fact-workspace-unit-blocker` 已归档并 fast-forward 合入 `main`；其目标 unit blocker 已关闭。
- 前置最终候选唯一一次 `make verify` 通过至 V2 fixture E2E；该阶段为 `355 passed / 27 skipped / 2 failed / 4.5m`，两个失败是同一 GEO Insights 场景在 mobile/desktop project 的结果。
- 当前分支零代码 diff 下独立运行 `geo-insights.spec.ts`，实际为 `14 passed / 2 failed / 23.8s`；Reset 期望 `2026-07-15..2026-08-13`，实际 `2026-07-18..2026-08-16`。
- production `defaultGeoInsightDates()` 按当前 UTC 日期生成含首尾的最近 30 日，model unit 已用注入时间锁定该合同；fixture 则固定在 `insights.generated_at=2026-08-13T00:00:00Z`。
- Playwright 1.61.1 已安装，公开 `page.clock.setFixedTime()` 可固定浏览器 `Date` 且保持 timer 正常运行，无需新增依赖或 helper。
- 规划时 open P0/P1/P2 为 `0/0/1`，Engineering 与 Phase 6 Exit Gate 为 `NOT_MET`。

## Requirements

### R1. 在 fixture E2E owner 固定权威时间

- 仅对失败的 Reset/history 场景，在首次导航前用 Playwright Clock 将浏览器时间固定为既有 `insights.generated_at`。
- 保留 canonical URL、筛选写回、Reset、back/forward 的精确断言；不得使用动态当前日期、正则、模糊 URL、额外等待或接受多个结果来掩盖漂移。
- 复用已有 fixture timestamp，不新增日期常量、helper、抽象或依赖。

### R2. 保持 production 与合同不变

- 不修改 `defaultGeoInsightDates()`、GEO Insights page/model/API、fixture response、database、permission、deployment 或 dependency。
- Reset 继续以浏览器当前 UTC 日期生成最近 30 日；本 Task 只使固定历史 fixture 的浏览器时钟与 fixture 生成时间一致。

### R3. 固化可执行测试约束

- 在 frontend quality spec 追加最小规则：固定日期 fixture 若覆盖依赖当前时间的默认值或 Reset，必须在浏览器边界显式控制时间。
- 不创建通用 time fixture、test helper 或 compatibility fallback。

### R4. 分层验证与 Gate 重判

- 先运行精确失败场景，再运行完整 `geo-insights.spec.ts`，确认 mobile/desktop 均通过。
- 运行 V2 typecheck、lint、Task validation 与 `git diff --check`；Playwright webServer 的 production build 结果一并记录。
- 所有前置验证通过后，使用本机 PostgreSQL source URL 和独占 Redis DB 14，只对最终候选运行一次 `make verify`，记录实际计数、耗时和 cleanup。
- 更新 `docs/frontend-v2/07-migration-plan.md`、`08-testing-quality-and-acceptance.md` 和本 Task evidence；不修改已归档 Task。
- 只有最终候选 `make verify` 完整退出 `0`、cleanup 完整且 open P0/P1/P2 为 `0/0/0`，Phase 6 Exit Gate 才能改为 `MET`。

## Acceptance Criteria

- [x] 失败场景在 mobile/desktop project 均通过，Reset 后仍精确回到 fixture canonical URL。
- [x] 完整 `geo-insights.spec.ts` 为 16/16 passed，无 skipped/failed。
- [x] production、API、database、permission、deployment、dependency 和产品行为零变化。
- [x] frontend quality spec 明确固定日期 fixture 的 browser clock 约束，未新增 helper 或抽象。
- [x] V2 typecheck、lint、Playwright production build、Task validation 与 diff check 通过。
- [x] 最终 `make verify` 只运行一次，实际 counts/duration/cleanup 完整记录；Gate 只按实际结果判定。
- [x] `07`、`08` 与本 Task evidence 对 blocker 和 Gate 的记载一致。
- [x] 提交前展示 commit plan 并取得确认；不自动 push 或创建 PR。

## Out of Scope

- 修改 GEO Insights production 日期算法、筛选行为、路由或 UI。
- 将 fixture 日期改为 wall clock、动态生成 fixture 响应，或建立全局 Playwright clock framework。
- 新增产品能力，修改 API、backend、database、permission、deployment 或 dependency。
- 修复最终门禁中新出现且与本 Task diff 无因果关系的 blocker。

## Planning Gate

- root owner 与最小修复已由 production contract、model unit、fixture、Playwright types 和独立复现共同确定。
- 规划批准前不创建分支、不运行 `task.py start`、不修改 test/spec/docs 或 production。
- 实施必须在唯一临时分支 `codex/frontend-v2-phase6-geo-insights-time-sensitive-e2e-blocker` 上开始，并在提交前再次等待确认。

## Notes

- 本 Task 是 Phase 6 release gate blocker 修复，不是 Phase 7 功能开发。
