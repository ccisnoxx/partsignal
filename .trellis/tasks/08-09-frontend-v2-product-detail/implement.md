# Frontend V2 Phase 2.4 — Product Detail Implementation Plan

## Current API Gap Analysis

1. `GET /products/{id}` 仅返回基础 Product；不能绘制蓝图要求的事实、内容、发布、GEO 与 Activity。
2. FactVersion/ContentTask/GEO 有独立接口，但浏览器调用会产生 waterfall 和 snapshot 不一致；PublicationWork/PublishedArticle 还缺完整 product filter。
3. `products_out`、`content_tasks_out`、Publication query 与 GeoMetrics 可复用，但没有 Product-level aggregate。
4. AuditLog 只保存白名单成功动作且按直接 target 查询，不能冒充完整 Product Activity。
5. Product 自身 primary/available/deletion projection 已完整，应原样嵌入 detail，不新增资格推导。

## 实施顺序

1. 修改 OpenAPI/database contract：新增 ProductDetail endpoint/schemas、收紧 ProductUpdate、补 errors 与 Product audit action说明。
2. 新增 backend schema/query service/route；实现 repeatable-read、fixed batch projection、Activity union 与 create/update audit。
3. 补 contract/audit/Product Detail PostgreSQL 集成测试，先证明字段、source、排序、snapshot 和固定查询数。
4. 运行 generator 机械更新 V1/V2 两套 schema，并通过 contract check。
5. 移动真实第二消费者能力到 Product domain `product.api.ts/product.model.ts`；保持 list search/current-fact 私有。
6. 实现 Product Detail model/page、UPDATE Dialog、DELETE conditions/confirm 和 expected error states。
7. 替换 `$productId` placeholder route，只保留 params/prefetch/metadata/error fallback/composition。
8. 补 unit/component tests，扩展 typed Products fixture，新增 Product Detail Playwright 并更新 List/New Product 回归。
9. 更新直接相关 docs/spec，运行全部必需验证、trellis-check、trellis-update-spec 必要性评估和 diff 审计。

## 精确文件范围

Contract/backend/generated：

```text
contracts/openapi.yaml
contracts/database.md
backend/app/audit_types.py
backend/app/routers/product_facts.py
backend/app/schemas/product_facts.py
backend/app/schemas/content.py
backend/app/schemas/product_detail.py
backend/app/services/product_facts.py
backend/app/services/product_detail.py
backend/tests/unit/test_audit.py
backend/tests/unit/test_contract.py
backend/tests/integration/test_product_detail.py
frontend/src/shared/api/schema.d.ts
frontend-v2/src/shared/api/generated/schema.d.ts
```

Frontend：

```text
frontend-v2/src/domains/product/products-list.api.ts        # remove after move
frontend-v2/src/domains/product/products-list.model.ts
frontend-v2/src/domains/product/products-list.model.test.ts
frontend-v2/src/domains/product/products-list-page.tsx
frontend-v2/src/domains/product/products-list-page.test.tsx
frontend-v2/src/domains/product/product.api.ts
frontend-v2/src/domains/product/product.model.ts
frontend-v2/src/domains/product/product-deletion-dialog.tsx
frontend-v2/src/domains/product/product-detail.model.ts
frontend-v2/src/domains/product/product-detail.model.test.ts
frontend-v2/src/domains/product/product-detail-page.tsx
frontend-v2/src/domains/product/product-detail-page.test.tsx
frontend-v2/src/routes/_app/products/$productId.tsx
frontend-v2/src/routeTree.gen.ts
frontend-v2/tests/e2e/fixtures/products.fixture.ts
frontend-v2/tests/e2e/products-list.spec.ts
frontend-v2/tests/e2e/new-product.spec.ts
frontend-v2/tests/e2e/product-detail.spec.ts
```

Documentation：

```text
docs/frontend-v2/03-page-and-workflow-blueprint.md
docs/frontend-v2/05-business-actions-state-and-api-contract.md
docs/frontend-v2/08-testing-quality-and-acceptance.md
docs/frontend-v2/09-architecture-decisions.md
.trellis/spec/backend/database-guidelines.md
.trellis/spec/frontend/quality-guidelines.md
```

`07-migration-plan.md` 的 Phase 顺序不变，不修改。除非出现经证明的直接阻塞，不修改 Design System API、数据库 schema、部署或 V1 UI。

## Query、Loader 与 Error Boundary

- `productsKeys.lists/list/details/detail` 同属 Product domain；list key 保持既有 shape。
- loader 非阻塞 prefetch，与 component 共享同一 detail options；TanStack Query 去重。
- loading 保留 Product ID 与全部 section skeleton。
- 404/NOT_FOUND 和 403 无自动 retry，提供返回 Products；普通错误显示 request ID 和 retry。
- route errorComponent 只处理未知异常，Domain 不吞掉 API contract error。

## Action 与 Mutation

- 六种 primary_task 和 UPDATE/DELETE generated union 使用穷尽 switch/assertNever。
- List UPDATE href=`/products/{id}`；Detail UPDATE command 打开 Dialog。
- PATCH body 精确为 `{expected_revision,part_number,brand,category,status}`。
- immutable/revision conflict 刷新 canonical detail；duplicate/validation 映射字段；未知 error 进入 form summary。
- DELETE 使用 detail revision/CSRF；blocker、confirmation、409 refresh 和成功导航均有测试。

## Test Matrix

| 层级 | 覆盖 |
|---|---|
| Contract | endpoint/schema required、无正文/内部对象、Product GET 不变、ProductUpdate 1..160、errors、generated 一致 |
| Backend | facts 选择、全部空态、content latest stage、publication count/latest、GEO rate/null、Activity source/order/limit/actor/target |
| Consistency | repeatable-read 在 auth 前生效；1/N 查询数固定；无 per-item serializer |
| Audit | create/update 同事务；冲突不写成功审计；旧历史不回填 |
| Model | primary/overflow、list/detail UPDATE、status/time/error mapping、unknown token |
| Component | skeleton、summary 有/无、404/403/error、Activity、UPDATE、DELETE |
| Playwright | List/New → Detail、direct/refresh/history、breadcrumb/sidebar、单 detail request、summary fixtures、actions、UPDATE/DELETE、四档宽度、keyboard/focus/runtime audit |

Fixture 使用 generated ProductDetail/ProductUpdate/Product；只返回已定义 fixture，不复制 backend selection/排序；任何跨域或未声明 API 请求显式失败。它是 production-artifact 前端页面测试，不代表完整真实业务 E2E。

## 必需验证

```bash
make contract-check

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_audit.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_product_detail.py

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/audit_types.py \
  backend/app/routers/product_facts.py \
  backend/app/schemas/product_facts.py \
  backend/app/schemas/content.py \
  backend/app/schemas/product_detail.py \
  backend/app/services/product_facts.py \
  backend/app/services/product_detail.py \
  backend/tests/unit/test_audit.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_product_detail.py

UV_CACHE_DIR=.cache/uv uv run --project backend \
  mypy --config-file backend/pyproject.toml backend/app

npm --prefix frontend run typecheck
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run test -- \
  src/domains/product/products-list.model.test.ts \
  src/domains/product/products-list-page.test.tsx \
  src/domains/product/product-detail.model.test.ts \
  src/domains/product/product-detail-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/products-list.spec.ts \
  tests/e2e/new-product.spec.ts \
  tests/e2e/product-detail.spec.ts
git diff --check
```

## 可选完整验证

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test
npm --prefix frontend-v2 run test
make verify
```

## 失败归因和停止条件

- 只修复本 Task 造成且属于批准范围的失败；可选全套无关失败只记录。
- 同一失败无新 root-cause 证据重复，或修复扩展到迁移、通用 framework、Design System 重构时停止。
- repeatable-read 无法在 auth 查询前生效、查询数随关联行增长或必须客户端 join 时停止评审。
- Product identity constraint 名不是 `uq_products_normalized_brand` 时停止，不解析数据库错误文本。
- Activity 无权威来源时返回缺失/空态，不使用 `updated_at`、AuditLog 猜测或静默 fallback。
- OpenAPI/runtime/generated union 不一致时不得继续前端实现。

## Rollback Point

- 分支基线为 `199ef05d8cd13c0b3771d91091495d0c5fb27e48`；基线变化时重新记录。
- 无数据库迁移、缓存或数据回填；回滚为整体撤销本 Task contract/backend/frontend/tests/docs。
- 不保留 wrapper、feature flag、兼容字段或第二套 DTO。

## 明确非目标

- Fact Workspace/Review/Version Detail、事实 Markdown 编辑。
- Content/Publication/GEO 页面、完整 Product Facts E2E。
- 通用 Dashboard/read-model/detail/CRUD framework、数据库迁移、缓存、物化视图。
- commit、merge、push、archive 或开始 Fact Workspace。
