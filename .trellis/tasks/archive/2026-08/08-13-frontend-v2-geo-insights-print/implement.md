# Frontend V2 GEO Insights Print 实施计划

## 1. 实施前门禁

- [ ] 用户批准本轮最终 `prd.md`、`design.md`、`implement.md` 摘要。
- [ ] 运行 `task.py start` 将 Task 从 `planning` 切换为 `in_progress`；审批前不得执行。
- [ ] 加载 `trellis-before-dev`，重新读取本 Task 三份规划文档和相关 frontend spec。
- [ ] 确认主工作目录仍在最新、干净的 `main`；若需要同步且干净，仅执行 `git pull --ff-only origin main`。
- [ ] 从该 `main` 创建本 Task 唯一获授权分支 `codex/frontend-v2-geo-insights-print`，并登记 Task branch；不得 push。
- [ ] 再次确认 `contracts/openapi.yaml` 的 `GeoInsights` 与 generated types 没有变化；若发现真实合同缺口，停止实现并返回规划审批点。

## 2. 有序实施清单

### Step 1：建立 Print route 与唯一 URL/query owner

- [ ] 在 `geo-insights.model.ts` 增加只复用 `canonicalGeoInsightSearchRecord` 的 `geoInsightPrintHref(search)`，以及 Screen/Print 共用的 generated time formatter；不新增筛选 schema 或 DTO。
- [ ] 在 model test 断言全七参数 Print href、unknown 参数不进入 href、现有 rate/change 无数据语义保持不变。
- [ ] 新增 `routes/_app/geo/insights/print.tsx`，完整复用 `geoInsightSearchSchema`、`isCanonicalGeoInsightSearch`、`defaultGeoInsightDates` 和 `geoInsightsQueryOptions`。
- [ ] 保持 loader prefetch 不 await，让 Print page 自己呈现 loading/error；route reset 只更新 Print search。
- [ ] 使用项目已安装 Vite Router plugin 重新生成 `routeTree.gen.ts`，不手写生成结构。

完成条件：Print direct URL、refresh 和 invalid-param canonicalization 只依赖现有 URL/model/query owner。

### Step 2：让 AppShell 按 metadata 真正移除普通导航

- [ ] 在 `navigation.ts` 的 `StaticDataRouteOption` 增加窄 `layout?: 'app' | 'print'`。
- [ ] Print child route 声明 `layout: 'print'`；不修改 navigation item，不新增 Sidebar route。
- [ ] `AppShell` 在 Print match 下只渲染 main 与 children，并保留 pathname 导航后的 main focus；不渲染 skip link、Sidebar、mobile navigation、top header、AccountMenu 或 Breadcrumb。
- [ ] 普通 app composition 保持原样，不引入 pathname special case 或第二 AppShell。
- [ ] 用最小 unit/component 证据冻结普通 route 与 Print route 的 DOM 边界；若 E2E 已完整覆盖 Print DOM，仅补 metadata resolver 单测，避免重复 fixture。

完成条件：Print 在 Screen 与 Print media 中都不存在普通导航交互节点，普通页面不回归。

### Step 3：提取 GEO Insights 专用共享报告体

- [ ] 新建 `geo-insights-report.tsx`，把当前趋势、Platform、Content、Coverage、Recommendations 和 Data Quality sections 从 `geo-insights-page.tsx` 原样迁入。
- [ ] 使用 discriminated `screen | print` props；Screen 必须带现有 `onOptimize`，Print 不接受 action callback。
- [ ] Screen 变体保留 `<details>`、`TableShell` 和既有 action column/服务端 action 验证。
- [ ] Print 变体直接显示三个精确趋势表，使用非聚焦 GEO-local report table region，并从表头、行和 DOM 中完全删除操作列。
- [ ] 共享 `formatInsightRate`、`formatInsightChange` 和 generated time formatter；不得重算 rate/change/trend/ranking/recommendation。
- [ ] 保留 `aria-hidden` SVG、文字/数值/table 等价信息，以及 current/previous numerator/denominator。

完成条件：Screen 现有展示与动作行为保持，Print 使用同一 rows/sections 且没有交互操作 DOM；无通用 framework。

### Step 4：实现 Screen 入口与 Print read-only page

- [ ] Screen header 增加“打印报告”语义 link，href 由 `geoInsightPrintHref(search)` 生成并保留全部 canonical search。
- [ ] 新建 `geo-insights-print-page.tsx`，直接调用 `useQuery(geoInsightsQueryOptions(search))`。
- [ ] Print success header 展示报告标题、服务端 current period、七项筛选人类标签、`generated_at` 与 analysis unit 标签。
- [ ] 未选择筛选显示“全部”；成功响应内找不到已选 ID 时显式失败，不显示 UUID fallback。
- [ ] Print 页面区分 pending、首次 error、retry、reset、cached refresh error、empty、partial 和 unavailable。
- [ ] 按钮 onClick 直接调用 `window.print()`；不创建 print service/hook。
- [ ] 确认 Print component 不导入 CSRF、creation-options、mutation、Content/Product cache keys、Dialog 或路由 drill-down helper。

完成条件：Screen→Print、direct/refresh/Back/Forward 可恢复同一报告；Print 只有报告和必要的打印/错误恢复控件。

### Step 5：增加 route-scoped responsive/print CSS

- [ ] 在 `global.css` 增加 `.geo-insights-print-*` 局部规则，不改变普通 `.ps-table` 合同。
- [ ] 375px Screen 下把 Print report table 视觉卡片化，使用 `data-label` 复用同一 cell 数据；确保 root 无横向溢出。
- [ ] 768/1024/1440 使用正常语义 table；长标题、URL 和标签允许换行。
- [ ] `@media print` 隐藏 `.geo-insights-print-controls`，使用纸张高对比表面与 print color adjustment。
- [ ] 保留浏览器默认纸张页边距，以报告局部内边距控制版面；不增加影响其它 route 的全局 `@page`。
- [ ] Print table 设置 `width:100%/min-width:0/table-layout:fixed`、重复表头、row 不拆分和单元格换行；不依赖横向滚动。
- [ ] 标题与短卡片使用精确 `break-*`，但不把长 section/table 整体设为不可拆分。
- [ ] 去掉 Print hover/focus 装饰；保留文字、数值和 table 的非颜色表达。

完成条件：四档 Screen 与 Print media 都可读，页面根无不可用横向溢出，浏览器可自行分页。

### Step 6：扩展 unit/component tests

- [ ] `geo-insights.model.test.ts` 覆盖 Print href、generated time 和既有无数据文案。
- [ ] `geo-insights-page.test.tsx` 继续证明 Screen 全部 sections/actions/filter，并增加 Print 入口 search 保留。
- [ ] 同一 test fixture 渲染 `GeoInsightsPrintPage`，证明筛选标签、analysis unit、全部 sections、默认可见的三个精确 table、无操作列/Dialog/Filter Form，并 spy `window.print`。
- [ ] 对 AppShell/layout metadata 增加不重复的 targeted test：Print 无主导航/面包屑/账户按钮，普通 route 仍有现有 shell。
- [ ] 不为纯 CSS 复制浏览器行为测试；分页/宽度交给 Playwright Print media。

完成条件：共享提取和只读 composition 有稳定模块边界测试，现有 Screen 行为没有弱化。

### Step 7：扩展 generated-type strict fixture Playwright

- [ ] 在现有 `geo-insights.fixture.ts` 增加每测试独立的 Print read-only gate；继续复用同一 `insights` / `emptyInsights` payload。
- [ ] read-only gate 只允许 auth 与 Insights GET；options、优化 POST、Detail stop 和其它 API 记录 unexpected 并 501。
- [ ] Happy path 断言精确一个 Insights GET、七参数一一映射、同一 fixture 报告数据、options/create 为零。
- [ ] Screen 全七参数“打印报告”链接、Back/Forward 和 Print canonical URL 保留。
- [ ] 覆盖 Print loading/error/retry/reset/empty/partial/unavailable/cached refresh error。
- [ ] 断言 Print DOM 无 Filter Form、操作列、drill-down/优化动作、Dialog、Sidebar、主导航、顶栏、AccountMenu、Breadcrumb。
- [ ] init script 记录 `window.print()`；点击后断言调用。
- [ ] `page.emulateMedia({ media: 'print', colorScheme: 'light', reducedMotion: 'reduce' })` 后断言打印/错误恢复控件隐藏、精确表格仍显示、分页 computed style 与 table 宽度有效。
- [ ] 在两个 Playwright project 中分别量测 375/768 与 1024/1440 的 document 根无溢出。
- [ ] 不调用 `page.pdf()`，不新增 PDF 能力或 Puppeteer。

完成条件：production artifact 明确证明同 URL/API/data、只读请求边界、Print media 和四档响应式。

### Step 8：同步稳定文档与 spec

- [ ] `05`：把单 GET 消费边界扩展为 Screen/Print。
- [ ] `07`：记录 Print 已完成；Phase 5 仍因完整 GEO real-stack E2E 与抽象回顾为 `NOT_MET`。
- [ ] `08`：登记 Print strict fixture、Print media、原生打印和四档验收。
- [ ] `09`：扩展 ADR-034，记录同一 URL/query/read model、Print shell、局部 SVG/精确表和原生打印。
- [ ] frontend state spec：扩展 GEO Insights Screen/Print 同 owner，Print 不读取 options/不 mutation。
- [ ] 核对 `02`、`03`、`01`、`04` 仍与实现一致；没有必要时不重复编辑。
- [ ] 明确记录 OpenAPI/database/backend/generated types/旧 frontend 未变更及原因。

完成条件：代码、测试、稳定 spec 与权威 Frontend V2 文档描述同一已实现边界。

### Step 9：自审与收口

- [ ] 运行 required validation；仅修复可归因于本 Task 的失败。
- [ ] 检查 diff：无第二 URL schema/query key/read model、无 client metric calculation、无 hidden focusable Screen controls、无 options/mutation、无通用 framework、无旧 frontend/后端/合同夹带修改。
- [ ] 检查 CSS：普通 `.ps-table` 与其它 route 不受 Print override 影响；375 卡片化和 Print table 只在 route-scoped selector 生效。
- [ ] 检查测试：fixture 不是固定成功假实现，未声明 API 确实失败；Print happy path 精确一个 GET。
- [ ] 检查文档：只更新直接过时的事实，不宣称完整 GEO real-stack 或 Phase 5 完成。
- [ ] 加载 `trellis-check` 完成 inline quality verification。
- [ ] 提交前向用户展示 commit plan 并另取确认；不得自动 commit、merge、archive 或 push。

## 3. Acceptance 与证据映射

| 验收范围 | 主要证据 |
|---|---|
| 七参数 canonical URL / direct / refresh / Back / Forward | model tests + route production Playwright |
| 同一 API params / query key / read model | API existing test + Print strict fixture request assertions |
| Screen→Print search 保留 | model/component + Playwright link/history |
| 报告全部 sections / labels / generated_at / analysis unit | component + Print production fixture |
| 无 filter/actions/Dialog/nav/options/mutation | component DOM + read-only fixture unexpected API gate |
| 三项趋势、精确表、空分母 | shared report component + Print media E2E |
| `window.print()` | component spy + Playwright init-script call record |
| Print CSS / 分页 / table / 非颜色表达 | Print media computed styles + visible text/table assertions |
| 375/768/1024/1440 根无溢出 | 两个 Playwright projects 的精确宽度量测 |
| loading/error/retry/empty/partial/unavailable | component + fixture modes |
| 普通 AppShell 不回归 | existing AppShell tests + Print metadata targeted test |
| 无合同变化 | `api:check` + diff/self-review |

## 4. Required Validation

以下命令直接覆盖本 Task 的共享 model/presentation、AppShell metadata、Print route、strict request boundary、Print media、四档响应式和 production artifact；全部为完成条件：

```bash
# 新 route 文件落地后，先让已安装的 TanStack Router Vite plugin 生成 routeTree.gen.ts
npm --prefix frontend-v2 exec -- vite build --config vite.config.ts

npm --prefix frontend-v2 run test -- \
  src/domains/geo/geo-insights.model.test.ts \
  src/domains/geo/geo-insights-page.test.tsx \
  src/app/navigation.test.ts \
  src/app/layout/app-shell.test.tsx

npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/geo-insights.spec.ts
git diff --check
```

说明：

- 首个 Vite build 只用于由现有 Router plugin 生成 route tree；最终 `npm run build` 仍是受影响 package 的正式 production build 证据。
- Targeted Playwright 在 `foundation-mobile` 与 `foundation-desktop` 两个 project 运行，并由 spec 内补足 375/768/1024/1440。
- `api:check` 证明 generated type 继续与未修改的 OpenAPI 同步；不需要 `make contract-check` 或 backend tests，因为本 Task 不改变共享 contract/backend/database。
- 任一失败只能在代码、配置或环境发生预期变化后重跑；范围外失败记录证据，不扩展 Task。

## 5. Optional Full-Suite Validation

以下是更广回归或 release/Phase gate 验证，不是当前独立 Print Task 的默认完成条件：

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make verify
```

- 完整 GEO real-stack E2E 明确排除，不因本 Task 的 fixture Playwright 自动执行或宣称完成。
- 若 required evidence 指向共享 AppShell/CSS 回归，先扩大到完整 V2 test/e2e；只有共享 contract、release readiness 或用户明确要求时才运行 `make verify`。

## 6. 回滚点

- Route/UI 回滚：删除 Print route/page、Screen Print link 和生成 route tree 变化。
- 共享 presentation 回滚：把共享 sections 恢复到 Screen page；不改变原有 query/model/API/optimization flow。
- AppShell 回滚：移除 `layout` metadata 和 Print composition，普通 composition 保持当前实现。
- CSS 回滚：删除 `.geo-insights-print-*` 与 scoped media rules；不改普通 TableShell contract。
- 测试/文档/spec 与对应行为一起回滚；无数据库、OpenAPI、backend 或不可逆数据回滚。

## 7. 明确不实施

- 不增加 backend/OpenAPI/database/generated type 变化。
- 不创建 print-only API/read model、query key、URL schema 或 client calculations。
- 不创建 PDF、服务端渲染、Puppeteer/ECharts/通用 Report framework。
- 不请求 creation-options、不执行 mutation、不提供 drill-down actions。
- 不执行完整 GEO real-stack、GEO 抽象回顾、Workbench、Phase 6 或旧 frontend 修改。
