# G07 GEO 洞察打印

## Goal

单独验收 `/geo/insights/print` 的只读查询、筛选标签、报告布局与 print media。

## Requirements

- 前置 G06 已由本轮证据完成。权威为 `docs/frontend-v2/05-business-actions-state-and-api-contract.md` 第 21 节、`08-testing-quality-and-acceptance.md` 第 20 节及 `11-frontend-redevelopment-task-list.md` G07。
- Print 与 Screen 共享七参数 canonical URL schema、`GET /api/v1/geo-insights` query key、报告行及格式化。所选筛选的人类标签只取响应 `filter_options`，缺失标签显式失败。
- 保留鉴权和 Query provider，去除普通导航、账户与面包屑；不读取 creation-options、不发 mutation。所有精确表格直接可见，只调用原生 `window.print()`。
- print media 隐藏控件、保留重复表头和短卡片/行分页规则，四档宽度无根级横向溢出；按当前验收文档不生成 PDF。

## Acceptance Criteria

- [x] 直接测试与当前 production artifact 严格 fixture 证明同 read model、七参数、服务端标签、只读边界和错误/空态。
- [x] mobile/desktop 浏览器量测 375/768/1024/1440，print media 检查控件、表头、行/卡片分页规则与 `window.print()`。
- [x] 记录实际代码、当前验证、未覆盖边界和 G08 下一步；历史 V2 验收不算本轮结果。

## Notes

- 本项为已有只读页面的独立门禁；如当前候选满足合同，不为制造 diff 而改动生产代码。G08 单独执行无 fixture 真实栈。

## 本轮实施与验证证据

- 生产代码无需修改。已核对 `geo-insights-print-page.tsx` 与 Screen 共用 `geoInsightsQueryOptions`、`geo-insights-report.tsx`，route 使用同一 schema/query key；`AppShell` 的 print 分支没有普通导航。`global.css` 提供 print 控件隐藏、重复表头、行与短卡片分页规则。
- G06 当前 production build 的严格 `geo-insights.spec.ts` **24/24** 包含本项三个 Print 场景在 mobile/desktop 的 **6/6**，当前相关源码、配置和 fixture 未再变化。覆盖七参数映射、人类标签、只读无命令、`window.print()`、四档宽度、print media、canonical/history、loading/error/empty。
- G06 同轮 page/model/API 直接 **28/28** 含四个 Print page 测试；本项另运行 AppShell/navigation/global CSS 定向 Vitest **42/42**。G06 production build、typecheck、修改文件 ESLint 与 `git diff --check` 证据在相关输入不变时复用。
- 当前 Print 门禁按照权威验收文档不生成 PDF。完整 GEO 前端到真实服务和持久化边界由下一项 G08 的隔离真实栈验证，不用此 fixture 代替。
