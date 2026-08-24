# 实施计划

## Phase A — A29 后启动

1. 等待 final recheck evidence 与 A29 获准提交；回到 clean `main` 后运行 `task.py start`，不创建分支，除非用户另行授权。
2. 运行 `trellis-before-dev`，读取 infra E2E isolation、frontend quality 与本 Task research。
3. 冻结启动时 HEAD，确认 A29 closed、A30 planning/active、Phase 8=`NOT_MET`。

## Phase B — 最小实现

1. 在 `deploy/scripts/e2e-local.sh` 的 worker 与 beat 命令上使用 Celery 顶层 `--quiet`。
2. 保留 `--loglevel=WARNING`、worker concurrency/pool、beat schedule、PID capture 与 cleanup 顺序。
3. 不新增 logfile、redirect、filter、helper、依赖或 Settings/Celery app 变更。
4. 若 installed CLI 或真实运行证明 quiet 不足，停止并更新 planning evidence；不尝试第二方案。

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

## Commit 停止点

建议 commit：`fix(e2e): silence Celery broker lifecycle output`。范围仅 runner、经确认需要的 infra spec、A30 artifacts 与父 metadata；展示 diff 后等待批准。
