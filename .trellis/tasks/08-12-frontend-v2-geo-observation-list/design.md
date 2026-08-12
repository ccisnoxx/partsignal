# Frontend V2 GEO Observation List — Design

## 1. 根问题与最小设计决定

当前 collection endpoint 同时承担 V1 列表和 Detail projector，响应不是 compact list read model。直接替换它会破坏 V1；给同一 operation 增加 `compact=true` 或 `view=v2` 会制造条件响应和长期兼容分支。

本 Task 采用一个 additive、用途明确的 read endpoint：

```text
GET /api/v1/geo-observations/list-items
  ?search=<optional>
  &product_id=<optional UUID>
  &geo_platform=<optional>
  &accuracy=<optional AccuracyStatus>
  &date_from=<optional YYYY-MM-DD>
  &date_to=<optional YYYY-MM-DD>
  &sort=OBSERVED_DESC
  &page=1
  &page_size=20
  -> GeoObservationListPage
```

保留以下既有边界不变：

```text
GET /api/v1/geo-observations                  -> GeoObservationList (V1/detail-rich)
GET /api/v1/geo-observations/{observation_id} -> GeoObservation (Detail)
DELETE /api/v1/geo-observations/{observation_id}
```

不新增数据库表、模式参数、compatibility alias、filter-options endpoint、客户端 join 或通用列表框架。

## 2. 权威 read model

### 2.1 Schema

```text
GeoObservationListSort = OBSERVED_DESC | OBSERVED_ASC

GeoObservationListProduct:
  id: UUID
  label: string

GeoObservationListIndicator:
  positive_count: integer >= 0
  assessed_count: integer >= 0
  total_count: integer >= 0
  invariant: positive_count <= assessed_count <= total_count

GeoObservationListOutcomes:
  discovered: GeoObservationListIndicator | null
  mentioned: GeoObservationListIndicator
  accuracy: GeoObservationListIndicator

GeoObservationListItem:
  id: UUID
  observation_kind: LEGACY_MODEL_RESULT | MANUAL_ARTICLE_SEARCH
  query_text: string
  product: GeoObservationListProduct
  geo_platform: string
  outcomes: GeoObservationListOutcomes
  related_achievement_count: integer >= 0
  evidence_count: integer >= 0
  recorder: ActorSummary
  observed_at: date-time
  available_actions: (CORRECT | DELETE)[]

GeoObservationListPage:
  items: GeoObservationListItem[]
  page: integer
  page_size: integer
  total: integer
```

### 2.2 Indicator semantics

`GeoObservationListIndicator` 是同一个 compact count shape，不引入 UI status enum：

- `positive_count`：boolean 为 `true` 的数量；accuracy 为 `ACCURATE` 的数量。
- `assessed_count`：manual 的 discovered/mentioned 等于成果总数；accuracy 排除 null 与 `UNJUDGEABLE`。
- `total_count`：manual 的 current article-result 总数；legacy 为 1。
- legacy `discovered` 为 `null`，表示该模型没有采集该事实，不能显示为 0。
- legacy `mentioned` 为 `0|1 / 1`；legacy `UNJUDGEABLE` accuracy 为 `0 / 0 / 1`。
- manual 的 discovered/mentioned 由当前数据库约束保证非 null；若历史数据违反该约束，read model 返回结构化 409，不把未知事实伪装成 negative。accuracy 可返回 `0 / 0 / N`，明确区分“未评估”与 negative。
- manual current row 没有任何 article result 属于 read-model invariant 断裂，返回结构化 409，不伪造空结果。

页面格式由字段语义直接决定，例如“发现 2/3”“提及 1/3”“准确 1/2”；当 `assessed_count < total_count` 时以文本/tooltip 标明未评估数量。颜色和 icon 只是冗余提示。

### 2.3 字段来源

| List field | 权威来源 |
| --- | --- |
| `query_text` | 两类观测有 QueryTopic 时使用 `canonical_question`；manual 无 topic 时使用 `search_query`。raw `actual_prompt/search_query` 仍参与服务端搜索 |
| `product` | `Product.id` + 现有 brand/part-number label 规则 |
| `geo_platform` | legacy `model_name`；manual `search_platform` |
| `outcomes` | legacy row 或 manual current `GeoObservationPublication` aggregate |
| `related_achievement_count` | legacy distinct `published_article_ids`；manual current relation count |
| `evidence_count` | 当前 correction chain 各祖先 distinct attachment IDs |
| `recorder` | `tested_by` 对应 `ActorSummary` |
| `observed_at` | `tested_at` |
| `available_actions` | backend actor-aware action projector |

Notes、citations、article title/final URL、attachment IDs、raw workflow/primary task 均不进入 list item。

## 3. Backend query 与 action projection

### 3.1 Query pipeline

```text
GeoObservationListFilters
  -> current-tail predicate
  -> server search/filter predicate
  -> count
  -> tested_at + id stable order/page
  -> fixed-size batch projection
      Product + QueryTopic + recorder
      manual relation aggregates
      legacy relation counts
      correction-chain evidence counts
      actor-aware available_actions
  -> GeoObservationListPage
```

- 新 list query 不调用 `geo_observations_out()`，避免装载文章 URL、content versions、citations 与 notes。
- 复用已存在的 current-tail/date/accuracy 业务谓词；只有统一 platform 和 Product/query search 是新 list contract 的明确差异。
- 将现有 actor-aware action 判断提取成一个服务层私有 helper，由 full projector 与 compact projector 共用；这是两个真实消费者，不创建 action service/interface。
- fixed-size batch query 数量不随 page rows 增长；不得逐行 `db.get()` 或逐行关系查询。
- list 读取仍使用现有 Session 生命周期；本 Task 不增加 transaction isolation 或缓存。count/items 的普通并发分页语义不构成持久化合同变更。

### 3.2 Search/filter/sort

- `search` 对 canonical question、raw prompt/search query、Product brand、part number 做大小写不敏感 contains；count 与 rows 共用 predicate。
- `product_id` 精确匹配。
- `geo_platform` 在两个 observation kind 的权威列上做 trim 后大小写不敏感精确匹配。
- `accuracy` 保持 legacy exact/manual relation `EXISTS` 语义。
- `date_from/date_to` 沿用现有 date boundary helper；`date_from > date_to` 显式 422。
- `OBSERVED_DESC` = `tested_at DESC, id ASC`；`OBSERVED_ASC` = `tested_at ASC, id ASC`。
- 新 operation 的 `page_size` 只声明 `10|20|50`，默认 20；旧 endpoint 继续保持 1..100，不改变 V1 合同。

### 3.3 Permission/error matrix

| Operation | 200/204 | 401 | 403 | 404 | 409 | 422 |
| --- | --- | --- | --- | --- | --- | --- |
| list-items GET | 200 | session | account/password restriction | — | incomplete projection | query validation |
| delete existing | 204 | session | actor/action denied | missing | chain/current conflict | UUID/header validation |

新 list GET 允许现有已认证读取角色。`available_actions` 由 `ADMIN|ENGINEER` correction 与 `ADMIN` deletion 规则投影，命令端继续重新校验。OpenAPI 为 delete 补声明真实 422；不改变命令行为。

## 4. URL state 与 table state

### 4.1 TanStack Router

`geoObservationSearchSchema` 负责 trim、enum/date/UUID/数字 normalization。route 使用 `validateSearch`、canonical `search.middlewares`/`beforeLoad` replace、loader prefetch 与 thin component，完全复用 Content Tasks/Products pattern。

```text
URL q          -> API search
URL productId  -> API product_id
URL geoPlatform-> API geo_platform
URL accuracy   -> API accuracy
URL from       -> API date_from
URL to         -> API date_to
URL sort       -> API sort
URL page       -> API page
URL pageSize   -> API page_size
```

默认 URL 始终写 `page=1&pageSize=20`；默认 sort 不写入 URL。URL 是唯一已应用的 filter state；FilterBar 只保留未提交的表单 draft，并在一次 submit 中原子写入全部筛选，避免多个异步 URL 更新互相覆盖。所有非分页筛选提交把 page 设为 1。

### 4.2 TanStack Query/Table

- `geoObservationListQueryOptions(search)` 的 key 使用完整 API params；`retry:false`，显式 retry button 调用 `refetch`。
- delete mutation 成功后 invalidate list keys；失败保留 row 和结构化错误，不自动重放。
- TanStack Table 使用 `manualSorting/manualPagination`；唯一可排序列是 observed time，sorting 与 `GeoObservationListSort` exhaustive 双向映射。
- 不存全局 table state，不把 server rows 交给 client filter/sort/pagination model。

## 5. 页面与组件组合

```text
GeoObservationListPage
├── PageHeader
├── FilterBar
│   ├── q searchbox
│   ├── productId UUID input
│   ├── geoPlatform text input
│   ├── accuracy Select
│   ├── native from/to date inputs
│   └── reset
├── TableShell
│   ├── Query + Product (primary canonical anchor)
│   ├── GEO platform
│   ├── inline compact outcome indicators
│   ├── related achievement count
│   ├── evidence indicator
│   ├── recorder
│   ├── observed time (sortable)
│   └── RowActions (optional per row)
└── Pagination
```

- Product UUID 使用现有 `Input`，不新增 Product lookup/query。`q` 已能按 brand/part number 搜索；精确 `productId` 主要服务 canonical handoff 和高级筛选。
- outcome indicators 作为 GEO page 内的局部纯渲染函数；只有一个消费者，不提升为 Design System primitive。
- Query 使用普通 `<a href="/geo/observations/{id}">`，因为目标 route 尚未注册；不伪造 typed Router route。
- `CORRECT` 也是普通 canonical anchor；`DELETE` 使用现有 `RowActions` confirmation/finalFocus contract。
- 不做 whole-row click，主链接已满足“主列/行进入详情”，且避免与 overflow/menu/keyboard 交互冲突。

## 6. Responsive 与 accessibility

现有 `TableShell` 和 global table role 足够：

| Column | role | 窄屏策略 |
| --- | --- | --- |
| Query/Product | `primary` | 始终保留 |
| GEO platform | `metadata` | <=1023 可隐藏 |
| Outcomes | `status` | 始终保留 |
| Related achievements | `numeric` | <=767 可隐藏 |
| Evidence | `metadata` | <=1023 可隐藏 |
| Recorder | `metadata` | <=1023 可隐藏 |
| Observed time | `date` | <=767 可隐藏 |
| Actions | `actions` | 有资格时 sticky；无资格无 trigger |

Table 自身可局部滚动，Page/App Shell 继续 `min-width:0`；fixture 在 375/768/1024/1440 直接断言 `documentElement.scrollWidth <= clientWidth`。

语义要求：table headers、`aria-sort`、search/filters labels、indicator 文本、evidence accessible label、overflow accessible name、Dialog title/description、alert/request ID、loading rowgroup、visible focus 和 focus return。

## 7. Route 与未实现 Detail 的边界

新增：

```text
routes/_app/geo/route.tsx
routes/_app/geo/observations/route.tsx
routes/_app/geo/observations/index.tsx
```

明确不新增：

```text
routes/_app/geo/observations/$observationId.tsx
routes/_app/geo/observations/$observationId_.correct.tsx
```

E2E 只断言主链接和更正链接的 `href`；不点击进入未实现 route。这样 handoff URL 从第一张列表页开始稳定，但 Detail/Correction 能力仍由后续独立 Task 正式实现。

## 8. Test design

### Contract/backend

- Contract test 冻结新 operation、query names/sort/page size、compact required fields、禁止 detail-only fields、typed actions 和 error matrix。
- Integration 覆盖 legacy/manual projection、canonical/raw query、Product label、unified platform、indicator invariant、related/evidence count、recorder、tail-only、search/filters/date/sort/page/count。
- ADMIN manual 覆盖 `CORRECT+DELETE`，ENGINEER manual 覆盖 `CORRECT`，legacy 覆盖空 actions；delete command 仍重验权限。
- query-count 断言只要求固定，不把内部 SQL 数量写死到 UI contract；若现有测试工具支持，记录 page size 1/20 下相同数量。

### Frontend unit/component

- URL normalize/canonical record/API mapping/page reset/sort mapping/date range/unknown token fail-fast。
- 八列、primary href、Product second line、indicator 文本、evidence、action gating、无“查看详情”。
- loading/empty/filtered empty/error/request ID/retry/pagination/cached refresh error。
- delete CSRF/single request/success invalidation/409 no replay/focus return。
- navigation item/active state 与无 placeholder route。

### Fixture Playwright

- 新 `geo.fixture.ts` 只声明 auth me、list-items GET、delete DELETE；其他 GEO/业务 API 返回 501 并在 teardown 失败。
- 新 `geo-observations.spec.ts` 覆盖 canonical/direct/refresh/Back/Forward、所有 URL→API 参数、main/correction href、action gating/delete Dialog、states、pagination、keyboard/focus、四宽度与 root overflow。
- fixture 使用 generated types 构造数据，包含 legacy、manual、mixed/unknown/unassessed、长文本和不同 actor action projections。

### Real stack decision

本 Task 不新增 GEO real-stack spec，也不修改 `deploy/scripts/e2e-local.sh`。原因：当前只具备 List，真实 GEO create/detail/correction canonical surfaces 均被明确排除；backend PostgreSQL integration 与 production-artifact fixture 分别验证 read model 和 UI 映射。Phase 5 的 GEO checkpoint 在后续页面完整后通过唯一隔离编排建立，不先写 API 编排替代页面 flow。

## 9. 精确预计文件范围

### Contract/backend

- `contracts/openapi.yaml`
- `backend/app/schemas/geo_files.py`
- `backend/app/routers/observation.py`
- `backend/app/services/geo_observation.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/integration/test_geo_observation_list.py`（新增）

### Generated types

- `frontend-v2/src/shared/api/generated/schema.d.ts`
- `frontend/src/shared/api/schema.d.ts`（已批准的唯一 V1 机械生成例外）

### Frontend V2 runtime

- `frontend-v2/src/app/navigation.ts`
- `frontend-v2/src/app/navigation.test.ts`
- `frontend-v2/src/routes/_app/geo/route.tsx`（新增）
- `frontend-v2/src/routes/_app/geo/observations/route.tsx`（新增）
- `frontend-v2/src/routes/_app/geo/observations/index.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）
- `frontend-v2/src/domains/geo/geo.api.ts`（新增）
- `frontend-v2/src/domains/geo/geo.api.test.ts`（新增）
- `frontend-v2/src/domains/geo/geo-observation-list.model.ts`（新增）
- `frontend-v2/src/domains/geo/geo-observation-list.model.test.ts`（新增）
- `frontend-v2/src/domains/geo/geo-observation-list-page.tsx`（新增）
- `frontend-v2/src/domains/geo/geo-observation-list-page.test.tsx`（新增）

### Fixture E2E

- `frontend-v2/tests/e2e/fixtures/geo.fixture.ts`（新增）
- `frontend-v2/tests/e2e/geo-observations.spec.ts`（新增）

### Documentation

- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`

预计不改 `contracts/database.md`、migration、Design System、global CSS、`frontend/` runtime/page/test 或 E2E orchestration。若实现证据要求这些路径，先回到 planning 更新范围，不顺手扩张。

## 10. V1/V2 精确影响

| Layer | Impact |
| --- | --- |
| Backend existing V1 endpoint | 参数、response、query 与 projector 行为不变 |
| Backend new V2 endpoint | 新 compact query/projector；复用私有 action eligibility helper |
| V1 runtime/page/tests | 零业务变更；继续请求旧 endpoint |
| V1 generated schema | 机械增加新 operation/schemas；旧 types 不变 |
| V2 generated schema | 增加新 operation/schemas并由 GEO domain 消费 |
| Database | 无 schema/data 变化 |
| E2E orchestration | 无变化；只新增 fixture spec |

## 11. Rollback 与 branch 生命周期

- 无 migration、回填、双写、依赖或不可逆外部状态。
- 实现回滚为移除 additive endpoint、V2 route/domain/tests/docs 与 generated additions；V1 原接口从未切换。
- 实施与验证都在 `codex/frontend-v2-geo-observation-list`；不自动 push。
- 合并回 `main` 后删除本地分支；只有远端分支实际存在时才按用户授权删除远端同名分支。
