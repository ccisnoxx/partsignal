# Frontend V2 Phase 2.5 — Fact Workspace Implementation Plan

## 实施顺序

1. 扩展 OpenAPI Facts read model 和实际 errors，补 contract tests。
2. 实现 backend 一致读投影、共享 workflow stage、RETIRED 最终门禁和空白 summary 校验。
3. 补 backend projection、固定查询数、revision conflict、snapshot immutability 集成测试。
4. 生成 V1/V2 clients，修复仅由 required 类型新增造成的 V1 typed fixture。
5. 扩展 Product API/query keys；实现 Fact Workspace model/page 和 non-nested route。
6. 复用 Workspace/Form/Editor/StickyActionBar/DirtyGuard，补 MarkdownEditor ARIA contract。
7. 补 unit/component/Playwright，修正文档中的 Evidence URLs 冲突。
8. 跑 required validation、trellis-check、diff 与需求逐项自审。

## Required Validation

```bash
make contract-check

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_product_detail.py tests/integration/test_publication_workflow.py

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/schemas/product_facts.py \
  backend/app/services/product_facts.py \
  backend/app/routers/product_facts.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py \
  backend/tests/integration/test_product_detail.py \
  backend/tests/integration/test_publication_workflow.py

UV_CACHE_DIR=.cache/uv uv run --project backend \
  mypy --config-file backend/pyproject.toml backend/app

npm --prefix frontend run typecheck
npm --prefix frontend-v2 run test -- \
  src/design-system/editor/markdown-editor.test.tsx \
  src/domains/product/fact-workspace.model.test.ts \
  src/domains/product/fact-workspace-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/products-list.spec.ts \
  tests/e2e/product-detail.spec.ts \
  tests/e2e/fact-workspace.spec.ts
git diff --check
```

## Optional Full-suite Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run build-storybook
npm --prefix frontend-v2 run e2e
make verify
```

## Review Gates

- OpenAPI、runtime schema 和两套 generated clients 必须一致。
- GET 必须单请求、repeatable-read；不得由前端 join Product Detail 和 Facts。
- action projection 与 mutation guard 必须对称，前端无 status 推导。
- dirty refetch、409 或提交失败不得丢失本地 Markdown。
- snapshot 必须在后续 Workspace 保存后保持不变。
- 不得出现 Fact Review route、Evidence 模型、新依赖、数据库迁移或无关重构。
- 只修复本 Task 导致的失败；相同失败无新根因证据时停止重复尝试。

## Git 边界

- 工作分支：`codex/frontend-v2-fact-workspace`，基线为当前本地 `main`。
- 完成验证后先报告 diff 和 commit plan，取得确认前不 commit。
- 不自动 push、archive、merge 或删除临时分支。
