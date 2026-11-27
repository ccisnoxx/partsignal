# G01 GEO 观测列表

## Goal

验收 `/geo/observations` 的更正链当前尾摘要、服务端筛选排序分页、canonical URL 和服务端 token 动作。

## Requirements

- 前置 U07、F05 本轮完成。权威为 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 第 6.1 节、`05-business-actions-state-and-api-contract.md` GeoObservationListItem、`11-frontend-redevelopment-task-list.md` G01 与 `contracts/openapi.yaml`。
- 使用 `GET /api/v1/geo-observations/list-items` 的链尾紧凑投影，不在浏览器 join Product/Topic/旧完整列表/Detail，不对当前页二次筛选或排序。八列中呈现 legacy/manual 发现、提及、准确和未评估差异。
- URL 与服务端参数一一对应：搜索、Product/Query Topic 引用、GEO 平台、准确性、日期、观测时间排序、分页；直接访问、刷新、Back/Forward 与非法参数 canonicalization 可恢复。
- 仅按服务端 `available_actions` 提供更正/删除。删除确认/失败与焦点、CSRF、列表及跨域缓存刷新可用；无权限 token 不显示命令。
- 当前候选需有组件/model、严格 fixture 浏览器及必要的后端集成证据；不把历史 V2 门禁当本轮结果。

## Acceptance Criteria

- [x] 当前尾 read model、URL/API 映射、八列、空/筛选空/加载/失败/重试、分页与 token 动作验收。
- [x] 当前候选移动/桌面 production 预览覆盖 direct/refresh/Back/Forward、删除、焦点和目标宽度；必要的真实后端 current-tail 证据可核对。
- [x] 记录实际代码、验证、独立复核、残余风险与 G02 下一步。

## Notes

- 本项不改变 GEO 持久化或更正链合同；根 OpenAPI 由主代理维护。

## 本轮交付与验收证据（2026-09-21）

- 实际代码：`geo-observation-list-page.tsx` 将删除意图留在页面，只保存 ID；确认时读取当前筛选的 exact Query 投影及 `DELETE` token。后台刷新撤销动作或移除记录后，Dialog 保留但禁止旧命令。409 冻结删除直至显式重载成功；204 后取消旧列表读取、从列表缓存移除该 ID，再失效列表、详情、更正上下文、洞察、Topic 与 Product 消费者。读取失败时更正和删除入口禁用，焦点回到仍存在的 overflow 或页面标题。`05-business-actions-state-and-api-contract.md` 补齐已有 `query_topic_id`／`queryTopicId` 筛选合同；未更改根 OpenAPI 或后端行为。
- 列表组件/model 定向测试 8/8；production preview 浏览器 14/14，覆盖桌面/移动 direct、刷新、Back/Forward、筛选排序分页、四档宽度、删除和背景移除时的确认框及焦点。新增直接测试覆盖 token 撤销、行消失、409 关闭重开/显式恢复、204 后 GET 失败不复用旧入口；浏览器新增背景移除场景。`npm run typecheck`、三个修改文件定向 ESLint、`git diff --check` 通过。production build 仍有既有大 chunk 提示。
- 隔离 PostgreSQL 迁移后的 `backend/tests/integration/test_geo_observation_list.py` 1/1，验证 correction-chain 当前尾、服务端筛选分页与动作、固定查询数量；测试容器和卷已清理。该证据属于本轮 G01，不借用历史 V2 门禁。
- 独立只读高风险复核核对了 exact Query、409 冻结、204 缓存与失效、焦点、CSRF 及服务端完整更正链删除，未确认阻断问题。多筛选/多分页同时缓存和旧列表请求与 204 交错未有专门测试；现有取消旧请求、只移除已知 ID、失效全部列表的路径已静态复核。下一步 G02 新建观测。
