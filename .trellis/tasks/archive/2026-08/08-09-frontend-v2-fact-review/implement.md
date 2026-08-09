# Frontend V2 Phase 2.6 — Fact Review Implementation Plan

## 实施顺序

1. 更新 OpenAPI：产品级 context、fact diff、窄动作 token 和实际 errors；同步权威架构/蓝图/测试文档的 Diff、Blocking Issues、Evidence 结论。
2. 实现后端事实 diff projection、产品级目标选择与一致读 context，复用现有 review policy/history/commands。
3. 补 contract、projection、目标选择、权限、history 隔离、命令、revision conflict 与不可变快照测试。
4. 生成 V1/V2 clients，仅修复 contract required 字段造成的 V1 typed fixture。
5. 扩展 Product API/query keys；实现 Fact Review model/page 和 non-nested route，复用现有 Workspace/Timeline/StickyActionBar/Form/Dialog/feedback primitives。
6. 补页面单元/组件和 Playwright：单请求、action tokens、命令/CSRF/revision、错误、键盘、响应式及浏览器错误审计。
7. 跑 required validation、`trellis-check`、git diff 与逐项完成审计；在任何 commit/archive/merge/delete branch 前请求用户确认。

## Required Validation

```bash
make contract-check

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_product_detail.py -k fact_review

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/schemas/content.py \
  backend/app/services/review_policy.py \
  backend/app/services/projections.py \
  backend/app/services/review.py \
  backend/app/routers/product_facts.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py \
  backend/tests/integration/test_product_detail.py

UV_CACHE_DIR=.cache/uv uv run --project backend \
  mypy --config-file backend/pyproject.toml backend/app

(cd frontend && npm exec -- vitest run \
  src/features/product-facts/ProductFactsPage.test.tsx)
npm --prefix frontend run typecheck

npm --prefix frontend-v2 run test -- \
  src/design-system/editor/markdown-editor.test.tsx \
  src/design-system/workspace/workspace-kit.test.tsx \
  src/domains/product/fact-review.model.test.ts \
  src/domains/product/fact-review-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/fact-review.spec.ts

git diff --check
git status --short
```

## Optional Full-suite Validation

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run build-storybook
npm --prefix frontend-v2 run e2e
make verify
```

## Playwright Scenarios

- 从服务端 `REVIEW_FACT` action 进入；其他 token 不产生审核入口。
- direct navigation、refresh、breadcrumb/sidebar；首次只允许一个产品级 context GET，其他 Detail/Facts/Versions/exact-context 请求视为失败。
- 不可变且 sanitized 的 Markdown；无 textbox、CodeMirror 或 contenteditable。
- metadata、紧邻前序版本 diff、首版本无 diff、目标 FactVersion 专属 Review History。
- `available_actions` 精确控制按钮；空数组无动作；不得显示 `RETIRE`。
- Approve 确认、CSRF、`expected_revision`、canonical response、context 刷新和 history 更新。
- Request Changes 空值/空白不发送；合法意见请求、成功刷新和 history 更新。
- 409 显示 request ID、禁用陈旧动作、刷新 canonical context且不重放命令。
- empty、404、403、通用错误、retry；成功后刷新失败保留 canonical 成功状态。
- Tab/Shift+Tab、Enter/Space、Esc、Dialog 初始焦点与关闭后焦点恢复。
- 375/768/1024/1440 页面无横向溢出。
- console error、pageerror、requestfailed 和 unexpected API 审计。

## Review Gates

- OpenAPI、runtime schema、backend、两套 generated clients 必须一致。
- 产品级 GET 必须是唯一初始 read 请求和 repeatable-read；目标选择只能由服务端完成。
- action projection 与 mutation guard 对称；前端不得从 status 推导资格。
- history 必须按目标 `fact_version_id` 隔离；diff 必须来自不可变服务端版本基线。
- mutation failure 与 mutation success/context-refresh failure 必须区分；409 不得自动重放。
- 不得出现 Evidence、Blocking Issues 占位、可编辑事实副本、新依赖、数据库迁移、Fact Version Detail 或通用 Review 抽象。
- 只修复本 Task 导致的失败；相同失败无新根因证据时停止重复尝试。

## Git 边界

- 工作分支：`codex/frontend-v2-fact-review`，基线为本任务创建前的本地 `main` `ef80a5d`。
- 计划已由用户确认；任务文档写入后启动任务并创建临时分支。
- 完成验证后先报告 diff 和 commit plan，取得确认前不 commit。
- 不自动 push、archive、merge 或删除临时分支。
