# G06 GEO 洞察

## Goal

验收 `/geo/insights` 的七参数 URL、服务端 Insights 聚合、drill-down、优化任务命令及空/部分/不可用状态。

## Requirements

- 前置 G01、F06 已按本轮证据完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 6.6 节、`05-business-actions-state-and-api-contract.md` 第 21 节、`08-testing-quality-and-acceptance.md` 第 20 节、`11-frontend-redevelopment-task-list.md` G06 与 `contracts/openapi.yaml`。
- Screen 只消费 `GET /api/v1/geo-insights` 的服务端 read model，canonical URL 固定 `from/to/productId/contentPlatformId/geoPlatform/publishedArticleId/queryTopicId` 并显式映射 API；缺省日期为 UTC 当日及前 29 日。KPI、三项趋势、平台/内容/覆盖、建议和质量状态不从 Observation 分页在浏览器重算。
- 内容与覆盖行只依服务端 `primary_task` 和 nullable `optimization_action` 给出 drill-down 或优化入口；不从 rate、status、section 或建议推断动作。筛选选项和已选标签从服务端响应读取；空、部分和不可用均保持真实状态。
- 优化 Dialog 打开时才读取 Content Task creation-options。完整 source+target body 的相同人工重试复用 Idempotency-Key；409/stale 保留输入并冻结，不自动重放，仅显式成功刷新 Insights 与 options 后重新确认。POST 成功使用响应 ID 进入 Content Task Detail，并失效 Insights、Content Task list、目标 Product Detail；Coverage 来源还失效 Topic list。

## Acceptance Criteria

- [x] PostgreSQL integration、API/model/page 直接测试证明 read model、七参数、服务端动作与最终复核、Idempotency-Key 和冲突/成功状态。
- [x] 当前 production artifact 严格 fixture 的移动/桌面 URL、loading/error/empty/partial/unavailable、三项趋势精确表、drill-down、按需 options、优化命令及四档布局通过。
- [x] 记录实际代码、验收证据、独立复核、残余风险与 G07 下一步。

## Notes

- G07 单独验收 Print 只读路由；G08 单独验收完整真实栈。本项不把历史 V2 门禁当作本轮结果。

## 本轮实施与验证证据

- 实际生产修改：`frontend/src/domains/geo/geo-insights-page.tsx` 将命令 key/pending/accepted ID 交由页面级完整 body 记录持有，以 canonical search 隔离 Dialog，提交前重读精确 Insights 与 creation-options 状态；`frontend/src/routes/_app/geo/insights/index.tsx` 返回导航 Promise。pending 不可关闭，201 后仅重试进入响应 ID；409 显式刷新要求两项读取成功，来源消失仍保留选择和 request ID。
- 回归：`frontend/src/domains/geo/geo-insights-page.test.tsx` 增加命令交错边界；`frontend/tests/e2e/fixtures/geo-insights.fixture.ts` 与 `geo-insights.spec.ts` 增加 pending、409 幂等键、来源/目标撤销、后台选项错误的严格场景。
- 本轮 backend PostgreSQL integration `tests/integration/test_geo_insights.py` **32/32**，backend unit `tests/unit/test_geo_insights.py` **8/8**。两者同 basename，分别收集执行；首次组合收集失败不计为测试结果。
- 前端定向 page/model/API Vitest **28/28**；当前 production build 下 Playwright `geo-insights.spec.ts` **24/24**（mobile/desktop，含 Print 与四档布局）。`npm run typecheck`、生产构建、修改文件 ESLint、`git diff --check` 均通过。
- 独立高风险候选只读复核检查 page、route、API 错误映射、schema、直接测试和严格 fixture，未确认重复 POST、跨 search 串线或输入覆盖的阻断问题。它未重复运行测试；同 key 后端并发/事务与完整 GEO real-stack 留给 G08 当前门禁。
- 下一项 G07：单独核验只读 Print route、同一 read model/七参数标签、精确表格和 print media；G08 的无 fixture 真实业务栈尚未在本轮执行，G06 fixture 和 PostgreSQL 证据不替代它。
