# Frontend V2 Phase 6 New GEO Observation desktop 焦点 E2E blocker 设计

## Status

`in_progress`。最小 test-owner 修复、全部 Required validation 与提交前审查已完成，commit plan 已获确认；尚未提交、归档、合入或 push。

## 1. Invariant and authority

Workspace 的响应式权威链为：

```text
viewport width
  -> matchMedia('(min-width: 1280px)')
  -> useSyncExternalStore notification
  -> WorkspaceShell tabbed DOM 或 desktop 三栏 DOM
  -> 当前 document 中可交互的 input
```

测试必须等待这条链完成后再断言布局或焦点。`page.setViewportSize()` 完成只证明浏览器 viewport 已改变，不证明 React 已消费 `matchMedia` 通知并完成分支重挂载。

## 2. Actual reproduction and root cause

- 前置完整门禁中，desktop 场景在 1024→1440 后最终 `toBeFocused()` 失败，active element 为 `inactive`；mobile 同场景通过。
- 当前 clean `main` 的精确场景单独运行结果为 `2 passed / 0 failed / 8.6s`，证明失败具有时序性。
- 目标用例在每次 `setViewportSize()` 后立即读取 document overflow；该读取不会等待 React 完成 1280px breakpoint 分支切换。
- 循环结束于 1440px，随后 `showPanel()` 因 viewport 已是 desktop 而直接返回，再立即 focus。旧 tabbed input 可能先被 focus，随后被三栏 input 替换，最终失去 active element。
- `WorkspaceShell` unit 已明确证明 breakpoint 会将 tabbed DOM 替换为固定三槽；New GEO input 具有原生 label、未 disabled，且 mobile 与本次 target run 均可聚焦。
- 因此当前权威 owner 是 `new-geo-observation.spec.ts` 的 breakpoint settle 边界，不是 production accessibility、form 或 Workspace 行为。

## 3. Minimum correction

只调整现有四档宽度循环：

- `<1280px`：等待具名 Workspace tab 可见，证明 tabbed 分支已稳定。
- `>=1280px`：等待具名 `观测上下文` region 可见，证明 desktop 三栏分支已稳定。
- 分支稳定后再读取页面根 overflow；循环结束后继续重新查询 `GEO platform`，执行 `.focus()` 和精确 `toBeFocused()`。

这使用页面既有 role/name 语义，既验证真实响应式结果，也消除旧 DOM 节点竞态。无需 sleep、`waitForTimeout`、retry、CSS selector、数组下标、辅助函数或 production change。

## 4. Exact writable scope

- `frontend-v2/tests/e2e/new-geo-observation.spec.ts`
- `.trellis/spec/frontend/quality-guidelines.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- 当前 Task artifacts

`.trellis/spec/frontend/quality-guidelines.md` 已包含“响应式状态切换可能重挂载布局；切换后重新查询并等待稳定”的规则；提交前 break-loop 审核将其原有几何边界最小扩展到焦点/键盘交互，明确先等待互斥可访问性分支再重新查询当前节点，不新增第二条规范。明确不修改 production、fixture、API/generated types、backend、database、permissions、deployment 或 dependencies。

## 5. Behavior preservation

- 用户仍在 375/768/1024 看到同一 keep-mounted Tabs Workspace，在 1440 看到同一三栏 Workspace。
- DirtyGuard、Back/Forward、canonical URL、表单数据、input label 与键盘焦点行为均保持。
- 唯一变化是测试在跨 breakpoint 后等待已批准的 DOM 分支稳定；断言范围和强度不降低。

## 6. Validation topology

```text
精确场景
  -> 完整 New GEO spec
  -> 完整 V2 fixture E2E（384 项）
  -> V2 静态/构建 + Compose dev/prod config
  -> 唯一一次最终 make verify
```

前置门禁已经在同一 `main` 基线证明其余未修改上游阶段通过；本 Task 对唯一变更的 fixture E2E 边界进行由窄到全的独立验证，并在 final gate 前补齐此前未执行的 Compose config。这样最终 `make verify` 用于确认候选，而不是继续逐层发现。

## 7. Gate decision

- 实施前 open P0/P1/P2=`0/0/1`，Engineering 与 Phase 6 Exit Gate=`NOT_MET`。
- 目标与 384 项 V2 E2E、Compose precheck 通过后，已知 blocker 可记为关闭，但 Gate 在最终 `make verify` 前仍保持 `NOT_MET`。
- 只有最终门禁完整退出 `0`、cleanup 完整且 open P0/P1/P2=`0/0/0`，才将 Engineering 与 Phase 6 Exit Gate 更新为 `MET`。

## 8. Risks and controls

- **target run 偶尔通过掩盖竞态**：验证点不是增加重试，而是显式等待 breakpoint 对应的可访问性分支。
- **等待了错误节点**：窄屏等待 tab，desktop 等待 region；两者分别属于互斥渲染分支。
- **扩大到通用 helper**：当前只有一个已知失败 owner，局部两分支断言足够。
- **完整 V2 E2E 出现其它失败**：先完成归因并批量报告；无因果关系时停止，不修改其它 owner，也不进入最终门禁。
- **Compose precheck 失败**：先归因；范围外配置问题不在本 Task 顺手修复，且不运行最终门禁。
- **最终门禁意外失败**：不自动第二次运行；保留实际证据与 cleanup，Gate 继续 `NOT_MET`。

## 9. Implemented outcome

- 现有四档 viewport 循环在切换尺寸后按宽度等待互斥的 Workspace 可访问性分支；之后才读取根 overflow，并继续重新查询 `GEO platform` 执行精确焦点断言。
- production、fixture payload、API、数据库、权限、部署、依赖及产品行为均未改变；没有新增 helper、sleep、retry、fallback 或抽象。
- 精确场景、完整目标 spec、384 项 V2 fixture E2E、静态/构建/合同、Compose precheck 与唯一最终候选 `make verify` 全部通过。
- 最终 open P0/P1/P2=`0/0/0`；Engineering 与 Phase 6 Exit Gate=`MET`。
