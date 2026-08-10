# 技术设计

## 1. Gap 与 read model 决策

既有 `FactVersionList` 的字段可以绘制六列，但不是适合 V2 history page 的 read model：它无分页、版本数量无上限、携带完整 Markdown/动作/删除投影、缺少 Product identity；同时 V1 三处消费者依赖其全量详情语义。直接收窄或默认分页会破坏既有合同。

因此保留 `listFactVersions` 不变，新增 Product 专用窄投影，不建立通用 History API：

```text
GET /api/v1/products/{product_id}/fact-history?page=1&page_size=20
  -> ProductFactHistoryList
     product: ProductFactsProductContext
     items: ProductFactHistoryItem[]
     page / page_size / total
```

`ProductFactHistoryItem` 仅包含 `id`、`product_id`、`version`、`status`、`classification`、`change_summary`、`created_by`、`created_at`。它不包含 `body_markdown`、`primary_task`、`available_actions`、`deletion` 或 `revision`。`page_size` 允许 10/20/50，默认 20；服务端唯一顺序为 `version DESC`。

Backend 在一个 `REPEATABLE READ` 请求内读取 Product context、total 与当前页，产品不存在返回 404。OpenAPI 声明 401、403、404、422。V1 的原 endpoint、调用者和返回结构不变。

## 2. URL、owner 与数据流

- canonical URL：`/products/$productId/facts/versions?page=1&pageSize=20`。
- route owner：`routes/_app/products/$productId_.facts_.versions.tsx`。
- page/query/search owner：`domains/product`。
- search schema 只接受 `page` 与 `pageSize`；非法值规范化为 1/20，canonical URL 始终保留两个参数。
- query key 包含 `productId` 和完整 pagination params；API 映射为 `page/page_size`。

```text
FactHistoryRoute
  -> validate search / loaderDeps
  -> productFactHistoryQueryOptions
  -> listProductFactHistory
  -> FactHistoryPage
     -> Product identity + readonly/history 说明
     -> TableShell
        -> TableSkeleton | EmptyTable | six-column tbody
     -> TablePagination
```

页面先大小写不敏感地验证 `response.product.id` 及所有 `item.product_id` 与 URL `productId` 一致；任一不一致都阻断整张表。版本单元格是语义链接，不增加整行 JavaScript 导航。

## 3. UI 与导航

- 该列表没有搜索、筛选、排序或选择，直接组合 `TableShell`、`TableSkeleton`、`EmptyTable`、`TablePagination`、`Badge`，不为静态六列引入额外 Table engine 配置。
- 列角色依次为 `primary/status/metadata/metadata/metadata/date`；窄屏按既有 CSS 隐藏次要列，document 不横向溢出。
- 状态与数据级别复用 `productFactStatusRegistry`、`confidentialityRegistry`；提交时间使用 `<time>` 与现有 formatter。
- 初始 loading 保留表头；空历史、404、403、通用错误使用明确文案和 request ID；通用错误可 retry，后台刷新失败保留旧数据。
- `VIEW_FACT_HISTORY` 指向 canonical history route。
- Product Detail 的事实 section 增加“查看全部事实历史”；Fact Version Detail 增加“返回事实历史”。Fact Review 不成为 history owner。

## 4. 兼容性与失败语义

- 不修改 database contract、V1 页面或旧 endpoint，generated V1 type 只因新增公开 schema/operation 更新。
- offset pagination 在并发新增或管理员合法删除后可能移动；页面每次按服务端当前真实顺序读取，不增加 cursor 或 snapshot token。
- API/前端不提供 fallback、客户端 join 或第二次 Product 请求。未知字段/token/错误仍通过现有显式错误路径暴露。
- 回滚点是移除新 OpenAPI operation/read model、backend endpoint、V2 route/page/query 与对应导航；旧 V1 能力始终保持。
