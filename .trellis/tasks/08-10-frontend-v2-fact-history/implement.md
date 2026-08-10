# 实施计划

## 1. 执行顺序

- [x] 用户确认 artifacts 后激活 task，从干净 `main` 创建 `codex/frontend-v2-fact-history`。
- [x] 按 contract-first 顺序增加 `ProductFactHistoryItem`、`ProductFactHistoryList` 与 `listProductFactHistory`。
- [x] 在现有 Product Facts schema/service/router 内实现分页窄投影，并增加 backend integration coverage；旧 `listFactVersions` 不变。
- [x] 生成并检查 V1/V2 OpenAPI types。
- [x] 增加 Fact History search model、query keys/query options、page 和 thin route。
- [x] 调整 `VIEW_FACT_HISTORY`、Product Detail 和 Fact Version Detail 的 canonical navigation。
- [x] 扩展 generated-type `products.fixture.ts`，新增 fixture-based `fact-history.spec.ts` 及 component/unit coverage。
- [x] 最小扩展既有 real-stack Flow B，验证 v2/v1 顺序并进入 readonly Detail。
- [x] 更新 02/03/05/07/08/09 权威文档，运行 required validation 与 `trellis-check`。
- [x] 自审 Phase 2 exit gate、最终 diff、中文开发者文本和禁止范围；提交前另给 commit plan 等待确认。

## 2. 预计修改文件

- Contract/backend：`contracts/openapi.yaml`、`backend/app/schemas/product_facts.py`、`backend/app/services/product_facts.py`、`backend/app/routers/product_facts.py`、`backend/tests/integration/test_product_detail.py`。
- Generated：`frontend/src/shared/api/schema.d.ts`、`frontend-v2/src/shared/api/generated/schema.d.ts`。
- V2 Product：`product.api.ts`、`product.model.ts`、新 `fact-history.model.ts`、新 `fact-history-page.tsx`、Product Detail、Fact Version Detail、对应 tests、新 route 与 `routeTree.gen.ts`。
- Playwright：`products.fixture.ts`、新 `fact-history.spec.ts`、相关 detail specs、`product-facts-real-stack.spec.ts`。
- 文档：`docs/frontend-v2/02-information-architecture-and-routing.md`、`03-page-and-workflow-blueprint.md`、`05-business-actions-state-and-api-contract.md`、`07-migration-plan.md`、`08-testing-quality-and-acceptance.md`、`09-architecture-decisions.md`。

## 3. Required validation

```bash
make contract-check
make lint typecheck

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend \
  pytest backend/tests/integration/test_product_detail.py -q

npm --prefix frontend run test -- src/features/product-facts/ProductFactsPage.test.tsx

npm --prefix frontend-v2 run test -- \
  src/domains/product/fact-history.model.test.ts \
  src/domains/product/fact-history-page.test.tsx \
  src/domains/product/products-list.model.test.ts \
  src/domains/product/product-detail-page.test.tsx \
  src/domains/product/fact-version-detail-page.test.tsx

npm --prefix frontend-v2 run build

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/fact-history.spec.ts \
  tests/e2e/product-detail.spec.ts \
  tests/e2e/fact-version-detail.spec.ts

DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  REDIS_URL=redis://127.0.0.1:56379/9 \
  deploy/scripts/e2e-local.sh tests/e2e/trusted-types.spec.ts

git diff --check
```

## 4. Optional full-suite validation

```bash
npm --prefix frontend-v2 run e2e
make test-integration
make verify
```

只有发布准备、shared gate 出现关联回归或用户明确要求时运行。失败必须先归因，不扩展修复无关问题。

## 5. Gate 与交付

- Phase 2 只有在 history contract/backend、canonical route/navigation、fixture matrix、real-stack Flow B、V1 兼容和文档一致性全部通过后才能从 `NOT_MET` 改为 `MET`。
- 不自动 commit、push、archive、merge 或删除分支。实施验证完成后先展示 commit plan 并等待用户确认。
