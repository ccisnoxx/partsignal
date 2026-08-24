# 技术设计

## 1. 设计目标与固定候选

本 Task 不设计产品能力，只定义同一候选上的验证编排、环境边界、证据 owner 与 Gate 判定。

```text
产品候选 = main HEAD 3c93e8b2d164f57b2ef253bad010bb9e0e1d7403
允许变化 = 当前 Task artifacts + Phase 8 父任务 metadata
MET 后追加允许 = docs/frontend-v2/07、08
禁止变化 = 产品代码 / 测试 / 合同 / 配置 / Makefile / runner
```

验证前、九阶段后与最终 gate 前都核对 HEAD 和 dirty allowlist。候选或禁止范围变化时，不得把不同 SHA 的结果拼成同一个 Gate。

## 2. 验证流水线

```text
批准启动 + Git/Task/env preflight
                 ↓
九个独立阶段（顺序执行、各一次）
                 ↓
       任一失败 ─┴─ 全部通过
           ↓              ↓
安全独立诊断完成      final preflight
           ↓              ↓
       NOT_MET      唯一一次 make verify
                          ↓
                exit 0 ───┴─── nonzero
                  MET            NOT_MET
```

独立阶段调用根 Make/Compose 的现有 owner，不新增 runner、结果 parser、retry wrapper 或 scanner。串行执行避免 Docker、npm cache、Redis、database 与固定端口争用。

## 3. 环境与资源模型

### 3.1 两键环境

使用项目现有 `python-dotenv` 在进程内读取 `.env`，从子进程基础环境删除 `.env` 全部键，仅加入宿主机可访问的 `DATABASE_URL` 与 `REDIS_URL`。只记录交集键名，不记录值；不 `source .env`、不 `set -a`、不创建持久 wrapper。

### 3.2 Redis 与 E2E

独立 E2E 和最终 Gate 是两个独立生命周期。每次实时扫描空闲非 0 logical DB，拒绝 DB 0、非空 DB、同库外部客户端和固定端口占用；最终 Gate 必须排除本轮独立 E2E 实际使用的编号。

`e2e-local.sh` 继续拥有 database、Redis allowlist key、storage、API/AI/storage/worker/beat/frontend 进程与固定端口 cleanup。A30 的 Celery 顶层 `--quiet` 必须在完整 E2E 输出中继续保持 connection category `0`，但真实业务 warning、exit 和 cleanup 仍可见。

### 3.3 输出边界

命令输出在当前验证进程内受控审查，不保存原始日志。只落盘阶段结果、计数、耗时、脱敏失败 owner、敏感类别计数与 cleanup 状态；不把 URL、credential、header/body、storage state、签名 capability 或敏感正文写入 evidence。

## 4. 证据 owner

| 事实 | 权威 owner |
| --- | --- |
| candidate、祖先、dirty set、分支/worktree | Git |
| 阶段与最终 gate 定义 | 根 `Makefile` |
| contract/generated drift | `make contract-check` |
| lint/type/unit/integration/build | 对应根 Make target |
| real-stack/V1/fixture E2E 与 lifecycle | `make e2e`、`e2e-local.sh` |
| Redis 独占与固定端口 | `e2e-environment.py` preflight/cleanup |
| A29 selector closure | A29 implementation/evidence + 本轮完整 V1 E2E |
| A30 output closure | A30 runner/evidence + 本轮完整 E2E 输出审查 |
| open severity/blocker state | 当前与父 Trellis metadata + 本轮新结果 |
| Phase 8 最终状态 | 本 Task 判定算法与唯一最终 gate |

## 5. 判定算法

`MET` 当且仅当以下条件全部为真：

1. 固定候选未变化，dirty set 只含允许 evidence。
2. A25/A26 已归档，A27/A28 已归档，A29/A30 completed/closed，相关提交均为候选祖先。
3. 父任务 `blocker_count=0`、active blockers 为空，本轮 open P0/P1/P2=`0/0/0`。
4. 九个独立阶段各运行一次且全部 exit `0`。
5. 两次适用的 preflight 与 database/Redis/storage/process/port cleanup 全部完整。
6. 本轮没有未归因失败或敏感值回显；敏感结论不超过实际 owner。
7. 最终 `make verify` 恰好运行一次并 exit `0`。
8. 收尾 diff、Task validate、JSON/metadata 与 Git 状态审计通过。

其他任何结果均为 `NOT_MET`。独立阶段失败时最终 gate=`NOT RUN`；最终 gate 意外失败时运行次数保持 `1`，禁止重跑。

## 6. 文档分流

### MET

- 07 Phase 8 追加固定候选、Workbench 交付与 A25–A30 closure、九阶段/最终 Gate 实际结果、suite 计数、耗时、cleanup、open P0/P1/P2=`0/0/0` 和 Exit Gate=`MET`。
- 08 新增 Phase 8 Exit Gate 验收证据，并把敏感保证限定到 A27/A28/A30、现有 Playwright/dev-storage owner 与本轮输出审查。
- 同步当前 Task 与父 metadata；父任务不归档，Phase 9 不开始。

### NOT_MET

- 07/08 保持当前未完成状态。
- 当前 Task evidence 与父 metadata 记录实际失败、owner、cleanup、候选和 stop reason；不自动修复或创建 blocker。

## 7. 停止与回滚

- 候选 HEAD、禁止范围文件、祖先关系或 blocker state 变化。
- 出现未知 dirty 文件、分支/worktree、资源 owner、preflight 拒绝或 cleanup 不完整。
- 输出出现敏感值/正文，继续执行会扩大泄露。
- 任一步需要产品、测试、合同、配置或 runner 修复。
- 最终 Gate 条件不全，或 `make verify` 已实际执行一次。

停止后只整理安全 evidence。回滚只反向撤销当前 Task/父 metadata/成功路径 docs 的精确 hunk，不使用历史改写、broad delete、`FLUSHDB` 或未知进程终止。

## 8. Commit 范围

- `MET`：`docs(frontend-v2): close phase 8 exit gate`，只含 07/08、当前 Task artifacts 与父 metadata。
- `NOT_MET`：`docs(trellis): record phase 8 post-blocker recheck`，只含当前 Task artifacts 与父 metadata，07/08 不进入提交。

两条路径都先报告 diff 与 commit plan，等待用户批准；不自动 commit、push、PR 或 archive。
