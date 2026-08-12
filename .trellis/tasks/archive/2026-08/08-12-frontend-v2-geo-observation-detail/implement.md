# Frontend V2 GEO Observation Detail — Implementation Plan

## 1. Approval / Branch Gate

- 用户已明确批准规划；Task 已进入实施阶段并在授权分支完成实现与 required validation。
- 批准后先确认主工作区仍是最新、干净的 `main`，再创建并切换：

```bash
git switch -c codex/frontend-v2-geo-observation-detail
python3 ./.trellis/scripts/task.py start .trellis/tasks/08-12-frontend-v2-geo-observation-detail
```

- 不自动 push。提交前展示 commit plan 并再次等待确认。

## 2. Ordered Implementation Checklist

### 2.1 Contract first

- [x] 在 `contracts/openapi.yaml` 新增 `getGeoObservationDetail` operation、完整 401/403/404/409/422 responses 和 `GeoObservationDetail` generated union。
- [x] 新增最窄的 Query Topic summary、Published Article summary、evidence（`FileRecord + SignedUrl`）、Manual correction node/detail 与 Legacy detail schemas；不改 POST/list 基础 DTO。
- [x] 补齐既有单条 GET 的真实非 2xx 声明，不改变其 200 schema。
- [x] 在 `contracts/database.md` 记录无 migration 的 consistent read、root→tail 权威排序、批量 article/evidence、证据直接归属与不可变边界。
- [x] 先生成 V1/V2 types，确认 union 可穷尽消费且 V1 只有 additive operation diff。

### 2.2 Backend schema / projector / route

- [x] 在 `backend/app/schemas/geo_files.py` 建立与 OpenAPI 一致的 Detail schemas，复用现有 `GeoObservationOut`、`FileRecordOut`、`SignedUrl` 与 Product summary，禁止平行兼容字段。
- [x] 在 `backend/app/services/geo_observation.py` 实现无锁 consistent Detail projector：target、Manual recursive chain、Product、Topics、Recorders、Articles/Citations、Files 固定批量装配。
- [x] Published Article 使用终态 snapshot；文件只通过 observation attachment 关系读取，统一签发短期 URL。
- [x] 复用现有 observation fact/action projector；把 INCOMPLETE Manual 的 primary 选择修到共享 owner，使无 `CORRECT` actor 使用查看类 primary。
- [x] 在 `backend/app/routers/observation.py` 注册新 GET，并使用 `REPEATABLE READ` dependency；旧 GET 保持不变。
- [x] 缺失/断裂上下文显式 409，目标缺失 404，禁止 fallback 到旧 GET。

### 2.3 Backend tests

- [x] 扩展 contract test，冻结新 path、union、required fields、error matrix 与旧 GET/POST/list compatibility。
- [x] 新增 PostgreSQL integration：Legacy 完整事实/文章/citation/evidence；Manual root/middle/tail、任意 selected node、root→tail 顺序、direct evidence、inherited IDs 与当前真实 Admin/Engineer actions；历史 nullable Topic/unknown facts 由 generated-type model/component fixture 覆盖（当前数据库约束不允许新插入该类 legacy 行）。
- [x] 断言 chain/article/evidence 数量增加时 SQL statement count 不增长；缺失上下文 409、not found 404。

### 2.4 Generate and inspect types

- [x] 机械生成 `frontend/src/shared/api/schema.d.ts` 与 `frontend-v2/src/shared/api/generated/schema.d.ts`。
- [x] 再次生成后无新增 diff；不手改 generated files。
- [x] 确认 `GeoObservationDetail` discriminator、nullable Query Topic、Legacy-only/Manual-only fields 保持精确。

### 2.5 Frontend query / model / actions

- [x] 在 `geo.api.ts` 增加 detail query key/options，确保只调用新 operation；复用 `GeoRequestError` 和既有 delete command。
- [x] `geo-observation-detail.model.ts` 只做 generated aliases、labels/formatting、exhaustive branch 与 identity/chain assertions；不复制 API DTO。
- [x] 把 List 内现有 CORRECT/DELETE resolver 提取到最窄 GEO Action Registry，List 与 Detail 共用 canonical href、confirm 文案和 unknown-token hard failure。
- [x] primary mapping只消费服务端投影；Detail 对 current tail 的动作不从 raw state 推导。

### 2.6 Detail page / route

- [x] 注册 `$observationId` route：UUID boundary、breadcrumb/head、query prefetch、RouteError 和 page composition。
- [x] 实现 readonly Detail Header、Summary、Metadata、Results、Evidence、Correction History、Related Articles。
- [x] Legacy/Manual 穷尽分支；unknown/null 文案诚实，不渲染不适用字段。
- [x] correction history 显示 original/selected/current/historical、完整节点事实、notes、recorder、时间与新增 evidence。
- [x] 给现有 Timeline 增加一个 additive `content?: ReactNode` 插槽并补既有 workspace test，用于承载完整 readonly correction node；不增加 variant 或业务字段。
- [x] DELETE 成功先 replace List，再无重取地失效链中 detail、刷新 lists/Product detail；失败不 replay，Dialog focus return。
- [x] loading/404/403/409/ordinary/cached refresh error/retry，以及 375/768/1024/1440/keyboard/focus/a11y。

### 2.7 New handoff

- [x] New page保留 POST response ID，dirty reset 与精准 invalidation 完成后调用 `onCreated(id)`。
- [x] New route 导航 `/geo/observations/$observationId`，不查询 List 发现 ID。
- [x] 更新 unit/E2E 断言 canonical Detail URL；不进入 Correction。

### 2.8 Strict fixture E2E

- [x] 新 generated-type Detail fixture 只允许 auth、一个 detail GET 与 token 允许的 DELETE；未声明 API 为 501 且 teardown 失败。
- [x] 覆盖 List → Detail、direct/refresh/Back/Forward、Legacy/Manual、完整 chain/evidence/articles、actions、错误/retry、delete focus 与四档 responsive。
- [x] New fixture 只为创建成功后的精确 Detail GET 放行；断言没有 list-items 搜索 ID。

### 2.9 Docs / self-review / delivery

- [x] 更新 05 的 Detail read model/New handoff、07 Phase 5 状态、08 Detail fixture 验收、09 新 ADR；不改 02/03/04 已准确规则。
- [x] Final diff review：无客户端 join、逐项请求、raw-state action、second DTO、fallback、silent default、原地编辑、数据库 migration、旧 frontend UI 或下一 Task。
- [x] 完成 required validation 后展示 commit plan，等待确认；不得自动 commit/push/merge/archive。

## 3. Required Validation

以下检查直接证明本 Task 的合同、聚合读取、V1 compatibility 和页面行为，实施完成前必须运行：

### Contract generation / consistency

```bash
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate
make contract-check
```

- 连续第二次运行两条 generation 命令后应无新增 diff。

### Backend contract / PostgreSQL integration

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py -q

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_geo_observation_detail.py \
  backend/tests/integration/test_geo_observation_list.py -q
```

- List integration 同跑用于证明共享 primary/action 与基础 projector 改动没有破坏 compact list。

### Frontend V2 targeted unit / component

```bash
npm --prefix frontend-v2 run test -- \
  src/design-system/workspace/workspace-kit.test.tsx \
  src/domains/geo/geo.api.test.ts \
  src/domains/geo/geo-observation-detail.model.test.ts \
  src/domains/geo/geo-observation-detail-page.test.tsx \
  src/domains/geo/geo-observation-list-page.test.tsx \
  src/domains/geo/new-geo-observation.model.test.ts
```

### Static / build / V1 generated compatibility

```bash
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend run typecheck
```

### Production-artifact strict fixture Playwright

```bash
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/geo-observations.spec.ts \
  tests/e2e/new-geo-observation.spec.ts \
  tests/e2e/geo-observation-detail.spec.ts
```

- 默认 projects 覆盖 375/1440，Detail spec 内补测 768/1024。
- List spec 同跑用于保护抽取后的 GEO Action Registry 与 canonical links。

### Final hygiene

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate \
  .trellis/tasks/08-12-frontend-v2-geo-observation-detail
git status --short
```

## 4. Optional Full-Suite Validation

以下覆盖更广，但不默认作为本增量完成条件：

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-unit
make test-integration
make verify
```

- 若 targeted evidence 显示共享 read/action/file projection 回归，升级运行相应 full suite。
- 完整 `new → detail → correction` 真实栈、Topics、Insights、Print 与 GEO optimization 不因 full suite 名称进入本 Task。

## 5. Acceptance / Evidence Mapping

| 风险或行为 | 主要证据 |
|---|---|
| Detail 单请求、无 browser join | API unit、strict fixture teardown、network assertions |
| chain 顺序/完整性/root/tail/selected | PostgreSQL integration、model assertion tests |
| Legacy/Manual 精确 union | contract test、generated typecheck、component/E2E |
| article/evidence 批量与归属 | PostgreSQL statement-count integration、strict fixture |
| actor-aware primary/actions | backend Admin/Engineer cases、共享无 token fallback、component actions |
| DELETE/CORRECT canonical behavior | component/E2E、CSRF/request assertions、Dialog focus |
| 404/403/409/error/retry | API/component/fixture E2E |
| New POST ID handoff | New E2E URL + no list lookup assertion |
| responsive/accessibility | production artifact 375/768/1024/1440 + keyboard/focus |
| V1 compatibility | old GET schema assertion、V1 typecheck、generated diff review |

## 6. Rollback / Stop Conditions

- 新 endpoint、route 与 docs 均为 additive；未合并时删除临时分支即可回滚，不涉及数据恢复。
- 若发现 correction chain 无法由现有 DB invariant 无歧义表达，或必须新增 schema/migration，立即停止并回到审批点，单独说明 migration 需求。
- 若实现需要修改旧 `frontend/` 业务代码而非 generated schema，停止并请求确认。
