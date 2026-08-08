# Products Contract Readiness Design

## Contract

新增 OpenAPI-owned `ProductListItem`，它继承现有 Product list 所需字段并增加：

```text
fact_status: NOT_ENTERED | PENDING_REVIEW | CHANGES_REQUESTED | APPROVED | RETIRED
current_fact: { version: integer >= 1, status: FactVersionStatus } | null
updated_at: date-time
```

`ProductList.items` 改为 `ProductListItem[]`。Product detail contract 保持原样，避免把 list 聚合时间和摘要扩散到 Detail。

`GET /api/v1/products` 保留 `search/page/page_size`，新增 typed `sort/fact_status/workflow_stage`。不增加 camelCase 或 `q` 兼容参数；Frontend V2 后续在 route/query 层显式映射。

Product DELETE 新增必填 query `expected_revision >= 0`。成功保持 `204`；删除对象不存在 canonical response，调用方失效 Products query。

## Projection and Data Flow

```text
PostgreSQL Product + FactVersion + FactReviewRecord + direct references
  -> backend batch projection
  -> ProductListItem
  -> derived filter/sort/count/page
  -> GET /api/v1/products
```

- `current_fact` 取最大 `FactVersion.version`；无版本显式为 `null`。
- `fact_status` 取 `current_fact.status`，无版本为 `NOT_ENTERED`。
- list `updated_at` 取 Product 更新时间、最新事实版本创建/批准时间和最新事实审核记录时间的最大值。
- workflow/primary task 继续由现有单一投影规则计算。已批准版本存在但工作区内容不同，只改变 `workflow_stage/primary_task`，不改写 fact summary。
- 删除阻断、事实版本和审核活动均批量读取；不得在 serializer/presenter 逐行查询。

为避免在 SQL 条件和 presenter 中复制 workflow 状态机，服务先在数据库执行安全 search，再批量投影所有匹配 Product，随后在内存执行派生筛选、稳定排序、`total` 与分页。该实现查询次数固定但内存复杂度为 O(n)；代码加入 `ponytail:` 注释，只有真实规模测量证明不足时才下推为 SQL read projection。

## Actions and Errors

- `primary_task` 保留 `ENTER_FACTS/SUBMIT_FACT_REVIEW/REVIEW_FACT/REVISE_FACT/CREATE_CONTENT_TASK/VIEW_FACT_HISTORY`，始终由服务端唯一投影。
- `available_actions` 继续只表达 `UPDATE/DELETE` 等可尝试命令；它不是授权凭证。
- DELETE 锁定 Product 后先比较 revision，再重新统计 FactVersion、ContentTask、GeoObservation 引用；读投影不会绕过最终守卫。
- 使用既有 `REVISION_CONFLICT`、`PRODUCT_IN_USE`、`VALIDATION_ERROR`、认证与权限 code；不解析 message，不扩展全局错误 DTO。

## Compatibility and Rollback

- V1 只机械重生成 OpenAPI types、补一条 typed ProductList fixture，并在 Product DELETE 调用传入已有 revision；不改变 UI 行为。
- 无数据库迁移或数据变更。回滚为整体撤销 contract、backend、生成类型、最小 V1 同步、测试和文档。
