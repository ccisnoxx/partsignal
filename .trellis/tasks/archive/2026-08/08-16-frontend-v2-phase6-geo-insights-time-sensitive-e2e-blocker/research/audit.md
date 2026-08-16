# Frontend V2 Phase 6 GEO Insights 时间敏感 E2E blocker 复现与归因

## 1. Baseline and inherited failure

- 日期：2026-08-16（Asia/Shanghai）。
- 基线：`main` at `3df7b5e8c046434aa5eea39ded91a54b1e0741bb`；除当前 planning Task 外无 dirty change，相对 `origin/main` ahead 228，不 pull/push。
- 前置 Task 已归档并合入；其唯一最终候选 `make verify` 通过至 V2 fixture E2E。
- V2 fixture E2E 为 `355 passed / 27 skipped / 2 failed / 4.5m`；两个失败来自同一 GEO Insights Reset/history 场景的 mobile/desktop project。
- 门禁总退出码 `2`、耗时 `1148.07s`；Compose config 因前序失败未运行。cleanup 完整。
- 当前 Phase 6 open P0/P1/P2 为 `0/0/1`，Gate=`NOT_MET`。

## 2. Independent reproduction

| Command | Exit | Actual result | Interpretation |
| --- | ---: | --- | --- |
| `npm --prefix frontend-v2 run e2e -- tests/e2e/geo-insights.spec.ts` | 1 | `14 passed / 2 failed / 23.8s` | 同一场景在 foundation-mobile 与 foundation-desktop 各失败一次 |

两处均在 `geo-insights.spec.ts:37` 等待 exact URL 超时：

- expected：`/geo/insights?from=2026-07-15&to=2026-08-13`
- received：`/geo/insights?from=2026-07-18&to=2026-08-16`

复现后 4174 已释放，无 Playwright/Vite preview 残留；工作树仍只有当前 planning Task artifacts。

## 3. Authority evidence

### Production date owner

- `resetFilters()` 返回 `defaultGeoInsightDates()`，没有读取 fixture 或 API generated timestamp。
- `defaultGeoInsightDates(now = new Date())` 使用当前 UTC 日作为 `to`，向前减 29 日作为 `from`，即含首尾的最近 30 日。
- `geo-insights.model.test.ts` 已用注入 `Date` 精确锁定 UTC 30 日合同。
- 2026-08-16 的 production 结果 `2026-07-18..2026-08-16` 因而正确，不应修改 production。

### Fixture/test owner

- fixture 的 `insights.generated_at` 固定为 `2026-08-13T00:00:00Z`，current period 固定为 `2026-07-15..2026-08-13`。
- E2E canonical 常量与 fixture 一致，但运行前没有控制浏览器时间；时间过去后 Reset 自然偏离固定 fixture。
- 测试文件已导入 `insights`，无需新增日期常量或跨文件 owner。

### Native mechanism

- 已安装 `@playwright/test` 1.61.1；本地公开 types 提供 `page.clock.setFixedTime(time)`。
- 该 API 固定 `Date.now()` / `new Date()`，同时 timer 正常运行，正好覆盖本场景，不需要自制 fake clock、init script 或依赖。

## 4. Root-owner matrix

| Failure group | Root cause | Authoritative owner | Minimum correction | Behavior |
| --- | --- | --- | --- | --- |
| mobile Reset/history | 固定 fixture 未控制浏览器当前日期 | `tests/e2e/geo-insights.spec.ts` | 首次导航前以 `insights.generated_at` 固定 page clock | production preserved |
| desktop Reset/history | 与 mobile 完全相同 | 同上 | 同一测试行覆盖两个 projects | production preserved |

## 5. Rejected alternatives

- 修改 `defaultGeoInsightDates()`：破坏已批准 UTC 30 日 production 合同。
- 将 expected URL 动态改为运行日：不再证明固定 fixture canonical，且让测试依赖 wall clock。
- 改 fixture 响应为动态日期：扩大 fixture owner 并使历史数据不确定。
- 使用 regex、多结果或重试：掩盖语义差异并降低断言强度。
- 新增全局 clock fixture/helper：当前只有一个已证实 owner，一行原生 API 已足够。

## 6. Planned exact files

- `frontend-v2/tests/e2e/geo-insights.spec.ts`
- `.trellis/spec/frontend/quality-guidelines.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- 当前 Task `prd.md`、`design.md`、`implement.md`、`research/audit.md` 与 metadata

## 7. Planning conclusion

- 当前 P2 是 fixture E2E determinism blocker，root owner 已唯一定位到测试浏览器的时间前置条件。
- 最小修复为单行 Playwright 原生 Clock 调用；无 production、API、database、permission、deployment、dependency 或产品行为变化。
- 当前 Gate 仍为 `NOT_MET`；只有实施、Required validation 和唯一最终候选门禁全部通过后才可改判。

## 8. Implementation evidence before final gate

- 失败场景首次导航前增加 `page.clock.setFixedTime(insights.generated_at)`；其余测试和 production 均未修改。
- 精确场景：`2 passed / 0 failed / 7.4s`，mobile `494ms`、desktop `503ms`。
- 完整 GEO Insights fixture spec：`16 passed / 0 failed / 0 skipped / 13.3s`。
- 两次 Playwright webServer production build 均通过，只保留既有大 chunk 与 `NO_COLOR/FORCE_COLOR` warning。
- V2 typecheck 与 lint 均退出 `0`；Task validation 与 diff check 通过。
- 原 P2 已关闭，当前已知 open P0/P1/P2=`0/0/0`；最终候选门禁运行前 Phase 6 Gate 仍为 `NOT_MET`。

## 9. Final-candidate gate evidence

- 最终候选 `make verify` 只运行一次，非零结束，总耗时 `1144.56s`；Compose dev/prod config 因前序 E2E 失败未运行。
- 已通过合同与双前端 API drift、Ruff、mypy、双前端 lint/typecheck、backend unit `193 passed / 5.67s`、V1 unit `205 passed / 247.14s`、visual contract `24 passed / 0 failed / 0 skipped`、V2 unit `427 passed / 13.70s`、PostgreSQL integration `116 passed / 144.01s`、三套 production build、V2 real-stack `13 passed / 1.1m` 与 V1 E2E `52 passed / 5.5m`。
- V2 fixture E2E 为 `356 passed / 27 skipped / 1 failed / 4.4m`。本 Task 修复的 GEO Insights Reset/history 场景在 mobile `462ms`、desktop `469ms` 均通过。
- 唯一新失败为未改动的 `new-geo-observation.spec.ts:206` desktop 场景：同一页面依次从 1024px 切换到 1440px，跨越 `WorkspaceShell` 的 1280px tabbed/三栏 DOM 分支后立即 `.focus()`；旧 input 可能在 React 重挂载时被替换，最终 `toBeFocused()` 收到 inactive。mobile 同场景通过，原生 input 可聚焦，当前证据指向测试 breakpoint settle 时序 owner，而非 production 可访问性缺陷。
- 按范围约束不修改该无关 owner、不自动重跑完整门禁；当前 open P0/P1/P2=`0/0/1`，Engineering 与 Phase 6 Exit Gate 保持 `NOT_MET`。
- 项目 E2E cleanup 报告 Redis DB 14 的 `1` 个 key 已删除、`8000/9001/5173/4173/4174/19009` 全部释放、临时数据库 `partsignal_e2e_20260816_95776` 已删除、storage 已移除；随后通过 PostgreSQL 容器再次确认该数据库不存在。
- 外层 runner 因 zsh 不支持本次使用的 `PIPESTATUS[0]` 记账表达式提前结束，独占 Redis 容器未由 trap 输出收尾证据；已按精确名称删除 `partsignal-e2e-geo-insights-redis`，复核容器不存在且 `16379` 释放。最终固定七端口、storage、数据库、E2E process/container 均无残留。
