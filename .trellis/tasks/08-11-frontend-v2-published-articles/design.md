# Frontend V2 Published Articles — Design

## 1. 根问题与设计决定

当前 UI 链接已经使用正确的 Article canonical URL，但路由不存在；现有 list DTO 可以绘制行，却没有服务端搜索/显式排序；现有 detail DTO 不能一次绘制 Approved Content snapshot、lineage 和 publication timeline。最小修复不是新增万能 context，而是保留现有两个资源 endpoint：list additive 增 query contract，detail additive 复用既有 `ContentVersionDetail` 与 `PublicationWorkEvent`。

```text
GET /api/v1/published-articles
  ?page=1&page_size=20&search=<optional>&sort=VERIFIED_DESC

GET /api/v1/published-articles/{article_id}
  -> existing PublishedArticle fields
  + source_content: ContentVersionDetail
  + events: PublicationWorkEvent[]
```

不新增数据库表、Article context endpoint、Content snapshot DTO、客户端 join 或跨域前端组件复用。

## 2. 权威数据流与 snapshot

### 2.1 List

```text
URL(q/page/pageSize/sort)
  -> route Zod normalization
  -> publishedArticleSearchToApiParams
  -> GET PublishedArticleList
  -> PostgreSQL search/count/stable sort/page
  -> Publication domain Table
```

- count 与 rows 使用相同 predicate。
- 列表仍批量读取当前页 issue health，不逐行查询。
- list 请求进入 `REPEATABLE READ`，使 rows、issue health 与 deletion projection（虽 V2 不显示）来自同一 snapshot。
- Work 终态 snapshot 是平台/账号显示权威；不再以仍存在的 live Profile/Account 文本覆盖历史。

### 2.2 Detail

```text
PublishedArticle.id
  -> same-id PublicationWork
  -> fixed PASSED PublicationVerification
  -> verification.content_version_id
  -> existing ContentVersionDetail service
  -> PublicationWorkEvent[]
  -> one PublishedArticle response / one REPEATABLE READ transaction
```

- `PublishedArticle.id == PublicationWork.id` 是数据库 PK/FK invariant。
- Article 固定的 verification 决定来源 ContentVersion；不得读取 Work 当前指针或 ContentTask current pointer替代。
- 复用 `ContentVersionDetail` 是已有稳定 read model 的第二个真实消费者；它提供 immutable payload、Fact identity、generation lineage 和 review lineage。Article 页面只显示本 surface 需要的字段，不 import Content domain UI。
- 服务端校验 source content ID/hash 与 Article/Work 一致；校验失败统一转换为 `PUBLICATION_CONTEXT_INCOMPLETE`。
- events 使用现有 schema，固定 `created_at ASC, id ASC`。

## 3. API 与 OpenAPI 决策

### 3.1 List query

新增 `PublishedArticleSort`：

```text
VERIFIED_DESC (default)
VERIFIED_ASC
PUBLISHED_DESC
PUBLISHED_ASC
TITLE_ASC
TITLE_DESC
```

新增可选 `search`，trim 后 1–200 字符；搜索实际标题、来源内容标题、最终 URL、冻结平台名、冻结账号标签与标识。所有 sort 追加 `PublishedArticle.id ASC`。

保持 `page/page_size` 现有兼容范围和默认值。V1 省略新参数时仍取得与当前一致的 `verified_at DESC` 结果。

### 3.2 Detail response

对现有 `PublishedArticleOut` additive 增：

```text
source_content: ContentVersionDetail
events: PublicationWorkEventOut[]
```

保留现有顶层 content/result/verification/issues/action/deletion 字段，避免破坏旧消费者；V2 不渲染任何 command/deletion projection。

### 3.3 Error matrix

| Boundary | 401 | 403 | 404 | 409 | 422 |
| --- | --- | --- | --- | --- | --- |
| Article list | session | password/account restriction | — | broken result/context | query validation |
| Article detail | session | password/account restriction | article missing | broken work/verification/content lineage | UUID validation |

错误继续使用 `ErrorEnvelope(code,message,request_id,field_errors,details)`；不解析英文 message，不增加 fallback。

## 4. URL 与页面设计

### 4.1 Canonical URL

- 列表默认：`/publishing/articles?page=1&pageSize=20`
- q 仅在非空时保留；默认 `VERIFIED_DESC` 不写入 URL，其他 sort 显式保留。
- page/pageSize 始终显式保留；pageSize 只接受 10/20/50。
- 额外 key、非法 enum、过长/空白 q、非法数字统一 replace 到 canonical URL 后才 prefetch。
- q/sort/pageSize 变化回 page 1；page navigation 不改其他 URL state。

### 4.2 List columns

| Column | Content | Sort |
| --- | --- | --- |
| 发布内容 | actual title link；第二行 final URL domain | TITLE_ASC/DESC |
| 平台 / 账号 | frozen platform name；account label/identifier | — |
| 发布时间 | exact/relative time | PUBLISHED_ASC/DESC |
| 首次核验 | `Passed` + verified_at | VERIFIED_ASC/DESC |
| 内容健康 | HEALTHY / OPEN_ISSUE / RETIRED display registry | — |

没有 action column。现有 `primary_task/available_actions/deletion` 仍是 API 合同的一部分，但本 readonly slice 不消费它们。

### 4.3 Detail sections

```text
PublishedArticleDetailPage
├── PageHeader
│   ├── actual title
│   ├── readonly / immutable badge
│   └── external final URL
├── DetailSection: 发布成果
│   └── IDs、URL、domain、publish time、frozen platform/account、health
├── DetailSection: 来源内容快照
│   ├── Content/Task/Fact/version/hash/creator/change summary links & metadata
│   └── MarkdownPreview + summary + tags
├── DetailSection: 首次成功核验快照
│   └── PASSED、snapshot title/URL/time、comment、actor、verification time
├── DetailSection: Lineage
│   └── based-on/source job、generation/humanization lineage、content review result
├── DetailSection: Publication Timeline
│   └── Timeline(events in server order)
└── DetailSection: 内容健康
    └── health 与已有 issue count/summary；无 issue link/action
```

GEO references 暂不显示，因为当前合同没有该字段且本任务明确排除 GEO。Published Content Issue lifecycle 也不实现；健康区只显示 Article detail 已经携带的 read-only summary。

## 5. Component hierarchy 与依赖

```text
routes/_app/publishing/articles/*
  -> domains/publication/published-article-*.tsx
      -> domains/publication/publication.api.ts
      -> domains/publication/published-article.model.ts
      -> design-system/data-table/*
      -> design-system/detail/detail-section.tsx
      -> design-system/feedback/*
      -> design-system/markdown/markdown-preview.tsx
      -> design-system/workspace/timeline.tsx (existing pure UI)
      -> shared/api/generated types/client
```

- Route 只做 search/UUID validation、canonical redirect、metadata、prefetch 和 composition。
- Article model 独立拥有 search/schema/sort/status/time/domain 映射，不污染 `publication-work.model.ts`。
- Query keys 和 `PublicationRequestError` 留在现有 `publication.api.ts`，不创建第二个 API client。
- 不创建 Article action registry，因为本任务没有允许显示的 business action。

## 6. Navigation 与 handoff

- 父 `/publishing` route 只提供 breadcrumb `发布管理`。
- 子 route 分别声明 `navId: publishing-work` 与 `navId: publishing-articles`；导航新增“发布成果”，不创建“内容问题”占位。
- Workspace `COMPLETED`、Content Task Detail 和 Product Detail 已使用同 ID Article href；实现后只补回归断言，不改 handoff 业务逻辑。
- Detail 提供返回成果列表、来源 Content Version、所属 Content Task、Fact Version 的 canonical links；这些是导航，不是浏览器 join。

## 7. Test design

### Backend

- default/search/six sort values、stable ID tie-break、count/page predicate 一致。
- ADMIN/ENGINEER read projection、401/403/404/409/422 runtime/OpenAPI。
- Platform/Account live value变化后仍显示终态 snapshot。
- Detail source content/verification/work ID/hash 对齐、event order、PASSED-only invariant、断裂 lineage 409。
- 在 `REPEATABLE READ` 下固定查询数，不随 timeline/issue 行数增长。

### Component/model

- canonical URL normalization/API mapping/page reset/sort mapping/unknown token fail-fast。
- 五列无 action column、loading/empty/filtered empty/stale refresh error/pagination/long text。
- Detail section、sanitized Markdown、lineage/timeline、external link、403/404/409/request ID、cached data background failure。
- 无 form/contenteditable/delete/reverify/issue/GEO command。

### Fixture Playwright

- 扩展现有 generated-type `publication.fixture.ts`；只允许 Article list/detail GET，未知 API 返回 501 并在 teardown 失败。
- 一个 `published-articles.spec.ts` 覆盖 List → Detail、direct/refresh/Back/Forward/new tab、q/sort/pagination、404/403/409/retry、四档响应式、keyboard/focus 和浏览器错误审计。

### Independent real stack

- 复用 `deploy/scripts/e2e-local.sh` 的 PostgreSQL/FastAPI/V2 production preview 生命周期，不增加 orchestration。
- 在现有 `publication-workspace-real-stack.spec.ts` 增加独立只读用例：API 只建立前置 aggregate，浏览器从 Article list 搜索唯一成果并进入 detail；记录业务请求并断言只有 list/detail GET、source IDs/hash/snapshot/timeline 可见且无 mutation 控件。
- 既有 Flow B 继续证明 Workspace `COMPLETED` handoff；不重复完整 ACTION_REQUIRED 发布流程。

## 8. 预计修改文件

### Contract/backend

- `contracts/openapi.yaml`
- `backend/app/schemas/publication.py`
- `backend/app/services/publication_queries.py`
- `backend/app/routers/publication.py`
- `backend/tests/integration/test_publication_workflow.py`
- `frontend-v2/src/shared/api/generated/schema.d.ts`（生成）
- `frontend/src/shared/api/schema.d.ts`（仅在用户批准机械生成例外后）

### Frontend V2 runtime

- `frontend-v2/src/app/navigation.ts`
- `frontend-v2/src/routes/_app/publishing/route.tsx`
- `frontend-v2/src/routes/_app/publishing/work/route.tsx`
- `frontend-v2/src/routes/_app/publishing/articles/route.tsx`（新增）
- `frontend-v2/src/routes/_app/publishing/articles/index.tsx`（新增）
- `frontend-v2/src/routes/_app/publishing/articles/$articleId.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）
- `frontend-v2/src/domains/publication/publication.api.ts`
- `frontend-v2/src/domains/publication/published-article.model.ts`（新增）
- `frontend-v2/src/domains/publication/published-article-list-page.tsx`（新增）
- `frontend-v2/src/domains/publication/published-article-detail-page.tsx`（新增）

### Tests

- `frontend-v2/src/domains/publication/published-article.model.test.ts`（新增）
- `frontend-v2/src/domains/publication/published-article-list-page.test.tsx`（新增）
- `frontend-v2/src/domains/publication/published-article-detail-page.test.tsx`（新增）
- `frontend-v2/src/domains/publication/publication.api.test.ts`
- `frontend-v2/tests/e2e/fixtures/publication.fixture.ts`
- `frontend-v2/tests/e2e/published-articles.spec.ts`（新增）
- `frontend-v2/tests/e2e/publication-workspace-real-stack.spec.ts`

### Documentation

- `docs/frontend-v2/03-page-and-workflow-blueprint.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`

`contracts/database.md` 预计不改；实现只消费既有 immutable/snapshot invariant。

## 9. Review size / split decision

不拆 Task。虽然生成文件、测试和五份直接受影响文档使路径总数超过 20，但主要业务改动仍是一个可独立验收的 vertical slice：一个既有后端 list/detail read-model owner、一个 Publication domain、两个 canonical route。拆成 backend 与 frontend 子任务会制造无法单独交付的中间合同；没有第二个 workflow、mutation 或数据库 migration。若实施中出现新 GEO/Issue contract、数据库变更或第二个独立 consumer，立即回到规划并拆分，不在本 Task 扩张。

## 10. Rollback point

- 无 migration、无数据回填、无依赖升级。
- 回滚点是本 Task 单一实施 commit/merge 前的 `main`。
- API 变更全部 additive；回滚新 query/response 字段、新 routes/navigation 与生成类型即可恢复原状态，现有 V1 默认 list/detail 调用不需要数据修复。
- 回滚后已存在的 Workspace handoff 会恢复为当前“链接存在但 route 未实现”的已知前置状态，不引入半迁移数据。
