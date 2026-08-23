# 实施计划

## Phase A — 批准后启动与候选冻结

1. 用户批准本计划后才运行：

```bash
python3 ./.trellis/scripts/task.py start 08-17-frontend-v2-phase-7-exit-gate-recheck
```

2. 继续使用本地主工作区 `main`，不创建分支/worktree，不 pull/push/PR。
3. 用 `trellis-before-dev` 重读本 Task artifacts、父 Task evidence、Frontend quality 与 E2E isolation spec。
4. 确认 `HEAD` 仍为已批准候选，且下列提交全部为祖先：

```bash
for commit in ab748d02 9feffdc5 b4c02fb0 79cce8ce 24cc8f81; do
  git merge-base --is-ancestor "$commit" HEAD
done
```

5. `git status --short --branch` 只能包含当前 Task artifacts 与父任务 child link；不得出现产品、测试、runner、合同或无关 dirty 文件。
6. 只确认 `.env` 存在，不显示其内容；运行 E2E 时服从既有 preflight，不接管未知端口/进程/Redis/database/storage。

## Phase B — 独立诊断阶段

从仓库根目录依次运行下列同一 Make owner stages，并记录 exit code、pass/fail/skip 计数与实际耗时：

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make build
make e2e
docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_VERSION=test \
  docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet
```

执行规则：

1. 阶段按顺序独立执行，避免 npm cache、Docker image、Compose 与固定端口并发争用。
2. 一个阶段失败后仍执行不依赖该失败且环境安全的其他阶段，集中发现 blocker；未知 owner、敏感泄漏或 cleanup 失败除外。
3. 不修改代码/测试/配置来修复失败，不重复运行未受相关变化影响的命令。
4. 不运行四个 blocker 的定向命令；完整 stage 已覆盖其最终集成结果。
5. `make e2e` 必须观察 V2 real-stack、V1 E2E、V2 fixture E2E 的结果，以及 database `status=dropped`、storage `status=removed`、Redis `status=deleted`、port `status=released`；不把 credential 或请求正文写入 Task。

若任一阶段非零或无法安全运行：完成仍安全的独立阶段后跳到 Phase E，最终 gate 标记 `NOT RUN`。

## Phase C — 唯一最终 Gate

只有 Phase B 全部退出 `0`、cleanup 无残留且没有 open P0/P1/P2 时运行一次：

```bash
make verify
```

规则：

- 记录命令开始/结束、总耗时、exit code、每个 stage 的可见计数和最终 cleanup。
- 不在同一 candidate 上第二次运行；意外失败即判 `NOT_MET`。
- 若最终 gate 触发新的 failure，独立阶段已覆盖所有下游 stage，不再机械追加一轮完整诊断。

## Phase D — 成功路径文档收口

仅当 `make verify` exit `0`：

1. 更新 `docs/frontend-v2/07-migration-plan.md` 的 Phase 7，追加 System abstraction review、四 blocker closeout、唯一最终 gate 与 `MET`；明确未开始 Phase 8。
2. 更新 `docs/frontend-v2/08-testing-quality-and-acceptance.md`，新增 System abstraction review / Phase 7 Exit Gate 小节，记录实际 suite 计数、耗时、cleanup 和 open P0/P1/P2=`0/0/0`。
3. 在父 Task 的 PRD/audit/implement/task metadata 追加 Recheck 后续证据；保留最初 `NOT_MET` 过程，不改写归档任务。
4. 更新当前 Task 的 PRD acceptance、audit、implement result 与 task metadata。
5. 不修改 01/04/05/06/09、spec、contracts、代码或测试。

## Phase E — 失败路径证据收口

若 Phase B/C 任一失败：

1. 当前 Task audit/implement 记录 stage、exit code、最小症状、owner、cleanup 与 Gate `NOT_MET`。
2. 父 Task 只追加 Recheck 结果和未关闭 blocker 数；不擦除原审计记录。
3. 不把 07/08 更新为 `MET`，不修复失败，不启动 blocker。

## Required Validation — 收尾

完成对应成功/失败 evidence 后运行：

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate 08-17-frontend-v2-phase-7-exit-gate-recheck
python3 ./.trellis/scripts/task.py validate 08-17-frontend-v2-system-abstraction-review
git status --short --branch
```

再用 `trellis-check` 自审：

- diff 只有允许的 docs/Trellis evidence，没有产品、测试、runner、合同或旧 `frontend/` 修改；
- 实际命令、计数、耗时、cleanup、Gate 判定与文档一致；
- 没有 secret、完整 headers/body、trace/video/screenshot/storage state 路径进入文档；
- 没有重跑、弱化断言、silent fallback、第二 orchestration 或顺手修复。

## Optional / Deferred Validation

- 不运行 `make test-deploy-scripts`：本 Task 不改 staging deploy，完整默认 E2E runner已由 `make e2e` 与 `make verify` 覆盖。
- 不运行 Storybook、临时浏览器 walkthrough、Lighthouse、staging deploy 或任何 Phase 8/9 检查。
- 不在 Gate 后因仅修改 Markdown/Trellis evidence 而第二次运行 `make verify`。

## Commit 与归档停止点

完成验证和自审后停止并报告，不自动 commit/archive/push/PR。

- 成功候选提交：`docs(frontend-v2): close phase 7 exit gate`，只含 07/08、当前 Task artifacts 与父 Task 后续 evidence。
- 失败候选提交：`docs(trellis): record phase 7 recheck blockers`，默认只含当前/父 Task evidence，不把 07/08 标为 `MET`。
- 用户批准结果提交后，再单独说明 `task.py archive` 可能产生的 Trellis bookkeeping 变更，并等待归档确认；仍不开始 Phase 8。

## 实际执行结果

### 候选与独立诊断

- 分支保持 `main`，候选 HEAD 固定为 `24cc8f81e12247705b59eb3ade4a2cbbdb049d2c`；五个要求提交均为其祖先。
- `make contract-check`、`make lint`、`make typecheck`、`make test-unit`、`make test-integration`、`make build`、`make e2e` 与 dev/prod Compose config 均退出 `0`。
- 独立 unit：backend `201 passed / 6.45s`，V1 `205 passed / 255.55s`，visual contract `24 passed / 525ms`，V2 `457 passed / 16.06s`。
- 独立 integration：`117 passed / 146.54s`。三套 production build 通过。
- 独立 E2E：V2 real-stack `16 passed`，V1 `52 passed / 5.5m`，V2 fixture `379 passed / 33 skipped / 4.6m`；Redis DB 14、临时数据库、临时 storage 与六个固定端口完成精确 cleanup。

### 唯一最终 Gate

仅在独立阶段全绿后运行一次 `make verify`；退出码 `0`，总耗时 `19:23.64`。backend unit `201 passed / 6.35s`、V1 unit `205 passed / 254.86s`、visual contract `24 passed`、V2 unit `457 passed / 15.48s`、integration `117 passed / 144.91s`、V2 real-stack `16 passed / 1.2m`、V1 E2E `52 passed / 5.5m`、V2 fixture `379 passed / 33 skipped / 4.6m`，三套 build 与双 Compose config 全部通过。最终 cleanup 同样完成。

### Exit Gate

八项 System shared invariant 无新反证，open P0/P1/P2=`0/0/0`，Phase 7 Exit Gate=`MET`。未修改产品代码、测试、合同、runner、spec 或旧 `frontend/`；未 commit、archive、push、创建 PR 或开始 Phase 8。

收尾时两个 Trellis task validation 均通过。全量 `git diff --check` 只命中任务启动前已识别并保留的 `AGENTS.md` 与 07 文档 EOF 空行；排除这两个既有 hunk 后，Task/docs 差异的 whitespace check 通过。提交时必须选择性暂存 07 的 Phase 7 hunk并排除其 EOF 空行，`AGENTS.md` 整体不进入提交。
