# Frontend V2 Phase 6 New GEO Observation desktop 焦点 E2E blocker 实施计划

## Status

`in_progress`。实施、Required validation 与提交前审查已完成，commit plan 已获用户确认，准备提交并归档收尾。

## 0. Start gate after approval

1. 再次确认 primary workspace 位于 clean `main`，前置 Task 已归档合入，无活动 Task 冲突、同名 branch/worktree 或未识别 dirty file；不因 ahead `origin/main` pull 或 push。
2. 创建并切换唯一临时分支 `codex/frontend-v2-phase6-new-geo-observation-focus-e2e-blocker`，不创建额外 worktree。
3. 使用 `trellis-before-dev` 复核当前 Task 三份规划、research、Frontend quality/state specs 与目标 owner。
4. 运行 `task.py start`，Task 从 `planning` 进入 `in_progress`。

## 1. Minimum implementation

### 1.1 Breakpoint settle

- [x] 在现有四档宽度循环内，viewport 切换后按宽度等待当前 Workspace 的可访问性分支：窄屏 tab、desktop `观测上下文` region。
- [x] 分支稳定后再检查页面根无横向溢出。
- [x] 保留 `GEO platform` locator 的 `.focus()` 与 `toBeFocused()` 精确断言。
- [x] 不新增 helper、sleep、retry、CSS/数组 locator、production change 或抽象。

### 1.2 Gate documentation

- [x] 前置验证后确认 blocker 已关闭、完整 V2 E2E 与 Compose precheck 通过；最终门禁前 Gate 保持 `NOT_MET`。
- [x] 最终门禁后只按实际结果更新 `07/08` 的 Gate、counts、duration 与 cleanup。
- [x] 更新当前 Task `research/audit.md`；不修改任何已归档 Task。

## 2. Required validation

### Layer 1 — exact failing scenario

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/new-geo-observation.spec.ts --grep 'DirtyGuard 覆盖 Cancel，Back/Forward 可恢复 canonical 页面；四档宽度无溢出'
```

预期两个 project 均通过：`2 passed / 0 failed`。

### Layer 2 — complete New GEO Observation fixture spec

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/new-geo-observation.spec.ts
```

预期 `14 passed / 0 failed / 0 skipped`。

### Layer 3 — complete Frontend V2 fixture E2E discovery

```bash
npm --prefix frontend-v2 run e2e
```

要求 384 个 discovered tests 全部 accounted 且无失败；按当前矩阵预期 `357 passed / 27 skipped / 0 failed`。记录实际计数、耗时、production build 和 warning。若出现新失败，先归因并一次性报告全部 blocker；与本 Task diff 无关时停止，不扩大 Task，也不运行最终 `make verify`。

### Layer 4 — static, build and contract

```bash
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
make contract-check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-16-frontend-v2-phase6-new-geo-observation-focus-e2e-blocker
git diff --check
```

E2E 已对 production artifact 执行 build；显式 build 仍作为最终候选静态/构建记录。完整 V2 unit 和其它未修改上游阶段已有前置最终候选通过证据，并由最终 `make verify` 再确认，不在发现阶段机械重复。

### Layer 5 — Compose dev/prod config precheck

从仓库根目录执行 Makefile 中同一权威命令，不启动服务：

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_VERSION=test \
  docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet
```

两条都必须在最终门禁前退出 `0`。不得回显 credential 或批量导出 `.env`。

### Layer 6 — one final-candidate gate

只读确认本机 PostgreSQL source 可隔离建库，Redis 使用本 Task 独占端口的 DB 14 且为空，E2E 固定端口和 storage/process owner 通过既有 preflight。全部 Layer 1–5 通过后只运行一次：

```bash
DATABASE_URL='<本机 PostgreSQL source URL>' \
REDIS_URL='redis://127.0.0.1:<独占端口>/14' \
make verify
```

记录总退出码/耗时，以及 contract、lint/typecheck、backend/V1/V2 unit、integration、build、real-stack、V1/V2 E2E、Compose config 的实际 passed/failed/skipped。记录 PostgreSQL 临时数据库、Redis queue/unacked/DBSIZE、storage、process/container 和全部固定端口 cleanup。门禁后只允许更新证据文档、Task validation 与 diff check；不自动第二次运行。

## 3. Optional validation

无。上述链已覆盖唯一修改、完整 384 项 V2 fixture E2E、此前未到达的 Compose config 与最终 release gate；额外 repeat-each、浏览器 CLI 或重复完整门禁不会提高验收证据。

## 4. Documentation and review

- 对最终 diff 执行 `trellis-check`，拒绝 production change、弱断言、sleep/retry、helper/abstraction 和无关清理。
- `.trellis/spec/frontend/quality-guidelines.md` 已有响应式重挂载后的 settle 规则；`trellis-update-spec`/`trellis-break-loop` 审核后只扩展原规则的焦点/键盘边界，不新增重复章节。
- 核对测试、当前 Task evidence、`07`、`08` 和 Gate 状态一致。

## 5. Phase 6 gate update condition

- 当前 blocker 关闭、384 项 V2 E2E 无失败、Compose precheck 通过、最终 `make verify` 退出 `0`、cleanup 完整且 open P0/P1/P2=`0/0/0`：将 Engineering 与 Phase 6 Exit Gate 从 `NOT_MET` 更新为 `MET`。
- 任一前置发现性检查失败：完成归因后停止，不运行 final gate。
- 最终门禁出现新无关 blocker：记录完整阶段证据与 cleanup，Gate 保持 `NOT_MET`，不扩围、不自动重跑。

## 6. Stop conditions

- 证据要求修改 production、API、database、permission、deployment 或 dependency 时，返回 planning 请求重新批准 owner/scope。
- breakpoint 分支等待仍不能稳定目标场景，或暴露真实 focus/accessibility 缺陷时，停止测试-only 方案并重新归因。
- 出现未识别 dirty file、branch/worktree 冲突、PostgreSQL/Redis/端口无法独占时，不启动最终门禁。
- 完整 V2 E2E 或 Compose precheck 出现与本 Task diff 无因果关系的新 blocker 时，不把它夹带进本 Task。

## 7. Commit and lifecycle plan

实施与 Required validation 完成后，先报告精确 diff、计数/耗时、cleanup 和 Gate 结论，并给出候选 commit plan；未经确认不提交：

1. 工作提交：`test(frontend-v2): stabilize New GEO focus after breakpoint`，包含目标 E2E、既有 Frontend quality rule 的焦点边界补强、`07/08` 与当前 Task evidence。
2. 获得收尾授权后归档 Task，并独立提交 Trellis archive bookkeeping 与 developer journal。
3. 不 push、不创建 PR；切回 `main` 后只执行 `git merge --ff-only codex/frontend-v2-phase6-new-geo-observation-focus-e2e-blocker`。
4. 确认工作、归档和 journal 提交均已 fast-forward 进入 `main` 后删除本地临时分支；远端分支预期不存在。

## 8. Actual validation results

- 精确场景：`2 passed / 0 failed / 8.7s`；mobile `1.1s`，desktop `1.2s`。
- 完整目标 spec：`14 passed / 0 failed / 0 skipped / 20.8s`。
- 独立完整 V2 fixture E2E：`357 passed / 27 skipped / 0 failed / 4.2m`，384 项全部 accounted。
- V2 `api:check`、typecheck、lint、production build、`make contract-check` 均退出 `0`；build 只有既有大 chunk warning。
- Compose dev/prod `config --quiet` 在最终门禁前均退出 `0`。
- 唯一最终 `make verify`：退出 `0`，`real 1124.40s`；backend unit `193 passed / 5.57s`、V1 unit `205 passed / 247.70s`、visual contract `24 passed / 496ms`、V2 unit `427 passed / 13.72s`、PostgreSQL integration `116 passed / 143.95s`、V2 real-stack `13 passed / 1.1m`、V1 E2E `52 passed / 5.5m`、V2 fixture E2E `357 passed / 27 skipped / 0 failed / 4.3m`，三套 production build 与 Compose dev/prod config 均通过。
- 最终 cleanup：Redis DB 14 empty/exclusive，独占 Redis container 已移除；临时 E2E database、storage directory、backend-test container 均为 `0`；`8000/9001/5173/4173/4174/19009/16379` 全部释放。
- 最终 open P0/P1/P2=`0/0/0`，Engineering 与 Phase 6 Exit Gate=`MET`。最终门禁未重跑。
- `trellis-update-spec`/`trellis-break-loop` 将现有响应式重挂载规则补强为：焦点/键盘断言先等待互斥可访问性分支，再重新查询当前节点；`.trellis/` 下不存在对应模板文件，无需模板同步。
