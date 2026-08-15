# Frontend V2 Phase 6 verify blocker 修复实施计划

## Status

`in_progress`。用户已批准规划；Task 已在唯一授权分支 `codex/frontend-v2-phase6-verify-blockers` 启动。

## 0. Start gate after approval

1. 重新运行 `trellis-start` context，确认本 Task 仍为唯一 active planning Task。
2. 确认主工作区仍基于 `main`、除本 Task planning artifacts 外没有未识别 dirty files；不因 `main` ahead `origin/main` pull 或 push。
3. 确认目标 branch/worktree 仍不存在，然后创建唯一临时分支 `codex/frontend-v2-phase6-verify-blockers`；不创建额外 worktree。
4. 加载 `trellis-before-dev`，完整读取本 Task `prd.md`、`design.md`、`implement.md` 与相关 frontend specs。
5. 运行 `task.py start` 将 Task 从 `planning` 切到 `in_progress`；本会话 inline 实施和检查，不 dispatch implement/check sub-agent。

## 1. Implement the four minimum test-boundary corrections

### 1.1 Global token contract

- [x] 在 `global.test.ts` 中提取 `@media print .geo-insights-print-shell` declaration body。
- [x] 全局 token 唯一性只排除该精确 body，保证任何其它重复仍失败。
- [x] 精确比较 Print override custom properties 及批准值，禁止任意 duplicate allowlist。
- [x] 不修改 `global.css` 或 Print production behavior。

### 1.2 Product Detail

- [x] 使用具名 Product article 作为 `within` 边界。
- [x] 只断言七个 Product Detail level-2 headings；保留主导航 active link、breadcrumb 与 API 单请求断言。
- [x] 不修改 `navigation.ts`、App Shell 或 Product Detail production。

### 1.3 Content Editor

- [x] 在 `内容文档` region 内断言版本差异与 `+当前正文`。
- [x] 保留 Reference panel `Server Diff`，不使用 all-by 查询或位置索引。

### 1.4 Publication Workspace

- [x] 在 `发布内容与操作` region 内断言当前核验失败说明。
- [x] 保留核验历史、Content Task 修正链接和 trigger 焦点恢复断言。

## 2. Required validation

### Layer 1 — exact target tests

四组分开运行并记录 files/tests/counts/duration：

```bash
npm --prefix frontend-v2 run test -- src/styles/global.test.ts
npm --prefix frontend-v2 run test -- src/domains/product/product-detail-page.test.tsx
npm --prefix frontend-v2 run test -- src/domains/content/content-editor-page.test.tsx
npm --prefix frontend-v2 run test -- src/domains/publication/publication-workspace-page.test.tsx
```

任一失败先归因，只在代码或环境发生足以影响结果的变化后重跑对应命令。

### Layer 2 — complete V2 unit

```bash
npm --prefix frontend-v2 run test
```

记录 passed/failed/skipped files、tests 与实际耗时。未通过时不进入最终 `make verify`。

### Layer 3 — static, contract and build

```bash
npm --prefix frontend-v2 run api:check
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run build
make contract-check
git diff --check
```

记录每条退出码与耗时；build warning 如存在必须区分既有 warning 与当前失败。完成测试与静态证据后，先把 `07`、`08` 更新为“前置检查通过、最终候选门禁待运行，Gate 仍为 NOT_MET”的事实状态。

### Layer 4 — one final-candidate `make verify`

先以只读/预检方式确认：

- PostgreSQL source URL 指向本机可创建临时数据库的实例，不回显 credential；
- `redis://127.0.0.1:<独占端口>/14` 仅供本次 gate，preflight 证明 DB 非 0、启动前为空且没有外部客户端/端口冲突；
- E2E 固定端口、临时 storage 与进程 owner 均通过既有 `e2e-environment.py preflight`。

然后只对所有前置检查已通过的最终代码候选运行一次：

```bash
DATABASE_URL='<本机 PostgreSQL source URL>' \
REDIS_URL='redis://127.0.0.1:<独占端口>/14' \
make verify
```

不从 `.env` 批量导出其它变量。记录：

- 总退出码与总耗时；
- contract、lint、typecheck、backend/V1/V2 unit、integration、build、real-stack、V1/V2 E2E、Compose config 的实际 passed/failed/skipped 数量；
- 临时 PostgreSQL database drop；
- Redis 初始/最终 key、queue/unacked/DBSIZE 与精确 cleanup；
- storage removed；
- API、worker、scheduler、fake provider、V1/V2 dev/preview 等进程 wait；
- 六个固定测试端口释放。

`make verify` 后只允许把实际证据抄入 `07`、`08` 和本 Task artifacts，并再次运行 `git diff --check`；这些文档证据更新不改变已验证代码候选。完整门禁失败时不得自动运行第二次。

## 3. Optional validation

当前没有 optional command。原因：计划不修改 Design System primitive/story、production CSS、部署脚本或 E2E orchestration；最终 `make verify` 已覆盖现有完整 E2E。

若实际 diff 越过上述边界，不追加 `build-storybook` 或 deploy check 来掩盖范围变化，而是停止并返回 planning。

## 3.1 Validation progress before final candidate gate

- Layer 1 全部通过：Global `1 file / 33 tests / 290ms`；Product Detail `1 / 7 / 1.58s`；Content Editor `1 / 7 / 1.80s`；Publication Workspace `1 / 5 / 1.08s`。
- Layer 2 全部通过：`73 passed files / 427 passed tests / 12.22s`，无 failed 或 skipped。
- Layer 3 全部退出码 `0`：`api:check`、`typecheck`、`lint`、`build`、`make contract-check`、`git diff --check`。build 仅报告既有 `markdown-editor` chunk 大于 500 kB 的非阻塞 warning。
- 最终候选 `make verify` 已按计划运行一次：退出码 `2`，总耗时 `430.93s`。门禁在 integration 以 `114 passed / 2 failed / 142.21s` 停止，未进入 build、real-stack E2E 或 Compose config。
- 两个新 blocker 均位于本分支零 diff 的 backend integration owner：`test_content_task_detail.py` 的 GEO snapshot 缺当前必填 `optimization_action`；`test_migrations.py` 的 fresh-head 仍期望 `0042`，实际 head 为 `0043`。不在本 Task 扩围修复或重跑完整门禁。
- 失败路径 cleanup 完整：PostgreSQL 临时数据库 `0`、Redis DB 14 `0` key 且独占容器已移除、storage 目录 `0`、固定六端口及 Redis 16379 均释放；E2E 进程因阶段未到达而未启动。
- 四个原 Frontend V2 P2 已关闭，但新增两个 integration P2 仍 open；Phase 6 Exit Gate 保持 `NOT_MET`。

## 4. Documentation and diff review

- [x] 更新 `research/audit.md` 的四个 finding 为实际 closed/open，并记录精确验证。
- [x] 更新 `07`、`08`，不修改归档 Task。
- [x] 核对 `04`、`09`、frontend specs、OpenAPI/generated/database docs 无漂移；本 Task 行为与合同不变，无需更新。
- [x] 检查最终 diff 无 production behavior change、模糊 selector、数组下标、`getAllByText`、任意 duplicate allowlist、helper/abstraction、fallback 或无关清理。
- [x] 确认 `git status --short` 只包含规划列出的文件与 Trellis lifecycle metadata。

## 5. Phase 6 Exit Gate decision

| Category | Required evidence | Planning result |
| --- | --- | --- |
| Product | Phase 6 既有产品能力和页面行为不变 | `MET` |
| Engineering | 四层 required validation，尤其当前候选 `make verify` 完整通过 | `NOT_MET`：integration 2 failed |
| UX / Accessibility | 语义 region、导航、Diff、核验历史与 Print 高对比保持 | `MET` |
| Architecture | 权威 owner 单一，无新抽象、fallback 或第二状态源 | `MET` |
| Contract / Data Integrity | API/generated/database/runtime 无变化或漂移 | `MET` |
| Documentation | `07`、`08`、Task evidence 与最终候选一致 | `MET` |

只有六项全部为 `MET` 且 Phase 6 open P0/P1/P2 为 0，才把 Exit Gate 更新为 `MET`。完整门禁、cleanup 或任一 blocker 未关闭时保持 `NOT_MET`。

## 6. Failure attribution and stop conditions

- 目标/完整 unit 或静态检查出现新失败：先判断当前 diff、环境、既有无关缺陷或 flaky；只修当前四组授权范围内且有证据的 root cause。
- 最终 `make verify` 出现任何失败或 cleanup 不完整：记录精确阶段和 owner，Gate 保持 `NOT_MET`，停止扩大范围，不自动第二次运行完整门禁。
- production、公共 API、数据库、权限、部署、依赖、E2E orchestration或新产品行为成为必要条件：返回 planning 请求新授权。
- 出现与本 Task 重叠的未识别 dirty file、目标 branch/worktree 冲突、Redis 非独占/非空、端口被外部进程占用或 PostgreSQL source 不满足隔离创建条件：不启动最终门禁。
- 不以历史成功、skip、放宽 selector、删除测试或 compatibility fallback 关闭 Gate。

## 7. Commit, archive, fast-forward and branch deletion plan

实施与 required validation 完成后，先展示 findings、精确 changed files/diff、验证/cleanup、Gate 结论和以下候选 commit plan，等待用户确认后才提交：

1. `test(frontend-v2): close phase 6 verify blockers`：四个测试修复、`07/08`、当前 Task evidence 与 lifecycle metadata；只 stage 已识别文件并复核 staged diff。
2. 说明 `task.py archive` 会移动 Task artifacts 并产生 Trellis bookkeeping diff；归档后提交 `chore(task): archive frontend-v2-phase6-verify-blockers`。
3. 若 `trellis-finish-work` 要求 `add_session.py` 写 journal，先说明其会产生 bookkeeping diff，再用独立 `chore: record journal` 提交；不夹入工作代码提交。
4. 全程不 push、不创建 PR；remote branch 不存在。
5. 在主工作区切回 `main`，确认只能 fast-forward 后执行 `git merge --ff-only codex/frontend-v2-phase6-verify-blockers`。
6. 核对归档 Task 和最终提交均已在 `main`，再删除本地临时分支 `codex/frontend-v2-phase6-verify-blockers`；不存在 remote branch，因此无 remote 删除。

若用户最终 commit plan 只批准不同提交拆分，以当时明确批准内容为准。
