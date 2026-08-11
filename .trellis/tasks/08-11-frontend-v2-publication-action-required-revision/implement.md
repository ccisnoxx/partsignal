# Frontend V2 Publication ACTION_REQUIRED Content Revision — Implementation Plan

## 1. 实施步骤

1. 运行 `trellis-before-dev`，读取 backend/frontend/infra 相关 spec 与本任务三份规划产物。
2. 在 `content_task_workflow_projection()` 内增加 `ACTION_REQUIRED` 的精确 CASE 顺序，不新增 helper、schema 或第二套投影。
3. 扩展 backend integration test，用真实 content revision/review commands 证明失败核验后的五个 Content Task 投影阶段，并保留正常发布与完成态回归。
4. 扩展现有 Publication Workspace 真实栈 spec，以独立数据通过 V2 UI 完成 Flow B；复用现有 Content Editor/Review 与 Publication dialogs。
5. 运行 targeted validation、`trellis-check` 和 diff 自审；确认无合同、V1 或无关改动后，展示 commit plan 并等待确认。
6. 提交并快进合并到 `main` 后删除临时分支；运行父任务最终集成门禁。父任务归档和 journal 前先说明可能产生 Trellis bookkeeping commit。

## 2. 预计修改文件

必需：

```text
backend/app/services/projections.py
backend/tests/integration/test_publication_workflow.py
frontend-v2/tests/e2e/publication-workspace-real-stack.spec.ts
```

规划与父任务一致性：

```text
.trellis/tasks/08-11-frontend-v2-publication-action-required-revision/{prd,design,implement}.md
.trellis/tasks/08-11-frontend-v2-publication-workspace/{prd,design,implement}.md
```

仅当 targeted evidence 证明现有 handoff 不足时才允许触碰 `frontend-v2/src/domains/**`；出现这种情况必须先更新规划并重新请求批准。

明确不修改：

```text
contracts/openapi.yaml
contracts/database.md
frontend/src/**
frontend-v2/src/shared/api/generated/schema.d.ts
backend/app/services/publication.py
backend/app/services/content_production.py
backend/app/services/review.py
deploy/scripts/e2e-local.sh
```

## 3. 必需验证

### Backend targeted

```bash
PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/integration/test_publication_workflow.py::test_failed_verification_remains_pending_then_completes_and_opens_issue \
  backend/tests/integration/test_content_task_detail.py::test_content_task_detail_projects_server_workflow_matrix \
  -q
```

### Frontend regression and build

```bash
npm --prefix frontend-v2 run test -- \
  src/domains/content/content-editor.model.test.ts \
  src/domains/content/content-task-actions.test.ts \
  src/domains/publication/publication-workspace-page.test.tsx

npm --prefix frontend-v2 run build
```

### Isolated real stack

```bash
DATABASE_URL=<local-postgres-url> REDIS_URL=<exclusive-local-redis-url> \
  deploy/scripts/e2e-local.sh
```

验收 `publication-workspace-real-stack.spec.ts` 的 Flow A 与新增 Flow B 均执行；脚本最终必须确认隔离数据库和对象存储目录已删除。

### Static checks

```bash
git diff --check
```

本任务不改合同，因此不把 generated types 或 `make contract-check` 作为子任务必需门禁；它们仍由父任务最终门禁统一验证。

## 4. 可选验证

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_workflow_projections.py -q
npm --prefix frontend-v2 run e2e -- tests/e2e/publication-workspace.spec.ts
make verify
```

只有 targeted evidence 显示影响扩大时才升级这些检查，不为本地 CASE 修复默认运行全仓套件。

## 5. 启动前检查

- [ ] 用户已明确批准本版 `prd.md`、`design.md` 与 `implement.md`。
- [ ] 主工作区处于干净最新 `main`；规划产物已有明确提交处理方案。
- [ ] 激活本子任务后，按项目单分支规则直接在 `main` 实施；除非用户再次明确批准，不创建新的临时分支。
- [ ] 不修改 V1 runtime/test/page，不新增合同字段、依赖或迁移。
- [ ] 实施完成后展示 commit plan，未经确认不提交、不 push。
