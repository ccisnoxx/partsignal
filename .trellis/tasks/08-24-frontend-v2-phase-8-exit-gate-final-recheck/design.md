# 技术设计

## 1. 设计目标

本 Task 不设计生产能力，只定义同一固定候选上的验证编排、环境边界、证据 owner 与 Gate 判定。最小方案是直接复用根 Make targets、A27 已验证的两键子进程环境和现有 E2E runner，不新增脚本、wrapper、parser 或 scanner。

## 2. 固定候选模型

```text
产品候选 = Git HEAD 306f70f9ab6c84a2732d7d5aa69001982e2d39ce
允许变化 = 当前 Task artifacts + Phase 8 父任务 metadata
禁止变化 = 产品代码 / 测试 / 合同 / 配置 / Makefile / runner
```

验证前、独立阶段后与最终 gate 前都核对 HEAD 和 dirty allowlist。若 HEAD 或禁止范围变化，已完成结果不得与新状态拼成同一个 Gate，立即停止并要求重新规划候选。

## 3. 环境构造

### 3.1 A27 两键 allowlist

每个根 Make 子进程复用 A27 已证明的方式：

1. 使用项目现有 Python runtime 和 `python-dotenv` 在进程内读取 `.env`。
2. 从当前基础环境删除 `.env` 中出现的所有键。
3. 只加入转换为宿主机可访问端点的 `DATABASE_URL`、`REDIS_URL`。
4. 不持久化临时 wrapper，不打印键值；证据只允许记录交集键名。

prod Compose config 额外加入 `PARTSIGNAL_BACKEND_IMAGE=partsignal-backend` 与 `PARTSIGNAL_VERSION=test`；这两个不是 `.env` secret。

### 3.2 Redis isolation

独立 `make e2e` 与最终 `make verify` 是两个生命周期：各自在执行前动态探测一个空闲、非 0、独占 logical DB，并用现有 preflight 复核。最终 gate 不复用独立 E2E 的编号；若无法安全取得 DB，则该命令不运行。

runner 只清理本生命周期确认拥有的精确 Celery/Kombu keys，不清理外部 owner 数据。

## 4. 验证流水线

```text
启动批准 + candidate/env/git preflight
                 ↓
九个独立阶段（顺序执行，每项一次）
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

独立阶段顺序与根 Makefile 一致，Compose config 显式作为第八、九阶段。串行运行避免端口、Docker、npm cache、数据库与 Redis owner 争用。

一个独立阶段失败后，继续执行尚未运行且不依赖该失败的安全阶段。以下情况停止后续可能扩大影响的命令：资源 owner 不明、preflight 拒绝、敏感信息已暴露、cleanup 不完整、候选变化或继续执行可能接管外部资源。

## 5. 证据 owner

| 事实 | 权威 owner |
| --- | --- |
| candidate、祖先、dirty set、分支/worktree | Git |
| 阶段顺序与最终 gate 内容 | 根 `Makefile` |
| contract/generated drift | `make contract-check` |
| lint/type | `make lint`、`make typecheck` |
| unit/integration/build suite | 对应 Make target 的实际输出 |
| real-stack/fixture E2E 与生命周期 | `make e2e`、`deploy/scripts/e2e-local.sh` |
| Redis 空闲/独占与固定资源 preflight | 现有 `e2e-environment.py` |
| Settings failure-output guarantee | A28 实现与本轮实际输出复核 |
| open P0/P1/P2 与 blocker state | 当前/父 Trellis metadata + 本轮阶段结果 |
| Phase 8 最终状态 | 本 Task 判定算法与唯一最终 gate |

## 6. 判定算法

`MET` 当且仅当以下条件全部为真：

1. 固定候选未变化，dirty set 仅包含允许 evidence。
2. A25/A26/A27/A28 均已关闭，父任务 blocker_count 为 0。
3. 九个独立阶段各运行一次且 exit code 全为 0。
4. 两次适用的 preflight、database/Redis/storage/process/port cleanup 都完整。
5. 本轮没有开放 P0/P1/P2，也没有未归因失败或敏感信息泄露。
6. 最终 `make verify` 恰好运行一次并 exit 0。
7. 收尾 `git diff --check`、当前 Task validate 与状态审计通过。

其他任何结果均为 `NOT_MET`。独立阶段失败时最终 gate=`NOT RUN`；最终 gate 意外失败时运行次数保持 1，禁止重跑。

## 7. 文档分流

### MET

- 07 Phase 8 记录固定候选、A25/A26/A27/A28 已关闭、实际阶段/suite 结果、最终 gate 总耗时、cleanup、open P0/P1/P2=`0/0/0` 与 Exit Gate=`MET`。
- 08 新增/补充 Phase 8 Exit Gate 验收证据，敏感保证限定到实际 runner、Playwright、A27、A28 和人工输出复核 owner。
- 当前 Task 与父任务 metadata 同步最终结果；父任务不归档，历史归档任务不修改。

### NOT_MET

- 07/08 保持当前未完成状态。
- 当前 Task evidence 记录失败阶段、exit code、owner、cleanup、候选和 stop reason。
- 父任务只更新 current gate、失败摘要与下一步需用户决定；不自动创建 blocker。

## 8. 停止条件

- 候选 HEAD 或禁止范围文件发生变化。
- 出现未知 dirty 文件、遗留分支/worktree 或 A27/A28 不是候选祖先。
- E2E preflight 拒绝，资源 owner 不明，或 cleanup 无法证明完整。
- 输出出现敏感值/正文，继续执行会扩大泄露。
- 任何步骤需要产品、测试、合同、配置或 runner 修复。
- 最终 gate 条件不全，或最终 gate 已执行一次。

停止后只整理安全 evidence，不修复、不重跑、不启动 Phase 9。

## 9. Commit 范围

- `MET`：建议一个 `docs(frontend-v2): close phase 8 exit gate`，只包含 07/08、当前 Task artifacts 与父任务 metadata。
- `NOT_MET`：建议一个 `docs(trellis): record phase 8 final recheck`，只包含当前 Task artifacts 与父任务 metadata；07/08 不进入提交。

两条路径均需先报告 diff 与 commit plan，等待用户批准；不自动提交、推送、创建 PR 或归档父任务。
