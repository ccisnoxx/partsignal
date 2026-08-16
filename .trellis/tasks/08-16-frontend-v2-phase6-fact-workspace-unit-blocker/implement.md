# Frontend V2 Phase 6 Fact Workspace unit blocker 实施计划

## Status

`implemented`。Required validation 与唯一最终候选门禁已完成，等待提交确认。

## 0. Start gate after approval

1. 确认 `main`、Task、branch/worktree 和 dirty state；不因 ahead `origin/main` pull 或 push。
2. 创建并切换唯一临时分支 `codex/frontend-v2-phase6-fact-workspace-unit-blocker`，不创建额外 worktree。
3. 使用 `trellis-before-dev` 复核本 Task 三份规划及 frontend state/quality/component specs。
4. 运行 `task.py start`，Task 从 `planning` 进入 `in_progress`。

## 1. Minimum implementation

### 1.1 Fact Workspace tests

- [x] revision conflict 用例不再缓存 CodeMirror DOM `textContent`。
- [x] 用现有公开表面精确证明本地正文、dirty、request ID 和 explicit reload canonical adoption。
- [x] background refetch failure 用例用同一稳定边界证明 dirty 草稿保留。

### 1.2 MarkdownEditor test

- [x] readonly toggle 先确认输入已进入 controlled value，再证明切换后 exact value 与 readonly 状态保持。
- [x] 不新增 helper、test ID、production accessor、sleep 或 retry。

### 1.3 Stable spec

- [x] 在 frontend quality spec 的 jsdom section 记录 CodeMirror controlled-value assertion boundary。

## 2. Required validation

### Layer 1 — exact owner tests

两个文件分别运行并记录 files/tests/counts/duration：

```bash
npm --prefix frontend-v2 run test -- src/design-system/editor/markdown-editor.test.tsx
npm --prefix frontend-v2 run test -- src/domains/product/fact-workspace-page.test.tsx
```

### Layer 2 — complete V2 unit

```bash
npm --prefix frontend-v2 run test
```

必须记录 passed/failed/skipped files、tests 与耗时；未通过时不进入最终门禁。

### Layer 3 — API, static, build and diff

```bash
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
make contract-check
git diff --check
```

完成后先更新 `07/08` 为“B-03 已关闭、最终候选门禁待运行”，Gate 保持 `NOT_MET`。

### Layer 4 — one final-candidate gate

只读确认本机 PostgreSQL source 可隔离建库，Redis 使用本 Task 独占端口的 DB 14 且为空，E2E 固定端口和 storage owner 通过既有 preflight。不得回显 credential或批量导出 `.env`。

全部前置检查通过后只运行一次：

```bash
DATABASE_URL='<本机 PostgreSQL source URL>' \
REDIS_URL='redis://127.0.0.1:<独占端口>/14' \
make verify
```

记录总退出码/耗时，以及 contract、lint/typecheck、backend/V1/V2 unit、integration、build、real-stack、V1/V2 E2E、Compose config 的实际 passed/failed/skipped 数量。记录 PostgreSQL、Redis queue/unacked/DBSIZE、storage、process/container 和全部固定端口 cleanup。完整门禁后只允许更新实际证据并再次运行 diff check；失败时不自动第二次运行。

## 3. Optional validation

无。计划不修改 production；完整 V2 unit 与最终 `make verify` 已覆盖现有 Fact Workspace production-artifact E2E，不再单独重复整套 Playwright。

## 4. Documentation and review

- 更新 Task research、frontend quality spec、`07`、`08`；不修改已归档 Task。
- diff 自审拒绝 production change、弱断言、sleep、DOM implementation selector、helper/abstraction 和无关清理。
- 运行 `trellis-check`、Task validation 与最终 `git diff --check`。

### 4.1 Final-candidate result

- Fact Workspace 原 P2 已关闭，目标 tests、完整 V2 unit、API/static/build/contract/diff 均通过。
- 唯一 `make verify` 退出 `2`、耗时 `1148.07s`；通过至 V1 E2E，V2 fixture E2E 为 `355 passed / 27 skipped / 2 failed / 4.5m`。
- 两个失败来自同一未改动 GEO Insights Reset 时间敏感期望；root owner 为 `frontend-v2/tests/e2e/geo-insights.spec.ts`，与本 Task diff 无因果关系。
- PostgreSQL、Redis DB 14、container、storage、process 与固定端口 cleanup 完整；Phase 6 Gate 保持 `NOT_MET`，open P0/P1/P2=`0/0/1`。

## 5. Stop conditions

- 证据要求修改 production/API/database/permission/deployment/dependency 时，返回 planning 请求新授权。
- 目标测试或完整 V2 suite 出现不同 root cause，先归因；只修本 Task 三处同根 owner。
- 最终 `make verify` 出现无因果关系的新 blocker 或 cleanup 不完整时，Gate 保持 `NOT_MET`，停止扩围且不自动重跑。
- 出现未识别 dirty file、branch/worktree 冲突、PostgreSQL/Redis/端口无法独占时，不启动最终门禁。

## 6. Commit and lifecycle plan

实施与验证完成后，先报告精确 diff、counts/duration、cleanup 和 Gate 结论，并给出候选 commit plan；未经确认不提交：

1. 工作提交：`test(frontend-v2): stabilize Fact Workspace conflict coverage`。
2. 获得收尾授权后归档 Task，并独立提交 Trellis bookkeeping 与 journal。
3. 不 push、不创建 PR；切回 `main` 后只做 `git merge --ff-only codex/frontend-v2-phase6-fact-workspace-unit-blocker`。
4. 确认提交和归档均在 `main` 后删除本地临时分支；remote branch 不存在。
