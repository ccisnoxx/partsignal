# Products Contract Readiness Implementation

## Ordered Checklist

1. 修改 `contracts/openapi.yaml`：增加 Product list 类型/enum、查询参数和 DELETE revision。
2. 修改 `backend/app/schemas/product_facts.py`、`backend/app/routers/product_facts.py`、`backend/app/services/product_facts.py`：实现同一 read projection、过滤排序分页和删除 revision 校验。
3. 更新 `backend/tests/unit/test_workflow_projections.py`、`backend/tests/unit/test_contract.py`、`backend/tests/integration/test_publication_workflow.py`，覆盖投影、固定查询次数、真实 PostgreSQL 查询和 mutation 最终守卫。
4. 更新 `docs/frontend-v2/03-page-and-workflow-blueprint.md` 与 `docs/frontend-v2/05-business-actions-state-and-api-contract.md`，使蓝图与合同一致。
5. 运行 `npm --prefix frontend run api:generate`，仅同步 `frontend/src/shared/api/schema.d.ts`、一条 ProductList fixture 和 Product DELETE 的 `expected_revision` 参数。
6. 运行 Required Validation；检查全量 diff、范围、合同一致性、中文 touched-scope 文档与无下一 Task 夹带。

## Expected Files

```text
contracts/openapi.yaml
backend/app/schemas/product_facts.py
backend/app/routers/product_facts.py
backend/app/services/product_facts.py
backend/tests/unit/test_workflow_projections.py
backend/tests/unit/test_contract.py
backend/tests/integration/test_publication_workflow.py
docs/frontend-v2/03-page-and-workflow-blueprint.md
docs/frontend-v2/05-business-actions-state-and-api-contract.md
frontend/src/shared/api/schema.d.ts
frontend/src/features/geo-observations/GeoObservationsPage.test.tsx
frontend/src/features/product-facts/ProductsPage.tsx
```

## Required Validation

```bash
make contract-check

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_workflow_projections.py \
  backend/tests/unit/test_contract.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_publication_workflow.py \
  -k 'product_list or product_delete or fact_workspace_submission'

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/schemas/product_facts.py \
  backend/app/routers/product_facts.py \
  backend/app/services/product_facts.py \
  backend/tests/unit/test_workflow_projections.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_publication_workflow.py

UV_CACHE_DIR=.cache/uv uv run --project backend \
  mypy --config-file backend/pyproject.toml backend/app

npm --prefix frontend run typecheck
git diff --check
```

## Optional Validation

```bash
make test-unit
make test-integration
make verify
```

## Review Gates

- Contract-first 顺序已遵守，runtime OpenAPI 与 frozen contract 一致。
- 列表无需额外请求，projection 查询次数固定，derived filter 在分页前执行。
- mutation 使用 revision 与服务端最终校验，错误码稳定。
- 未修改 `frontend-v2/`、数据库、其他 domain 或 Foundation。
- 未 push、合并、归档；提交前展示 commit plan 并等待确认。
