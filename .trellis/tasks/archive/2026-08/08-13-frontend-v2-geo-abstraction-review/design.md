# Frontend V2 GEO abstraction review — Design

## 1. Scope and decision

本任务不是再设计 GEO vertical slice，而是对既有所有权做最小校正。静态审计确认 route、domain API、服务端 read model、server-driven action、append-only correction、Screen/Print 报告体和测试分层均已有稳定 owner；因此不提升新抽象，只修 1 个共享身份比较 root cause、补齐 mutation 的真实 query consumers，并把三处已明确违反 Design System 规范的输入控件改回既有 primitive 边界。

## 2. Existing architecture to preserve

```text
TanStack Router routes
  -> GEO domain pages/models/geo.api.ts
    -> generated OpenAPI client + TanStack Query
      -> dedicated FastAPI read models / commands
        -> PostgreSQL authoritative state

GEO domain pages
  -> Design System primitives/patterns

Screen Insights + Print Insights
  -> same URL schema
  -> same geoKeys.insight(params)
  -> same GET /api/v1/geo-insights
  -> same GeoInsightsReport rows/formatters
```

继续禁止 `design-system -> GEO domain`、浏览器多接口 join、页面从 status/role 推导动作，以及 Print 第二 read model。

## 3. Finding F-01 — UUID identity normalization (P1)

### Root cause

Route 使用 `z.uuid()` 接受合法 UUID；UUID 十六进制大小写不属于身份差异。FastAPI 接受 `uuid.UUID` 后，Pydantic JSON 序列化输出规范小写。`assertGeoObservationDetail` 却把 response UUID 与原始 route string 做大小写敏感的 `===`，并在 Manual history 的 `is_selected` 校验中再次使用原始 route string。

### Minimal design

- 在 `geo-observation-detail.model.ts` 内增加一个局部 UUID identity comparator，比较 `toLowerCase()` 后的值。
- 只用于“route/request UUID 与 generated response UUID”的身份比较：Legacy requested ID、Manual selected ID、history selected node。
- response 内部各 UUID 继续精确比较，因为它们都来自同一 generated response，不需要泛化 normalized data model。
- `geoKeys.detail()` 与请求路径暂不做 canonical lower-case 改写；这不是正确性所需，也避免扩大 route/cache 行为。

该方案修复所有 Detail/Correction 调用，因为两条 query options 都经过同一 assertion owner。

## 4. Finding F-02 — mutation consumer invalidation (P2)

### Authoritative consumers

服务端事实表明一次 Observation mutation 会改变：

- `geoKeys.lists()`：链尾、compact outcomes、数量。
- `geoKeys.details()` / `geoKeys.correctionContexts()`：创建 correction、删除链时的详情上下文。
- `geoKeys.insights()`：Insights 只聚合当前人工链尾关系。
- `geoKeys.topicLists()`：Query Topic `observation_count` 与 DELETE blocker 直接统计全部 `GeoObservation.query_topic_id`。
- `productsKeys.detail(productId)`：Product Detail 的 GEO metrics 与 Activity。

Topic create/update/delete 会改变 Topic options/list、Observation/Detail/Correction 展示、Content consumers，并会改变 Insights 的 filter options、canonical question 和 coverage matrix。

### Minimal design

- 保持 query key factory 的唯一 owner `geo.api.ts`，不引入 cache service。
- 在现有 mutation success handler 中显式补齐缺失 key；这些 handler 已负责 mutation 协调且各自影响集合不完全相同。
- List 删除把整行作为 mutation variable（或等价地保留 `observationId + productId`），成功后精准失效 Product Detail，同时补 Insights/Topic list。
- Detail 删除、New、Correction 补 Insights/Topic list；既有 List/Detail/Correction/Product invalidation 保留。
- `QueryTopicListPage.invalidateConsumers()` 补 `geoKeys.insights()`。
- 不提取仅包装数个 `invalidateQueries` 的新 helper；当前重复是短、显式且 consumer 集合不同，尚不足以证明新 abstraction。

### Test design

- 复用现有 QueryClient spy pattern，给已有 page/component test 增加 precise key assertions。
- List 删除测试同时证明 mutation variable 携带当前行 product identity，且只失效对应 Product Detail。
- New/Topics 当前没有 colocated page test：优先在最小相关 component test 中覆盖 mutation success，不建立通用 test harness；若现有 fixture E2E 更低成本且能直接观察 query refresh，可在既有 spec 加一个精确断言。

## 5. Finding F-03 — Design System input drift (P2)

### Evidence-backed boundary

Frontend V2 Design System 明确列出 `Textarea` 与 `Select` 为 primitive，并规定 Domain UI 不应重新实现基础交互。GEO New/Correction 各复制同一 `textareaClass`；GEO Insights 的 Screen filters 与 Optimization Dialog 又手写两个 native `<select>` 样式，尽管同 domain 其他页面已经使用既有 `Select`。

### Minimal design

- 新增 `design-system/primitives/textarea.tsx`，结构与现有 `Input` 一致，只拥有 UI/accessibility style，不接收 GEO 类型。
- 为 Textarea 增加最小 Story 与 primitive test，满足既有 primitive 的项目惯例。
- New/Correction 删除复制的 `textareaClass`，直接使用 `Textarea`。
- Insights FilterSelect 使用既有 Base UI `Select`；需要“全部”时用明确 sentinel（例如 `ALL`）只在局部 helper 内映射到 `undefined`，不进入 URL/API contract。
- Optimization Dialog 的三个 RHF select 使用同一 primitive，保持现有 field error、label 与 dependent Product -> Fact selection 行为。
- 不创建 `GeoSelect`、通用 Form Select wrapper 或新的 form framework；局部小 helper 可保留，因为它拥有当前页面的 options/placeholder 映射。

## 6. Findings that require no code change

- Routes 已薄：只做 validation/canonical loader/metadata/composition。
- `geo.api.ts` 是 generated client/query key/query options 的唯一 GEO owner，页面没有直接调用 generated client。
- `geo-observation-actions.ts` 被 List/Detail 复用并 exhaustively 映射 token；无需 action framework。
- `GeoEvidenceUpload` 是 New/Correction 的真实双消费者边界；无需上传框架。
- Correction 使用 service-owned `chain_tail_id`，POST append-only；409 不 replay。
- Insights action 来源由 `primary_task + optimization_action` 决定；服务端 POST 复算并提供幂等/不可变来源。
- Screen/Print 已复用同一 URL/query/read model/report；无需 print API 或 analytics framework。
- unit/component/fixture/real-stack 的覆盖职责互补；不删除测试。

## 7. Documentation impact

若实施获批，更新：

- `docs/frontend-v2/04-design-system-and-interaction-spec.md`：Textarea/Select primitive 的实际使用边界无需改变，只补本轮 closeout（如需要）。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`：Observation/Topic mutation 的真实 consumers。
- `docs/frontend-v2/07-migration-plan.md`：审计 findings、修复结果和最终 Phase 5 gate。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`：targeted 回归与既有 real-stack 证据关系。
- `docs/frontend-v2/09-architecture-decisions.md`：仅在最终 closeout 需要记录 GEO abstraction review 结果时追加 ADR；不重写既有 ADR。
- `.trellis/spec/frontend/state-management.md`、必要时 `component-guidelines.md`：GEO mutation consumers 与 UUID identity contract。

本任务不更新 OpenAPI/database docs，因为没有批准或需要 API/数据库变化。

## 8. Phase 5 gate rule

实施前为 `NOT_MET`。实施完成后已重新核对 Product、Engineering、UX/Accessibility、Architecture、Contract/Data integrity、Testing、Documentation 七类证据；F-01/F-02/F-03 均已关闭且 required validation 通过，Phase 5 最终评定为 `MET`。
