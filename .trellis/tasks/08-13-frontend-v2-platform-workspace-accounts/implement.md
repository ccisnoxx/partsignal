# 实施计划

## 0. Start Gate

- [ ] Core 已验证、提交、归档、fast-forward 合入 `main`，且其临时分支已删除。
- [ ] 用户批准本 Task 最新 `prd.md / design.md / implement.md`。
- [ ] 主工作目录位于更新后的干净 `main`，无未识别改动。
- [ ] 用户确认唯一临时分支 `codex/frontend-v2-platform-workspace-accounts`。
- [ ] 通过 gate 后才运行 `task.py start` 并创建分支。

## 1. Ordered Implementation

- [ ] Contract first：Account DELETE 增加 required revision；Account List 不增加集合 `CREATE` token。
- [ ] Backend projection/command：确认现有 row actor projection；delete 锁内 revision + PublicationWork blocker；唯一性预检/constraint 共用结构化字段错误 owner。
- [ ] Backend tests：ADMIN/ENGINEER、platform disabled、fixed query count、CRUD、预检与真实 PostgreSQL 唯一约束字段错误、stale delete、blocker。
- [ ] 生成 V1/V2 schema并运行 contract check。
- [ ] V1 只更新 Account DELETE 调用与直接测试。
- [ ] V2 Account API/model：CRUD/status/delete、collection/row token 穷尽 mapping。
- [ ] UI：create/edit Dialog、status/delete/blocker、409 reload、focus return、375 mobile actions。
- [ ] 精确失效 Platform 与 Publication consumers。
- [ ] 扩展 Core fixture/Playwright，不创建第二套 route/fixture。
- [ ] 更新直接相关 spec/docs并执行 diff 自审。

## 2. Required Validation

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_workflow_projections.py

PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55432/partsignal \
  PYTHONDONTWRITEBYTECODE=1 backend/.venv/bin/pytest -p no:cacheprovider -q \
  backend/tests/integration/test_platform_accounts.py

cd frontend && npm exec -- vitest run src/features/settings/SettingsPage.test.tsx
cd ..

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/platform-workspace.model.test.ts \
  src/domains/configuration/platform-workspace-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/platform-workspace.spec.ts
git diff --check
```

若复用现有大型 integration 文件，Required command 必须改为精确 test nodes，不机械运行整份无关 suite。

测试必须覆盖 page create、row token、平台停用 create 拒绝、empty/edit/status/delete/blocker、normalized unique、stale revision、409 不重放、cache targets、focus return、ADMIN/ENGINEER 与 375px actions。

## 3. Optional Validation

```bash
make verify
npm --prefix frontend-v2 run e2e
make test-integration
```

Phase 6 完整 real-stack E2E 和其他 Domain E2E 继续留给后续独立 Task。

## 4. Completion Gate

- [ ] Required checks 实际通过或逐项说明未运行原因。
- [ ] 自审无 optional revision、先 GET 后 DELETE、client eligibility、重复 Account owner 或终态 snapshot 误失效。
- [ ] 报告 changed files、contract/backend、action ownership、revision、cache、实际测试、跳过项、风险和文档一致性。
- [ ] 提交前提供 commit plan 并等待确认；不自动 push/PR。
- [ ] 提交、归档、fast-forward 合入 main、删除本地分支后，父 Task 才可完成。
