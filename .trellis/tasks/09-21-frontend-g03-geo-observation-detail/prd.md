# G03 GEO 观测详情

## Goal

验收 `/geo/observations/$observationId` 的单次聚合 Detail、Legacy/Manual 只读投影、当前链尾动作、错误边界及四档布局。

## Requirements

- 前置 G02 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 6.3 节、`05-business-actions-state-and-api-contract.md` GeoObservationDetail、`08-testing-quality-and-acceptance.md` GEO Detail、`11-frontend-redevelopment-task-list.md` G03 与 `contracts/openapi.yaml`。
- 只使用 `GET /api/v1/geo-observations/{id}/detail` generated discriminator。Legacy 展示其原有 recommendation/citation/成果/Evidence；Manual 展示 selected/root/tail 和服务端顺序的完整只读更正历史、每节点直接 Evidence、逐篇结果。历史 null 不补事实，浏览器不 join 旧 GET 或重排链。
- route UUID、响应身份和链断言明确失败；404/403/409/普通失败及已缓存刷新失败提供准确状态和显式重试。读失败时旧动作冻结；CORRECT 只指向当前尾，DELETE 只依尾节点服务端 token，409 必须显式刷新、重开和重新确认，不自动 replay。
- 删除成功后按 canonical route 返回列表，并失效全部已知链节点 Detail、Correction Context、GEO List/Insights、Topic 与对应 Product Detail；确认、错误、焦点可用。

## Acceptance Criteria

- [x] PostgreSQL integration、API/model/page 直接测试证明单次聚合、Legacy/Manual 历史、身份/错误/动作、DELETE 消费者与固定查询行为。
- [x] 当前 production artifact 严格 fixture 的移动/桌面 direct/refresh/Back/Forward、New ID handoff、404/403/409、删除确认/焦点、四档宽度及未声明 API 边界通过。
- [x] 记录实际代码、验证、独立复核、残余风险与 G04 下一步。

## Notes

- 不修改历史节点或 GEO 持久化；根 OpenAPI 由主代理维护。G08 负责完整真实服务闭环，本项 fixture 不替代。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`geo-observation-detail-page.tsx` 将删除意图交由 Detail 页面维护。打开确认后，后台 Detail 焦点刷新始终读取最新服务端动作；确认时再次核对精确 query 的成功/空闲状态、读取错误计数、当前尾 ID 与 DELETE token。读取失败或权限撤销冻结旧动作；DELETE 409 关闭旧确认，只有显式重载成功后才能重新打开并人工确认。DELETE 204 固定提交时的链节点和 Product 身份，取消旧 Detail 查询并失效 Detail、Correction Context、List、Insights、Topic、Product 消费者；跨域读取悬停不阻塞返回列表。导航失败仍保持已删除终态和返回入口；A 删除 pending 时切换 B 不会用 B 的身份清理或导航。`geo.api.ts` 将 Detail 与 Correction Context query key 的 UUID 统一为小写。
- 验证：Detail/API 直接测试 24/24，隔离 PostgreSQL 的 `backend/tests/integration/test_geo_observation_detail.py` 7/7（包含链历史、Evidence、角色动作、损坏链错误、固定查询数量）。移动/桌面 production preview Detail 浏览器 16/16，覆盖 direct/refresh/Back/Forward、Legacy/Manual、404/403/409/普通错误、后台撤销动作、删除确认/焦点、删除后列表消失和 375/768/1024/1440 宽度。共享 GEO List 与 New 浏览器回归 32/32，包含创建响应 ID 交接。Typecheck、production build、修改文件定向 ESLint、`git diff --check` 通过；构建仅有大 chunk 提示。第一次 Detail 浏览器运行 14/16 揭示 30 秒 fresh 窗口焦点不重读；改为正常状态 `'always'` 后 16/16。第一次 PostgreSQL 命令误从 `backend/` 读取根 `.env` 失败，修正路径后 7/7；临时数据库由测试夹具清理。
- 独立只读高风险复核：确认焦点刷新回归并在修复后复核实现，没有剩余确认的生产阻断项；指出 DELETE fixture 原先接受任意 ID 且仅按列表行 ID 删除。现已明确注册链节点到列表行的映射，并断言返回列表后原链消失；共享列表回归通过。
- 覆盖边界：本项浏览器使用严格 API fixture，后端真实服务端到端 GEO 闭环仍由 G08 验收。下一步 G04 更正工作区，重点核对 append-only、证据上传和 stale 409 显式恢复。
