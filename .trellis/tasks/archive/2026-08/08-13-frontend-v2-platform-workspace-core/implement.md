# 实施计划

## 0. Start Gate

- [x] 用户批准本 Task 最新 `prd.md / design.md / implement.md`。
- [x] 主工作目录位于 `main`，工作区除获批 Trellis 规划文件外无未识别改动。
- [x] Platform List 前置提交、归档和 journal 仍在 `main`。
- [x] 用户确认唯一临时分支 `codex/frontend-v2-platform-workspace-core`。
- [x] 通过 gate 后才运行 `task.py start` 并创建分支。

## 1. Ordered Implementation

- [x] Contract first：Detail 增加 type options，并同步 runtime schema。
- [x] Backend read owner：CurrentUser、actor projection、首次查询前 `REPEATABLE READ`、固定 query count。
- [x] Backend tests：ADMIN/ENGINEER、action差异、404、summaries/options、isolation 和 query count。
- [x] 生成 V1/V2 schema并运行 contract check。
- [x] 扩展 Platform API/query keys；最小复用 List lifecycle action/command owner。
- [x] 实现 UUID/search route、prefetch、breadcrumb 与返回入口。
- [x] 实现 Header、Overview、read-only Accounts、Generation 和查询状态。
- [x] 实现一次 PATCH、dirty/cancel/409 reload、status/delete 和精确 invalidation。
- [x] 实现 Logo upload/candidate/confirm/remove，复用现有 transfer/lifecycle。
- [x] 补 model/component 与 production-artifact Playwright。
- [x] 更新直接相关合同/spec/docs，执行 diff 自审。

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
  backend/tests/integration/test_platform_workspace.py

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/platform-list.model.test.ts \
  src/domains/configuration/platform-workspace.model.test.ts \
  src/domains/configuration/platform-workspace-page.test.tsx

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/platform-workspace.spec.ts
git diff --check
```

若专项 backend 文件名与最终落点不同，改为实际精确 test node，不扩大到整份无关 integration suite。

Playwright 必须覆盖 List → Workspace、direct/refresh/Back/Forward、tab canonicalization、Overview edit/cancel/save、Logo、read-only Accounts、Generation、ADMIN/ENGINEER、403/404/error/retry、DirtyGuard、焦点、未声明 API/console/page/request error，以及 375/768/1024/1440。

## 3. Optional Validation

```bash
make verify
npm --prefix frontend-v2 run e2e
make test-integration
```

只在共享合同回归证据不足、发布准备或用户明确要求时运行。Phase 6 完整 real-stack E2E 不属于本 Task。

## 4. Actual Validation

- `npm --prefix frontend run api:generate`：通过。
- `npm --prefix frontend-v2 run api:generate`：通过。
- `make contract-check`：通过，包含 FastAPI runtime 与 V1/V2 generated schema 一致性。
- Backend unit：`test_contract.py` 与 `test_workflow_projections.py`，59 项通过。
- Backend integration：`test_platform_workspace.py`，1 项通过；相关 `test_platform_profile_list.py` 合跑共 3 项通过。
- 相关 Logo/configuration backend unit：40 项通过。
- Frontend 定向 Vitest：4 个文件、19 项通过。
- `npm --prefix frontend-v2 run lint`：通过。
- `npm --prefix frontend-v2 run typecheck`：通过。
- `npm --prefix frontend-v2 run build`：通过；仅保留既有 Markdown editor chunk size warning。
- Platform Workspace production-artifact Playwright：mobile/desktop 共 12 项通过。
- `git diff --check`：通过。
- 未运行 optional `make verify`、全量 frontend-v2 E2E、全量 backend integration 与 Phase 6 real-stack E2E；定向合同、权限、组件、构建和 production-artifact 证据已直接覆盖本 Task，且后两者属于明确排除项或后续阶段。

## 5. Completion Gate

- [x] Required checks 实际通过或逐项说明未运行原因。
- [x] 自审无客户端权限推导、waterfall、无边界 cache clear、重复 action owner 或通用框架。
- [x] 报告 changed files、contract/backend、权限、revision、cache、实际测试、跳过项、风险和文档一致性。
- [ ] 提交前提供 commit plan 并等待确认；不自动 push/PR。
- [ ] 提交、归档、fast-forward 合入 main、删除本地分支后，才允许启动 Accounts 子 Task。
