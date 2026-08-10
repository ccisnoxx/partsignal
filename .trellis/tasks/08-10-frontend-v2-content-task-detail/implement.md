# Content Task Detail 实施计划

## 执行顺序

1. 确认 task artifacts、相关 backend/frontend specs、contract 和现有 Product Detail/Content List 实现已读取；激活 task，创建 `codex/frontend-v2-content-task-detail`。
2. Contract-first：修改 OpenAPI 新增 endpoint 与 compact schemas；更新 database contract/detail read projection 约束。
3. Backend：新增 Content Task Detail schema/query service、REPEATABLE READ route dependency/endpoint；复用现有 workflow/deletion projection，实现 deterministic current/generation/review/publishing/source/activity。
4. Generated types：运行 `make contract-generate`，检查 V1/V2 schema 仅增加新接口且基础 ContentTask 不变。
5. Content domain：新增 detail query key/options；提取最小 action/lifecycle 复用边界，保持 token exhaustive 和现有 commands。
6. Page/route：实现只读 Detail shell、全部 sections、links、states、responsive/a11y；新增 thin `$taskId` route。
7. New Task：成功后清 DirtyGuard/idempotency，失效 list，导航 canonical Detail；更新直接相关测试。
8. Backend unit/integration 与 frontend model/component targeted tests。
9. 扩展 generated-type `content.fixture.ts`，严格 exact path/method；新增 Detail production-artifact Playwright，拒绝任何浏览器 join。
10. 扩展既有 Product Facts real-stack Flow A，验证创建后真实 Detail 和 `CREATE_FIRST_DRAFT`，不进入 Editor。
11. 运行 required validation、`trellis-check`、diff/contract/docs/V1 兼容自审；修复仅由本任务导致的失败。

## 预计文件

- Contract/backend：`contracts/openapi.yaml`、`contracts/database.md`、`backend/app/schemas/content.py`、`backend/app/services/content_task_detail.py`、`backend/app/routers/planning.py`、对应 unit/integration tests。
- Frontend：`frontend-v2/src/domains/content/*`、`frontend-v2/src/routes/_app/content/tasks/$taskId.tsx`、generated schema、content component/model tests。
- E2E/docs：`frontend-v2/tests/e2e/fixtures/content.fixture.ts`、`content-task-detail.spec.ts`、`new-content-task.spec.ts`、`product-facts-real-stack.spec.ts` 和直接受影响的 frontend-v2/Trellis specs。

## Required validation

```bash
make contract-generate
make contract-check

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py

UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_content_task_detail.py \
  backend/tests/integration/test_content_task_list.py -m integration

UV_CACHE_DIR=.cache/uv uv run --project backend ruff check backend/app backend/tests
UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app

npm --prefix frontend-v2 run test -- \
  src/domains/content/content-task-actions.test.ts \
  src/domains/content/content-task-detail-page.test.tsx \
  src/domains/content/new-content-task-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/content-task-detail.spec.ts \
  tests/e2e/new-content-task.spec.ts \
  --project=foundation-desktop

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/content-task-detail.spec.ts \
  tests/e2e/new-content-task.spec.ts \
  --project=foundation-mobile

# 使用项目规定的隔离 DATABASE_URL/REDIS_URL
deploy/scripts/e2e-local.sh
```

## Optional full-suite validation

- `make test-unit`
- `make test-integration`
- `make e2e`
- 发布准备或用户明确要求全库门禁时运行 `make verify`

## Review gates

- OpenAPI/Pydantic/generated types 一致，基础 ContentTask endpoint/schema 未漂移。
- 页面网络日志只包含 detail GET 与用户明确触发的 lifecycle command。
- pointer、stable ordering、Activity limit、fixed query count、RR 均有直接测试。
- 无 Editor/Generation/Manual Draft/Review/Publication 实现或占位页面。
- Python touched-scope 中文 comments/docstrings/logs/errors 已检查。
- 最终 diff 不含无关文件；提交、归档、合并和删分支前按 AGENTS.md 单独获得用户确认，不 push。
