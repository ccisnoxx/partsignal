# 实施计划

## Phase A — 单独批准后启动

本文件获用户明确批准前，不运行 `task.py start`、门禁、分支创建或 07/08 更新。

批准后：

1. 使用 `trellis-before-dev` 重读当前 Task、父任务、backend/frontend/infra spec、A25–A30 与历史 recheck evidence。
2. 在主工作区执行：

```bash
python3 ./.trellis/scripts/task.py start \
  frontend-v2-phase-8-exit-gate-post-blocker-recheck
```

3. 保持单分支 `main`；不创建分支/worktree，不 pull、push、PR、commit 或历史改写。
4. 确认 HEAD 仍为 `3c93e8b2d164f57b2ef253bad010bb9e0e1d7403`；dirty set 只包含当前 Task 与父 metadata。
5. 确认无 `codex/frontend-v2-*` 分支、无额外 worktree，且以下 closing commits 均为 HEAD 祖先：

```text
c7d0a2ed  A25 implementation
3642cb9e  A25 archive
73f5807a  A26 implementation
08592cbc  A26 archive
deed51dd  A27 closeout
9c25ed28  A27 archive
ec1effb4  A28 implementation
a2f13df6  A28 archive
71e1e8bb  A29 implementation/closeout
3c93e8b2  A30 implementation/closeout
```

6. 核实 A25–A30 closed、父 `blocker_count=0`、active blockers 为空、已知 open P0/P1/P2=`0/0/0`；只确认 `.env` 存在，不显示内容。

任一条件不符即停止，不执行阶段命令。

## Phase B — 安全验证环境

每个根 Make 命令作为独立子进程，使用同一算法：

1. 用 backend 已安装的 `dotenv_values()` 在内存读取 `.env`，不 `source` 或 `set -a`。
2. 从基础环境删除 `.env` 中全部键，仅加入宿主机可访问的 `DATABASE_URL`、`REDIS_URL`。
3. 只记录环境交集键名，不记录值；不创建持久化 helper/raw log。
4. 独立 E2E 实时选择空闲、非 0、独占 Redis DB，先运行现有 preflight；不得硬编码、沿用历史编号或清理外部 owner。
5. 原始 stdout/stderr 仅在当前进程内审查；面向 evidence 只输出脱敏阶段摘要、suite 计数、敏感类别计数与 cleanup。

## Phase C — 九个独立阶段

从仓库根目录严格按下列顺序，各运行一次：

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

每项记录 wall-clock 开始/结束、耗时、exit code、实际 pass/fail/skip 计数或不适用说明和 owner。

执行规则：

1. 前七项使用 Phase B 两键环境；Compose config 使用显式 `.env`，prod 只增加两个既有非 secret 变量。
2. 阶段串行执行；一个阶段失败后继续尚未执行且安全独立的阶段。
3. 代码、配置或环境没有相关变化时，不重复运行失败命令。
4. 不运行 A25–A30 targeted 命令；本轮完整阶段是同一候选的集成证据。
5. `make e2e` 只用现有 runner；不启用额外 trace/video，不创建 playwright-cli session。
6. E2E 后记录 database dropped、Redis allowlist cleanup/empty/external clients、storage removed、服务 stop/wait 与 `8000/9001/5173/4173/4174/19009` 释放状态。
7. 输出审查必须确认 A30 所属 Redis URI/connection/broker 类别为 `0`，并据实记录其他敏感类别；不打印匹配值。

任一独立阶段非零或不能安全运行：完成其他安全阶段后跳到 Phase F，最终 `make verify=NOT RUN`。

## Phase D — 唯一最终 Gate 前置判断

只有以下条件全部满足才继续：

- 九阶段 exit 均为 `0`，独立 E2E cleanup 完整；
- candidate HEAD 与 dirty allowlist 未变化；
- A25–A30 closed、blocker_count=0、open P0/P1/P2=`0/0/0`；
- 未发现敏感输出或未归因失败；
- 本 Task 中 `make verify` 执行次数仍为 `0`。

随后实时选择一个与独立 E2E 不同、当前空闲的非 0 独占 Redis DB，通过现有 preflight，并重建相同两键环境。任一前置失败即跳到 Phase F。

## Phase E — 唯一一次最终 Gate

在相同固定候选上运行且只运行一次：

```bash
make verify
```

记录总耗时、exit code、每个可见 suite 的 pass/fail/skip 计数、失败阶段 owner、敏感类别计数与 database/Redis/storage/process/ports cleanup。

若非零：执行次数保持 `1`；不修复、不立即重跑、不自动创建 blocker。独立阶段已完成，除安全状态复核外不追加第二轮完整诊断。

## Phase F — Gate 与文档分流

严格应用 `design.md` 判定算法。

### MET

1. 更新 `docs/frontend-v2/07-migration-plan.md` Phase 8：记录固定候选、A25–A30 closed、九阶段结果/计数、最终 `make verify` 耗时/exit、cleanup、open P0/P1/P2、Gate=`MET`，并明确未开始 Phase 9。
2. 更新 `docs/frontend-v2/08-testing-quality-and-acceptance.md` Phase 8 验收证据；敏感保证只列实际 owner 并明确无全局 scanner。
3. 更新当前 Task evidence 与父 gate/child metadata；不归档父任务，不修改历史归档结论。

### NOT_MET

1. 不修改 07/08 的 Phase 8 完成状态。
2. 只在当前 evidence 与父 metadata 记录实际失败、owner、cleanup、候选、open severity 与 stop reason。
3. 不修复或创建 blocker，等待用户决定。

## Required Validation — 收尾

最终 Gate 后执行：

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate \
  frontend-v2-phase-8-exit-gate-post-blocker-recheck
python3 -m json.tool \
  .trellis/tasks/08-23-frontend-v2-phase-8-workbench-planning/task.json >/dev/null
git status --short --branch
```

再用 `trellis-check` 核对：

- diff 只含对应 MET/NOT_MET 允许范围；
- 实际命令、执行次数、计数、耗时、cleanup、敏感类别和 Gate 一致；
- 无 secret、URL、header/body、trace/video/storage state 或敏感正文进入 evidence；
- 无重跑、silent fallback、第二 runner、顺手修复或历史结论改写。

## Explicitly Skipped

- 不运行 A25–A30 targeted checks、`make test-deploy-scripts`、Storybook、Lighthouse、staging deploy、Phase 9 rehearsal 或 Cutover。
- 不修改产品、测试、合同、配置、Makefile、runner 或旧 `frontend/`。
- Gate 后不因仅修改 Markdown/Trellis evidence 而第二次运行 `make verify`。
- 不自动 commit、push、PR、archive 或归档父任务。

## Commit 停止点

- `MET`：建议 `docs(frontend-v2): close phase 8 exit gate`，只含 07/08、当前 Task artifacts、父 metadata。
- `NOT_MET`：建议 `docs(trellis): record phase 8 post-blocker recheck`，只含当前 Task artifacts、父 metadata。

完成后报告 diff 与对应 commit plan，等待用户批准。

## 执行证据

### 1. 候选与前置条件

- 固定候选始终为 `3c93e8b2d164f57b2ef253bad010bb9e0e1d7403`，分支为 `main`；dirty set 只含当前 Task、父 metadata，以及 Gate=`MET` 后允许的 07/08。
- 没有遗留 `codex/frontend-v2-*` 分支或额外 worktree；A25–A30 closing commits 均为候选祖先，A25–A30 全部 closed。
- 父任务 `blocker_count=0`、active blockers 为空，本轮 open P0/P1/P2=`0/0/0`。
- 前七个独立 Make 阶段和最终 Gate 均使用两键子进程环境，`.env` 交集精确为 `DATABASE_URL,REDIS_URL`，没有记录连接值。

### 2. 九个独立阶段

| 阶段 | 时间（+08:00） | 耗时 | exit | 实际结果 |
| --- | --- | ---: | ---: | --- |
| `make contract-check` | 15:05:32–15:05:34 | 2.275s | 0 | backend contract 与 V1/V2 generated drift 检查通过；suite 计数不适用 |
| `make lint` | 15:05:49–15:05:58 | 9.234s | 0 | backend Ruff 与 V1/V2 lint 通过；suite 计数不适用 |
| `make typecheck` | 15:06:15–15:06:23 | 7.915s | 0 | backend mypy `80 source files`、V1/V2 typecheck 通过 |
| `make test-unit` | 15:07:12–15:11:32 | 260.219s | 0 | V1 Vitest `205 passed`、V2 Vitest `463 passed`；已保留摘要中的 suite 合计 `0 failed / 0 skipped`；backend pytest 与 V1 visual contract 通过，但本轮内存摘要未保留这两个 suite 的数字，明确记为 unavailable，不从历史值推断 |
| `make test-integration` | 15:13:03–15:15:33 | 150.100s | 0 | backend `120 passed / 0 failed / 0 skipped` |
| `make build` | 15:15:48–15:16:08 | 19.440s | 0 | backend/frontend Docker image 与 V2 production build 通过；suite 计数不适用 |
| `make e2e` | 15:17:49–15:30:09 | 740.577s | 0 | V2 real-stack `16 passed`；V1 `52 passed`；V2 fixture `383 passed / 33 skipped`；`0 failed` |
| dev Compose config | 15:30:39 | 0.089s | 0 | `config --quiet` 通过；suite 计数不适用 |
| prod Compose config | 15:30:51 | 0.037s | 0 | `config --quiet` 通过；suite 计数不适用 |

九阶段严格串行且各运行一次，没有失败或重跑。独立 E2E 使用实时动态选择的非 0 独占 Redis DB `7`，现有 preflight exit `0`、耗时 `0.065s`。Cleanup 证明 database dropped、Redis allowlist cleanup 完成且最终为空/外部客户端 `0`、storage removed、runner 完成服务 stop/wait，端口 `8000/9001/5173/4173/4174/19009` 全部 released。

### 3. 唯一最终 Gate

最终选择阶段先只读拒绝有既存键的 DB `1`–`13`（排除独立运行使用的 DB `7`），没有创建或清理资源；扩展到全部可用非 0 logical DB 后动态选择空闲、无外部客户端的 DB `14`。现有 preflight 只运行一次并 exit `0`、耗时 `0.068s`，与独立 E2E 的 DB 不同。

`make verify` 于 `15:33:30`–`15:53:11 +08:00` 恰好运行一次，exit `0`，总耗时 `1180.905s`：

- backend unit `204 passed`，V1 Vitest `205 passed`，V2 Vitest `463 passed`，backend integration `120 passed`；V1 visual contract 通过但内存摘要未保留数字，明确记为 unavailable。
- backend/frontend/V2 build、dev/prod Compose config 全部通过。
- V2 real-stack `16 passed`、V1 E2E `52 passed`、V2 fixture `383 passed / 33 skipped`，全程 `0 failed`。
- 第二次 cleanup 同样证明 database dropped、Redis allowlist cleanup 完成且最终为空/外部客户端 `0`、storage removed、服务 stop/wait 完成、六个固定端口全部 released。

两次受控内存输出审查中，精确敏感值、Redis URI、A30 Redis connection/broker lifecycle 和签名 query 类别命中均为 `0`。保证范围仅包括 A27 两键 allowlist、A28 Settings repr/ValidationError、A30 Celery quiet、既有 dev-storage/Playwright artifact owner 与本轮实际输出审查；不存在也未宣称全局 secret scanner。

### 4. 判定与收口

- A25–A30 closed，open P0/P1/P2=`0/0/0`，九个独立阶段和唯一最终 Gate 全部 exit `0`，两次 cleanup 完整。
- Phase 8 Exit Gate=`MET`；07/08 已按实际结果更新，历史 abstraction review 与两次旧 recheck 的 `NOT_MET` 保持只读。
- Phase 9 未开始，父任务不归档；不自动 commit、push、PR 或 archive。
- 建议 commit：`docs(frontend-v2): close phase 8 exit gate`，只含 07/08、当前 Task artifacts 与父 metadata。
