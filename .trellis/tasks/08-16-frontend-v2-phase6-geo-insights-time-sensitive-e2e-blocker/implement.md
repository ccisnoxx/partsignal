# Frontend V2 Phase 6 GEO Insights 时间敏感 E2E blocker 实施计划

## Status

`in_progress`。实施与 Required validation 已完成，最终候选的新无关 blocker 已归因，等待提交确认。

## 0. Start gate after approval

1. 确认 `main`、Task、branch/worktree 和 dirty state；不因 ahead `origin/main` pull 或 push。
2. 创建并切换唯一临时分支 `codex/frontend-v2-phase6-geo-insights-time-sensitive-e2e-blocker`，不创建额外 worktree。
3. 使用 `trellis-before-dev` 复核本 Task 三份规划及 frontend quality/state specs。
4. 运行 `task.py start`，Task 从 `planning` 进入 `in_progress`。

## 1. Minimum implementation

### 1.1 Fixture E2E

- [x] 在 Reset/history 场景首次导航前，以 `insights.generated_at` 调用 `page.clock.setFixedTime()`。
- [x] 保留现有 exact canonical、platform filter、Reset 与 back/forward 断言。
- [x] 不新增 helper、常量、sleep、retry、模糊 selector 或 production change。

### 1.2 Stable spec

- [x] 在 frontend quality spec 记录固定日期 fixture 与 browser clock 的测试边界。

### 1.3 Gate documentation

- [x] 前置验证后更新 `07/08` 为 blocker 已关闭、最终候选待运行，Gate 保持 `NOT_MET`。
- [x] 最终门禁后只按实际结果更新 Gate、counts、duration 与 cleanup。

## 2. Required validation

### Layer 1 — exact failing scenario

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/geo-insights.spec.ts --grep "筛选写回 canonical URL，reset 与浏览器历史恢复"
```

预期两个 project 均通过：`2 passed / 0 failed`。

### Layer 2 — complete GEO Insights fixture spec

```bash
npm --prefix frontend-v2 run e2e -- tests/e2e/geo-insights.spec.ts
```

预期 `16 passed / 0 failed / 0 skipped`。两次 Playwright 命令均通过既有 webServer 运行 production build，记录 build 结果与既有 warning。

### Layer 3 — static, planning and diff

```bash
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
python3 .trellis/scripts/task.py validate .trellis/tasks/08-16-frontend-v2-phase6-geo-insights-time-sensitive-e2e-blocker
git diff --check
```

本 Task 不改变 generated API、contract 或 unit production owner，因此不在最终门禁前额外重复 `api:check`、`contract-check`、完整 V2 unit 或独立 build；最终 `make verify` 会覆盖它们。

### Layer 4 — one final-candidate gate

只读确认本机 PostgreSQL source 可隔离建库，Redis 使用本 Task 独占端口的 DB 14 且为空，E2E 固定端口和 storage/process owner 通过既有 preflight。不得回显 credential 或批量导出 `.env`。

全部前置检查通过后只运行一次：

```bash
DATABASE_URL='<本机 PostgreSQL source URL>' \
REDIS_URL='redis://127.0.0.1:<独占端口>/14' \
make verify
```

记录总退出码/耗时，以及 contract、lint/typecheck、backend/V1/V2 unit、integration、build、real-stack、V1/V2 E2E、Compose config 的实际 passed/failed/skipped 数量。记录 PostgreSQL、Redis queue/unacked/DBSIZE、storage、process/container 和全部固定端口 cleanup。完整门禁后只允许更新实际证据并再次运行 Task validation 与 diff check；失败时不自动第二次运行。

## 3. Optional validation

无。目标 spec 已覆盖唯一变更边界，最终 `make verify` 是用户要求的 release gate；在此前重复整套 V2 unit、contract 或全量 E2E 只会增加时间而不提高本 Task 的归因证据。

## 4. Documentation and review

- 更新 Task research、frontend quality spec、`07`、`08`；不修改已归档 Task。
- diff 自审拒绝 production change、动态 URL 期望、弱断言、sleep、helper/abstraction 和无关清理。
- 运行 `trellis-check`、Task validation 与最终 `git diff --check`。

## 5. Phase 6 gate update condition

- 当前 blocker 关闭且最终 `make verify` 退出 `0`、所有阶段完整、cleanup 完整、open P0/P1/P2=`0/0/0`：将 Engineering 与 Phase 6 Exit Gate 从 `NOT_MET` 更新为 `MET`。
- 最终门禁出现新的无关 blocker：记录 owner、证据和 cleanup，Gate 保持 `NOT_MET`；不扩围、不自动重跑。

## 6. Stop conditions

- 证据要求修改 production/API/database/permission/deployment/dependency 时，返回 planning 请求新授权。
- Playwright Clock 影响 timer、路由或其它行为，导致目标场景出现不同 root cause 时停止并重新归因。
- 出现未识别 dirty file、branch/worktree 冲突、PostgreSQL/Redis/端口无法独占时，不启动最终门禁。
- 最终门禁出现与本 Task diff 无因果关系的新 blocker 或 cleanup 不完整时，停止扩围且不自动重跑。

## 7. Commit and lifecycle plan

实施与验证完成后，先报告精确 diff、counts/duration、cleanup 和 Gate 结论，并给出候选 commit plan；未经确认不提交：

1. 工作提交：`test(frontend-v2): stabilize GEO Insights fixture time`。
2. 获得收尾授权后归档 Task，并独立提交 Trellis bookkeeping 与 journal。
3. 不 push、不创建 PR；切回 `main` 后只做 `git merge --ff-only codex/frontend-v2-phase6-geo-insights-time-sensitive-e2e-blocker`。
4. 确认提交和归档均在 `main` 后删除本地临时分支；remote branch 不存在。
