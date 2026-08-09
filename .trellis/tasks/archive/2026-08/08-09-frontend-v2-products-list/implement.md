# Products List Implementation Plan

## 实施顺序

1. 核对 `contracts/openapi.yaml`、generated `ProductListItem/listProducts/deleteProduct` 和后端真实 list/delete 流程；发现 gap 立即停止，不写 join/fallback。
2. 实现 Products search schema、canonical URL 比较、URL→API mapping、page reset 和 query key/query options。
3. 实现 Products 私有 status registry、Primary/overflow action mapping、relative time/current fact formatter 和 DELETE mutation。
4. 使用现有 Table Kit 组合 ProductsListPage，覆盖六列、全部页面状态、long text、responsive、delete conditions/confirm/error。
5. 替换 `/products` placeholder route，只保留 validation、prefetch、CSRF prop 注入和 composition。
6. 编写 unit/component tests。
7. 新增 typed Products Playwright fixture/spec，并把 Foundation smoke 的 `/products` 验证迁移到业务 spec。
8. 运行必需验证、trellis-check、spec 必要性评估和最终 diff 审计。

## 精确文件范围

```text
frontend-v2/src/app/auth/auth-provider.tsx
frontend-v2/src/app/auth/auth-provider.test.tsx
frontend-v2/src/app/layout/app-shell.stories.tsx
frontend-v2/src/app/layout/app-shell.test.tsx
frontend-v2/src/design-system/data-table/row-actions.tsx
frontend-v2/src/routes/_app/products/index.tsx
frontend-v2/src/domains/product/products-list.model.ts
frontend-v2/src/domains/product/products-list.model.test.ts
frontend-v2/src/domains/product/products-list.api.ts
frontend-v2/src/domains/product/products-list-page.tsx
frontend-v2/src/domains/product/products-list-page.test.tsx
frontend-v2/tests/e2e/fixtures/products.fixture.ts
frontend-v2/tests/e2e/products-list.spec.ts
frontend-v2/tests/e2e/foundation-smoke.spec.ts
docs/frontend-v2/08-testing-quality-and-acceptance.md
.trellis/spec/frontend/quality-guidelines.md
```

除非出现经证明的直接阻塞，不修改 Table Kit、全局 CSS、Playwright config、route tree、shared API client、generated schema、backend、contract、V1 或部署文件。实施中已证明 RowActions Primary 的 `<a>` 被 Base UI 赋予 button 语义并输出 console warning，因此只在既有实现内改用同一 `buttonVariants` 的原生链接，不改变 Table Kit API。

## Route Search Schema

| URL 字段 | Canonical 规则 | API 字段 |
|---|---|---|
| `q` | trim，空移除，最大 200 | `search` |
| `page` | 正整数，默认 1 | `page` |
| `pageSize` | 10/20/50，默认 20 | `page_size` |
| `sort` | generated ProductSort，默认 UPDATED_DESC | `sort` |
| `factStatus` | generated ProductFactStatus，可选 | `fact_status` |
| `workflowStage` | generated ProductWorkflowStage，可选 | `workflow_stage` |

- 未知/非法 search 由 schema 规范化并 replace URL。
- q/factStatus/workflowStage/sort/pageSize change -> `page=1`；pagination 只改 page。

## Query 与 Mutation 边界

- Query key：`['products', 'list', canonicalApiParams]`。
- Query：唯一 `GET /api/v1/products`；route prefetch 与 component 使用同一 options。
- Mutation：仅 Product DELETE；参数为 `{product, csrfToken}`，发送 `expected_revision`。
- 成功和失败均刷新 list projection；失败额外保留并显示真实错误。
- 不请求或缓存 Facts、Versions、Actions；不做 optimistic delete。

## Action Mapping

Primary 与 overflow 采用 `design.md` 两张映射表；六个 Primary、两个 available action 都使用 generated field union。UPDATE 固定为禁用 blocker；DELETE 只消费 token/deletion projection。每行最多一个 Primary 和一个 overflow。

## Test Matrix

### Unit

- search 默认/非法/unknown/canonical URL；URL→API mapping；query key。
- q/filter/sort/pageSize reset page，pagination 保留筛选。
- 两套 status registry、current fact、Intl formatter。
- 六种 Primary href、UPDATE blocker、DELETE/blocked delete、unknown token error。

### Component

- 单次 Products GET，无 join；loading/initial empty/filtered empty/error+retry/success。
- 六列、long model/brand/category、tooltip、pagination。
- manual sort/filter/page/pageSize 与 URL/search callback。
- Primary/overflow、UPDATE disabled reason、blocker dialog。
- DELETE confirm、expected_revision/CSRF、success invalidation、server rejection error+refresh。

### Playwright

- 列表加载、搜索、factStatus、workflowStage、sort、pagination/pageSize。
- filter/sort/pageSize 回 page=1。
- refresh、Back/Forward、direct/copy URL、invalid normalization。
- 产品名称详情链接；六种 Primary href；overflow/UPDATE blocker/DELETE 条件和确认。
- loading、initial empty、filtered empty、error+retry。
- keyboard、visible focus、menu/dialog focus。
- 375/768/1024/1440；页面根无意外横向溢出。
- pageerror、console.error、requestfailed 和失败静态资源均为失败。

Products fixture 必须位于 `tests/e2e/fixtures`，使用 generated types，明确声明为前端 production-artifact 页面/路由测试；任何未声明 API 请求失败。完整真实 Product Facts 闭环留到 Phase 2.8。

## 必需验证

```bash
make contract-check
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run test -- \
  src/app/auth/auth-provider.test.tsx \
  src/domains/product/products-list.model.test.ts \
  src/domains/product/products-list-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/foundation-smoke.spec.ts \
  tests/e2e/products-list.spec.ts
git diff --check
```

## 可选完整验证

```bash
npm --prefix frontend-v2 run test
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_workflow_projections.py \
  backend/tests/unit/test_contract.py
make verify
```

## 失败归因与停止条件

- 只修复当前变更导致且属于 Task 范围的失败；可选全套中的无关失败只记录证据。
- 每次修复必须有新 root-cause 证据；同一失败无进展重复或开始产生越界修复时停止。
- ProductListItem/GET 无法单请求绘制、必须 join/fallback、需要 contract/backend 变更或 Table Kit API 存在真实阻塞时，先报告并停止相关实施。
- 未知 action/status 必须让类型检查或显式错误失败，不补兼容默认值。

## Rollback Point

- 分支创建时记录的干净 `main` SHA 为 rollback point。
- 无数据、contract 或部署迁移；回滚为整体撤销本 Task 文件，不保留 wrapper、flag 或兼容层。

## 明确非目标

- `/products/new`、Product Detail、Fact Workspace/Review/Version、Content Task 页面。
- 通用 DataTable、跨 domain registry、Design System 重构、未来路由占位。
- backend/OpenAPI/database/V1/deployment/cutover 修改。
- commit、merge、push、archive、下一 Task 或 Products List 抽象回顾。
