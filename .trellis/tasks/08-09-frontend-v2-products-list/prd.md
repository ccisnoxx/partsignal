# Frontend V2 Products List

## 目标

实现 Frontend V2 第一张业务页面 `/products`，使用单次 Products list read model 展示可恢复、可筛选、可排序、可分页的产品事实列表，并严格消费服务端动作和删除投影；不提前实现 Product Facts 的其他页面。

## 已确认事实

- 实施基线是本地干净 `main`；本地允许领先 `origin/main`，不得 reset、回退、自动 pull 或 push。
- 实施分支为 `codex/frontend-v2-products-list`，只承载本 Task。
- `GET /api/v1/products` 和 generated `ProductListItem` 已返回绘制一行所需的全部字段，并支持 `page/page_size/search/sort/fact_status/workflow_stage`。
- 后端列表使用固定次数批量投影；事实、版本和动作接口不参与列表绘制。
- Product DELETE 使用 `expected_revision`，服务端锁内重新校验引用，并返回 `REVISION_CONFLICT` 或结构化 `PRODUCT_IN_USE`。
- V2 没有权威产品编辑路由；V1 当前列表也没有 UPDATE 入口。UPDATE 必须作为明确 UX blocker 呈现，不得猜测 `/edit`。
- 现有 Table Kit 已支持 manual server table、唯一 Primary、overflow、loading/empty/error、局部横向滚动和 responsive column role；本 Task 不修改其 API。

## 需求

1. `/products` 严格显示六列：产品（型号、第二行品牌）、类别、事实状态、当前事实、最近更新、操作。
2. 页面只调用一次 `GET /api/v1/products` 绘制列表，不请求 Facts、Versions 或 Actions 做客户端 join。
3. API 类型只使用 generated `ProductListItem`，不手写重复 DTO。
4. TanStack Query 管理 server state；TanStack Table 使用 manual server filtering、sorting 和 pagination。
5. URL search 包含 `q/page/pageSize/sort/factStatus/workflowStage`，显式映射 `q→search`、`pageSize→page_size`、`factStatus→fact_status`、`workflowStage→workflow_stage`。
6. `q/factStatus/workflowStage/sort/pageSize` 改变时回到 `page=1`；刷新、Back、Forward、direct URL 和复制 URL 恢复同一视图。
7. route schema 规范化非法数字、未知 enum、空或超长搜索及未知参数，并 replace 为 canonical URL；非法原值不得传给 API。
8. 分清 loading、initial empty、filtered empty、error+retry、success、pagination，并覆盖长文本和窄视口。
9. Products domain 自己维护 fact status/workflow stage 的 label、tone 和说明映射；映射不得决定动作资格。
10. 最近更新只使用浏览器 `Intl.RelativeTimeFormat` 和 `Intl.DateTimeFormat`。
11. Primary 只消费 `primary_task`，对六个 generated token 穷尽映射；`available_actions` 只进入 overflow，不从 status、role 或页面条件推导资格。
12. 每行最多一个 Primary 和一个 overflow；产品名称链接 `/products/$productId`，不增加“查看详情”。
13. 后续已批准但尚未实现的 route 只生成并测试 href，不创建占位业务页。
14. `UPDATE` 在 overflow 中显示禁用“编辑产品”，说明“V2 编辑入口待定义”。
15. `DELETE` 仅在服务端 projection 允许时显示；有 blocker 时显示删除条件，无 blocker 时危险确认；请求携带 `expected_revision`，拒绝或 conflict 显示真实错误并刷新 Products query。
16. 页面不增加“新建产品”按钮或 `/products/new`。
17. route 只负责 schema、prefetch 和 composition；Products domain 负责 model、query/mutation、action/status mapping 和页面组件。
18. Design System 不 import Products domain；不新增跨 domain abstraction 或通用 DataTable。

## 验收标准

- [x] 单次 list 请求可以完整绘制六列，且没有客户端业务 join。
- [x] search/filter/sort/page/pageSize 请求参数与 URL 映射精确，变化后的 page reset 正确。
- [x] refresh、Back、Forward、direct URL 和非法参数规范化通过。
- [x] status/workflow 映射只负责展示，Primary/overflow 只消费服务端 typed projection。
- [x] 六种 Primary href、UPDATE blocker、DELETE 条件/确认/revision/error 流程均通过测试。
- [x] loading、initial empty、filtered empty、error+retry、long text 和 pagination 可访问。
- [x] 375/768/1024/1440 下页面根无意外横向溢出，表格局部滚动、keyboard 和 focus 可用。
- [x] Playwright fixture 使用 generated type，明确是前端页面/路由测试，未声明 API 请求失败。
- [x] browser console 无未处理错误；必需验证全部通过。
- [x] 最终 diff 不含下一页面、抽象回顾、Design System 重构、backend/contract/deployment/V1 变更。

## 明确非目标

- `/products/new`、Product Detail 业务实现、Fact Workspace、Fact Review、Fact Version Detail、Content Task 页面。
- 新增通用 DataTable、跨 domain action registry、提前抽象或 Products List 抽象回顾。
- 重构稳定 Design System、修改部署、切换 V1、创建未来占位页。
- OpenAPI、generated schema、backend 或数据库修改；若实施时发现 contract gap，停止并报告。
- commit、merge、push、archive 或自动开始下一 Task。
