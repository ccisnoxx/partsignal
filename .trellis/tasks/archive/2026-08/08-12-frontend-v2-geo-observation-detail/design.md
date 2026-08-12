# Frontend V2 GEO Observation Detail — Design

## 1. 设计结论

采用一个 additive 的 V2 专用 read model：

```text
GET /api/v1/geo-observations/{observation_id}/detail
  -> GeoObservationDetail (generated discriminated union)
```

保留现有 `GET /api/v1/geo-observations/{observation_id} -> GeoObservation` 给 V1 Drawer，保留 collection 与 POST canonical response。V2 Detail 只调用新 operation，一次得到 selected record、完整 correction chain、Query Topic、Product、Published Articles、证据 metadata/短期地址和 actor-aware actions。

这是当前缺口下最小的单一权威方案：扩展基础 `GeoObservation` 会把详情字段带入 V1 collection 与 POST schema；在旧 GET 上改 wrapper 又会破坏 V1；浏览器补请求则直接违反 waterfall、snapshot 和 N+1 边界。新增一个窄 GET 不增加持久化来源，也不为未来 Correction/Topics/Insights 预建能力。

## 2. 规划重点问题结论

### 2.1 当前单条 GET 是否足够

不够。`get_geo_observation()` 只调用 `geo_observations_out(db, [observation])`，能给单条记录补 Product label、recorder、article facts、citation 和继承后的 attachment IDs，但不能给页面一次返回 Query Topic 文本、FileRecord/访问地址或完整 correction chain。V1 Drawer 的逐文件/逐 Article 请求正是缺口的运行证据。

### 2.2 缺少哪些直接绘制字段

缺少：

- Query Topic `{id, canonical_question}`，历史真实空值需保留；
- evidence 的 `FileRecord` metadata、短期访问地址与首次追加节点；
- root→tail correction history、root/tail/selected 身份；
- Legacy Published Articles 的标题、冻结平台文本和 final URL；
- 可验证的链完整性与每个节点的直接证据归属。

`attachment_file_ids` 只有继承后的 ID 集合，`supersedes_id` 只有反向指针，两者不能让页面权威绘制上述信息。

### 2.3 扩展旧 Detail 还是新增窄 read model

新增窄 V2 Detail operation，旧单条 GET 不变。新 schema 是 OpenAPI/runtime 唯一权威，V2 直接使用 generated union；不创建手写 API DTO、兼容 query 参数、`view=v2` 或第二个客户端聚合层。

### 2.4 correction history 权威

后端负责：

- 从 requested node 找到 root；
- 按现有唯一后继 invariant 得到 root→tail 线性顺序；
- 校验 requested node 属于完整链；
- 明确返回 `selected_observation_id`、`chain_root_id`、`chain_tail_id`；
- 每个 node 返回 `is_original`、`is_selected`，现有 `observation.is_current` 继续由后继存在性投影；
- 所有顺序在响应中固定，前端不遍历 `supersedes_id`、不重排、不选择“最新 created_at”。

实现复用 `_lock_manual_observation_chain` 已证明的完整性规则，但 Detail 使用无锁、固定次数的 recursive CTE/batch read；不为只读页面逐节点加锁或逐节点查询。

### 2.5 Published Articles 与 evidence 批量边界

- 一次按全部 chain node IDs 查询 `GeoObservationPublication + PublicationWork + ContentVersion`，使用 Published Article/PublicationWork 的冻结平台 snapshot、实际标题/final URL；不读取 live PlatformProfile 补历史身份。
- 一次按全部 chain node IDs 查询 `GeoObservationAttachment + FileRecord`，只接受真实关联的 `VERIFIED OPERATION_SCREENSHOT`。
- 同一响应时间点生成所有文件的短期 download URL；签名不产生逐文件数据库请求。
- node 内直接携带当次新增 evidence；既有 `attachment_file_ids` 可继续表达该节点可见的祖先累计 IDs，但页面不依赖它补请求。
- 浏览器只渲染响应，不调用 Article/File endpoints join。

### 2.6 Legacy/Manual generated union

`GeoObservationDetail` 使用 `observation_kind` discriminator：

```text
GeoObservationDetail
├── LegacyGeoObservationDetail
│   ├── observation: LegacyGeoObservation
│   ├── query_topic
│   ├── product
│   ├── published_articles[]
│   └── evidence[]
└── ManualGeoObservationDetail
    ├── selected_observation_id
    ├── chain_root_id
    ├── chain_tail_id
    ├── product
    └── correction_history[]
        └── observation + query_topic + evidence + is_original/is_selected
```

Legacy 的 `recommendation/citations/answer_summary` 只存在于 `LegacyGeoObservation`；Manual 的 `article_results.discovered/mentioned/accuracy` 只存在于 `ManualGeoObservation`。Frontend model 只做 generated type alias、穷尽分支和响应 identity assertion，不复制字段定义。

### 2.7 primary_task / available_actions

现有 token 集合足够，不新增 token：

- Legacy：`VIEW_HISTORICAL_RECORD`，无 mutation action；
- Manual READY current tail：`VIEW_ANALYSIS`；
- Manual INCOMPLETE current tail：有 `CORRECT` 的 actor 使用 `CORRECT_OBSERVATION`，无资格 actor 使用 `VIEW_CORRECTION_HISTORY`；
- superseded Manual：`VIEW_CORRECTION_HISTORY`；
- current Manual actions：Engineer/Admin 可 `CORRECT`，Admin 额外 `DELETE`，历史节点为空。

修复点放在共享 `geo_observations_out` 的 primary projection owner：先得到 `_geo_observation_actions`，再选择 actor-aware primary。这样 Detail、V1 单条/列表和 POST canonical response 不会各自拥有第二套资格逻辑。

V2 Action Registry 解析：

- `VIEW_ANALYSIS` → 本页 `#results`；
- `VIEW_CORRECTION_HISTORY` → 本页 `#correction-history`；
- `VIEW_HISTORICAL_RECORD` → 本页 `#observation-record`；
- `CORRECT_OBSERVATION + CORRECT` → `/geo/observations/{chain_tail_id}/correct`；
- secondary `CORRECT` → 同一 tail URL；
- `DELETE` → 既有 delete command 与完整链确认 Dialog。

Registry 只映射 token，不从 `is_current`、role、status 或 supersedes 推导资格。List 与 Detail 成为第二个真实消费者后，把当前 List 内的 GEO action resolver 提取为同域单一 registry；不推广到 Design System 或其他 domain。

### 2.8 New Observation handoff

`createGeoObservation()` 已返回完整 canonical response。New page 保存 `result.id`，完成既有 dirty reset 与精准 invalidation 后调用 `onCreated(result.id)`；route 使用 TanStack Router 导航 `/geo/observations/$observationId`。fixture 必须断言没有通过 list-items 搜索该 ID。

### 2.9 文件范围与验证

精确范围和命令见 `implement.md`。Required validation 直接覆盖 OpenAPI/runtime、PostgreSQL chain snapshot、generated union、V1 compatibility、Detail/New/List 前端行为和 strict production artifact。完整 V2 E2E、完整 backend integration、`make verify` 与真实 `new→detail→correction` 均为 optional 或明确排除。

## 3. Backend 数据流

```text
observation_id + actor
  -> consistent read snapshot
  -> target GeoObservation
  -> Legacy: selected node only
     Manual: recursive chain root -> tail
  -> fixed batches:
     Product
     Query Topics
     Recorders
     ObservationPublication + PublishedArticle projection
     Citations
     ObservationAttachment + FileRecord
  -> existing geo observation fact/action projection
  -> Detail union + signed evidence URLs
```

查询结果缺少 Product、recorder、required Query Topic、Published Article URL、关联 FileRecord，或 Manual 链/类型/产品不一致时抛 `GEO_OBSERVATION_CONTEXT_INCOMPLETE` 或 `REVISION_CONFLICT` 的稳定 409。目标不存在为 404；认证/权限为 401/403；非法 UUID 为 422。新 operation 和既有单条 GET 都补齐真实非 2xx OpenAPI 声明。

Detail route 使用与 Product/Content/Publication read models 相同的 `REPEATABLE READ` dependency；不写数据库、不加缓存、不持久化 snapshot。

## 4. Frontend 边界

### Route

- 新文件 route 只负责 UUID boundary、metadata、query prefetch 和 composition。
- Domain page 使用 TanStack Query；浏览器 navigation 使用 TanStack Router。
- loader 不把 list row 写入 Detail cache，也不把 prefetch error 变成假 route success。

### Page

顺序遵循 Detail Pattern：

```text
Detail Header / readonly badges / actions
Summary
Metadata
Result facts
Evidence
Correction history
Related Published Articles
```

Manual 的 correction history 使用现有 Timeline 的最小 additive `content` slot，节点内复用 DetailSection/Badge/metadata pattern；不创建通用 History framework。Legacy 不渲染 correction controls。

### Error / retry

- `GeoRequestError.status/detail` 继续是结构化错误唯一 owner。
- 404、403、409、ordinary error 映射不同 title/description，全部保留 request ID 和 retry。
- 有 cached data 的 background error 显示 alert，保留 readonly snapshot。
- response ID、discriminator、root/tail/selected 或唯一 node 标记不一致时显式显示 contract mismatch，不降级到旧 GET。

### Delete

- 当前 tail 的 `DELETE` token 才传入 action resolver。
- mutation 使用现有 `deleteGeoObservation()`、CSRF 和 RowActions confirmation focus pattern。
- 成功后先 replace 到 canonical List，再以 `refetchType: 'none'` 精确失效链中 Detail cache，并刷新 GEO lists 与 Product Detail。
- 409/403/404 不 replay；保留错误和 retry/reload 入口。

## 5. Compatibility

- V1 `GeoObservationDrawer`、旧 GET、旧 collection 与 POST response 不改形状或业务 UI。
- 两套 generated schema 都机械更新；V1 typecheck 证明 additive operation 无破坏。
- 新 endpoint 不需要数据库 migration；现有 immutability、unique successor、FK 和 evidence relation 继续是唯一持久化 authority。
- `GeoObservationDetail` 不用于 List、POST 或 Correction form，避免万能 DTO。

## 6. Expected Files

### Contract / backend

- `contracts/openapi.yaml`
- `contracts/database.md`
- `backend/app/schemas/geo_files.py`
- `backend/app/services/geo_observation.py`
- `backend/app/routers/observation.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/integration/test_geo_observation_detail.py`（新增）

### Generated compatibility

- `frontend/src/shared/api/schema.d.ts`（机械生成）
- `frontend-v2/src/shared/api/generated/schema.d.ts`（机械生成）

### Frontend V2

- `frontend-v2/src/design-system/workspace/timeline.tsx`
- `frontend-v2/src/design-system/workspace/workspace-kit.test.tsx`
- `frontend-v2/src/domains/geo/geo.api.ts`
- `frontend-v2/src/domains/geo/geo.api.test.ts`
- `frontend-v2/src/domains/geo/geo-observation-actions.ts`（新增）
- `frontend-v2/src/domains/geo/geo-observation-detail.model.ts`（新增）
- `frontend-v2/src/domains/geo/geo-observation-detail.model.test.ts`（新增）
- `frontend-v2/src/domains/geo/geo-observation-detail-page.tsx`（新增）
- `frontend-v2/src/domains/geo/geo-observation-detail-page.test.tsx`（新增）
- `frontend-v2/src/domains/geo/geo-observation-list-page.tsx`
- `frontend-v2/src/domains/geo/geo-observation-list-page.test.tsx`
- `frontend-v2/src/domains/geo/new-geo-observation-page.tsx`
- `frontend-v2/src/routes/_app/geo/observations/$observationId.tsx`（新增）
- `frontend-v2/src/routes/_app/geo/observations/new.tsx`
- `frontend-v2/src/routeTree.gen.ts`（机械生成）

### E2E / docs

- `frontend-v2/tests/e2e/fixtures/geo-detail.fixture.ts`（新增）
- `frontend-v2/tests/e2e/fixtures/new-geo.fixture.ts`
- `frontend-v2/tests/e2e/geo-observation-detail.spec.ts`（新增）
- `frontend-v2/tests/e2e/new-geo-observation.spec.ts`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`

不预建 Correction/Topics/Insights/Print 文件。Timeline 只增加当前完整 correction node 所需的可选 rich content 插槽，现有字符串 description 消费者保持不变。

## 7. Rollback

实现未合并前可整体丢弃 Task 临时分支；新 operation 和 V2 route 均为 additive，不涉及数据回滚。若实现阶段发现现有 database invariant 无法形成完整线性链，停止实施并回到规划，不增加 migration 或猜测兼容逻辑。
