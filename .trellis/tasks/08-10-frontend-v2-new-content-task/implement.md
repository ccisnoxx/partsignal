# 实施计划

## 执行清单

- [x] 激活 task，从干净 `main` 创建 `codex/frontend-v2-new-content-task`。
- [x] 更新 `contracts/openapi.yaml` 与 `contracts/database.md`：creation-options schemas/path、POST 实际错误响应、创建锁边界。
- [x] 在 Content schema/query/router 实现固定查询的 creation options；在 `create_content_task` 补 Product/Fact 行锁。
- [x] 增加 contract 与 PostgreSQL integration tests：过滤、排序、权限/空态、statement count、三实体资格、幂等重放/冲突、并发唯一、options 过期。
- [x] 分别重新生成 V1/V2 OpenAPI types，保持 V1 调用不变。
- [x] 扩展 Content query keys/API/error mapping，新增 URL/form/idempotency model。
- [x] 实现三字段 NewContentTaskPage、thin route、列表一次性成功反馈；生成 route tree。
- [x] 更新蓝图 `03/05/07/08`，不改 ADR 或无关架构文档。
- [x] 增加 model/page/list component tests。
- [x] 扩展 `content.fixture.ts` 与 `new-content-task.spec.ts`，所有未声明 API 继续失败。
- [x] 扩展既有 Product Facts real-stack Flow A，复用 `deploy/scripts/e2e-local.sh`。
- [x] 运行 required validation、`trellis-check`、diff/依赖/范围/文案自审。
- [ ] 停在 commit plan 前；提交、合并、归档、删分支和 push 均等待用户确认。

## 预计文件

- Contract/docs：`contracts/openapi.yaml`、`contracts/database.md`、`docs/frontend-v2/03*`、`05*`、`07*`、`08*`。
- Backend：`backend/app/schemas/content.py`、`services/content_task_queries.py`、`services/content_planning.py`、`routers/planning.py`、contract/integration tests。
- Generated：V1 `frontend/src/shared/api/schema.d.ts`、V2 `frontend-v2/src/shared/api/generated/schema.d.ts`。
- Frontend V2：Content API/query keys、new-content model/page/route/tests、Content List success feedback、route tree。
- E2E：`content.fixture.ts`、`new-content-task.spec.ts`、既有 `product-facts-real-stack.spec.ts`。

## Required validation

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

PARTSIGNAL_TEST_DATABASE_URL=<postgres-admin-url> \
  uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_content_task_creation.py

npm --prefix frontend-v2 run test -- \
  src/domains/content/new-content-task.model.test.ts \
  src/domains/content/new-content-task-page.test.tsx \
  src/domains/content/content-task-list-page.test.tsx

make lint typecheck
npm --prefix frontend-v2 run build

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/new-content-task.spec.ts \
  --project=foundation-desktop

DATABASE_URL=<postgres-admin-url> REDIS_URL=<redis-url> \
  deploy/scripts/e2e-local.sh
```

PostgreSQL 测试若因缺少环境而 skip，不算通过。

## Optional full-suite validation

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make verify
```

## 验证记录

- 已通过：`make contract-check`；backend contract + PostgreSQL integration 32 tests；V2 component 24 tests；`make lint`；`make typecheck`；V2 build；New Content Task desktop/mobile Playwright 20 tests；Content Task List desktop Playwright 6 tests。
- 真实栈同一 orchestration 中，Product Facts Flow A/B 均通过；Flow A 已经真实创建 ContentTask 并返回列表。随后脚本继续运行的 V1 全套为 49 passed / 3 failed，失败位于未修改的 AI 审计可见性、既有源码标记清单和不存在资源删除状态断言，不纳入本 Task 修复。
- V1 定向 `ContentTasksPage.test.tsx` 23 tests 通过；V1 generated type、lint、typecheck 通过。

## 回滚点

本 task 无 migration。任一 contract/backend gate 失败时先回滚到旧三字段 POST，再删除尚无消费者的 creation-options；前端 route 可独立移除，不影响 V1 或 Content Task List。
