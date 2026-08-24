# 规划审计

## 1. 候选与仓库状态

- 创建本 Task 前，主工作区位于 `main`，HEAD 为 `306f70f9ab6c84a2732d7d5aa69001982e2d39ce`。
- 创建后预期 dirty set 只有父任务 `task.json` 与当前 Task 目录；未创建分支或额外 worktree。
- `git branch --list 'codex/frontend-v2-*'` 无结果；`git worktree list --porcelain` 只有主工作区。
- A27 实施提交 `deed51ddfc7430db93b4ff7035117c812335a604`、A28 实施提交 `ec1effb4d787556a71ee3e5e16b3b29d95aa88b5`，以及相关归档提交 `0cf6cd18`、`9c25ed28`、`a2f13df6` 均已确认是固定候选祖先。

## 2. 历史 Gate 与 blocker 证据

### 第一次 Phase 8 recheck

归档任务 `08-24-frontend-v2-phase-8-exit-gate-recheck` 已证明九个独立阶段当时均可通过，但唯一最终 `make verify` 因 `.env` 批量导出污染 backend unit，且失败输出出现开发连接配置的截断表示，最终判定 `NOT_MET`。该结论保持只读；旧 suite 计数、耗时、Redis DB 和环境值不得复制为本轮结果。

### A27：final verify environment isolation

- A27 已归档并判定 `CLOSED`。
- 权威规则是使用已安装的 `python-dotenv` 在当前进程读取 `.env`，从子进程基础环境删除全部 `.env` 键，再只加入 `DATABASE_URL`、`REDIS_URL`。
- 两个连接值转换为宿主机可访问端点，但不得打印。
- Redis 必须动态选择空闲、非 0、独占 logical DB，并运行现有 `e2e-environment.py preflight`。
- 证据只记录交集键名、Redis DB 编号、preflight/cleanup 状态，不记录 URL。

### A28：Settings failure-output safety

- A28 已归档并判定 `CLOSED`。
- Settings 使用 `hide_input_in_errors=True`；七个敏感字段使用 `repr=False`。
- 保证范围是 Settings repr、Pydantic `ValidationError` 与受控 Python 失败输出，不是全局日志、pytest 或 secret scanner。
- 本轮必须人工复核命令输出是否包含不应公开的敏感值或正文，并据实记录 owner。

### 其他 Phase 8 blocker

- A25 root fixture convergence、A26 Auth/Workbench request cancellation 已归档并包含在固定候选。
- 父任务当前 `blocker_count=0`，open P0/P1/P2 计划在 gate 前重新核实，不由历史数字替代。

## 3. 根门禁真实定义

根 `Makefile` 中 `verify` 依次执行 `contract-check`、`lint`、`typecheck`、`test-unit`、`test-integration`、`build`、`e2e`，随后验证 dev/prod Compose config。最终入口是 fail-fast，因此本轮先独立执行九阶段，集中暴露所有安全可诊断 owner，再决定是否允许唯一最终 gate。

独立阶段固定为：

1. `make contract-check`
2. `make lint`
3. `make typecheck`
4. `make test-unit`
5. `make test-integration`
6. `make build`
7. `make e2e`
8. `docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet`
9. `PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_VERSION=test docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet`

## 4. E2E isolation owner

- `deploy/scripts/e2e-local.sh` 是 real-stack 的唯一生命周期 owner；它负责临时 PostgreSQL database、storage、服务进程与固定端口 cleanup。
- `e2e-environment.py preflight` 拒绝 Redis DB 0、非空 DB、外部 client 和固定端口占用。
- cleanup 只能处理枚举后确认属于本轮的精确 Celery/Kombu keys；禁止 `FLUSHDB`、通配删除或接管共享 DB。
- 固定端口按 runner 实际输出记录；本规划不复制旧任务的“已释放”结论。
- 独立 `make e2e` 与最终 `make verify` 必须分别重新选择不同的动态 DB，并各自完成 preflight 与 cleanup。

## 5. 文档现状与更新边界

- `docs/frontend-v2/07-migration-plan.md` 的 Phase 8 仍只描述目标与退出条件，没有 `MET` 结论。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md` 已记录 Workbench real-stack 复用边界，但没有最终 Phase 8 Exit Gate 结论。
- 只有本轮最终 `make verify` 退出 `0` 且所有前置条件满足，才允许写入固定候选、实际 suite 计数/耗时、cleanup、open P0/P1/P2、A25/A26/A27/A28 已关闭、Exit Gate=`MET` 与实际敏感信息 owner。
- 若 `NOT_MET`，07/08 不变；失败仅进入当前 evidence 与父任务 metadata。

## 6. Phase 7 组织方式复用

复用 Phase 7 recheck 的结构：候选冻结、九阶段独立诊断、全绿才运行唯一最终 gate、成功/失败分流、docs/Trellis-only commit plan。明确不复用其旧候选、suite 计数、耗时、Redis DB、端口或环境观测值。

## 7. 规划结论

不需要新 runner、结果 parser、retry wrapper、secret scanner 或产品修改。现有 Make targets、A27 两键环境构造、现有 E2E preflight/cleanup 与人工证据整理足以完成本任务。

## 8. 最终执行证据

### 8.1 候选与环境

- 固定候选始终为 `306f70f9ab6c84a2732d7d5aa69001982e2d39ce`；分支为 `main`，没有额外 worktree 或遗留 `codex/frontend-v2-*` 分支。
- A27/A28 实施与归档提交均为候选祖先；启动时 A25/A26/A27/A28 全部 closed，父任务 `blocker_count=0`，已知 open P0/P1/P2=`0/0/0`。
- 每个根 Make 子进程均从环境删除 `.env` 的全部键后，只加入 `DATABASE_URL`、`REDIS_URL`；交集键名精确为这两项，未把连接值写入 evidence。
- 独立 E2E 的 Redis logical DB 是本轮实时扫描空闲候选后动态选择的 `7`，不是硬编码或沿用历史结果；现有 preflight exit `0`。该编号与历史观测巧合相同，不改变动态选择事实。

### 8.2 九个独立阶段

| 阶段 | 时间（+08:00） | 耗时 | exit | 实际结果 |
| --- | --- | ---: | ---: | --- |
| `make contract-check` | 13:44:19–13:44:22 | 2.543s | 0 | backend contract 与 V1/V2 generated API drift 检查通过 |
| `make lint` | 13:44:22–13:44:32 | 9.876s | 0 | backend Ruff、V1/V2 lint 通过 |
| `make typecheck` | 13:44:32–13:44:40 | 8.639s | 0 | backend mypy `80 source files`、V1/V2 typecheck 通过 |
| `make test-unit` | 13:44:40–13:49:16 | 275.340s | 0 | backend `204 passed`；V1 Vitest `205 passed`；V1 visual `24 passed`；V2 Vitest `463 passed`；合计 `896 passed` |
| `make test-integration` | 13:49:16–13:51:46 | 150.539s | 0 | backend `120 passed` |
| `make build` | 13:51:46–13:52:23 | 36.873s | 0 | backend/frontend Docker image 与 V2 production build 通过 |
| `make e2e` | 13:53:14–13:59:29 | 374.494s | 2 | V2 real-stack `16 passed`；V1 Playwright `51 passed / 1 failed`；后续 V2 fixture suite `NOT RUN` |
| dev Compose config | 14:00:59 | 0.095s | 0 | `config --quiet` 通过 |
| prod Compose config | 14:00:59 | 0.037s | 0 | `config --quiet` 通过 |

所有阶段各运行一次。E2E 失败后没有相关代码、配置或环境变化，因此未重跑；两个安全且独立的 Compose config 阶段仍按计划完成。

### 8.3 E2E 失败与 cleanup

- 失败 owner：V1 Playwright `frontend/tests/e2e/mvp-flow.spec.ts:284` 的删除菜单 strict selector 同时匹配两个 menuitem；这是独立 E2E 的唯一测试失败，本 Task 不修复。
- 本轮 runner 完整 cleanup：临时 database `status=dropped`；Redis 精确删除 `1` 个 allowlisted key 后为空且无外部 client；storage `status=removed`；服务进程均 stop/wait；端口 `8000/9001/5173/4173/4174/19009` 全部 released。
- Task 内的精确值人工复核发现 Celery 启动 banner 与关闭诊断各回显一次 Redis 连接值。这里只记录敏感类别、次数与 owner，不记录值；该问题属于 `deploy/scripts/e2e-local.sh` 启动的 Celery 输出边界，不属于 A28 的 Settings repr、Pydantic `ValidationError` 或受控 Python 失败输出保证，也不代表存在全局 secret scanner。

### 8.4 Gate 判定

- 独立 E2E 非零且出现 runner/Celery 敏感输出 owner，九阶段全绿前置条件不成立。
- 最终 `make verify` 执行次数为 `0`，状态为 `NOT RUN`；没有选择第二个 Redis DB，也没有形成 gate 重跑循环。
- 本轮新增两个未关闭、尚未分配 blocker Task 的 owner；父任务 `blocker_count=2`。已知 open P0/P1/P2 仍为 `0/0/0`，等待用户决定是否分别创建独立 blocker Task。
- Phase 8 Exit Gate=`NOT_MET`；`docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md` 未修改，Phase 9 未开始。
