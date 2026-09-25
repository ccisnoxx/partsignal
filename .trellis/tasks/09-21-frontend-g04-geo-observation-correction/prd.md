# G04 GEO 更正工作区

## Goal

验收 `/geo/observations/$observationId/correct` 的服务端更正上下文、冻结字段、append-only 创建、证据与 stale 409 显式恢复。

## Requirements

- 前置 G03 已按本轮证据完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 6.4 节、`05-business-actions-state-and-api-contract.md` GeoObservationCorrectionContext、`08-testing-quality-and-acceptance.md` 第 13.9 节、`11-frontend-redevelopment-task-list.md` G04 与 `contracts/openapi.yaml`。
- 首屏只读取 `GET /api/v1/geo-observations/{id}/correction-context`，历史 ID 由响应 `chain_tail_id` canonical replace；Legacy、缺失、权限不足、损坏链整体失败。原节点、历史逐篇事实和 Evidence 只读。
- POST 复用 `POST /api/v1/geo-observations`。Product、Platform、Query、非空 Topic 取当前服务端上下文；仅提交本次时间、候选完整显式事实、新 Evidence、Notes 与服务端当前尾 `supersedes_id`。三阶段上传完成才可提交；待完成上传、无合格候选或缺失 Topic 均阻止提交；DirtyGuard 覆盖上传和草稿。
- `GEO_PUBLICATIONS_CHANGED`、`GEO_OBSERVATION_HAS_SUCCESSOR` 冻结旧上下文，保存草稿、完成证据和 request ID；显式成功重载后按 Article ID 合并仍有效事实并采用新尾 canonical URL，不自动重放。`GEO_OBSERVATION_CONTEXT_INCOMPLETE` 保持 blocked，只有显式成功重读可恢复。刷新或导航失败不猜测 winner、不把成功 POST 当失败重试。
- POST 成功按响应 ID 进入新 Detail，并失效 GEO List/Detail/Correction Context/Insights、Topic list-items 与对应 Product Detail。

## Acceptance Criteria

- [x] PostgreSQL integration 与 API/model/page 直接测试证明 append-only、资格/冻结/证据边界、上下文身份、三类 409、pending 防重、消费者失效及无自动 replay。
- [x] 当前 production artifact 严格 fixture 的移动/桌面入口、direct/refresh、历史 canonical replace、错误/权限变化、上传重试、草稿与成功 ID handoff、焦点和四档宽度通过。
- [x] 记录实际代码、验收证据、独立复核、残余风险与 G05 下一步。

## Notes

- 本项不修改 GEO 持久化或根 OpenAPI；G08 负责完整真实栈闭环，本项 fixture 不替代。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：更正页面把服务端 correction-context 作为链尾、动作资格与冻结身份的唯一来源；内部 canonical replace 保留草稿，外部观察 ID 切换建立新会话。真实 `GEO_PUBLICATIONS_CHANGED`、`GEO_OBSERVATION_HAS_SUCCESSOR`、`GEO_OBSERVATION_CONTEXT_INCOMPLETE` 409，以及后台上下文读取失败或新尾变化均冻结旧写入。显式 GET 只有成功且身份吻合才按 Published Article ID 合并草稿并恢复；失败保留已完成证据与 request ID。提交时复核精确 query 与上传状态；上传 controller 由表单会话持有，跨 1280px 面板重挂仍保留 pending/failed intent。POST 201 立即固定响应 ID、关闭重复写入，缓存失效不阻塞导航；导航失败只重试打开已创建 Detail。route 向页面返回导航 Promise。历史节点和历史 Evidence 仍只读，payload 只关联本次证据。
- 当前验证：修改后 API/model/page 直接测试 26/26，隔离 PostgreSQL `backend/tests/integration/test_geo_observation_correction.py` 21/21（包含 append-only、服务端资格/候选/证据、successor 诊断和并发）。production preview 移动/桌面更正浏览器 22/22，覆盖历史 ID replace、详情入口、三类真实 409、失败重载、后台权限撤销、上传 complete 悬停跨断点、空白上传 DirtyGuard、响应 ID 交接与四档布局。另补 complete 失败后跨断点重试 2/2。`npm run typecheck`、production build、修改文件定向 ESLint、`git diff --check` 通过；构建只有大 chunk 提示。
- 基线诊断：更正直接测试 20/20、PostgreSQL 21/21；浏览器基线 10/12，两例因测试断言旧英文路由错误标题而失败。测试改为当前中文标题后在最终 22/22 中通过；这些旧门禁结果未计为本轮完成证据。
- 独立只读高风险复核：检查 canonical replace 与外部同链 ID 切换、精确上下文提交守卫、三类 409/失败重读、上传生命周期及 A→B 迟到成功隔离；未发现剩余确认的生产阻断项。复核未自行运行测试，以上数字均为本轮主代理实际执行结果。
- 覆盖边界：严格 fixture 验证页面协议和交互，真实服务的 New → Detail → Correction 闭环留待 G08。本项未修改后端、数据库、OpenAPI 或生成代码。
- 下一步 G05 GEO 问题库：服务端分页、引用与管理命令，按当前候选实际证据验收。
