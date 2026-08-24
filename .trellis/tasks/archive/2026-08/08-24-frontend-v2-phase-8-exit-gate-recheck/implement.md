# Frontend V2 Phase 8 Exit Gate Recheck — 执行计划

## 0. 当前状态

- [x] 已通过 `trellis-start` 加载会话、workflow、package/spec 索引。
- [x] Task 已创建为 Phase 8 既有父任务的最后一个 child，并在批准后启动。
- [x] 创建前为 clean `main`，产品候选冻结为 `52da9f45ceb606ed86a7348a4960bf94e63f4c76`。
- [x] A25/A26 实施和归档提交均为候选祖先；无遗留 `codex/frontend-v2-*` 分支/worktree。
- [x] 已读取要求的项目规则、workflow、相关 spec、父 Task、abstraction review/A19/A20/A25/A26、两个 blocker、Phase 7 recheck、`07/08`、Makefile 与 E2E runner/preflight。
- [x] 已创建唯一临时分支，九个独立阶段全部通过，唯一最终 `make verify` 已运行一次且 exit `2`。
- [x] Phase 8 Exit Gate=`NOT_MET`；未修改产品或 `07/08`，未修复、重跑或创建 blocker。

## 执行结果

- 独立阶段：9/9 exit `0`。unit 合计 893 passed；integration 120 passed；E2E 451 passed/33 skipped；三套 build 与两套 Compose config 均通过。
- 独立 E2E：动态 Redis DB 7 preflight 通过；database/Redis/storage/process/ports cleanup 完整。
- 最终 gate：动态 Redis DB 14 preflight 通过；`make verify` 于 `2026-08-24 11:23:17 +0800` 运行唯一一次，26s，exit `2`。
- 最终失败阶段：backend unit，`200 passed / 1 failed`；门禁包装导入的 production/本地 AI HTTP 环境令安全配置测试先命中另一条 validator，且 traceback 触发截断开发连接配置表示的敏感输出边界问题。
- 最终 cleanup：E2E 尚未开始，因此未创建 database/storage/services；Redis DB 14 为空，固定端口 released。
- 正式 open P0/P1/P2=`0/0/0`，但两个 failure owner 等待用户定级；不自动建立 blocker。
- Phase G：`git diff --check`、当前 Task validate、最终 Git 状态检查均 exit `0`；dirty set 只有当前 Task 与父 metadata。

## Phase A — 用户批准后的启动与候选复核

1. 再次确认当前 Task artifacts 与父 child metadata 是唯一 dirty set，`HEAD` 仍为冻结 SHA，主工作区仍无额外 worktree/blocker 分支。
2. 运行：

```bash
python3 ./.trellis/scripts/task.py start \
  frontend-v2-phase-8-exit-gate-recheck
git switch -c codex/frontend-v2-phase-8-exit-gate-recheck
python3 ./.trellis/scripts/task.py set-branch \
  frontend-v2-phase-8-exit-gate-recheck \
  codex/frontend-v2-phase-8-exit-gate-recheck
```

3. 使用 `trellis-before-dev` 重读当前 Task、相关 specs 和 research。
4. 逐项用 `git merge-base --is-ancestor` 复核 `c7d0a2ed`、`3642cb9e`、`73f5807a`、`08592cbc`、`2d2eccf4`。
5. 不 pull、push、PR、commit、merge、历史改写或创建 worktree。

任一候选/dirty/祖先/分支条件不符即停止，不执行验证。

## Phase B — E2E 环境预检

1. 只检查 `.env` 存在，不显示内容。
2. 从当前 `.env` 在进程内取得宿主机可达 PostgreSQL/Redis 基础连接；不写新配置文件，不在命令回显或 evidence 中输出 URL。
3. 使用只读运行时选择器查询 Redis logical DB 范围，动态选取非 0、当前空且无外部客户端的 DB；不固定 7、14、15 或任何历史值。
4. 对选定 URL 运行现有 preflight：

```bash
backend/.venv/bin/python deploy/scripts/e2e-environment.py preflight \
  --redis-url "$REDIS_URL" \
  --storage-port "${PARTSIGNAL_E2E_STORAGE_PORT:-19009}"
```

5. 只记录 Redis DB 编号和 preflight `PASS/FAIL`；不记录 URL/credential。
6. DB 0、非空、外部客户端、固定端口占用或未知 owner 均停止 E2E；不自动清理或终止外部资源。

## Phase C — 九个独立阶段

严格串行，每项各运行一次并立即把脱敏摘要写入 `research/audit.md`：

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make build
make e2e
docker compose --env-file .env \
  -f deploy/compose.dev.yaml \
  config --quiet
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_VERSION=test \
  docker compose --env-file .env \
  -f deploy/compose.prod.yaml \
  config --quiet
```

### 记录字段

- command/stage；
- 北京时间 start/end；
- wall duration；
- exit code；
- backend/V1 visual/V1/V2 unit、integration、V2 real-stack、V1 E2E、V2 fixture 的实际 pass/fail/skip 计数；
- 三套 build 与 Compose config 结果；
- failure owner、是否与候选产品有关、是否环境问题；
- E2E database/Redis/storage/process/ports cleanup 状态。

### 失败规则

- 静态/合同/unit/integration/build/Compose 阶段失败不阻止其他安全独立阶段。
- E2E 失败后，如果 cleanup 完整，继续尚未运行的 Compose config；不重跑 E2E。
- cleanup 未完成、敏感信息回显、未知资源 owner 或外部占用时，停止所有会继续触碰该资源的动作，只完成确认安全的非资源阶段。
- 不改代码、测试、配置或环境修复失败；不以单包命令替代根 stage。
- 任何独立阶段非零时跳到 Phase F，`make verify` 标记 `NOT RUN`。

## Phase D — 唯一最终 `make verify`

执行前再次确认：

- 九个独立阶段 exit `0`；
- E2E cleanup 完整；
- `HEAD` 仍为冻结 SHA；
- dirty set 只含 Task/父 metadata；
- A25/A26 closed，当前开放 actionable P0/P1/P2=`0/0/0`；
- 当前环境仍可由 runner preflight 安全复核。

然后且仅然后运行一次：

```bash
make verify
```

记录开始/结束、总耗时、退出码、全部可见 suite 计数和最终 cleanup。不得在同一候选上第二次运行。

若非零：完成尚未执行且安全的独立诊断（正常情况下 Phase C 已全部完成），写入精确失败阶段/owner/SHA/cleanup，跳到 Phase F；不修复、不重跑、不创建 blocker。

## Phase E — `MET` 文档收口

仅当 Phase D exit `0`：

1. 更新 `docs/frontend-v2/07-migration-plan.md` Phase 8：记录 A25/A26、固定候选、独立阶段、唯一最终 gate、cleanup、open P0/P1/P2=`0/0/0` 和 `MET`；明确未开始 Phase 9。
2. 更新 `docs/frontend-v2/08-testing-quality-and-acceptance.md`：记录实际 suite 计数、退出状态、总耗时、cleanup 与 A20 纠偏。
3. 对敏感边界只写实际 owner：Auth/System sentinel scan、real-stack trace policy、dev-storage `--no-access-log`、GEO pathname/boolean assertion；明确不存在全局 secret scanner。
4. 更新当前 Task acceptance/result/meta 与父任务 `current_gate=MET`、`blocker_count=0`、recheck child 状态；不改归档 review/blocker。
5. 运行 Phase G post-check。

## Phase F — `NOT_MET` 证据收口

若 Phase C/D 任一失败：

1. 当前 Task audit/implement/task metadata 记录候选 SHA、stage、exit code、计数、最小症状、owner、cleanup 和 open P0/P1/P2。
2. 父任务 metadata 记录 recheck=`NOT_MET`、当前 blocker/failure owner 数量；保留 `blocker_count` 的实际值。
3. 不修改 `07/08` 完成状态，不修复失败，不创建 blocker或进入 Phase 9。
4. 运行 Phase G 中仍安全的 docs/Task post-check；最终 gate 若未满足前提则明确记录 `NOT RUN`。

## Phase G — 收尾检查

若最终 `make verify` 已运行，紧接着按用户指定顺序执行：

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate \
  frontend-v2-phase-8-exit-gate-recheck
git status --short --branch
```

若独立阶段已导致 `NOT_MET`、最终 gate 未运行，也在 evidence 收口后执行同样的 Task/docs 检查，但不得误写为最终 gate 后检查。

- 只允许修正当前 docs/Task artifact 的格式、计数转录或 metadata 错误，并只重跑对应 post-check；不重跑 gate。
- 若 post-check 暴露产品/测试/config/runner 变化或无法归属 dirty 文件，停止并保持 `NOT_MET`。
- 自审最终 diff：无产品/测试/合同/config/runner/旧 frontend/归档历史变更，无 secret，无过强安全声明，无 Phase 9 内容。

## Optional / Explicitly Skipped

不运行：

- `make test-deploy-scripts`
- `build-storybook`
- Lighthouse
- staging deploy
- Phase 9 rehearsal / Cutover
- 临时 `playwright-cli`
- 任何归档定向 Workbench/A25/A26 命令的机械重放

原因：本 Task 是固定候选仓库级 Gate；九个独立 root stages 与唯一 `make verify` 已覆盖批准范围。

## Stop Conditions

- 候选 SHA、分支来源或 A25/A26 祖先关系不符。
- 出现未识别/重叠 dirty 文件，或需要修改产品、测试、合同、数据库、配置、runner、依赖、V1。
- Redis DB 0、非空、非独占，固定端口/进程有未知 owner，或需要 broad cleanup。
- 输出/产物出现连接 URL、credential、Cookie、CSRF、headers/body、storage state、完整签名 URL或敏感正文。
- E2E database/Redis/storage/process/port cleanup 任一不完整。
- 任一 required stage/final gate 非零且没有已授权的相关变化支持重跑。
- 需要创建 blocker、进入 Phase 9、archive 父任务、commit/merge/push/PR，而尚未获得后续授权。

## 建议 Commit 范围

### Gate=`MET`

`docs(frontend-v2): close phase 8 exit gate`

- `docs/frontend-v2/07-migration-plan.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/tasks/08-24-frontend-v2-phase-8-exit-gate-recheck/**`
- `.trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/task.json` 中本 recheck gate/child metadata

### Gate=`NOT_MET`

`docs(trellis): record phase 8 exit gate recheck`

- 当前 Recheck Task artifacts
- 父 Task gate/child/failure metadata
- 不包含 `07/08` Phase 8 完成声明

两条路径都只提出实际 commit plan，等待用户确认；不自动 commit、merge、push、PR、删分支、archive 当前/父 Task。
