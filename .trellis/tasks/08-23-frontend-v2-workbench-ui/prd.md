# Frontend V2 Workbench UI

## 背景

Phase 8 的第一个子任务已经交付独立聚合端点 `GET /api/v1/workbench`。本任务是父任务
`08-23-frontend-v2-phase-8-workbench-planning` 的第二个 child Task，仅负责让 Frontend V2
通过这一份服务端聚合响应实现 Workbench Operations Inbox。

## 目标

- 新增 `frontend-v2/src/domains/workbench` 的 API/query、model 和 page。
- 将受保护的 `/` 路由从占位页替换为 Operations Inbox。
- 每次页面导航只消费一次 `GET /api/v1/workbench`，不由浏览器请求多个业务端点并 join。
- 完整展示六类 actionable count、attention queue、四域 workflow health 和 30 日 GEO summary。
- 原样使用服务端返回的 canonical `href`，不在前端重建业务路由、状态机或 action eligibility。

## 范围内

- Workbench 聚合查询、错误建模和页面展示模型。
- `/` 路由的 query 预取与页面组合。
- loading、fatal error、retry、attention empty、zero count、nullable rate 的显式状态。
- count links 与 attention items 的原生键盘访问能力。
- 375、768、1024、1440 四档响应式布局和页面根无横向溢出。
- 最小 model/component Vitest、Workbench strict fixture Playwright spec。
- 调整 Foundation smoke，使其改在无业务查询的受保护父路由验证 App Shell；其 business API allowlist 保持为空。
- 更新 `docs/frontend-v2/03-page-and-workflow-blueprint.md`，移除客户端派生总数并补齐当前 Workbench 聚合映射。

## 范围外

- backend、OpenAPI、数据库、V1 frontend、已有业务状态机及其他 domain 的 mutation/cache owner。
- 从 role、status、原始 DTO 或 count 数值推导 eligibility、canonical route 或 workflow health。
- 导入 Product、Content、Publication、GEO 的内部 registry。
- Redux、全局 store、自动刷新、图表、Workbench mutation。
- Dashboard、MetricTile、PageHeader、Workflow 等通用 framework，或仅一个 consumer 的 Design System 提升。
- Workbench real-stack spec；真实跨域验证由下一子任务 `frontend-v2-workbench-e2e` 负责。
- 抽象回顾、Phase 9、pull、push、PR、Git 历史改写和完整 `make verify`。

## 验收标准

- [ ] `/` 使用单一 Workbench query key；同次导航的 route loader 与 page 共享缓存，只发出一次 `GET /api/v1/workbench`。
- [ ] 浏览器不请求 Product、Content、Publication 或 GEO 业务端点来拼装页面。
- [ ] 六类 counts 均有穷尽映射；单链接和多链接结构都原样使用服务端 `href`。
- [ ] attention queue 展示服务端标题、摘要、时间和 `href`，六种 category 均有穷尽映射。
- [ ] workflow health 展示 `product_facts`、`content`、`publication`、`geo` 四域及服务端 summary；只把服务端 status 映射为视觉语义。
- [ ] 30 日 GEO summary 展示窗口、分子、分母和 rate；`value: null` 显示“暂无数据”，合法 `0` 显示为 0%，两者不混淆。
- [ ] loading 使用稳定骨架；fatal error 提供可用 retry；空 attention queue 有明确空态；zero count 仍按合同展示并保留服务端链接。
- [ ] 所有 count links 与 attention items 使用原生链接，可通过键盘依次聚焦；原生链接行为保留键盘激活能力。
- [ ] 375、768、1024、1440 四档内容可读，页面根 `scrollWidth <= clientWidth`。
- [ ] Foundation smoke 只验证受保护 App Shell，fixture 仍仅允许认证端点且 business API allowlist 为空。
- [ ] 不新增通用页面框架、全局状态、轮询、图表、mutation 或跨 domain registry 依赖。
- [ ] 定向 Vitest、两份 Playwright spec、API generated contract check、typecheck、lint、production build、`git diff --check` 和 Trellis Task validate 全部通过。
- [ ] `docs/frontend-v2/03-page-and-workflow-blueprint.md` 与现有聚合合同一致；其他权威文档无需重复维护。

## 实施门禁

本任务当前只完成规划。用户批准本版 `prd.md`、`research/audit.md`、`design.md` 和
`implement.md` 后，才允许运行 `task.py start`、创建唯一临时分支
`codex/frontend-v2-workbench-ui` 并修改产品代码。
