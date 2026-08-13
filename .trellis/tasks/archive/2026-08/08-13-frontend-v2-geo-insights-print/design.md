# Frontend V2 GEO Insights Print 技术设计

## 1. 设计结论

本 Task 新增一个 authenticated Print child route，但不新增数据边界：

```text
/geo/insights                /geo/insights/print
       │                              │
       ├─ 同一 geoInsightSearchSchema ┤
       ├─ 同一 URL→API params         ┤
       ├─ 同一 geoInsightsQueryOptions┤
       └──────── GET /api/v1/geo-insights
                         │
                  generated GeoInsights
                         │
            GEO domain 共享报告 presentation
                 ┌───────┴────────┐
          Screen actions       Print readonly
```

Print route 继续位于 `_app` 下以复用认证与 Router/Query providers。`AppShell` 根据 child route metadata 选择唯一壳层的 Print composition，只渲染 main，不创建 Sidebar、顶栏、Breadcrumb、账户菜单或移动导航。

没有合同缺口。`contracts/openapi.yaml`、backend、database 与 generated types 不修改。

## 2. 共享 read model、query key、URL schema 与格式化

### 2.1 唯一所有者

| 责任 | 权威实现 | Screen | Print |
|---|---|---|---|
| URL schema/default/normalization | `geoInsightSearchSchema` | 复用 | 复用 |
| canonical search record | `canonicalGeoInsightSearchRecord` | 复用 | 复用 |
| URL→API query | `geoInsightSearchToApiParams` | 复用 | 复用 |
| query key/options | `geoKeys.insight` / `geoInsightsQueryOptions` | 复用 | 复用 |
| API response type | generated `GeoInsights` | 复用 | 复用 |
| rate/change 文案 | `formatInsightRate` / `formatInsightChange` | 复用 | 复用 |
| generated time 文案 | 新增一个 GEO-local formatter | 复用 | 复用 |
| filter labels | 同一响应 `filter_options` | 供 Filter Form | 供报告摘要 |

不新增 `useGeoInsights` 薄 wrapper：两个页面直接调用已经稳定的 `geoInsightsQueryOptions(search)`，即可共享同一 query key、缓存语义和错误行为。

### 2.2 筛选标签

Print 报告显示：

- 日期范围：使用 `data.period.current.date_from/date_to`，确保报告范围来自实际服务端结果；
- Product、Content Platform、Published Article、Query Topic：用 canonical search ID 在同一响应的 `filter_options` 中查找 label；
- GEO Platform：canonical search 已是服务端验证过的精确人类文本；
- 未选中的筛选显示“全部”。

服务端在返回成功响应前已用同一 options 集合校验筛选。若成功响应中仍找不到已选 ID，前端显式抛出上下文不一致错误，不回退到 UUID、空字符串或猜测名称。

### 2.3 Screen→Print canonical href

在 `geo-insights.model.ts` 增加 GEO-local `geoInsightPrintHref(search)`：只调用 `canonicalGeoInsightSearchRecord(search)` 与原生 `URLSearchParams` 生成 `/geo/insights/print?...`。它不定义第二套字段表，也不保留 unknown raw params。

Screen header 用普通语义 link 呈现“打印报告”。当前 Screen 已经 canonical，因此该 href 精确保留七项业务参数，并支持浏览器 Back/Forward 与新标签页。

## 3. Route 与 loader

新增 `src/routes/_app/geo/insights/print.tsx`：

1. `validateSearch` 直接使用 `geoInsightSearchSchema`；
2. search middleware 直接 parse 同一 schema；
3. `beforeLoad` 直接使用 `isCanonicalGeoInsightSearch`，replace 回 `/geo/insights/print`；
4. `loaderDeps` 返回同一 search；
5. loader 调用现有 `geoInsightsQueryOptions(deps)`，保持当前“不 await、让页面表达 loading/error”的行为；
6. component 把 `search` 交给 `GeoInsightsPrintPage`，reset 只导航回默认 Print search。

Print 需要独立 loader，因为它必须独立支持 direct URL 与 refresh；不把 Screen index loader 移到 parent，也不为两份短 route boilerplate 创建 route factory。共享的是 schema、normalizer 和 query options，而不是 `createFileRoute` 的类型实例。

## 4. App Shell、Sidebar、Breadcrumb 与 Page Header

### 4.1 route metadata

扩展现有 `StaticDataRouteOption`：

```ts
layout?: 'app' | 'print'
```

Print child 声明 `layout: 'print'`。父级继续提供 `navId: 'geo-insights'`；Print composition 不渲染普通导航，因此无需改变 Sidebar active 逻辑，也不使用 `pathname === '/geo/insights/print'` 特判。

### 4.2 AppShell composition

`AppShell` 从现有 matches 判断是否存在 `layout: 'print'`：

- 普通模式：保持现有 skip link、Sidebar、mobile Sheet trigger、top header、AccountMenu、Breadcrumb 与 main；
- Print 模式：只渲染一个有 `main-content` ID、pathname 导航聚焦和有限页宽的 main；不实例化上述交互节点。

这比 `@media print { display:none }` 更严格：在普通 Screen 查看 Print route 时也没有普通导航，键盘不会聚焦隐藏/无意义控件。

### 4.3 页面 Header

- Screen header 增加一个 outline 语义 link“打印报告”，不改变筛选或优化动作层级。
- Print header 独立呈现报告身份、摘要和一个“打印报告”按钮；不提供返回 link、Dropdown 或额外导出菜单。Back/Forward 使用浏览器原生导航。

## 5. 共享 presentation：只提取真实第二消费者

新增 `geo-insights-report.tsx`，只接受 generated `GeoInsights` 和一个真实两消费者变体：

```ts
type GeoInsightsReportProps =
  | { data: GeoInsights; variant: 'screen'; onOptimize: (...) => void }
  | { data: GeoInsights; variant: 'print' }
```

它组合当前已有的以下局部组件：

- `TrendCard` 与精确趋势表；
- `InsightSection` / `EmptyMessage`；
- Platform Performance；
- Content Performance；
- Question Coverage；
- Recommendations；
- Data Quality。

### 5.1 Screen 变体

- 趋势精确数据保留 `<details>/<summary>`；
- 表格继续使用 `TableShell`；
- Platform/Content/Coverage 渲染现有 action column；
- `onOptimize` 只供服务端 action 对应的 Dialog trigger 使用。

### 5.2 Print 变体

- 精确趋势表直接渲染，不创建 `<details>/<summary>`；
- 使用 GEO-local 非聚焦 report table region，不使用固定 `tabIndex=0` 的 `TableShell`；
- Platform/Content/Coverage 的 `<th>操作</th>` 与全部 action cells 整列不创建；
- 不调用 `contentInsightHref` / `coverageInsightHref`，不创建 link/button/Dialog 或 mutation surface。

共享文件仍然只理解 `GeoInsights`。它不接受任意 sections、columns、chart series、report schema 或配置对象，因此不是 Report/Analytics/Chart framework。

## 6. Print page 状态与只读边界

新增 `geo-insights-print-page.tsx`：

- 直接 `useQuery(geoInsightsQueryOptions(search))`；
- pending 显示报告 loading；
- 首次失败显示错误、retry 和“恢复默认范围”；
- cached refresh failure 保留报告并显示刷新警告；
- success 显示 Print header、筛选摘要和 `<GeoInsightsReport variant="print">`；
- 打印按钮直接执行 `window.print()`。

`GeoInsightsPrintPage` 不接收 CSRF、onCreated、onOptimize 或 creation options。这样即使 CSS 失效，也不存在 mutation/Dialog 的组件路径。

empty、partial 和 unavailable 不增加新状态机：它们继续由同一个 response 的空数组、`data_quality` 数量和 `unavailable_sections` 驱动共享报告体。空分母继续调用现有 formatter。

## 7. 趋势精确数据与非颜色表达

每张趋势卡在两个变体中都保留：

- 当前 rate 与 numerator/denominator；
- 上一周期 rate 与 numerator/denominator；
- change 文案；
- `aria-hidden` 局部 SVG；
- 日期、分子、分母、精确 rate 的原生 table。

Screen 用 `<details>` 控制展开；Print 直接显示 table。黑白打印仍可完全从标题、数字、分子/分母、变化文案和 table 理解结果，SVG 和颜色不是唯一信息源。

## 8. 表格布局、换行与分页

### 8.1 数据结构不复制

同一个 table rows JSX 由共享报告体生成；`variant` 只选择外层 table surface 与是否生成 action column。不会同时维护 table 与 card 两份数据组件。

### 8.2 Screen 375px

Print report 的 GEO-local table class 在 `@media screen and (max-width: 767px)` 下把原生 table row 视觉卡片化：

- header 仅视觉隐藏；
- 每个 `td` 使用 `data-label` 显示字段名；
- 单元格保持原生 table DOM/可访问文本；
- 长文本 `overflow-wrap:anywhere`；
- report root `min-width:0/max-width:100%`，不产生全页横向滚动。

768/1024/1440 继续使用正常 table。

### 8.3 Print media

`global.css` 增加只作用于 `.geo-insights-print-report` 的规则：

- 保留浏览器默认纸张页边距，报告自身使用适中内边距；不增加会影响其它 route 的全局 `@page`；
- `print-color-adjust`、白色纸张表面和高对比文字；
- `.geo-insights-print-controls` 隐藏；
- report table `width:100%; min-width:0; table-layout:fixed; overflow:visible`；
- `thead` 作为 table header group；
- 标题 `break-after:avoid-page`；趋势/建议等短卡片 `break-inside:avoid-page`；table row 避免拆分；
- 不把整个长 section 或 table 标为不可拆分；
- 标题、URL、标签和单元格允许 `overflow-wrap:anywhere/word-break:break-word`；
- hover/focus 背景在 Print 中还原，语义状态同时保留文字。

## 9. 原生打印集成

不创建 print service/hook：

```tsx
<Button onClick={() => window.print()} type="button">打印报告</Button>
```

这是唯一浏览器集成。无 PDF endpoint、`page.pdf()` 生产路径、Puppeteer、iframe 或 DOM clone。

Playwright 通过 init script 替换 `window.print` 为记录函数，点击按钮后断言调用；生产实现仍是原生 `window.print()`。

## 10. Playwright 设计

扩展现有 `geo-insights.fixture.ts` 与 `geo-insights.spec.ts`，不新增第二份 Insights payload。

### 10.1 strict read-only 模式

fixture 增加每测试独立的 Print/read-only gate：

- 允许 `/api/v1/auth/me`、`/api/v1/auth/csrf`；
- 允许 `GET /api/v1/geo-insights`；
- creation-options、优化 POST、Detail stop 和其它 API 全部进入 unexpected 并返回 501；
- happy path teardown/断言精确一个 Insights GET，retry 状态只允许重复同一 GET。

### 10.2 必测行为

1. Screen 全七参数链接进入 Print，href/Back/Forward 保留 canonical search；Screen 与 Print 请求参数逐项相同。
2. Direct Print 只发一个 Insights GET，并显示 fixture 中同一 generated time、analysis unit、筛选标签和全部 sections。
3. invalid primitive/unknown key replace canonical；合法但不存在 ID/错误可 retry/reset。
4. Print DOM 没有 Filter Form、操作列、drill-down/优化 link/button、Dialog、Sidebar、主导航、顶栏、AccountMenu 或 Breadcrumb。
5. 三张精确趋势表默认可见，`summary` 数量为 0；空分母仍为“暂无数据”。
6. options/create request 数量为 0，read-only gate 未记录 unexpected API。
7. 点击打印按钮调用 `window.print()`。
8. `emulateMedia({ media:'print', colorScheme:'light', reducedMotion:'reduce' })` 后打印按钮和 retry/reset controls 隐藏，table/精确数据仍可见。
9. 375/768/1024/1440 下 `documentElement.scrollWidth <= clientWidth`；Print media 断言 report/table 有有效宽度、长标签换行且关键元素的 computed `break-*` 符合规则。
10. loading/error/retry/empty/partial/unavailable/cached refresh error 继续由同一 fixture mode 覆盖。

不使用 `page.pdf()` 作为验收，以免把测试路径误当 PDF 能力；Print media DOM/CSS 断言直接验证本 Task 的浏览器合同。

## 11. 合同与文档

### 11.1 不变

- `contracts/openapi.yaml`
- `contracts/database.md`
- backend schema/service/router/tests
- `frontend-v2/src/shared/api/generated/schema.d.ts`
- 旧 `frontend/`

### 11.2 同步

- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`：Screen/Print 均只消费同一 GET。
- `docs/frontend-v2/07-migration-plan.md`：记录 Phase 5 Print 完成，完整 GEO real-stack 与抽象回顾仍未完成。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`：增加 Print strict fixture、Print media 与四档验收。
- `docs/frontend-v2/09-architecture-decisions.md`：扩展 ADR-034，记录同 URL/query/read model、Print shell 与原生打印边界。
- `.trellis/spec/frontend/state-management.md`：把 GEO Insights 稳定合同扩展到 Screen/Print 同 owner；Print 禁止 options/mutation。

`02` 已注册 route，`03` 已规定同 read model，`01` 的局部 SVG 决策和 `04` 的通用规则无需重复更新。

## 12. 文件范围

### 12.1 预计生产文件

- `frontend-v2/src/app/navigation.ts`
- `frontend-v2/src/app/layout/app-shell.tsx`
- `frontend-v2/src/domains/geo/geo-insights.model.ts`
- `frontend-v2/src/domains/geo/geo-insights-page.tsx`
- `frontend-v2/src/domains/geo/geo-insights-report.tsx`（新）
- `frontend-v2/src/domains/geo/geo-insights-print-page.tsx`（新）
- `frontend-v2/src/routes/_app/geo/insights/print.tsx`（新）
- `frontend-v2/src/routeTree.gen.ts`（生成）
- `frontend-v2/src/styles/global.css`

### 12.2 预计测试文件

- `frontend-v2/src/app/navigation.test.ts`
- `frontend-v2/src/app/layout/app-shell.test.tsx`
- `frontend-v2/src/domains/geo/geo-insights.model.test.ts`
- `frontend-v2/src/domains/geo/geo-insights-page.test.tsx`
- `frontend-v2/tests/e2e/fixtures/geo-insights.fixture.ts`
- `frontend-v2/tests/e2e/geo-insights.spec.ts`

若 AppShell Print DOM 已由 targeted E2E 充分证明且不需要额外 component fixture，可不改 `app-shell.test.tsx`；实现时以最小且不重复的证据为准。

### 12.3 预计文档/spec 文件

- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`
- `.trellis/spec/frontend/state-management.md`

## 13. 风险与回滚

- 主要共享风险是 AppShell metadata 分支误影响普通 route。用 navigation/unit 与 Print/普通 route E2E 同时证明；回滚只移除 `layout` metadata 分支。
- 主要展示风险是 print table CSS 在窄屏或纸张宽度下溢出。使用 route-scoped class、四档根宽量测和 Print media computed style 验证。
- 主要数据风险是 Screen/Print presentation 漂移。共享报告体和同一 formatter 是唯一防线，不用复制 JSX 后靠双份测试维持。
- 回滚删除 Print child route、Print page/report变体、Screen link、AppShell print metadata、route-scoped CSS、targeted tests 和直接文档更新；Screen 的原 query/model/API 与优化流程应恢复到当前行为。
