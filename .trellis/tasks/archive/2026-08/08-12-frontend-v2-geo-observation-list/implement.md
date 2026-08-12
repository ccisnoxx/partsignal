# Frontend V2 GEO Observation List — Implementation Plan

## 0. Approval gate

- 用户已批准本计划，Task 已运行 `task.py start` 并进入 `in_progress`。
- 用户授权临时分支 `codex/frontend-v2-geo-observation-list` 承载本 Task 的实现与验证。
- 批准内容确认：新增 `/api/v1/geo-observations/list-items`；保留 V1 原接口；允许机械生成 `frontend/src/shared/api/schema.d.ts` 作为旧 frontend 唯一例外。
- 实现、自测与自审完成前不提交；提交前展示 commit plan 并等待确认；不得自动 push。

## 1. Ordered implementation checklist

1. **启动 Task 与基线复核**
   - 再次确认当前分支、dirty files 仅为已审阅 Task 规划产物、`main` 基线未变化。
   - 运行 `task.py start`；读取本 Task 的 prd/design/implement 与相关 specs。
   - 若批准内容与文件现状漂移，先回到 planning，不带猜测继续。
2. **Contract first**
   - 在 `contracts/openapi.yaml` 新增 list-items operation、typed sort、compact item/outcomes/indicator/page schemas与 401/403/409/422。
   - 为现有 delete 补实际 422 声明，不改变 delete contract 其余部分。
   - 用 contract unit test 先冻结 query names、schema required/forbidden fields、actions 与 error matrix。
3. **Backend schema/query/router**
   - 在 `geo_files.py` 加与 OpenAPI 一致的 Pydantic DTO，不复用完整 GeoObservation union。
   - 在 `geo_observation.py` 实现 tail-only compact query/projector、统一 search/platform/date/accuracy/sort/page 与 fixed-size batches。
   - 抽取现有 full projector 的私有 action eligibility helper供两个 projector 共用；不改变 V1 输出。
   - 在 `observation.py` 的动态 `/{observation_id}` route 之前注册静态 `/list-items`，保持现有 permission owner。
4. **Backend targeted validation**
   - 新增 PostgreSQL integration tests，覆盖两个 observation kind、projection invariant、filter/count/sort/page、evidence chain、actor actions 与 structured errors。
   - 运行 contract/runtime 一致性与 targeted backend tests；失败归因并修复后才进入 UI。
5. **Generated types**
   - 机械生成 V2 schema。
   - 按计划批准的唯一例外机械生成 V1 schema；确认除 additive operation/types 外旧 operation shapes 无漂移。
   - 运行 `make contract-check`，不得手改 generated files。
6. **Frontend model/API**
   - 新建 GEO list model：Zod URL normalization、canonical record、API mapping、sort mapping、indicator formatting 与 exhaustive token handling。
   - 新建 GEO API query/delete mutation，使用 generated path/types、现有 client、结构化 error pattern、CSRF 与 list invalidation。
   - 不读取旧 `GeoObservation` type，不访问 Products/QueryTopics/detail endpoint。
7. **Route/navigation/page**
   - 注册 GEO parent、Observations parent/index、metadata、loader prefetch 与 canonical replace。
   - 导航仅增加“观测记录”。
   - 复用 Table/FilterBar/RowActions/Pagination/feedback primitives 组合八列与状态；不改 Design System 或 global CSS，除非现有 pattern 经测试证明确实无法满足并先回到 planning。
8. **Actions 与 a11y**
   - main/correction 使用 canonical native anchors，不注册目标 route。
   - DELETE 仅由 token 映射到 Dialog/mutation；验证 CSRF、single request、no replay、success refresh 与 final focus。
   - 验证 semantic table、labels、visible focus、indicator 非颜色单一表达与 root overflow。
9. **Fixture Playwright**
   - 新建严格 `geo.fixture.ts`；声明 auth/list/delete，拒绝任何其他业务 API。
   - 新建单一 `geo-observations.spec.ts` 覆盖 URL→API、八列/href/action、states/pagination、keyboard/Dialog、375/768/1024/1440。
   - 使用 Playwright Test Runner；不创建临时 `playwright-cli` flow。
10. **Docs、自审与报告**
    - 更新 05 的 read-model/API/action mapping、07 Phase 5 状态、08 fixture coverage、09 additive compact endpoint ADR。
    - 确认 03 蓝图未变、02 route 已有权威定义、06 架构未变，因而无需机械改写。
    - 检查无 client join/local server-data filtering/status inference/detail placeholder/new dependency/V1 business diff/hidden fallback/N+1。
    - 完成 required validation 和 final diff review；展示 commit plan，等待用户确认后才能 commit。不得自动 push。

## 2. Required validation

### Contract generation 与一致性

```bash
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:generate
make contract-check
```

- 第二条命令只允许机械更新 `frontend/src/shared/api/schema.d.ts`；若计划未批准则不能进入实施。
- 生成后再次运行同一 generation，工作树应无新增 diff。

### Backend contract/unit

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py -q
```

### Backend PostgreSQL integration

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_geo_observation_list.py -q
```

### Frontend V2 targeted unit/component

```bash
npm --prefix frontend-v2 run test -- \
  src/app/navigation.test.ts \
  src/domains/geo/geo.api.test.ts \
  src/domains/geo/geo-observation-list.model.test.ts \
  src/domains/geo/geo-observation-list-page.test.tsx
```

### Frontend static/build 与 V1 generated compatibility

```bash
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend run typecheck
```

- V2 build 证明 route tree/deep link production artifact；V1 typecheck 只证明机械 generated addition 未破坏既有消费者。

### Production-artifact fixture Playwright

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/geo-observations.spec.ts
```

- 默认 mobile/desktop projects 覆盖 375/1440，spec 内按项目补测 768/1024。
- 断言 root overflow、keyboard/focus、Dialog、strict API boundary 与 canonical href。

### Final diff/task hygiene

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-12-frontend-v2-geo-observation-list
git status --short
```

## 3. Optional full-suite validation

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-unit
make test-integration
DATABASE_URL=<host-postgres-url> REDIS_URL=<exclusive-redis-url> deploy/scripts/e2e-local.sh
make verify
```

- 完整 V2/V1 unit、完整 backend integration、现有真实栈与 `make verify` 默认 optional：required checks 已直接覆盖新 contract、PostgreSQL read model、V1 generated compatibility、V2 production artifact 和四档页面行为。
- 现有真实栈脚本当前不会运行 GEO spec；执行它只能证明本 Task 没有回归既有 Product/Content/Publishing flows，不能冒充 GEO acceptance。
- 若实现实际修改共享 Table/RowActions/error parser/auth、旧 list behavior、permission owner、database contract 或 E2E orchestration，则相关完整 suite 升级为 required，并先更新本文件。
- optional failure 仅在证据指向本 Task diff 时进入修复范围；环境或既有失败按原始证据报告，不重复运行掩盖。

## 4. Visual/accessibility acceptance matrix

| Area | Required cases |
| --- | --- |
| Width | 375、768、1024、1440；document root 无横向溢出，Table region 可局部滚动 |
| Text | 长 query、长 Product label、长 platform、长 recorder；主链接和 indicators 保持可读 |
| Data | legacy、manual positive/negative/mixed、accuracy unassessed、legacy discovered N/A、evidence 0/N |
| State | loading、initial empty、filtered empty、error/request ID、retry、cached refresh failure、multiple pages |
| URL | direct、refresh、Back、Forward、invalid/extra canonical replace、每个 filter mapping |
| Actions | no action、CORRECT only、DELETE only、both；Dialog cancel/success/error 与 focus return |
| A11y | keyboard-only、visible focus、semantic headers/aria-sort、non-color indicators、alert/loading labels |

## 5. Self-review checklist

- Contract first 且 runtime OpenAPI 完全一致；generated files 只由脚本产生。
- 新 list item 不含 notes/citations/article URL/attachment IDs/detail workflow 字段。
- V1 collection endpoint 与完整 projector 的默认行为、SQL filter、响应 shape 均无变化。
- URL key/API query 一一映射，无 aliases、candidate-path polling 或 fuzzy compatibility。
- List page 在没有 Products/QueryTopics/detail 请求时可完整绘制。
- Action 只由 `available_actions` 驱动；unknown token fail-fast，command server revalidation 保留。
- Detail/Correction 只有 href，无 route/component/placeholder/抽屉。
- 查询数不随 page rows 增长；无逐行补请求或本地 server-data manipulation。
- 没有 Design System/global CSS/依赖变化；若实际变化已先回到 planning。
- 中文 comments/docstrings/logs/errors 仅在非显然责任、边界或异常路径需要时增加；实现 final 明确说明 touched-scope 文档文字处理结果。
- Code、contract、tests、05/07/08/09 一致；`contracts/database.md` 不更新的理由成立。

## 6. Commit、merge 与 branch cleanup gate

- Required validation 和自审通过后，先向用户展示精确 commit plan 与纳入文件，等待确认。
- 不自动 push；push 需要另行明确授权。
- 合并回 `main` 后核对提交存在于 `main`，再删除本地临时分支。
- 只在 `git ls-remote --heads origin codex/frontend-v2-geo-observation-list` 确认远端存在且删除行为仍在用户授权范围内时删除远端分支；否则记录远端不存在。
- 最终不得留下长期开发分支、临时 worktree 或活动 Task。
