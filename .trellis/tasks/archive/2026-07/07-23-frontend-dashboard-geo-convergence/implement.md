# Dashboard 与 GEO 洞察视觉统一实施

## 实施顺序

1. [x] 补 Dashboard 单测：PageHeader 在加载和失败时常驻，重试仍刷新原有两个查询。
2. [x] 调整 Dashboard：移除查询提前返回造成的页头丢失，统一目标页局部标题和指标卡响应式。
3. [x] 补 GEO 观测单测：指标加载/失败、记录空态和原有筛选请求互不干扰。
4. [x] 调整 GEO 观测：显式指标状态、`NoData` 表格空态、指标语义及窄屏重叠；不改筛选、分页、Drawer/Form。
5. [x] 补 GEO 洞察单测：PageHeader、图表坐标、替代文本、单停靠点键盘导航、Tooltip、图例和打印状态。
6. [x] 调整 GEO 洞察：PageHeader 与信息层级、查询状态卡、现有自绘图表和打印呈现。
7. [x] 收敛 `global.css`：仅修改 `.dashboard-page`、`.geo-observation-page`、`.geo-insights-page` 及现有响应式/打印选择器。
8. [x] 新增目标 Playwright 用例，覆盖真实登录、真实 API、三页导航、主题、响应式、键盘、图表替代文本、reduced-motion 和打印。
9. [x] 运行完整质量检查并审查 Diff，确认无新增依赖、无主题/契约/第一批页面变更。

## 预计业务文件

- `frontend/src/features/dashboard/DashboardPage.tsx`
- `frontend/src/features/dashboard/DashboardPage.test.tsx`
- `frontend/src/features/geo-observations/GeoObservationsPage.tsx`
- `frontend/src/features/geo-observations/GeoObservationsPage.test.tsx`
- `frontend/src/features/geo-observations/GeoInsightsPage.tsx`
- `frontend/src/features/geo-observations/GeoInsightsPage.test.tsx`
- `frontend/src/styles/global.css`
- `frontend/tests/e2e/dashboard-geo-convergence.spec.ts`

## 针对性验证

在 `frontend/` 运行：

```bash
npm test -- \
  src/features/dashboard/DashboardPage.test.tsx \
  src/features/geo-observations/GeoObservationsPage.test.tsx \
  src/features/geo-observations/GeoInsightsPage.test.tsx

npm run typecheck
npm run lint
npm run build
```

使用明确的本地或 CI 测试数据库和 Redis，禁止指向生产：

```bash
DATABASE_URL=... REDIS_URL=... PLAYWRIGHT_HTML_OPEN=never \
  deploy/scripts/e2e-local.sh \
  tests/e2e/dashboard-geo-convergence.spec.ts \
  tests/e2e/theme.spec.ts
```

## Playwright 检查矩阵

- 视口：1440、1024、768、375、320px；页面无非预期横向滚动。
- 主题：浅色、深色、跟随系统；图表、Tooltip、状态和焦点语义一致。
- 键盘：主操作、GEO 子导航、筛选、表格操作、数据质量、比率条、趋势图和打印按钮。
- 图表：替代文本、2px 折线、坐标、网格、颜色 Token、非颜色表达和 Left/Right/Home/End。
- 动效：`prefers-reduced-motion: reduce` 下无非必要动画，状态不依赖动画。
- 打印：A4 横向预览或 PDF 中无应用导航/筛选，页头、范围、数据质量和图表标签不裁切。
- 控制台与网络：无未处理异常、失败 API 或开发调试输出。

## Diff 与文档门禁

- 检查 `package.json`、锁文件、`theme.ts`、contracts、backend 和第一批页面均未变化。
- 新增或实质修改的复杂前端逻辑使用必要中文注释；不为显然代码增加机械注释。
- 本任务不改变公共行为契约，因此不更新 OpenAPI、数据库文档或稳定前端规范；若实施发现新稳定约束，先评估是否返回规划。
- 验证完成后只报告准确 Diff、检查结果、剩余风险和提交计划；不提交、不归档、不推送。

## 实施验证结果

- 目标组件测试：3 个测试文件、16 个用例通过。
- `npm run typecheck`、`npm run lint`、`npm run build` 全部通过；构建仅保留既有的主分块超过 500 kB 警告。
- 真实 API Playwright：目标用例与主题回归共 8 个用例通过，覆盖 33 条完整人工观测。
- 已人工检查 1440px 浅色/深色、375px 窄屏和 A4 横向打印产物；打印报告保留 388 条真实建议，共 35 页，平台指标与图表标签无裁切。
- 已确认没有新增依赖，也没有修改 `theme.ts`、contracts、backend、公共共享组件或第一批页面。
