# Frontend V2 GEO Insights Print

## Goal

在 `/geo/insights/print` 提供可直接访问、刷新、恢复和浏览器原生打印的只读 GEO Insights 报告。Screen 与 Print 必须消费同一个 `GET /api/v1/geo-insights`、同一七参数 URL schema、同一 URL→API 映射、同一 TanStack Query key/options、同一 generated types 和同一格式化规则，不复制指标或创建第二个 read model。

## Background

- `/geo/insights` 已完成并进入 `main`，提供七项 canonical 筛选、单一 Insights read model、三个局部 SVG 趋势及精确表格、Platform/Content/Coverage/Recommendations/Data Quality，以及 Screen-only 优化动作。
- 路由蓝图已登记 `/geo/insights/print`，页面蓝图和 Phase 5 退出条件均要求 Print 与 Screen 复用同一 read model。
- 审计确认现有 OpenAPI 与后端响应已提供报告所需数据和全部筛选标签；本 Task 不需要合同、数据库或 generated type 变更。
- 本 Task 已获授权在规划审批后从最新且干净的 `main` 创建临时分支 `codex/frontend-v2-geo-insights-print`。不得自动 push；合并回 `main` 后必须删除本地和远程临时分支。

## Requirements

### Route、URL 与数据所有权

- 注册 canonical route `/geo/insights/print`。
- Print URL 使用 `from/to/productId/contentPlatformId/geoPlatform/publishedArticleId/queryTopicId`，与 Screen 使用同一 `geoInsightSearchSchema`、canonical normalization、默认 UTC 30 日范围和 URL→API 映射。
- direct URL、refresh、Back、Forward、Screen→Print navigation 和无效 primitive/未知参数恢复必须保持 canonical；`from > to` 或合法但不存在的 ID 保留 URL，并呈现服务端错误、retry 与恢复默认范围。
- Print route 使用独立 route loader 支持 direct/refresh，但 loader 与页面必须调用现有 `geoInsightsQueryOptions(search)`；不得新增 query key、API wrapper、print-only endpoint 或客户端 join。
- Screen 的“打印报告”入口完整保留当前 canonical search params。

### 报告内容

- 报告展示标题、服务端 current period、七项筛选的人类可读范围、`generated_at` 和 `analysis_unit` 的明确标签。
- 展示 Discovery / Mention / Accuracy 的当前值、当前分子/分母、上一周期值与分子/分母、变化文案、局部 SVG 趋势和每日精确数据。
- 展示 Platform Performance。
- 展示 Content Performance 的 Best、Declining、Long Unmentioned。
- 展示 Question Coverage 的状态计数和矩阵。
- 展示 Recommendations、Data Quality、partial data 说明和全部 unavailable sections。
- 分母为零继续显示“暂无数据”；上一周期无样本、真实 0% 和不可比较变化必须保持可区分，Print 不重新计算任何指标。

### 只读与打印交互

- Print route 不渲染 Filter Form、创建优化任务、drill-down 操作列、Dialog、Sidebar、移动导航、顶栏、Account Menu、Breadcrumb 或普通页面导航。
- 上述 Screen-only 节点必须在 React composition 中不创建，不能只靠 Print CSS 隐藏后仍可聚焦。
- Screen 模式只提供一个“打印报告”入口；Print 模式只提供原生浏览器打印按钮，点击直接调用 `window.print()`。
- Print media 隐藏打印按钮与所有恢复/重试类屏幕控件；不引入 PDF 生成依赖或服务端渲染。

### 趋势、表格、响应式与打印

- 继续复用当前三个局部 SVG，不安装 ECharts；SVG 保持 `aria-hidden`，精确数值和表格是等价信息来源。
- Screen Insights 的精确表格继续按需展开；Print route 不渲染 `<details>/<summary>`，三个精确表格默认完整可见。
- Print 报告使用语义 table；纸张宽度下移除操作列、允许长标题/URL/标签换行、重复表头、避免行被拆分，不依赖全页横向滚动。
- 375px Screen 下报告表格使用局部 CSS 卡片化呈现同一数据；768/1024/1440 和 Print media 使用可读 table。所有宽度页面根均不得出现不可用横向溢出。
- Print CSS 使用高对比、适合纸张的表面与文字，保留必要语义颜色但同时展示文字、数值和表格；标题与对应内容、关键卡片及 table row 应使用浏览器原生分页约束。

### 状态与错误

- Print route 明确区分 loading、首次 error、retry、empty、partial data 和 unavailable section。
- 后台刷新失败且已有数据时保留上一次成功结果并显示刷新错误。
- 恢复动作只重新读取同一 Insights GET 或导航到默认 canonical Print search；不得请求 creation-options、执行 mutation 或伪装成功。

### 测试与请求边界

- 复用现有 generated-type Insights strict fixture 数据，不创建第二份报告 DTO/fixture 计算。
- Print happy path fixture 只允许 auth 和一个 Insights GET；其它 API、page error 与未预期 console error 必须失败。
- Print route 不请求 Content Task creation-options、不执行优化 POST 或其它 mutation。
- Playwright 使用 Print media 验证相同 API 参数与报告数据、Screen controls 隐藏、精确趋势表可见、分页 CSS 生效、四档页面根无溢出以及 `window.print()` 调用。

## Constraints

- 只提取 Screen 与 Print 已存在的真实共享 GEO Insights presentation；不建立通用 Report、Analytics、Chart 或 table framework。
- Server state 继续由 TanStack Query 管理；URL state 继续由 TanStack Router 管理。
- 保留 `route -> domain -> design-system/shared` 依赖方向；App Shell 通过 route metadata 选择 Print composition，不使用 pathname 特判。
- 默认只修改 `frontend-v2`、相关测试、Trellis 规划/稳定 spec 和直接受影响的 Frontend V2 权威文档。
- 未发现合同缺口；若实施中出现与当前审计矛盾的真实合同证据，停止生产代码修改并返回规划审批点，不添加兼容 fallback。

## Acceptance Criteria

- [ ] `/geo/insights/print` 支持 direct URL、refresh、Back、Forward 和 canonical invalid-param recovery，并精确保留七项 Screen search params。
- [ ] Screen 与 Print 均通过现有 `geoInsightsQueryOptions` 使用同一 GET、API 参数映射、query key、generated `GeoInsights` 和格式化函数；没有 print-only API/read model/client metric calculation。
- [ ] Screen 提供“打印报告”入口，其 href 完整保留当前 canonical search；Print 成功响应显示服务端 period、筛选人类标签、generated time 和 analysis unit。
- [ ] 报告完整显示三项 KPI/趋势及默认展开的精确数据、Platform、Content 三分组、Coverage、Recommendations、Data Quality、partial/unavailable 信息。
- [ ] 空分母显示“暂无数据”，上一周期无样本、真实 0% 和不可比较变化没有被混淆。
- [ ] Print DOM 不包含 Filter Form、业务操作列、drill-down/优化动作、Dialog、Sidebar、顶栏、账户菜单、Breadcrumb 或普通导航；不请求 options/mutation。
- [ ] 打印按钮直接调用 `window.print()`，并在 Print media 下隐藏；没有 PDF/Puppeteer/ECharts 或服务端渲染依赖。
- [ ] Print media 下背景/文字对比、非颜色表达、标题/卡片/行分页、表头、换行和页宽可读性满足要求；三个精确趋势表不依赖 `<details>` 即可见。
- [ ] 375/768/1024/1440 的 Print route 页面根无不可用横向溢出；窄屏表格不依赖全页横向滚动。
- [ ] loading、error、retry、empty、partial data、unavailable section 和 cached refresh error 均有可区分、可访问的表现。
- [ ] generated-type strict fixture 的 Print happy path 精确只有 auth + 一个 Insights GET，未声明 API、creation-options、mutation、page error 和非预期 console error 均失败。
- [ ] required validation 直接覆盖 model/component/App Shell/route/Print media/production build；optional full-suite validation 与明确排除的 GEO real-stack 分开列出。
- [ ] `frontend-v2` 代码、相关稳定 spec 与 Frontend V2 权威文档一致；OpenAPI、数据库、backend、generated types 和旧 `frontend/` 保持不变。

## Out of Scope

- backend、数据库、migration、OpenAPI 或 generated type 变更。
- 新 Insights API、print-only read model、客户端指标/Recommendation 计算或数据复制。
- PDF 生成服务、服务端 HTML/PDF、Puppeteer 或其它打印依赖。
- ECharts、通用 Report/Analytics/Chart framework 或为未来页面预留的配置层。
- 创建优化任务、creation-options、任何 mutation、drill-down action 和 Dialog。
- 完整 GEO real-stack E2E、GEO vertical slice 抽象回顾、Workbench、Phase 6。
- 修改旧 `frontend/` GEO Print 页面。
