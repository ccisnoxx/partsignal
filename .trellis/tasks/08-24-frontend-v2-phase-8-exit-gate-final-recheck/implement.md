# 实施计划

## Phase A — 再次批准后启动

本文件获用户单独批准前，不运行 `task.py start`、不执行门禁、不创建分支、不更新 07/08。

批准后：

1. 运行 `trellis-before-dev`，重读当前 Task、父任务、backend/frontend/infra 相关 spec 与冻结 evidence。
2. 在主工作区直接启动：

```bash
python3 ./.trellis/scripts/task.py start frontend-v2-phase-8-exit-gate-final-recheck
```

3. 项目默认单分支；用户未另行授权时保持 `main`，不创建临时分支/worktree，不 pull、push、PR、commit 或历史改写。
4. 确认：

```bash
test "$(git branch --show-current)" = main
test "$(git rev-parse HEAD)" = 306f70f9ab6c84a2732d7d5aa69001982e2d39ce
git branch --list 'codex/frontend-v2-*'
git worktree list --porcelain
```

5. 用 `git merge-base --is-ancestor` 确认 A27/A28 实施及归档提交为 HEAD 祖先：

```text
deed51ddfc7430db93b4ff7035117c812335a604
ec1effb4d787556a71ee3e5e16b3b29d95aa88b5
0cf6cd18
9c25ed28
a2f13df6
```

6. `git status --short --branch` 只允许当前 Task artifacts 和父任务 metadata；确认 `.env` 存在但不显示内容。
7. 核实父任务 `blocker_count=0`、A25/A26/A27/A28 closed、open P0/P1/P2 当前无已知项。任一条件不符即停止。

## Phase B — 构造安全验证环境

每个根 Make 命令使用同一环境算法，但作为独立子进程执行：

1. 通过项目现有 Python runtime 导入 `dotenv_values()`；不 `source .env`，不使用 `set -a`。
2. 从基础 OS 环境删除 `.env` 中全部键。
3. 仅注入 `DATABASE_URL` 和 `REDIS_URL`，转换为宿主机可访问端点；不打印值。
4. 记录 `.env` 与子进程环境的交集键名恰为上述两个，不记录任何连接字符串。
5. 不创建持久化 helper 或修改 runner。

为独立 `make e2e` 动态选择当前空闲、非 0、独占 Redis logical DB，并先运行现有 preflight。不得硬编码或复用历史编号；preflight 非零则不运行 E2E。

## Phase C — 九个独立阶段

从仓库根目录严格按下列顺序，各运行一次并记录 wall-clock 开始/结束、耗时、exit code、suite pass/fail/skip 计数与 owner：

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

执行约束：

1. 前七个 Make stages 使用 Phase B 的两键子进程环境；Compose 仍使用显式 `--env-file .env`，prod 只增加两个既有非 secret 变量。
2. 阶段串行执行，不并发争用 Docker、database、Redis、storage 或固定端口。
3. 阶段失败后仍完成尚未执行且安全独立的阶段；若出现未知 owner、敏感输出、preflight/cleanup 问题或候选变化，则停止可能扩大影响的命令。
4. 代码、配置或环境未发生与失败相关的变化时，不重复运行同一失败命令。
5. 不运行 A25/A26/A27/A28 的历史 targeted 命令；完整 stages 是最终集成证据。
6. `make e2e` 只使用现有 runner；不额外启用 trace/video，不创建 playwright-cli session。
7. E2E 后据实记录：临时 database 是否 drop、Redis 本轮 keys 是否精确删除且 DB empty、storage 是否移除、服务进程是否 stop/wait、runner 实际列出的固定端口是否释放。
8. 输出审查只记录 owner、状态、计数和脱敏症状；不写入 password、Cookie、CSRF、Authorization、URL、header/body、storage state、签名 URL或敏感正文。

任一独立阶段非零或不能安全运行：继续完成其余安全阶段后跳到 Phase F，最终 `make verify` 标记 `NOT RUN`。

## Phase D — 唯一最终 Gate 前置判断

只有以下条件全部满足才继续：

- 九个独立阶段均 exit 0；
- 独立 E2E cleanup 完整；
- candidate HEAD 和 dirty allowlist 未变化；
- A25/A26/A27/A28 closed，blocker_count=0，open P0/P1/P2=`0/0/0`；
- 未发现敏感输出，且候选基于独立结果合理预期通过；
- 本 Task 中 `make verify` 执行计数仍为 0。

随后重新动态选择一个与独立 E2E 不同、当前空闲、非 0、独占的 Redis logical DB，通过现有 preflight，并重建相同两键 allowlist 环境。任一前置条件失败即跳到 Phase F。

## Phase E — 唯一一次最终 Gate

在相同固定候选上运行且只运行一次：

```bash
make verify
```

记录总耗时、exit code、每个可见 suite 的 pass/fail/skip 计数、失败阶段 owner，以及 database、Redis、storage、进程和端口 cleanup。

若 exit 非 0：

- 完成尚未执行且安全的独立诊断；正常情况下 Phase C 已全部完成；
- Gate=`NOT_MET`，不修复、不立即重跑 `make verify`；
- 不自动创建 blocker Task 或重复 gate 循环；
- 记录候选、精确失败阶段、owner、cleanup 与敏感输出审查，等待用户决定。

## Phase F — Gate 判定与文档分流

严格应用 `design.md` 判定算法。

### MET 路径

仅当最终 gate exit 0：

1. 更新 `docs/frontend-v2/07-migration-plan.md` Phase 8，记录固定候选、九阶段结果、实际 suite 计数、各阶段退出状态、最终 `make verify` 总耗时、cleanup、open P0/P1/P2、A25/A26/A27/A28 closed、Exit Gate=`MET`，并明确未开始 Phase 9。
2. 更新 `docs/frontend-v2/08-testing-quality-and-acceptance.md` 的 Phase 8 验收证据，按实际 owner 描述敏感信息保证，明确不存在全局 scanner 声明。
3. 更新当前 Task evidence 与父任务 gate/child metadata；父任务保持未归档。
4. 不修改任何归档任务的首次 `NOT_MET` 结论。

### NOT_MET 路径

1. 不修改 07/08 的 Phase 8 完成状态。
2. 只在当前 Task evidence 与父任务 metadata 记录失败、owner、cleanup、open severity、最终 gate 的 `NOT RUN` 或实际 exit code。
3. 不创建修复、不开始 blocker 或 Phase 9。

## Phase G — 收尾验证

完成对应 evidence/docs 修改后运行：

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate \
  frontend-v2-phase-8-exit-gate-final-recheck
git status --short --branch
```

再使用 `trellis-check` 做只读自审：

- HEAD 仍为固定产品候选；
- diff 仅含成功/失败路径允许的 docs 与 Trellis evidence；
- 每个命令执行次数、退出码、suite 计数、耗时、cleanup、open severity 与 Gate 一致；
- 没有产品、测试、合同、配置、runner、旧 `frontend/` 修改；
- 没有敏感值、trace/video、storage state、夸大的 scanner 声明或未归因失败；
- 未 commit、push、PR、归档父任务或开始 Phase 9。

## Optional / Explicitly Skipped

- 不运行 `make test-deploy-scripts`、build-storybook、Lighthouse、staging deploy、Phase 9 rehearsal 或 Cutover。
- 不创建临时 playwright-cli 流程；现有 Playwright Test runner 已覆盖本 gate。
- 不重复 A25/A26/A27/A28 targeted checks，也不因仅修改 Markdown/Trellis evidence 再跑 gate。

## Commit 计划与停止点

完成验证和收尾自审后停止并报告；不自动提交、推送、创建 PR 或归档父任务。

- `MET` 建议：`docs(frontend-v2): close phase 8 exit gate`，只暂存 07/08、当前 Task artifacts 与父任务 metadata。
- `NOT_MET` 建议：`docs(trellis): record phase 8 final recheck`，只暂存当前 Task artifacts 与父任务 metadata，07/08 不进入提交。

提交前展示精确 diff/文件清单并等待用户批准。即使当前 Task 后续获准归档，Phase 8 父任务也必须保持未归档，直到用户另行批准。

## 执行结果

- [x] 固定候选、祖先、分支、worktree、dirty allowlist 与 A25/A26/A27/A28 状态检查通过。
- [x] 九个独立阶段严格串行且各运行一次；八项 exit `0`，`make e2e` exit `2`。
- [x] 独立 E2E 使用本轮实时动态选择的非 0 logical DB 并通过 preflight；cleanup 对 database、Redis、storage、服务进程和固定端口全部完成。
- [x] E2E 失败归因到 V1 Playwright 删除菜单 strict selector；Celery lifecycle 输出另有 Redis 连接值回显 owner。未修改或重跑失败阶段。
- [x] 因独立阶段未全绿且存在敏感输出 owner，最终 `make verify`=`NOT RUN`，执行次数 `0`。
- [x] Phase 8 Exit Gate=`NOT_MET`；07/08 未修改，未创建 blocker、未开始 Phase 9。

建议 commit 保持失败路径：`docs(trellis): record phase 8 final recheck`，仅包含当前 Task artifacts 与父任务 metadata。
