# Products List Technical Design

## 边界与数据流

```text
route search schema
  -> canonical ProductsSearch
  -> URL/API 参数映射 + Products query key
  -> GET /api/v1/products
  -> generated ProductListItem[]
  -> Products status/action/view mapping
  -> TanStack Table + Table Kit
```

- 依赖方向保持 `route -> product domain -> design-system/shared`。
- route 只声明 `validateSearch`、canonical redirect、`loaderDeps`、query prefetch 和页面 composition。
- domain 不导入 route；Design System 不识别 Products token。
- `AuthContextValue` 暴露现有 `csrfToken: string | null`，route 将它作为 prop 注入页面；domain 不反向依赖 `app/auth`。

## Search 与 Query

`ProductsSearch` canonical shape：

```text
q?: trimmed string, 1..200
page: positive integer = 1
pageSize: 10 | 20 | 50 = 20
sort: UPDATED_DESC | UPDATED_ASC | MODEL_ASC | MODEL_DESC = UPDATED_DESC
factStatus?: ProductFactStatus
workflowStage?: ProductWorkflowStage
```

- canonical URL 始终保留 `page`，省略默认 `pageSize=20` 和 `sort=UPDATED_DESC`。
- route 对 raw search 与 canonical search 做键和值比较；不一致时 replace 到同一路由，移除未知或非法值。
- API 参数固定为 `{ search, page, page_size, sort, fact_status, workflow_stage }`，undefined 字段不发送。
- query key 固定为 `['products', 'list', apiParams]`；queryFn 只发一次 Products GET，失败保留服务端 `message/request_id`。
- list query 在窗口重新聚焦时刷新删除 projection。
- TanStack Table 受控状态由 canonical search 投影，使用 `manualFiltering/manualSorting/manualPagination`、`rowCount=total` 和 `autoResetPageIndex=false`。

## Status 与 Action Registry

Fact status：

| Token | Label | Tone |
|---|---|---|
| `NOT_ENTERED` | 未录入 | outline |
| `PENDING_REVIEW` | 待审核 | warning |
| `CHANGES_REQUESTED` | 待修订 | warning |
| `APPROVED` | 已批准 | success |
| `RETIRED` | 已停用 | secondary |

Workflow stage：

| Token | Label | Tone |
|---|---|---|
| `FACTS_EMPTY` | 事实未录入 | outline |
| `FACTS_EDITING` | 事实编辑中 | info |
| `FACT_REVIEW_PENDING` | 事实待审核 | warning |
| `FACT_CHANGES_REQUESTED` | 事实待修订 | warning |
| `FACT_APPROVED` | 事实已批准 | success |
| `RETIRED` | 已停用 | secondary |

Primary：

| Token | Label | href |
|---|---|---|
| `ENTER_FACTS` | 录入事实 | `/products/{id}/facts` |
| `SUBMIT_FACT_REVIEW` | 提交审核 | `/products/{id}/facts` |
| `REVIEW_FACT` | 审核 | `/products/{id}/facts/review` |
| `REVISE_FACT` | 修订 | `/products/{id}/facts` |
| `CREATE_CONTENT_TASK` | 创建内容 | `/content/tasks/new?productId={id}` |
| `VIEW_FACT_HISTORY` | 查看事实历史 | `/products/{id}` |

Overflow：

| Projection | 结果 |
|---|---|
| `UPDATE` | 禁用“编辑产品”，解释 V2 编辑入口 blocker |
| `DELETE` + 空 blocker | danger command + confirm |
| 无 `DELETE` + 非空 blocker | “查看删除条件” command，展示类型/数量 |
| `deletion=null` | 不显示删除相关入口 |

所有 generated union 使用 `switch + assertNever`；未知 token 显式报错，不回退为“查看”。

## 页面结构与响应式

```text
ProductsListPage
├── semantic page header（无 page action）
├── mutation error alert
├── TableToolbar
│   └── FilterBar（search + factStatus + workflowStage）
├── TableShell
│   ├── ColumnHeader
│   ├── TableSkeleton / EmptyTable
│   └── Product rows
│       ├── Product Link + model/brand tooltip
│       ├── status Badge
│       ├── relative time tooltip
│       └── RowActions
├── TablePagination
└── ProductDeletionConditionsDialog
```

- desktop 严格显示六列；现有 column role 在窄屏隐藏 metadata/date，保留 product/status/actions，横向溢出只允许在 TableShell region。
- 型号、品牌、类别分别截断并提供 hover/focus tooltip。
- current fact：`Approved vN`、`Pending vN`、`Changes requested vN`、`Retired vN`；无版本显示“暂无”。
- 初始 loading 使用 skeleton rows；空态按是否存在业务筛选区分；error row 显示真实错误和重试。

## DELETE 与错误流程

1. 只有 `available_actions` 包含 `DELETE` 且 blockers 为空时提供危险确认。
2. 请求发送 `product_id`、行上的 `expected_revision` 和 route 注入的 CSRF token；缺失 CSRF 显式失败，不发送请求。
3. 成功 `204` 后失效 Products list。
4. 任意服务端拒绝均显示 contract message/request id，并失效 Products list 取得最新 projection。
5. blocker 只展示服务端提供的 `type/count`；不从本地集合、状态或角色计算。

## Compatibility 与 Rollback

- 不改 OpenAPI/backend/database/generated schema/V1/deployment，没有迁移或兼容层。
- Foundation smoke 不再访问已变为业务页面的 `/products`；Products Playwright 接管该路由的 production artifact 验证，并同步测试文档/spec。
- 回滚点是创建实施分支时记录的干净 `main` SHA；整体撤销 route/domain/auth 注入、测试与测试归属文档即可。
