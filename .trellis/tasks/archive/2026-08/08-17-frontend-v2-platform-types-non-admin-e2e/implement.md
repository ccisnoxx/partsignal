# 实施计划

## Phase A — 实施前核对

1. 用户批准本计划后才运行 `task.py start 08-17-frontend-v2-platform-types-non-admin-e2e`；继续使用干净 `main`，不创建分支。
2. 用 `trellis-before-dev` 重读本 Task artifacts、Frontend V2 quality spec 和两个目标测试文件。
3. 确认工作树只有本 Task artifacts 与父任务 child link；不 pull/push/PR。

## Phase B — 最小实施

1. `platform-types.spec.ts`：把非管理员场景收敛为 route-before-loader 证据，精确断言 Platform Type GET 为 0，删除无意义 polling。
2. `platform-types.fixture.ts`：删除不可达的 ENGINEER list 403 response 与对应 `allowHttpError(403)`；保留 `/auth/me` ENGINEER session 控制。
3. 不修改 production route/domain、backend、OpenAPI、Playwright config、runner、旧 `frontend/` 或 Phase 7 文档。

## Required Validation

仓库根目录：

```bash
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/platform-types.spec.ts \
  --grep "非管理员" \
  --project=foundation-mobile \
  --project=foundation-desktop

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/platform-types.spec.ts \
  --project=foundation-mobile \
  --project=foundation-desktop

npm --prefix frontend-v2 run typecheck

frontend-v2/node_modules/.bin/eslint \
  frontend-v2/tests/e2e/platform-types.spec.ts \
  frontend-v2/tests/e2e/fixtures/platform-types.fixture.ts \
  --max-warnings 0

git diff --check
python3 ./.trellis/scripts/task.py validate \
  08-17-frontend-v2-platform-types-non-admin-e2e
```

第二个 Playwright 命令使用同一 production build artifact owner，预期两个 project 共 `10 passed`；它同时验证 ADMIN CRUD/409/500、导航、响应式和 strict runtime audit 未被 fixture 删除影响。

## Optional / Deferred Validation

- 不重跑 `backend/tests/integration/test_platform_types.py`：本任务不改 backend，当前主线与归档任务已证明 ENGINEER 四接口真实 403。
- 不运行完整 Frontend V2 E2E、`make e2e` 或 `make verify`：四个 blocker 全部提交后由 `frontend-v2-phase-7-exit-gate-recheck` 统一诊断并只运行一次最终候选 gate。
- 不单独运行 build：两个 Playwright 命令的 webServer 都会先构建 V2 production artifact。

## Phase C — 自审与停止

1. 用 `trellis-check` 确认 diff 只含本 Task artifacts、父任务 child link和两个 E2E 文件。
2. 确认没有新增 direct API 请求、sleep/retry、宽松计数、route 绕过、权限复制或通用测试 helper。
3. 全部 Required Validation 通过后报告结果和精确 commit plan，等待批准；不自动 commit、archive、push、PR、创建 Recheck 或开始 Phase 8。

## Commit 范围草案

单一提交，候选信息：

```text
test(frontend-v2): align platform type permission e2e ownership
```

只包含本 Task 5 个 artifacts、父任务 child link、`platform-types.spec.ts` 和 `platform-types.fixture.ts`。最终文件清单以实施后 diff 为准，提交前再次请求批准。

## 实施与验证结果

- 非管理员场景已改为证明 parent route 在 child loader 前拒绝 ENGINEER，并精确断言 Platform Type GET 为 0。
- 已删除不可达的 ENGINEER list 403 response 与对应 `allowHttpError(403)`；未修改 production、backend 或合同。
- 定向非管理员 E2E：mobile/desktop `2 passed`。
- 完整 Platform Types owner spec：mobile/desktop `10 passed`。
- Frontend V2 typecheck、目标文件 ESLint、`git diff --check` 与 Trellis task validation 均通过。
- 未运行完整 Frontend V2 E2E、`make e2e` 或 `make verify`；按计划留给 Phase 7 Exit Gate Recheck。
