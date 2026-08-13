# Frontend V2 GEO abstraction review — Implementation plan

## Status

已在 `codex/frontend-v2-geo-abstraction-review` 完成实施并通过验证，且已获得提交批准；不推送远端。

## Step 1 — Fix route-valid UUID identity at the shared model owner

Files:

- `frontend-v2/src/domains/geo/geo-observation-detail.model.ts`
- `frontend-v2/src/domains/geo/geo-observation-detail.model.test.ts`
- 必要时 `frontend-v2/src/domains/geo/geo-observation-detail-page.test.tsx`

Actions:

1. 在 model 内用局部 comparator 统一 request/response UUID identity。
2. 覆盖 Legacy、Manual selected node、Correction Context 的大写 route UUID。
3. 保留真正错配、链标记不一致和动作不一致的失败测试。

## Step 2 — Complete mutation invalidation without a new framework

Files:

- `frontend-v2/src/domains/geo/geo-observation-list-page.tsx`
- `frontend-v2/src/domains/geo/geo-observation-detail-page.tsx`
- `frontend-v2/src/domains/geo/new-geo-observation-page.tsx`
- `frontend-v2/src/domains/geo/geo-observation-correction-page.tsx`
- `frontend-v2/src/domains/geo/query-topic-list-page.tsx`
- 对应已有 tests；只在没有现成文件时新增最小 page test

Actions:

1. Observation create/correct/delete 补 `geoKeys.insights()` 与 `geoKeys.topicLists()`。
2. List delete 保留当前 row 的 product identity，并补精准 `productsKeys.detail(productId)`。
3. Topic mutation consumer 集合补 `geoKeys.insights()`。
4. 保留现有 list/detail/correction/content/product invalidation；不提取通用 invalidation helper。
5. 用 QueryClient spy 断言精确 key，不测试 TanStack Query 内部实现。

## Step 3 — Return GEO inputs to Design System primitives

Files:

- `frontend-v2/src/design-system/primitives/textarea.tsx`（当前缺失，最小新增）
- `frontend-v2/src/design-system/primitives/textarea.stories.tsx`
- `frontend-v2/src/design-system/primitives/core-primitives.test.tsx`
- `frontend-v2/src/domains/geo/new-geo-observation-page.tsx`
- `frontend-v2/src/domains/geo/geo-observation-correction-page.tsx`
- `frontend-v2/src/domains/geo/geo-insights-page.tsx`
- 对应最小 component/fixture regression（仅在现有覆盖不足时）

Actions:

1. 新增纯 UI Textarea primitive，复用既有 token/focus/error/disabled 约定。
2. 删除 New/Correction 两份 `textareaClass`，改用 Textarea。
3. 把 Insights filters/Optimization Dialog 的 native select 改为既有 Select primitive。
4. 保持 URL、RHF、dependent fields、labels/errors、keyboard/focus 和响应式不变。

## Step 4 — Update authoritative docs and final evidence matrix

Files:

- `.trellis/tasks/08-13-frontend-v2-geo-abstraction-review/research/evidence-matrix.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`（仅需 closeout ADR 时）
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/component-guidelines.md`（仅直接受影响条目）

Actions:

1. 将 F-01/F-02/F-03 从 open 更新为 closed，并写入实际验证结果。
2. 核对 OpenAPI/generated 实际无漂移，不伪造 API/数据库变化。
3. 七类 Phase 5 gate 无 P0/P1/P2 后才将 `07-migration-plan.md` 的 Phase 5 改判 `MET`。

## Required validation

### Direct behavior

```bash
npm --prefix frontend-v2 test -- \
  src/domains/geo/geo-observation-detail.model.test.ts \
  src/domains/geo/geo-observation-list-page.test.tsx \
  src/domains/geo/geo-observation-detail-page.test.tsx \
  src/domains/geo/geo-observation-correction-page.test.tsx \
  src/domains/geo/geo-insights-page.test.tsx \
  src/design-system/primitives/core-primitives.test.tsx
```

若为 New/Topics 新增了最小 page test，将其加入同一 targeted 命令。若 Select 迁移影响既有 production-artifact 交互，按实际变更只跑受影响 GEO fixture spec，不机械跑全套：

```bash
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/new-geo-observation.spec.ts \
  tests/e2e/geo-observation-correction.spec.ts \
  tests/e2e/geo-insights.spec.ts
```

### Affected frontend and contract

```bash
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
git diff --check
```

### Documentation consistency

- 对照最终 diff 核对 `05/07/08/09`、frontend spec、task evidence matrix 与实现。
- 确认 Phase 5 Gate 的每个 `MET/NOT_MET` 结论有 file:line 或实际命令证据。
- 确认没有改动 backend、OpenAPI、database、旧 frontend、deployment 或 Phase 6。

## Optional validation

仅在 required check 暴露共享回归、用户另行要求或准备 release candidate 时运行：

```bash
make verify
npm --prefix frontend-v2 run e2e
DATABASE_URL='...' REDIS_URL='...' deploy/scripts/e2e-local.sh tests/e2e/trusted-types.spec.ts
```

不默认重复完整 GEO real-stack：最近归档任务已有 V2 `12 passed`、V1 Trusted Types `7 passed`、隔离资源清理完成的直接证据；本计划不改 backend、数据库、OpenAPI、上传流程、append-only command、Insights 复算或 E2E orchestration。

## Actual validation

- targeted Vitest：`6 files / 36 tests passed`。
- GEO Insights production-artifact Playwright：`16 passed`（mobile/desktop 两个 project）。
- `api:check`、lint、typecheck、production build：通过。
- `git diff --check`：通过。
- 最近 GEO real-stack：V2 `12 passed`；V1 Trusted Types `7 passed`，本任务未触发重跑条件。

## Stop / escalation conditions

- 若实施中发现必须修改 API、database、权限、跨域 public contract 或 deployment，停止并提出独立 Task，不在本任务跨范围处理。
- 若发现未识别 dirty files，停止，不纳入分支或提交。
- 修改完成后先提交 diff/validation/Phase 5 gate 结论供用户审阅；获得确认后提交，不自动 push。
