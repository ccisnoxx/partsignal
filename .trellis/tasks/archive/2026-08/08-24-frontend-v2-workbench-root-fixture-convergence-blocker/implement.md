# Frontend V2 Workbench Root Fixture Convergence 实施计划

## 1. 当前状态与启动门禁

- 当前 Task status=`planning`，branch=`null`；只完成规划 artifacts。
- 本轮未运行 `task.py start`、未创建分支、未修改产品/测试代码、未运行测试。
- 用户批准本版规划后，才执行：

```bash
python3 ./.trellis/scripts/task.py start frontend-v2-workbench-root-fixture-convergence-blocker
git switch -c codex/frontend-v2-workbench-root-fixture-convergence-blocker
python3 ./.trellis/scripts/task.py set-branch \
  frontend-v2-workbench-root-fixture-convergence-blocker \
  codex/frontend-v2-workbench-root-fixture-convergence-blocker
```

启动前再次确认 dirty paths 仅为已审阅的本 child Task artifacts 与父 Task metadata；出现无法归属改动则停止。不执行 pull、push、PR 或历史改写。

## 2. 精确修改文件

### 2.1 `frontend-v2/src/app/layout/app-shell.test.tsx`

- 增加 `WorkbenchAggregate` / ProductList generated type alias 和两个本地最小 fixture。
- 将 `pathname 导航聚焦主内容，search-only 更新不抢焦点` 的 broad GET mock 改为精确 path dispatch：
  - `/api/v1/workbench` -> minimal aggregate；
  - `/api/v1/products` -> empty ProductList；
  - 其他 path -> 中文显式错误。
- 保留真实 route loader、App Shell navigation、pathname focus 与 search-only no-focus-steal 断言。

### 2.2 `frontend-v2/tests/e2e/fixtures/workbench.fixture.ts`

- 仅将既有 `emptyAggregate` 加入 export list。
- 不改变 aggregate 内容、Workbench mode、route handler、unexpected audit 或 spec 行为。

### 2.3 `frontend-v2/tests/e2e/auth-session.spec.ts`

- 从 Workbench strict fixture 导入 `emptyAggregate`。
- 在已有 `/api/v1/**` router 中对精确 `GET /api/v1/workbench` 返回 200 + `emptyAggregate`。
- 保留 Auth endpoint 条件、unexpected 501、teardown、trace off、secret scan 与全部用户行为断言。

### 2.4 `frontend-v2/tests/e2e/fixtures/platforms.fixture.ts`

- 从同目录 Workbench strict fixture 导入 `emptyAggregate`。
- 在已有 `/api/v1/**` router 中对精确 `GET /api/v1/workbench` 返回 200 + `emptyAggregate`。
- 保留 Platform API allowlist、commands、HTTP error allowance、unexpected 501、runtime error 与 teardown audit。

### 2.5 明确不修改

- `frontend-v2/tests/e2e/prompt-workspace.spec.ts`
- `frontend-v2/tests/e2e/fixtures/prompt-workspace.fixture.ts`
- 所有产品代码、backend、contracts、generated types、数据库、旧 frontend、配置、依赖、07/08/09 文档。

## 3. 实施顺序

1. 先导出既有 Playwright `emptyAggregate`，再为 Auth/Platforms 添加精确 handler。
2. 在 App Shell test 内增加本地 typed fixture，并把 broad mock 改为 endpoint dispatch。
3. 检查 diff：无 wildcard、fallback success、unknown API ignore、cross-runner import、新 helper/framework 或产品修改。
4. 按第 4 节执行 Required Validation；同一失败命令仅在代码/配置/环境发生预期影响变化后重跑。
5. 只修复本任务四个文件引入且属于 A25 的失败；A26 或其他 owner 问题停止扩围并批量报告。

## 4. Required Validation

### 4.1 App Shell 定向 unit

```bash
npm --prefix frontend-v2 run test -- \
  src/app/layout/app-shell.test.tsx
```

证明精确 Workbench / Products response dispatch 与原 focus 行为。

### 4.2 Frontend V2 完整 unit suite

```bash
npm --prefix frontend-v2 run test
```

必须确认原 `462 passed / 1 failed` 收敛为零失败；记录实际 files/tests/耗时，不以定向通过替代完整相关 suite。

### 4.3 Auth production-artifact mobile / desktop

```bash
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/auth-session.spec.ts \
  --project=foundation-mobile \
  --project=foundation-desktop
```

证明两次真实 `/`、Workbench heading、改密、403、logout、strict audit 与 secret scan。

### 4.4 Prompt Workspace production-artifact mobile / desktop

```bash
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/prompt-workspace.spec.ts \
  --project=foundation-mobile \
  --project=foundation-desktop
```

证明首场景仍从 `/` 经真实主导航进入 Prompt Workspace，且 Platforms/Prompt strict audit 收敛。

### 4.5 静态与 artifacts 检查

```bash
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
git diff --check
python3 ./.trellis/scripts/task.py validate \
  frontend-v2-workbench-root-fixture-convergence-blocker
```

## 5. Optional / Explicitly Skipped Validation

默认不运行：

- `make verify`
- 完整 `make e2e`
- `deploy/scripts/e2e-local.sh` 或任何真实栈 Auth 场景
- Workbench 专属 `workbench.spec.ts`
- build、Storybook、临时 `playwright-cli`

原因：本任务只改四个测试 owner 的 fixture 合同；Required Validation 已覆盖全部改动文件、完整 V2 unit 和两个受影响 production-artifact suite。真实栈 A26 与 Phase 8 Exit Gate recheck 必须在独立 Task 中处理。剩余风险是 A26 仍会使根真实栈 gate 非零，因此本任务结束后 Phase 8 仍为 `NOT_MET`。

## 6. Stop Conditions

- 正确修复需要修改产品代码、OpenAPI/generated types、backend、数据库、权限、Auth/query lifecycle 或 Prompt/Platform 行为。
- `emptyAggregate` 复用产生已证实的模块循环/fixture side effect；停止并回到 planning，不擅自新增 framework。
- 精确 handler 后出现其他 method/path 的 unexpected API；记录实际请求并停止，不扩大 route pattern。
- 需要删除 `/`、主导航、focus、session、403、logout、secret scan 或 teardown audit 断言才能通过。
- 出现 A26 的 real-stack cancellation 症状，或需要修改 `requestfailed` 过滤规则。
- 工作区出现无法归属或与本任务重叠的用户改动。

## 7. 回滚策略

- 提交前：用 `apply_patch` 反向撤销四个测试文件中的精确 hunks；不使用 `git checkout --`、`git reset --hard` 或通配删除。
- 某一 fixture 修正被证伪：只撤回该 owner 的 handler/import，保留其他独立修改和用户改动；更新 research evidence 后回到规划。
- 提交后只有用户另行授权才使用 `git revert <task-commit>`；不自动 push 或删除分支。

## 8. 建议 Commit 范围

实施与 Required Validation 全部通过后，建议一个聚焦工作提交：

```text
test(frontend-v2): align root workbench fixtures
```

包含四个测试文件、本 child Task artifacts 与 Phase 8 父 Task 的 child/current-blocker metadata；不包含产品代码、A26、07/08 完成状态、archive/journal bookkeeping 或无关 dirty files。提交前按项目规则展示实际 commit plan 并等待用户确认；不自动 commit/push。

## 9. 实际执行证据（2026-08-24）

### 修改结果

- `app-shell.test.tsx` 使用本地 generated-type `WorkbenchAggregate` / ProductList，对 `/api/v1/workbench` 与 `/api/v1/products` 精确返回对应 shape，未知 GET 显式抛错。
- 保留原“产品事实”heading、主导航与 focus 断言，并增加“产品事实列表”region 作为根 Workbench 同名 heading 存在时的精确导航完成信号。
- `workbench.fixture.ts` 仅导出现有 typed `emptyAggregate`；Auth 与 Platforms 对精确 `GET /api/v1/workbench` 返回该数据。
- Auth/Platforms 的 unexpected 501、teardown、runtime、secret、session、403、logout 与 Prompt 继承链均未放宽；Prompt spec/fixture 未修改。

### Required Validation

- App Shell targeted：`1 file / 6 tests passed`，`1.44s`。
- Frontend V2 unit：`81 files / 463 tests passed`，`14.67s`；原 `462 passed / 1 failed` 已关闭。
- Auth production artifact：mobile/desktop `2 passed`，`9.3s`。
- Prompt Workspace production artifact：mobile/desktop `8 passed`，`25.2s`。
- `npm --prefix frontend-v2 run typecheck`：退出 `0`。
- `npm --prefix frontend-v2 run lint`：退出 `0`。
- `git diff --check`：通过。
- `python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-root-fixture-convergence-blocker`：通过。

Playwright build 只输出既有 `>500 kB` chunk warning 与 `NO_COLOR`/`FORCE_COLOR` 环境 warning，不影响退出码或测试结果。

### 自审与保留项

- `trellis-check` 无未修 finding；只纠正 child/parent Task 的过期 planning notes。
- `.trellis/spec/` 无需更新：现有 frontend quality guideline 已覆盖 strict fixture 与未声明 API 边界，本任务没有产生新的稳定工程合同。
- A26 保持开放，Phase 8 Exit Gate 继续为 `NOT_MET`；未运行 `make verify`、完整 `make e2e`、真实栈 Auth、Workbench 专属 E2E 或 `playwright-cli`。
