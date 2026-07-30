# DEF-002 实现计划

## 实施步骤

1. **合同先行**
   - 在 `contracts/openapi.yaml` 为 `POST /api/v1/content-tasks` 增加现有 `IdempotencyKey` 参数，并明确 `201` 重放语义。
   - 在 `contracts/database.md` 和两份当前设计文档记录普通任务请求键、同键冲突、不同键允许重复业务输入及 PostgreSQL 锁/唯一约束。
   - 运行 `make contract-generate`，只接受 `frontend/src/shared/api/schema.d.ts` 的预期 Header 类型差异。

2. **数据库持久化**
   - 新增 `0032_content_task_idempotency`：可空 `VARCHAR(128)`、命名唯一约束、无历史回填；downgrade 删除新增结构。
   - 在 `ContentTask` ORM 增加可空内部字段，不加入 API response。
   - 迁移测试覆盖 `0031 -> 0032` 历史空值保留、重复非空键拒绝、不同/空键允许和 downgrade 不丢任务。

3. **服务端权威幂等**
   - 路由要求 `Idempotency-Key` 8–128 字符并传给 `create_content_task`。
   - 服务先获取命名事务 advisory lock；同键同载荷返回原任务，同键异载荷抛 `IDEMPOTENCY_CONFLICT`；新键沿用现有校验、插入和审计。
   - 任务响应投影排除内部 `idempotency_key`，不扩展公开响应模型。
   - 更新现有直接调用该服务的测试参数，不改发布修复任务语义。

4. **前端提交意图**
   - 创建弹窗打开时生成稳定键，POST Header 同时携带 CSRF 与该键；失败重试保留，关闭再打开重置。
   - 保留现有 loading，不增加全局 Store、通用 Hook 或第二套提交状态。
   - 组件测试断言 Header 存在、同一次快速连续提交复用同一键、重新打开生成新意图。

5. **回归与审查**
   - PostgreSQL 集成测试同时覆盖并发同键、顺序重放、异载荷冲突、不同键同载荷，以及只写一条创建审计。
   - 检查 diff 不含 DEF-001、DEF-AI-001、artifacts、部署或无关验收计划改动。
   - 实现完成后完成文档一致性检查并等待提交确认；不归档、不部署。

## Required validation

```bash
make contract-check

npm --prefix frontend run test:watch -- --run src/features/content-tasks/ContentTasksPage.test.tsx

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_migrations.py \
  -k content_task_creation_idempotency

docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_publication_review_closure.py \
  -k content_task_creation_idempotency

make lint
make typecheck
```

通过标准：所有命令退出码为 0；PostgreSQL 测试不得 skip；合同检查无运行时 OpenAPI 或生成类型漂移；定向测试证明同键仅一条任务/审计且不同键仍可重复业务输入。

## Optional full-suite validation

```bash
make verify
```

该命令包含完整合同、lint、typecheck、后端单元/集成、前端测试、构建和本地 Playwright。若因本机服务、Chromium 或外部环境未就绪而跳过，必须报告具体原因；不把无关既有失败纳入 DEF-002 修复。

## 部署后回归

需另行获得线上写入授权后，使用项目 `playwright-cli` 和新 run-id：

1. 仅使用明确的隔离测试产品、已批准事实和测试平台，不调用 AI、不真实发布。
2. 记录当前任务数量，打开创建弹窗并对“创建任务”执行一次快速双击，保存请求与响应证据。
3. 断言列表只净增一条；若浏览器实际发出两次 POST，两次响应必须返回同一任务 ID；刷新、后退再前进后数量不增加。
4. 按任务 ID检查只存在一条 `content_task.created` 审计。
5. 将空测试任务取消并按合同删除，恢复临时启停配置；审计和新的验收 artifacts 按历史规则保留。
6. 更新独立部署验收报告，只关闭 DEF-002，不改写原 run `20260730-002915` 和 `20260730-020822`。

## 本地验证结果（2026-07-30）

- [x] `make contract-check`
- [x] `npm --prefix frontend run test:watch -- --run src/features/content-tasks/ContentTasksPage.test.tsx`（14 passed）
- [x] 迁移聚焦测试（1 passed，28 deselected）
- [x] PostgreSQL 幂等聚焦测试（1 passed，21 deselected）
- [x] `make lint`
- [x] `make typecheck`
- [x] `git diff --check`
- [ ] `make verify`：可选全量验证，本次未运行；required validation 已覆盖变更合同、数据库、并发、前端和静态检查。
- [ ] 部署后回归：需另行获得线上写入授权。
