# Frontend V2 Phase 2.4 — Product Detail Technical Design

## Contract 与边界

新增 `GET /api/v1/products/{product_id}/detail`，`operationId=getProductDetail`，响应独立 `ProductDetail`。既有 `GET /products/{id} -> Product` 保持不变，避免改变 Product create/update、list 与 repair context 消费者。

```text
ProductDetail
├── product: Product
├── approved_fact: ProductDetailApprovedFact | null
├── pending_fact: ProductDetailPendingFact | null
├── content: ProductDetailContentSummary
├── publishing: ProductDetailPublishingSummary
├── geo: ProductDetailGeoSummary
└── activity: ProductDetailActivityItem[]
```

最小字段：

- approved fact：`id/version/status=APPROVED/classification/approved_at`；字段必有，历史批准时间缺失时值为 `null`。
- pending fact：`id/version/status=PENDING_REVIEW|CHANGES_REQUESTED/classification/created_at`。
- content：`task_count` 与 `latest_task={task_id,workflow_stage,created_at}|null`。
- publishing：`published_article_count` 与 `latest={work_id,article_id?,status,actual_title?,updated_at}|null`。
- GEO：`observation_count/article_result_count/discovery_rate/mention_rate/accuracy_rate`；无有效分母时 rate 为 `null`。
- Activity：`id/kind/label/timestamp/actor?/target`；target 只有 `kind/id/label`。

`null` 已表达摘要不存在，不增加 `exists` 布尔值。响应不包含事实/内容正文、review comment、完整任务、完整发布工作、完整观测或 Audit details。

事实选择规则：最高版本的 `APPROVED` 为 approved；pending 只检查最高版本，只有该版本为 `PENDING_REVIEW|CHANGES_REQUESTED` 时返回，避免旧退回版本冒充当前待处理事实。

## 权威数据来源与 Activity

| 区块 | 权威来源 |
|---|---|
| Product/actions/deletion | `Product` + `product_out/products_out` |
| Facts | `FactVersion` |
| Content | `ContentTask`；latest stage 复用 `content_tasks_out` |
| Publishing | `ContentTask -> PublicationWork -> PublishedArticle` |
| GEO | 当前 correction tails + 既有 GeoMetrics 口径 |
| Product Activity | `product.created/product.updated` AuditLog |
| Fact Activity | `FactReviewRecord` |
| Content Activity | `ContentTask` creation + `ContentReviewRecord` |
| Publishing Activity | `PublicationWorkEvent` |
| GEO Activity | `GeoObservation` creation/correction |

Activity kind 固定为 `PRODUCT|FACT_REVIEW|CONTENT_TASK|CONTENT_REVIEW|PUBLICATION|GEO_OBSERVATION`。服务端把领域 action 映射为中文 label，按 `timestamp DESC, kind ASC, source id DESC` 排序并截取最近 10 条。`timestamp` 使用记录 `created_at`；不使用可变 Product/Work `updated_at`、业务 `tested_at/published_at` 猜操作顺序。Publication Verification 与对应 WorkEvent/Audit 不重复加入。

为使新建和编辑也可追溯，将 `product.created/product.updated` 加入成功审计白名单并与业务写入同事务追加；不回填旧历史，无数据库迁移。

## 一致性与查询策略

- detail route 在认证查询前通过 route-local dependency 将同一 request session 设置为 PostgreSQL `REPEATABLE READ`。
- `product_detail_out` 在该事务内以固定次数批量查询组装所有区块；serializer 不逐项查询。
- Product/Content/GEO 复用现有权威投影；Publishing compact summary 与 Activity 使用 product-scoped aggregate/UNION 查询。
- query-count 测试用 1 条与 N 条相关记录证明次数固定；集成测试检查 `SHOW transaction_isolation`。
- 不新增表、缓存、物化视图、兼容 endpoint 或通用 aggregate framework。

## Frontend 架构与数据流

```text
route productId + non-blocking prefetch
  -> productsKeys.detail(productId)
  -> GET ProductDetail
  -> Product domain view/action/status mapping
  -> ProductDetailPage + existing DetailSection/Timeline/Badge/Dropdown/Dialog/Form Kit
```

- 依赖方向保持 `route -> product domain -> design-system/shared`。
- route 保留 static breadcrumb/nav inheritance，Domain 处理预期 404/403/query error；route errorComponent 只处理意外异常。
- query key 保持现有 `['products','list',params]`，新增 `['products','detail',id]`。
- Product domain 自己映射 compact Content/Publication/GEO summary，不 import 其他 Domain UI。
- Timeline 只消费服务端已排序 items；历史 fact/关联对象仅生成批准的 canonical href，不创建目标页面。

## 第二消费者抽象

| 能力 | 决定 |
|---|---|
| query keys | 提升到 Product API 稳定 factory |
| primary task | 移入 Product model，List/Detail 共同穷尽 union |
| available actions | 移入 Product model；List UPDATE 链接 Detail，Detail UPDATE 为 command |
| status presentation | fact/workflow 移入 Product model并补 Product status |
| API error mapping | 移入 Product API 边界，保留 status/code/message/request_id/details |
| 时间格式化 | 移入 Product model，继续使用原生 Intl |
| search/current fact/filter | 继续留在 Products List |

现有 `products-list.api.ts` 的真实能力移动到 `product.api.ts` 后删除，不保留薄 wrapper。不创建 shared registry、server-resource Hook、通用 CRUD 或 Detail framework。

## UPDATE 与 DELETE UX

- Header Primary 只消费 `product.primary_task`；overflow 来自 `available_actions`。
- Products List UPDATE 改为进入 Product Detail，不增加 `/edit`、URL modal state 或自动打开 Dialog。
- Detail UPDATE Dialog 只编辑四字段，使用 RHF/Zod/Form Kit、generated ProductUpdate 和 canonical revision。
- ProductUpdate 在 OpenAPI/Pydantic 统一 trim 后 `1..160`；update 的 normalized identity 唯一冲突只识别真实 constraint 并返回字段级 `PRODUCT_ALREADY_EXISTS`。
- UPDATE 成功用 canonical Product 更新 detail product，随后刷新 detail Activity/summary 与 lists。
- `REVISION_CONFLICT/IMMUTABLE_VERSION` 保留明确提示，立即 refetch 并把表单重置为最新 canonical Product；不根据事实状态在前端禁用字段。
- DELETE blocker 使用最新 detail projection；可删时确认对象和不可恢复后果。失败展示真实错误并刷新；成功先导航 Products，再以 `refetchType:none` 失效旧 detail 和刷新 lists。

## Compatibility 与 Rollback

- 新 endpoint 独立，现有 Product/List/Mutation wire shape 保持兼容；ProductUpdate 只收紧到数据库既有边界。
- 无数据库迁移、数据回填、feature flag 或兼容层。
- rollback point 为分支创建时的干净 main SHA；整体撤销本 Task contract/backend/frontend/tests/docs 即可。
