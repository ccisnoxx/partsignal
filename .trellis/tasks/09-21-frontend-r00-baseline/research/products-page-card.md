# `/products` 页面卡（R00）

## 目标与 Pattern

- Route：`/products`；Table。用户扫描产品事实状态、筛选和排序，进入详情或服务端指定的下一步工作。页面级「新建产品」进入 `/products/new`。
- 首屏固定显示产品型号/品牌、类别、事实状态、当前事实版本、最近更新时间和一列操作；对象型号是详情链接。来源：`docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 3.1 节。

## 数据与状态 owner

| 内容 | 权威与边界 |
|---|---|
| 列表 read model | `GET /api/v1/products` → `ProductList` / `ProductListItem`；服务端负责 `search/sort/fact_status/workflow_stage/page/page_size` 和 `total`，浏览器不得逐行读取 Detail 补数据。 |
| 按需读取 | 删除条件来自列表行的 `deletion` projection；本页不应为普通行或删除弹窗额外 join 详情。 |
| mutation | `DELETE /api/v1/products/{product_id}` 只在服务端返回 `DELETE` 时可尝试，带当前 `revision`、CSRF；创建与更新各由后续 `/products/new` 和 Detail 负责。 |
| URL | `q/page/pageSize/sort/factStatus/workflowStage`；映射到 API 的 `search/page/page_size/sort/fact_status/workflow_stage`。刷新和 Back/Forward 需恢复。 |
| Query | 仅持有按精确查询参数取得的列表；删除后失效列表。 |
| 局部 UI | 搜索输入的未提交文本、删除条件 Dialog 身份、mutation pending/error。 |

## 动作与错误

- `primary_task` 是每行唯一主操作：`ENTER_FACTS`、`SUBMIT_FACT_REVIEW`、`REVIEW_FACT`、`REVISE_FACT`、`CREATE_CONTENT_TASK`、`VIEW_FACT_HISTORY`。`available_actions` 只提供 `UPDATE`/`DELETE` 的次级动作；浏览器不从 `fact_status` 或角色推导资格。
- 列表 `401/403/400/422` 和删除 `409` 等错误须保留服务端错误与 request ID。删除条件、`revision` 和资格由当前列表投影与服务端最终守卫裁决；冲突后刷新，不自动重放。
- `03` 第 3.1 节与 OpenAPI 的 `ProductListItem.primary_task` 包含 `VIEW_FACT_HISTORY`，而 `05` 第 6 节写「事实历史查看不是 row primary action」。P01 必须以权威 OpenAPI 和服务端实际投影核对，并修正过期蓝图，不在 R00 猜测覆盖。

## 当前实现与差距

- `frontend/src/routes/_app/products/index.tsx` 有 search schema、canonical redirect 与 Query prefetch；`frontend/src/domains/product/products-list.model.ts` 将 URL 参数映射到 API；`product.api.ts` 的列表 query 只调用产品列表接口。
- `frontend/src/domains/product/products-list-page.tsx` 已组合 TanStack Table、FilterBar、RowActions、Pagination、loading/error/empty/filtered-empty 和删除条件 Dialog；`product.model.ts` 以 generated token 穷尽映射主操作。
- 源码位置与静态合同匹配；本轮尚未证明浏览器实际布局、键盘与焦点、URL 恢复、失败反馈或真实服务端行为。P01 需完成桌面与窄屏样板，记录保留或修复结论。

## P01 验收证据目标

1. Model/component：URL canonicalization 和 API 参数、唯一主操作、删除资格与 409、loading/error/empty/filtered-empty、分页排序和详情链接。
2. 浏览器 fixture：direct/refresh/Back/Forward、新标签、375/768/1024/1440 宽度与页面根无横向溢出、键盘行操作与 Dialog 焦点；声明确切允许的 API。
3. `api:check`、lint、typecheck、相关测试与 production build；fixture 和真实栈分别记录，不将历史 V2 测试结果计入本轮。
