# Frontend V2 Phase 2.3 — New Product Implementation Plan

## Contract Readiness Findings

1. `ProductCreate` 当前只有最短长度 1，数据库三字段实际上限 160。
2. 纯空白和 161 字符当前均能通过 Pydantic；service strip 后可写空字符串。
3. 唯一约束 `uq_products_normalized_brand` 当前落入全局 `REVISION_CONFLICT`。
4. POST `/products` 只声明 201，缺少 401/403/409/422。
5. duplicate 缺少稳定 code 和可定位字段信息。

因此本 Task 必须同步修改 OpenAPI、backend schema/service、相关测试与两套 generated frontend schema；不修改数据库结构，不扩展全局错误框架。

## 实施顺序

1. 修改 `contracts/openapi.yaml` 与 `contracts/database.md`，固定 trim 后 1..160、POST errors 和既有唯一约束说明。
2. 修改 backend `ProductCreate` 请求边界与 `create_product` 唯一竞态处理；补 contract/backend PostgreSQL 测试。
3. 机械生成 V1/V2 OpenAPI types，并先运行 contract check。
4. 实现 New Product UI schema、generated DTO mapping、typed mutation/error mapping。
5. 实现 NewProductPage，复用 Form Kit/DirtyGuard，完成 pending、error summary、query invalidation 和 success lifecycle。
6. 新增 `/products/new` route，并在 `/products` 现有标题区增加唯一 Primary。
7. 扩展 typed Products Playwright fixture，新增 production-artifact New Product spec。
8. 更新直接相关业务蓝图、测试文档和 V2 fixture 质量规范。
9. 运行必需验证、trellis-check、trellis-update-spec 必要性评估和最终 diff 审计。

## 精确文件范围

```text
contracts/openapi.yaml
contracts/database.md
backend/app/schemas/product_facts.py
backend/app/services/product_facts.py
backend/tests/unit/test_contract.py
backend/tests/integration/test_publication_workflow.py
frontend/src/shared/api/schema.d.ts
frontend-v2/src/shared/api/generated/schema.d.ts

frontend-v2/src/domains/product/new-product.model.ts
frontend-v2/src/domains/product/new-product.model.test.ts
frontend-v2/src/domains/product/new-product.api.ts
frontend-v2/src/domains/product/new-product-page.tsx
frontend-v2/src/domains/product/new-product-page.test.tsx
frontend-v2/src/routes/_app/products/new.tsx
frontend-v2/src/routeTree.gen.ts
frontend-v2/src/domains/product/products-list-page.tsx
frontend-v2/src/domains/product/products-list-page.test.tsx
frontend-v2/tests/e2e/fixtures/products.fixture.ts
frontend-v2/tests/e2e/products-list.spec.ts
frontend-v2/tests/e2e/new-product.spec.ts

docs/frontend-v2/03-page-and-workflow-blueprint.md
docs/frontend-v2/08-testing-quality-and-acceptance.md
.trellis/spec/backend/index.md
.trellis/spec/backend/error-handling.md
.trellis/spec/frontend/quality-guidelines.md
```

两套 generated schema 与 route tree 只能由现有 generator 产生；generator 输出未变化时不制造人工 diff。除非出现经证明的直接阻塞，不修改 router/auth/Form Kit/DirtyGuard、数据库 migration、V1 UI、部署或其他 domain。

## Form Schema 与 Generated DTO

| UI 字段 | Zod 规则 | ProductCreate |
|---|---|---|
| `part_number` | trim、必填、max 160 | `part_number` |
| `brand` | trim、必填、max 160 | `brand` |
| `category` | trim、必填、max 160 | `category` |

`toProductCreate(values)` 显式返回 generated `ProductCreate`，不添加 status、facts、revision 或兼容字段。

## Mutation、Invalidation 与成功导航

- `createProduct(body, csrfToken)` 返回 generated `Product`；缺 CSRF 显式失败。
- wrapper 不控制 UI；NewProductPage 负责 pending/error/query invalidation，route callback 负责导航。
- 成功只执行 `invalidateQueries({queryKey: productsKeys.lists()})`，不写 list cache。
- form reset 并确认 DirtyGuard disabled 后，导航 `/products/$productId`。

## Error → Field / Summary

- `details.errors[].loc` 精确落到 `part_number|brand|category` 时使用 `setError(field)`。
- duplicate 后端同时返回 `part_number` 与 `brand` 两项，并使用 `PRODUCT_ALREADY_EXISTS`。
- 其他错误写入 `root.server`；request ID 始终作为 ErrorSummary 独立项展示。
- 不解析 message，不增加全局 error utility/framework。

## DirtyGuard 生命周期

- clean：不拦截。
- dirty：Cancel、站内导航和 browser back 均提示。
- pending：字段和按钮禁用，guard 仍启用。
- success：先 reset dirty，再失效 query，最后导航；不得出现离开确认。
- failed：保留输入并允许 retry。

## Test Matrix

| 层级 | 覆盖 |
|---|---|
| Contract | 三字段 1/160/blank/161；POST 401/403/409/422；runtime/frozen/generated 一致。 |
| Backend | 真实 PostgreSQL normalized duplicate；稳定 code/details；事务回滚；未知 IntegrityError 不改写。 |
| Unit | UI schema trim/blank/max；generated DTO mapping；field/form/request_id mapping。 |
| Component | default、a11y error association、server validation、duplicate、forbidden、pending、retry、CSRF/body、dirty Cancel、success invalidation/navigation。 |
| Products regression | 唯一 page Primary href；既有 list/row action 不变。 |
| Playwright | list entry、direct/refresh、breadcrumb/sidebar、validation、POST/CSRF、pending、server errors、dirty Cancel/back、success/no guard、list refetch、375/768/1024/1440、keyboard/focus、runtime audit。 |

## 必需验证

```bash
make contract-check

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_publication_workflow.py -k product_create

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/schemas/product_facts.py \
  backend/app/services/product_facts.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_publication_workflow.py

UV_CACHE_DIR=.cache/uv uv run --project backend \
  mypy --config-file backend/pyproject.toml backend/app

npm --prefix frontend run typecheck
npm --prefix frontend-v2 run test -- \
  src/domains/product/new-product.model.test.ts \
  src/domains/product/new-product-page.test.tsx \
  src/domains/product/products-list-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/products-list.spec.ts \
  tests/e2e/new-product.spec.ts
git diff --check
```

## 可选完整验证

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test
npm --prefix frontend-v2 run test
make verify
```

## 实施验证结果

- `make contract-check`：通过；FastAPI runtime、冻结 OpenAPI 与 V1/V2 generated schema 一致。
- backend contract unit：20 passed；真实 PostgreSQL `product_create` integration：1 passed。
- backend touched ruff 与全 app mypy：通过。
- V1 typecheck：通过。
- V2 targeted unit/component：3 files、15 tests passed；lint、typecheck、production build：通过。
- Products List + New Product production-artifact Playwright：mobile/desktop 共 22 tests passed；覆盖 fixture 的 console/pageerror/requestfailed 审计。
- 可选完整 unit/full `make verify` 未运行；本次 contract 跨层风险已由计划中的精确门禁覆盖。

## 失败归因和停止条件

- 只修复本 Task 造成且属于批准范围的失败；可选全套无关失败只记录。
- 每次修复必须有新 root-cause 证据；同一失败无进展重复或开始越界时停止。
- 真实约束名不是 `uq_products_normalized_brand` 时停止，不解析数据库文本。
- 既有 `ErrorEnvelope.details.errors` 无法表达页面字段定位时停止并重新评审，不擅自扩展全局 contract。
- 需要数据库迁移、Form Kit API 改造、通用 CRUD/Error framework、新依赖或 Product Detail 业务时停止。
- 工作树出现不明修改、active task 冲突或基线变化时停止并重新核验。

## Rollback Point

- 分支基线：`a3f44cead73175c65b2126ad9c437ee55af4de02`。
- 无数据库迁移或数据修复；回滚只撤销本 Task 精确文件差异。
- 不使用 reset、历史改写、feature flag、wrapper 或兼容层。

## 明确非目标

- 编辑产品、Product Detail 业务、Fact Workspace/Review/Version、自动写事实。
- autosave、draft persistence、optimistic create、通用 CRUD Form、通用 API Error framework。
- 新 UI 库、Content/GEO 抽象、数据库迁移、部署/V1 切换。
- commit、merge、push、archive 或开始 Product Detail。
