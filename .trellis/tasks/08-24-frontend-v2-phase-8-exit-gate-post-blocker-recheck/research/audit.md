# Phase 8 Post-Blocker Recheck 规划审计

## 1. 候选与仓库状态

- 创建 Task 前主工作区为 clean `main`，HEAD=`3c93e8b2d164f57b2ef253bad010bb9e0e1d7403`。
- Task 创建后 dirty set 只有父 `task.json` 与当前 Task 目录；未创建分支或额外 worktree。
- `git branch --list 'codex/frontend-v2-*'` 无结果；`git worktree list --porcelain` 只有主工作区。
- 当前 Task 已由 `task.py create --parent` 挂为 Phase 8 父任务最后一个 child，状态保持 `planning`；本规划未运行 `task.py start` 或任何门禁。

## 2. 历史 Gate 与 owner closure

- 首次 abstraction review、第一次 recheck 与 final recheck 的 `NOT_MET` 结论保持历史只读；旧 suite 计数、耗时、Redis DB 与环境结果不能替代本轮观察。
- A25/A26 已提交并归档；A27/A28 已关闭并归档；A29/A30 已完成并提交。
- final recheck 的唯一失败阶段为 `make e2e`：V1 删除菜单 strict selector 与 Celery lifecycle Redis 连接值两个 owner。A29 将 locator 收敛到当前可见 menu 的 exact `menuitem`；A30 在 runner 的 worker/beat 顶层使用原生 `--quiet`。
- A29 定向验证为 V2 real-stack `16 passed`、V1 目标 `3 passed`；A30 定向 Worker real-stack `1 passed` 且 connection category `0`。这些只证明各 owner closure，不能替代新的完整 Gate。
- 父任务当前 `blocker_count=0`、active blockers 为空、已知 open P0/P1/P2=`0/0/0`，Phase 8 仍为 `NOT_MET`。

## 3. 根 Gate 真实定义

根 `Makefile` 的 `verify` 顺序为 contract-check、lint、typecheck、test-unit、test-integration、build、e2e、dev Compose config、prod Compose config。最终入口 fail-fast，因此先独立执行九阶段，只有全绿才运行唯一一次最终 `make verify`。

独立阶段直接复用相同 Make/Compose owner，不需要新 orchestration 文件、runner、parser、retry wrapper 或 scanner。

## 4. 环境与 E2E owner

- A27 的权威环境算法是用 `dotenv_values()` 只向子进程传递宿主机可访问的 `DATABASE_URL`、`REDIS_URL`，并从基础环境删除其他 `.env` 键。
- `e2e-environment.py` preflight 拒绝 Redis DB 0、非空 DB、同库外部客户端与固定端口占用。
- `e2e-local.sh` 拥有临时 database、Redis allowlist keys、storage、服务进程和固定端口 cleanup；A30 新增的 Celery quiet 属于该 runner 输出边界。
- 独立 E2E 与最终 Gate 必须各自实时选择不同的空闲非 0 DB；不得复制 A29/A30 或历史 recheck 的 DB 编号。
- 原始输出在内存审查，只落盘脱敏结果；敏感保证不是全局 scanner。

## 5. 文档边界

- 07 的 Phase 8 仍只有目标与退出条件，没有 `MET`。
- 08 已记录 Workbench real-stack 复用验收，但没有 Phase 8 最终 Exit Gate 结论。
- 只有本轮九阶段和唯一最终 `make verify` 全部成功，才允许在 07/08 写入实际候选、suite 计数、耗时、cleanup、A25–A30 closed、open severity、敏感 owner 与 `MET`。
- `NOT_MET` 只更新当前/父 Trellis evidence，不污染长期完成状态。

## 6. 复用与不复用

复用 Phase 7 的组织方式：候选冻结、九阶段独立诊断、全绿才运行唯一最终 Gate、成功/失败文档分流、提交前停止。复用 final recheck 的 A27 两键环境和 cleanup 证据结构。

不复用任何旧候选、计数、耗时、Redis DB、database/storage 名称、端口运行结果或敏感类别结果；全部运行值必须现场观察。

## 7. 规划结论

需求和范围已由用户授权及仓库证据完全确定，没有未解决的产品/风险决策。最小方案是直接复用现有 Make targets、两键环境、preflight/cleanup 和受控内存输出审查；本规划阶段没有运行 lint、typecheck、test、build、E2E、Compose config 或 `make verify`。
