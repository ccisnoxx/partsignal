# Frontend V2 Phase 6 New GEO Observation desktop 焦点 blocker 复现与归因

## 1. Baseline and inherited failure

- 日期：2026-08-16（Asia/Shanghai）。
- 基线：`main` at `86465f6ebcb62848f98888ce9d2eff9de3894739`；相对 `origin/main` ahead 231，不 pull/push。
- 前置 `frontend-v2-phase6-geo-insights-time-sensitive-e2e-blocker` 已归档、fast-forward 合入 `main`，临时分支已删除。
- 前置最终候选 `make verify` 在 V2 fixture E2E 得到 `356 passed / 27 skipped / 1 failed / 4.4m`；唯一失败是 `new-geo-observation.spec.ts:206` desktop project 的焦点断言。
- 前置门禁的合同、静态、backend/V1/V2 unit、PostgreSQL integration、三套 build、V2 real-stack 与 V1 E2E 均通过；Compose config 因前序 E2E failure 未运行。
- 前置 cleanup 已确认临时 database、Redis DB 14 数据、storage、process/container 与固定七端口均无残留。
- 当前 open P0/P1/P2=`0/0/1`，Engineering 与 Phase 6 Exit Gate=`NOT_MET`。

## 2. Planning preflight

- 当前为 clean `main`；`git status --short --branch` 仅显示 ahead 231。
- 当前没有活动 Trellis Task；创建本 Task 后 status 保持 `planning`。
- 不存在本地或远端 `codex/frontend-v2-phase6-new-geo-observation-focus-e2e-blocker` 分支，也不存在额外 worktree。
- 规划阶段未运行 `task.py start`、未创建分支、未修改 production/test/spec/docs 代码。

## 3. Independent reproduction

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/new-geo-observation.spec.ts \
  --grep 'DirtyGuard 覆盖 Cancel，Back/Forward 可恢复 canonical 页面；四档宽度无溢出'
```

实际退出 `0`：

- foundation-mobile：passed，`1.1s`
- foundation-desktop：passed，`1.0s`
- 合计：`2 passed / 0 failed / 8.6s`
- Playwright webServer production build 通过；只有既有 large chunk 与 `NO_COLOR/FORCE_COLOR` warning。

该场景在上一轮完整候选 desktop 失败、当前单独运行通过，排除了稳定必现的 input 不可聚焦或固定布局错误，证明 blocker 具有 breakpoint/React commit 时序依赖。

## 4. Authority evidence

### Workspace owner

- `WorkspaceShell` 的 breakpoint 固定为 `(min-width: 1280px)`。
- `useSyncExternalStore(subscribeToDesktop, isDesktop, ...)` 在 media change 后触发 React 更新。
- `<1280px` 渲染 keep-mounted Tabs DOM；`>=1280px` 渲染新的三栏 `WorkspacePane` DOM。两套分支不是同一个 input node。
- `workspace-kit.test.tsx` 已证明窄屏 tabbed state 和 desktop 固定三槽是批准行为。

### Target test owner

- desktop project 的宽度循环固定为 `[1024, 1440]`，恰好跨越 1280px。
- `page.setViewportSize()` 后，测试立即以同步 `page.evaluate()` 读取 document overflow；没有等待 tab 消失或 desktop context region 出现。
- 循环结束后 `showPanel()` 仅读取当前 viewport；1440px 分支直接返回，不能证明 React 已完成 Workspace remount。
- 随后的 `.focus()` 可能作用于即将卸载的 tabbed input；React 提交 desktop 分支后 active element 变为 inactive，解释了前置失败。

### Production focus evidence

- `GEO platform` 使用标准 `FormField` label + 原生 `Input`，没有自定义 tabindex 或 focus interception。
- 该 input 在非 pending 状态未 disabled。
- 同一精确 locator 在 mobile 和本次 desktop target run 均成功聚焦。
- 当前没有证据支持修改 production accessibility 或 Workspace lifecycle。

## 5. Root-owner matrix

| Failure group | Root cause | Authoritative owner | Minimum correction | Behavior |
| --- | --- | --- | --- | --- |
| New GEO desktop focus | 1024→1440 后未等待 `matchMedia` 驱动的 React DOM 分支重挂载完成 | `frontend-v2/tests/e2e/new-geo-observation.spec.ts` 响应式/焦点场景 | 每次 viewport 切换后等待对应 tab/desktop region，再断言 overflow 与 focus | production preserved |
| mobile 同场景 | 未跨越 1280px；前置与当前均通过 | 无 production defect | 继续由同一双 project 场景覆盖 | unchanged |

## 6. Rejected alternatives

- 修改 `WorkspaceShell` 保留同一个 DOM：改变已批准的响应式结构，且无稳定 production 缺陷证据。
- 给 input 增加 autofocus/tabindex/refocus effect：制造用户可见副作用，掩盖测试竞态。
- `waitForTimeout`、重试 focus 或重复 `toBeFocused()`：依赖机器速度并隐藏真实 settle 条件。
- 使用 CSS selector、元素数组或下标：绕过现有可访问性语义并降低测试稳定性。
- 新增通用 breakpoint helper：当前只有一个失败 owner，局部互斥分支断言已足够。
- 删除焦点断言：会削弱既有可访问性验收。

## 7. Planned exact files

- `frontend-v2/tests/e2e/new-geo-observation.spec.ts`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- 当前 Task `prd.md`、`design.md`、`implement.md`、`research/audit.md` 与 lifecycle metadata

`.trellis/spec/frontend/quality-guidelines.md` 已记录响应式重挂载后的重新查询与稳定等待；提交前 break-loop 审核把原有几何规则最小扩展到焦点/键盘交互，明确等待互斥可访问性分支后再查询当前节点。

## 8. Planning conclusion

- 唯一 P2 是 fixture E2E 的 breakpoint settle blocker，root owner 已定位到目标 test。
- 最小实现只增加现有场景内的语义 settle 断言，不改变 production、合同或产品行为。
- 完整 V2 E2E 与 Compose dev/prod config 必须在 final `make verify` 前独立完成；任一发现新 blocker 时先归因并停止 final gate。
- Phase 6 Gate 当前保持 `NOT_MET`；只有最终候选完整通过且 open P0/P1/P2=`0/0/0` 才能改判。

## 9. Implementation and validation evidence

- 实施只在现有 viewport 循环增加互斥语义 settle：`<1280px` 等待 `观测上下文` tab，`>=1280px` 等待同名 region；随后保留原 overflow、`.focus()` 与 `toBeFocused()` 断言。
- 精确场景：`2 passed / 0 failed / 8.7s`；完整目标 spec：`14 passed / 0 failed / 0 skipped / 20.8s`。
- 独立完整 V2 fixture E2E：384 项全部 accounted，`357 passed / 27 skipped / 0 failed / 4.2m`；目标与 GEO Insights 在 mobile/desktop 均通过，没有发现其它 blocker。
- V2 API drift、typecheck、lint、production build、contract-check 均通过；Compose dev/prod config precheck 均退出 `0`。既有 warning 仅为大 chunk 与 `NO_COLOR/FORCE_COLOR`。

## 10. Final candidate gate and cleanup

- 最终候选 `make verify` 仅运行一次，时间为 `2026-08-16 16:20:13 +0800` 至 `16:38:57 +0800`，退出 `0`，`real 1124.40s`。
- contract、Ruff/mypy、双前端 lint/typecheck、backend unit `193 passed / 5.57s`、V1 unit `205 passed / 247.70s`、visual contract `24 passed / 496ms`、V2 unit `427 passed / 13.72s`、PostgreSQL integration `116 passed / 143.95s`、backend/V1/V2 production build、V2 real-stack `13 passed / 1.1m`、V1 E2E `52 passed / 5.5m`、V2 fixture E2E `357 passed / 27 skipped / 0 failed / 4.3m` 与 Compose dev/prod config 全部通过。
- cleanup 证明 Redis DB 14 为空且独占，独占 Redis container 已移除；临时 E2E databases、storage dirs、backend-test containers 均为 `0`；固定端口 `8000/9001/5173/4173/4174/19009/16379` 全部释放。
- production、API、数据库、权限、部署、依赖与产品行为零变化；没有新增 helper、抽象、兼容 fallback、sleep 或 retry。
- 原 P2 已关闭，未出现其它 P0/P1/P2；最终 open P0/P1/P2=`0/0/0`，Engineering 与 Phase 6 Exit Gate=`MET`。

## 11. Break-loop analysis

### Root cause category

- **Category D/E — Test Coverage Gap / Implicit Assumption**：测试覆盖了四档宽度和焦点，却隐含假设 `setViewportSize()` 返回时 React 已完成 `matchMedia` 分支提交；单独运行可通过，完整套件时序才暴露旧节点被替换。

### Why earlier evidence did not prevent it

- 既有 E2E 已验证最终布局与焦点，但断言前没有可观察的 breakpoint settle 条件；此前通过结果只能证明竞态未在当次调度中出现，不构成同步合同。
- production 与测试均无前置修复尝试；本次直接在测试 owner 以互斥 role/name 分支作为同步点，未采用表面 sleep/retry。

### Prevention mechanisms

| Priority | Mechanism | Specific action | Status |
| --- | --- | --- | --- |
| P0 | Test coverage | 目标双 project 场景在每次 viewport 切换后等待当前 Workspace 分支，再断言 overflow/focus | DONE |
| P0 | Documentation | 扩展既有 Frontend quality rule，覆盖跨 breakpoint 后的焦点/键盘重新查询 | DONE |
| P1 | Release process | 完整 V2 fixture E2E 在最终门禁前独立执行，384 项一次性暴露潜在 blocker | DONE |

### Systematic expansion

- **Similar issues**：所有在同页跨响应式 breakpoint 后继续操作先前 locator 的 Playwright 场景都适用同一规则；无需全库机械改写，后续仅在实际跨分支交互时遵守规范。
- **Design improvement**：当前 `WorkspaceShell` 的互斥 DOM 是批准设计，没有架构缺陷，也不需要保留双 DOM 或增加 production refocus effect。
- **Process improvement**：目标 E2E、完整 V2 E2E、Compose precheck 后再运行一次 final gate 的顺序已证明可避免继续用 `make verify` 逐层发现本轮已知范围内问题。

### Knowledge capture

- [x] 更新 `.trellis/spec/frontend/quality-guidelines.md` 的既有响应式重挂载规则。
- [x] 由现有回归场景覆盖 mobile/desktop 与四档宽度，不新增 helper 或重复测试。
- [x] 当前 Task evidence 与 `07/08` 记录实际门禁和 Gate 结论。
- [x] 无需新 issue、feature Task 或架构改造。
