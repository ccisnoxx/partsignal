# 实施计划

## Phase A — A29 后启动

1. [x] final recheck evidence 与 A29 已获准提交；从 clean `main` 运行 `task.py start`，未创建分支。
2. [x] 已读取 infra E2E isolation、frontend/backend quality 与本 Task research。
3. [x] 冻结启动时 `HEAD=71e1e8bb2b7d4a27ebb7f048eede8af1f7a7f79a`，A29 closed、A30 active、Phase 8=`NOT_MET`。

## Phase B — 最小实现

1. [x] 在 `deploy/scripts/e2e-local.sh` 的 worker 与 beat 命令上使用 Celery 顶层 `--quiet`。
2. [x] 保留 `--loglevel=WARNING`、worker concurrency/pool、beat schedule、PID capture 与 cleanup 顺序。
3. [x] 未新增 logfile、redirect、filter、helper、依赖或 Settings/Celery app 变更。
4. [x] installed CLI 与真实运行证明原生 quiet 足够，未进入第二方案。

## Required Validation

```bash
bash -n deploy/scripts/e2e-local.sh
```

静态检查 worker/beat 均使用顶层 quiet，且 runner 没有新增 `--logfile`、stdout/stderr 丢弃或输出过滤。

随后使用 A27 两键 allowlist、动态空闲非 0 独占 Redis DB 与现有 preflight，选取既有会触发真实 Worker 的 V2 real-stack spec，运行一次：

```bash
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/<existing-worker-owner>-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh
```

以受控内存捕获方式检查输出，只报告 Redis URI/连接值类别命中数和 exit code，不打印/保存匹配值。记录真实 Worker 业务断言、耗时与 database/Redis/storage/process/ports cleanup。

若失败且代码/环境未相关变化，不重跑。

### 实际结果

- `bash -n` 与静态检查：exit `0`；worker/beat 均为顶层 `--quiet`，没有 logfile、redirect 或 filter。
- 两键 allowlist：交集精确为 `DATABASE_URL,REDIS_URL`；本轮动态选择非 0 Redis DB `7`，preflight exit `0`，`0.062s`。
- `PARTSIGNAL_E2E_V2_SPEC=tests/e2e/content-ai-real-stack.spec.ts deploy/scripts/e2e-local.sh`：只运行一次，exit `0`，`35.156s`；`1 passed / 0 failed / 0 skipped`。
- 输出审查：Redis URI `0`、Redis connection/broker category `0`、精确 Redis 值 `0`、精确 database 值 `0`；原始输出只在验证进程内存中检查，未保存或写入 evidence。
- Cleanup：database dropped；Redis allowlist cleanup 后 empty、外部客户端 `0`；storage removed；Celery 进程 `0`；`8000/9001/5173/4173/4174/19009` released。

## 收尾

```bash
git diff --check
python3 ./.trellis/scripts/task.py validate \
  frontend-v2-phase-8-celery-lifecycle-output-safety-blocker
git status --short --branch
```

使用 `trellis-check` 核对 quiet 没有吞掉失败、没有第二输出 owner，且 diff 只含 runner/必要 spec/evidence。A30 通过后父 metadata 记录两个 blocker closed、blocker_count=0；Phase 8 仍为 `NOT_MET`，等待用户另行批准新的独立 recheck。

## Explicitly Skipped

- 不运行根 `make e2e`、`make verify`、A29 或新 Exit Gate recheck。
- 不修改 Settings、Celery app、产品代码、Playwright tests、合同、Makefile 或 07/08。
- 不创建全局 scanner、filter、logfile、临时 playwright-cli 流程或 Phase 9 工作。
- 不自动 commit、push、PR、archive 或归档父任务。

## 执行结论

A30=`CLOSED`。原生 `--quiet` 在第三方 CLI 输出 owner 关闭了本次观察到的 Redis lifecycle 连接值回显，同时真实 Worker 用例、退出码和精确 cleanup 均保留。A29/A30 均关闭，open P0/P1/P2=`0/0/0`；Phase 8 仍为 `NOT_MET`，新的独立 Exit Gate recheck 需另行批准。

## Commit 停止点

已批准 commit：`fix(e2e): silence Celery broker lifecycle output`。范围仅 runner、经确认需要的 infra spec、A30 artifacts 与父 metadata；不 push、PR 或 archive。
