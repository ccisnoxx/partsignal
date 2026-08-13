# Frontend V2 GEO Insights Print 审计记录

## 1. 结论

- 当前 `main` 在创建 Task 前为干净状态，`frontend-v2-geo-insights` 功能提交 `661baf3` 已进入 `main`；本轮只创建了规划中的 Trellis Task，尚未创建分支或修改生产代码。
- `GET /api/v1/geo-insights` 已完整提供报告所需的周期、筛选标签、三项趋势、平台表现、内容排行、问题覆盖、建议、数据质量和 unavailable sections；无需 print-only API、第二个 read model、后端或 OpenAPI 变更。
- Screen 已有唯一 URL schema、canonical normalization、URL→API 映射、query key、query options 和 rate/change 格式化函数。Print 可直接复用，不需要新 schema、query key 或 API wrapper。
- 当前 `geo-insights-page.tsx` 把查询状态、Screen 筛选、共享报告内容和优化 Dialog 放在一个 440 行文件中。只应提取 Screen/Print 同时消费的 GEO Insights 报告体，不应创建通用 Report、Analytics 或 Chart framework。
- V2 当前没有 `@media print`、`window.print()` 或既有 Print route 实现可复用。旧 V1 仅提供 Playwright `emulateMedia({ media: 'print' })` 的测试思路，不应复制其 Ant Design UI 或路由结构。

## 2. URL、query 与合同证据

### 2.1 Screen canonical URL

- `frontend-v2/src/routes/_app/geo/insights/index.tsx:10-25` 使用 `geoInsightSearchSchema`、search middleware、`isCanonicalGeoInsightSearch` 和 replace redirect，并在 loader 中调用 `geoInsightsQueryOptions`。
- `frontend-v2/src/domains/geo/geo-insights.model.ts:47-69` 只保留 `from/to/productId/contentPlatformId/geoPlatform/publishedArticleId/queryTopicId`，无效日期、UUID、空文本与未知 key 会被移除或恢复为 UTC 30 日默认范围。
- `frontend-v2/src/domains/geo/geo-insights.model.ts:73-83` 把七个 URL 参数一一映射为 `date_from/date_to/product_id/content_platform_id/geo_platform/published_article_id/query_topic_id`。
- `frontend-v2/src/domains/geo/geo-insights.model.ts:85-107` 已有唯一 canonical search record 与精确比较逻辑；Screen→Print 链接可复用该 record 生成完整 search string。

### 2.2 单一 query owner

- `frontend-v2/src/domains/geo/geo.api.ts:44-47` 定义 `geoKeys.insight(apiParams) = ['geo', 'insights', apiParams]`。
- `frontend-v2/src/domains/geo/geo.api.ts:70-83` 的 `geoInsightsQueryOptions(search)` 只调用一次 `GET /api/v1/geo-insights`，并复用上述 URL→API 映射与 query key。
- `frontend-v2/src/domains/geo/geo-insights-page.tsx:73` 的 Screen 直接消费同一 query options。Print route 应有独立 loader 以支持 direct URL/refresh，但 loader 与页面仍调用这个现有 options，不新增 hook 或 API wrapper。

### 2.3 OpenAPI 与筛选标签足够

- `contracts/openapi.yaml:3091-3111` 已声明七个 GET query 参数和 `GeoInsights` 响应。
- `contracts/openapi.yaml:7476-7537` 已提供 current/previous period、全部筛选选项及趋势精确点。
- `contracts/openapi.yaml:7546-7706` 已提供 Platform、Content Best/Declining/Long Unmentioned、Question Coverage、Recommendations、Data Quality、unavailable sections、`generated_at` 与固定 `analysis_unit`。
- `backend/app/services/geo_observation.py:1253-1327` 从权威 Product、冻结 Content Platform、PublishedArticle、链尾 GEO Platform 和 Query Topic 投影人类可读筛选标签。
- `backend/app/services/geo_observation.py:1330-1351` 在返回成功 read model 前拒绝不属于同一选项集合的筛选值；因此 Print 对成功响应可以精确解析选中标签，缺失时应显式报错而不是显示 UUID 或猜测名称。
- `backend/app/services/geo_observation.py:2085-2157` 在同一 read model 中返回 canonical period、同一组选项和全部 sections。现有合同足以完成 Print，默认不修改 backend、OpenAPI、数据库或 generated types。

## 3. 当前页面可复用边界

### 3.1 直接共享的报告内容

- `geo-insights-page.tsx:116-123`：Discovery / Mention / Accuracy 趋势卡。
- `geo-insights-page.tsx:125-137`：Platform Performance 数据列；Print 只去掉操作列。
- `geo-insights-page.tsx:139-143,269-277`：Content Performance 的 Best、Declining、Long Unmentioned；Print 复用同一行数据并去掉操作列。
- `geo-insights-page.tsx:145-160`：Question Coverage 摘要与矩阵；Print 去掉操作列。
- `geo-insights-page.tsx:162-174`：Recommendations；当前没有伪造 detail link。
- `geo-insights-page.tsx:295-306`：Data Quality、partial data 和 unavailable messages。
- `geo-insights.model.ts:109-131`：空分母、上一周期无样本和变化不可比较的文案必须由 Screen/Print 共用。

### 3.2 只属于 Screen

- `geo-insights-page.tsx:93-107` 的 Screen 标题说明和 Filter Form。
- `geo-insights-page.tsx:178-198,309-425` 的优化上下文、creation-options、Dialog、POST、cache invalidation 与成功导航。
- Platform/Content/Coverage 的 drill-down 或创建任务操作列。

### 3.3 Print 需要的局部差异

- 独立报告标题、服务端 current period、七项筛选的人类可读摘要、`generated_at` 和 analysis unit 标签。
- 原生 `window.print()` 按钮；Print media 时隐藏。
- 趋势精确表格直接呈现，不渲染可聚焦的 `<summary>`，也不依赖 CSS 强行展开 closed `<details>`。
- 所有业务表格只保留数据列，不渲染操作列、链接、Dialog trigger 或 mutation surface。

### 3.4 最小提取方案

新增一个 GEO domain 内的 `geo-insights-report.tsx`，承载上述共享 sections，并使用真实的 `screen | print` 两消费者变体：

- Screen 变体保留 `TableShell`、折叠精确数据和现有 action render；
- Print 变体使用同一数据与格式化函数，但直接显示精确表格、删除整个 action column，并使用无 `tabIndex` 的报告表格容器；
- 变体只存在于 GEO Insights domain，不提升到 `design-system/`，不接受任意 report schema 或 chart config。

## 4. App Shell 与 Print route

- `frontend-v2/src/routes/_app/route.tsx:5-16` 让所有 `_app` 子路由经过同一个 `AppShell`，可继续复用现有认证上下文。
- `frontend-v2/src/app/layout/app-shell.tsx:52-93` 当前无条件渲染 skip link、Sidebar、移动导航、顶栏、Account Menu、Breadcrumb 和普通 main padding。
- Print route 若仅靠 CSS 隐藏这些节点，导航、账户菜单和移动 Sheet trigger 仍会存在于 DOM/焦点顺序，违反“彻底移除交互”的要求。
- 最小方案是扩展既有 route static metadata，给 Print child 声明 `layout: 'print'`；`AppShell` 在该 match 下只渲染可聚焦 main 与报告内容，不渲染 Sidebar、顶栏、Breadcrumb、账户菜单和普通导航。该方案继续使用唯一 App Shell，不新建第二个认证壳层，也不使用 pathname 特判。

## 5. 表格、响应式与 CSS 审计

- `frontend-v2/src/styles/global.css:194-215` 的 `TableShell` 默认 `overflow-x:auto`，表格 `min-width:52rem`。
- `frontend-v2/src/design-system/data-table/table-shell.tsx:9-20` 的滚动 region 固定 `tabIndex=0`，适合 Screen 宽表，不适合无需横向滚动和无意义焦点的 Print 报告。
- V2 `global.css` 当前没有 `@media print`、分页、print color adjustment 或 Print table override。
- Print 应使用 GEO 局部 class：纸张上保持原生 table 语义、固定布局、允许长标题/URL/标签换行、重复表头并避免行拆分；375px Screen 用相同表格数据的 CSS 卡片化布局，不让页面根依赖横向滚动。
- 分页只约束标题、趋势卡、Recommendation 卡和 table row 的 `break-*`；不增加影响其它 route 的全局 `@page`，也不把整个长 section/table 标为不可拆分。

## 6. 测试边界

- `frontend-v2/tests/e2e/fixtures/geo-insights.fixture.ts:108-162` 已是 generated-type strict fixture，并拒绝未声明 API，但当前还允许 creation-options、优化 POST 和 Content Task Detail stop。
- Print 测试应复用该 fixture 数据与拦截器，并增加 read-only 模式：该模式只接受 auth 与 Insights GET，creation-options、POST 和其它 API 均作为 unexpected 失败。
- Happy path direct Print 必须精确断言一个 Insights GET；retry/error 场景可以再次请求同一 GET，但仍不得出现其它业务 endpoint。
- `frontend-v2/tests/e2e/geo-insights.spec.ts` 已覆盖 Screen 的 URL、状态、精确趋势表、动作与四档根无溢出；Print 测试可以追加到同一 spec，避免第二套 fixture/read model。
- Playwright 使用 `page.emulateMedia({ media: 'print' })` 验证按钮隐藏、精确表格可见、表格/标题分页 CSS 和根无溢出；用 init script 替换 `window.print` 记录调用，验证按钮直接调用浏览器原生接口。测试不生成 PDF，也不引入 Puppeteer。

## 7. 文档影响

- `docs/frontend-v2/02-information-architecture-and-routing.md` 已登记 `/geo/insights/print`，无需改动。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md` 已规定 print view 复用同一 read model，语义已足够。
- 应更新 `05` 的单 read model 消费者、`07` 的 Phase 5 进度、`08` 的 Print 验收边界、`09` 的 ADR-034 Print 决策，以及 `.trellis/spec/frontend/state-management.md` 的 Screen/Print 同 owner 稳定约束。
- `01` 的局部 SVG/ECharts 决策和 `04` 的通用 Analytics/响应式规则保持有效，无需为单个报告增加通用 framework 规范。

## 8. 排除项

- 不修改 backend、数据库、migration、OpenAPI 或 generated types。
- 不新增 PDF/服务端渲染/Puppeteer/ECharts/Report framework。
- 不修改旧 `frontend/` Print 页面。
- 不执行完整 GEO real-stack E2E、GEO 抽象回顾、Workbench 或 Phase 6。
