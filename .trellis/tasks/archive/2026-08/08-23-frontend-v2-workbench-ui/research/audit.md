# Frontend V2 Workbench UI 审计

## 结论

当前实现条件齐备，没有阻塞项。仓库位于 clean `main`；前置子任务
`frontend-v2-workbench-aggregate-read-model` 已实现、提交并归档；OpenAPI 与生成类型已经提供
Workbench 页面所需的完整聚合合同。UI 应保持一个 domain、一个 query、一个页面组件，不需要新框架或
跨 domain 聚合逻辑。

## 仓库与前置任务证据

- `git status --short --branch`：`main...origin/main [ahead 264]`，创建本规划 Task 前无工作区改动。
- 实现提交：`545ecde2 feat(frontend-v2): add workbench aggregate read model`。
- 归档提交：`13f2449b chore(task): archive 08-23-frontend-v2-workbench-aggregate-read-model`。
- 已归档任务位于 `.trellis/tasks/archive/2026-08/08-23-frontend-v2-workbench-aggregate-read-model/`，
  状态为 completed，parent 指向 Phase 8 父任务，文档记录定向集成测试、固定 7 条查询和合同校验通过。
- 父任务文档明确本任务为第二个 child，后续 real-stack E2E 和抽象回顾仍由独立子任务承担。

## 合同审计

`contracts/openapi.yaml` 与 `frontend-v2/src/shared/api/generated/schema.d.ts` 已一致定义：

- 唯一端点：`GET /api/v1/workbench`，成功返回 `WorkbenchAggregate`。
- `counts` 六类字段：`fact_reviews`、`content_reviews`、
  `publication_verifications`、`publication_actions`、`content_issues`、
  `geo_accuracy_issues`。
- 单链接 count 使用 `{ value, href }`；publication action 和 GEO accuracy issue 使用
  `{ value, links[] }`。前端必须保留该差异，不能选一个链接或自行构造路由。
- `health` 四域为 `product_facts`、`content`、`publication`、`geo`；每域只消费服务端
  `status: CLEAR | ATTENTION` 和 `summary`。
- GEO rate 为 `{ numerator, denominator, value: number | null }`，其中 nullable value 是合同状态，
  不能用 truthy 判断把合法 0 误作缺失。
- attention category 是六值 union；每项已经包含 `title`、`summary`、`occurred_at` 和 canonical
  `href`，无需加载原始业务 DTO。

结论：不需要修改 OpenAPI 或 generated contract，也不需要兼容字段、默认值或客户端回算。

## 当前前端模式

- `frontend-v2/src/routes/_app/index.tsx` 当前仅为 Workbench Foundation 占位页，适合作为唯一入口替换点。
- `frontend-v2/src/routes/_app/route.tsx` 与 `frontend-v2/src/app/layout/app-shell.tsx` 已拥有认证边界、
  导航、面包屑和响应式 Shell；Workbench 不应复制这些职责。
- 相邻 domain route 已建立模式：route 声明 metadata，在 loader 中按相同 query key 预取，并把领域展示交给
  domain page；query 使用 generated DTO 和 `openapi-fetch` 客户端。
- `frontend-v2/src/shared/api/client.ts` 已统一 credentials 和 origin；不新增 fetch wrapper。
- 已有 `Button`、`Badge`、`Skeleton` 与 semantic tokens 足以实现页面；仓库没有需要扩展的通用
  `PageHeader`、`MetricTile` 或 `Workflow` 组件。
- 现有 model 使用 generated union 加 `satisfies Record<Union, ...>` 建立穷尽映射，适用于本任务的
  category、health domain 与 status 映射。

## 测试边界审计

- 当前 `foundation-smoke.spec.ts` 访问 `/`；一旦 `/` 发出 Workbench 业务请求，它将与
  `foundation.fixture.ts` 的“只允许认证 API”边界冲突。
- `/publishing` 是现有受保护父路由，本身只渲染 App Shell/Outlet、不发业务请求，适合承接 Foundation
  smoke。只需改 spec 的访问路径和 Shell 断言，fixture 无需修改，business API allowlist 继续为空。
- Workbench 需要独立 strict fixture：只允许认证 API 和一次 Workbench aggregate GET；任何 Product、
  Content、Publication、GEO endpoint 或额外业务 endpoint 都应记为 unexpected request 并使测试失败。
- Workbench spec 负责 aggregate contract 到 UI、canonical links、状态与四档布局；不连接真实 backend。
  real-stack 跨域验证继续留给下一子任务。

## 文档审计

- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`、Phase 8 migration、testing 文档和
  Workbench ADR 已准确规定 aggregate-only、server-owned href/eligibility 与后续 real-stack 边界，
  本任务不重复修改。
- `docs/frontend-v2/03-page-and-workflow-blueprint.md` 仍展示客户端式总数 `12`，且没有完整表达六类
  count、attention queue、四域 health 和 nullable GEO rate。现有 API 也没有 total 字段；保留该数字会诱导
  浏览器重新计算。因此该文档必须在本任务内更新。

## 最小方案

新增一个 Workbench domain（API、model、page）、两个定向 Vitest、一个 strict fixture 和一个
Playwright spec；修改根 route、Foundation smoke 和蓝图文档。复用现有 API client、TanStack Query、
App Shell、primitives 和 semantic tokens，不新增依赖、共享框架、全局状态或 CSS 基建。
