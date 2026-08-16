# Frontend V2 Phase 6 GEO Insights 时间敏感 E2E blocker 设计

## Status

`in_progress`。最小测试边界修复及 Required validation 已完成，等待提交确认；最终候选因新出现的无关 E2E P2 保持 `NOT_MET`。

## 1. Invariant and authority

权威时间链为：

```text
browser current UTC date
  -> defaultGeoInsightDates()
  -> Reset filters
  -> canonical query string
```

fixture 数据链为：

```text
insights.generated_at = 2026-08-13T00:00:00Z
  -> fixture current period = 2026-07-15..2026-08-13
  -> test canonical URL
```

Production 合同正确依赖浏览器当前 UTC 日；固定历史 fixture 的 E2E 必须控制浏览器时间，不能把测试运行日隐式当成 fixture 日期。

## 2. Root cause

- 测试把 fixture canonical URL 固定为 `2026-07-15..2026-08-13`，却没有固定浏览器 `Date`。
- `resetFilters()` 正确调用 `defaultGeoInsightDates()`；在 2026-08-16 运行时得到 `2026-07-18..2026-08-16`。
- 同一场景在 mobile 与 desktop project 各失败一次，表明差异来自共享时间前置条件，而非 viewport、交互或 production 分支。
- 因此 root owner 是 `frontend-v2/tests/e2e/geo-insights.spec.ts` 的 fixture 时间边界，不是 production 日期算法或 fixture payload。

## 3. Minimum correction

在失败场景首次 `page.goto()` 前增加一行：

```ts
await page.clock.setFixedTime(insights.generated_at);
```

该值已由测试导入的 fixture 提供。Playwright 原生 Clock 只固定 `Date.now()` / `new Date()`，timer 继续正常运行，足以对齐 Reset 的当前 UTC 日和固定 fixture 周期。

不修改 canonical 常量，因为它仍是该 fixture 的精确业务期望；不引入 beforeEach/global clock，因为其它场景没有经证据证明需要固定时间。

## 4. Exact writable scope

- `frontend-v2/tests/e2e/geo-insights.spec.ts`
- `.trellis/spec/frontend/quality-guidelines.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- 当前 Task artifacts

明确不修改 GEO production TS/TSX、fixture response、API/generated types、backend、database、permissions、deployment 或 dependencies。

## 5. Behavior preservation

- 浏览器处于任意真实日期时，production Reset 仍返回该 UTC 日的最近 30 日。
- E2E 场景仍精确证明筛选写回 canonical URL、Reset 与 back/forward 恢复。
- 变化只存在于测试浏览器的显式时间前置条件；用户可见行为、网络合同和持久化均不变。

## 6. Spec decision

在 frontend quality spec 追加一条范围明确的约束：固定日期 fixture 覆盖依赖 wall clock 的默认值、Reset 或历史恢复时，应使用 Playwright Clock 控制浏览器时间，并复用 fixture 的权威 timestamp；禁止用动态期望或宽松匹配掩盖时间漂移。

## 7. Gate decision

原 GEO Insights 时间敏感 P2 已关闭。唯一最终候选 `make verify` 在 V2 fixture E2E 出现新的 `new-geo-observation.spec.ts` desktop 焦点竞态，故当前 open P0/P1/P2 为 `0/0/1`，Engineering 与 Phase 6 Exit Gate 保持 `NOT_MET`；该新 owner 不在本 Task 扩围或重跑。

## 8. Risks and controls

- **Clock 设置过晚**：必须在首次导航前设置，确保 route loader 与 React 初始化读取同一时间。
- **全局影响其它场景**：只在单一失败 test 内设置，不提升为 suite-level fixture。
- **断言变弱**：保留 exact canonical、Reset 和 history 断言，不接受 wall-clock 动态 URL。
- **门禁出现新失败**：先归因；无因果关系时不扩大 Task、不自动第二次运行完整门禁。
