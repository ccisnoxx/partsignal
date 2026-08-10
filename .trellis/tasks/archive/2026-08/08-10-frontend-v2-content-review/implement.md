# Frontend V2 Content Review — Implementation Plan

## Preconditions

- [x] 用户确认本规划与 `frontend/src/shared/api/schema.d.ts` 生成文件例外。
- [x] 未运行 `task.py start` 前不修改业务代码。
- [x] 确认 primary working directory 位于最新、干净的 `main`；如需同步，只能在 clean tree 执行 `git pull --ff-only origin main`。
- [x] 运行 `task.py start` 后创建临时分支 `codex/frontend-v2-content-review`。
- [x] 重新加载 task phase context 与相关 `.trellis/spec/`，再进入修改。

## Execution Order

### 1. Contract and Backend Read Model

- [x] 在 `contracts/openapi.yaml` 新增 task-scoped Review Context 路径并补齐相关命令错误响应，不新增 DTO。
- [x] 在 review service 增加 task current pointer 解析入口，复用现有 context assembler。
- [x] 在 production router 增加 `REPEATABLE READ` task route；保留 existing version route。
- [x] 为无 current content 和断裂 context 返回稳定结构化 404/409。
- [x] 增加 focused backend integration tests，证明 snapshot、actions、permission、revision、CSRF、errors、immutability。

### 2. Generated Contracts

- [x] 运行现有 OpenAPI 生成命令更新 `frontend-v2/src/shared/api/generated/schema.d.ts`。
- [x] 同步更新用户已明确授权的 `frontend/src/shared/api/schema.d.ts` 生成文件；不改 V1 手写源码。
- [x] 运行 `make contract-check`，确保两套冻结生成类型与唯一 OpenAPI 一致。

### 3. Content Domain Slice

- [x] 在 `content.api.ts` 增加 review query key/query、approve/request-changes mutation，继续使用 `ContentRequestError`。
- [x] 新建 Content-specific review model：token 映射、意见 schema、issues/timeline/presentation mapping。
- [x] 新建 Review page：WorkspaceShell、MarkdownPreview、Badge、StickyActionBar、Timeline、Dialog、FormField/ErrorSummary；不建立通用 Review framework。
- [x] 新建 TanStack route `/content/tasks/$taskId/review` 并更新生成 route tree。
- [x] 成功/409 重新读取 canonical task Review Context；409 保留输入、request ID 且不 replay。
- [x] 增加 focused model/page tests。

### 4. Browser and Real-Stack Coverage

- [x] 扩展现有 Content fixture，支持 review snapshot、loading/error/permission/status modes、命令 mutation、CSRF/revision conflict/request ID 与请求计数。
- [x] 新增 fixture Playwright spec 覆盖全部视口、导航、状态、交互、错误、焦点和运行时错误监控。
- [x] 新增独立 real-stack approve/request-changes spec，两流程使用独立数据。
- [x] 把 real-stack spec 接入现有 `deploy/scripts/e2e-local.sh`，更新 E2E isolation spec 的 suite 清单/所有权。

### 5. Quality Gate and Review

- [x] 按 required validation 顺序执行；只修复能归因于本任务的失败。
- [x] 运行 `trellis-check`。
- [x] 自审 diff：范围、合同/实现一致性、无 waterfall/状态推导/fallback/第二 DTO/新依赖、未触碰 V1 手写代码。
- [x] 抽象回顾：确认没有真实证据需要 Review framework 或额外共享组件。
- [x] 报告改动、验证、剩余风险和文档一致性。
- [ ] 提交前展示 commit plan 并等待用户确认；不 push。

## Validation Results

- `make contract-check`：通过；运行时 OpenAPI 与两份冻结生成类型一致。
- `backend/.venv/bin/pytest backend/tests/integration/test_content_review.py -q`：在 `APP_ENV=test`、宿主机 PostgreSQL 映射下实际执行，2 passed。
- focused V2 Vitest：2 files / 12 tests passed；typecheck、lint、build 通过。
- fixture Playwright：25 passed / 1 skipped；skip 仅用于避免在 mobile project 重复执行 768/1024 场景。
- `sh -n deploy/scripts/e2e-local.sh` 与 `python -m py_compile deploy/scripts/e2e-database.py`：通过。
- `deploy/scripts/e2e-local.sh`：V2 real-stack 6/6 通过，其中 Content Review APPROVE 与 REQUEST_CHANGES 各自独立通过；随后 V1 suite 49 passed / 3 failed，失败位于未修改的 AI 审计日志时序、既有全站表格源码标记清单和删除接口 422/404 预期，不扩张本任务修复。失败后隔离数据库与临时对象存储均输出 `status=deleted`，独占 Redis 已清理。

## Exact Required Validation

按从最快、最能证明改动到真实闭环的顺序执行：

```bash
cd /Users/sc/PycharmProjects/partsignal

make contract-check

backend/.venv/bin/pytest \
  backend/tests/integration/test_content_review.py -q

npm --prefix frontend-v2 run test -- \
  src/domains/content/content-review.model.test.ts \
  src/domains/content/content-review-page.test.tsx

npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint

npm --prefix frontend-v2 run build

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/content-review.spec.ts \
  --project=foundation-mobile \
  --project=foundation-desktop

sh -n deploy/scripts/e2e-local.sh
deploy/scripts/e2e-local.sh
```

说明：

- 768 / 1024 由 `content-review.spec.ts` 在 desktop project 内显式 `page.setViewportSize` 覆盖；375 / 1440 分别由现有 mobile/desktop projects 覆盖。
- fixture spec 必须监听并断言 `console.error`、`pageerror`、非预期 `requestfailed` 为空。
- 运行 `deploy/scripts/e2e-local.sh` 前必须按既有基础设施合同导出可由本机访问的 `DATABASE_URL` 与独占 `REDIS_URL`；脚本负责创建独立数据库、启动真实服务、运行接入后的 Content Review spec 并清理，不以手工预启动服务或 fixture 结果冒充 real-stack。
- 不把全仓 `make verify` 设为 required：本任务不改数据库 schema、权限模型或共享公共 API 形状之外的仓库全域；focused backend + contract + V2 type/lint/build + fixture/real-stack 更直接。可选在交付前运行 `make verify`，其无关失败不扩张本任务。

## Expected Modified Files

### Authoritative contract / backend

- `contracts/openapi.yaml`
- `backend/app/routers/production.py`
- `backend/app/services/review.py`
- `backend/tests/integration/test_content_review.py`（新增）

### Generated contract artifacts

- `frontend-v2/src/shared/api/generated/schema.d.ts`
- `frontend/src/shared/api/schema.d.ts`（仅生成文件；待用户明确授权）

### Frontend V2 Content domain

- `frontend-v2/src/domains/content/content.api.ts`
- `frontend-v2/src/domains/content/content-review.model.ts`（新增）
- `frontend-v2/src/domains/content/content-review.model.test.ts`（新增）
- `frontend-v2/src/domains/content/content-review-page.tsx`（新增）
- `frontend-v2/src/domains/content/content-review-page.test.tsx`（新增）
- `frontend-v2/src/routes/_app/content/tasks/$taskId_.review.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）

### Browser / real-stack

- `frontend-v2/tests/e2e/fixtures/content.fixture.ts`
- `frontend-v2/tests/e2e/content-review.spec.ts`（新增）
- `frontend-v2/tests/e2e/content-review-real-stack.spec.ts`（新增）
- `deploy/scripts/e2e-local.sh`
- `.trellis/spec/infra/e2e-isolation.md`
- `.trellis/spec/frontend/state-management.md`（task-scoped Review Context 稳定跨层合同）

### Task artifacts

- `.trellis/tasks/08-10-frontend-v2-content-review/prd.md`
- `.trellis/tasks/08-10-frontend-v2-content-review/design.md`
- `.trellis/tasks/08-10-frontend-v2-content-review/implement.md`
- `.trellis/tasks/08-10-frontend-v2-content-review/task.json`（仅由 Trellis workflow 更新状态）

预计不需要修改数据库合同或迁移：现有 `ContentTask.current_content_version_id`、ContentVersion 不可变和 ContentReviewRecord append-only 规则已经满足目标；若实施中发现真实 schema 缺口，停止并重新请求范围确认。

## Rollback Plan

1. 前端 page/route/fixture 可整体回滚，不影响已有 Content Task Detail、Editor Core 或 AI Production。
2. task-scoped GET 可独立回滚；既有 version-scoped endpoint 和 V1 consumer 保持原样。
3. OpenAPI 路径与两份生成类型作为一个原子回滚单元，禁止只回滚其中一份。
4. approve/request-changes service 不计划改状态机；若只补合同/测试发现缺陷，修复必须保持现有唯一 command owner，不能加兼容分支。
5. real-stack 脚本接入可单独撤销以恢复旧 suite 清单，但不得用此隐藏业务测试失败。
