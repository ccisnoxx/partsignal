# Implement — Frontend V2 Phase 4 Exit Gate Final

> 当前状态：in_progress。唯一 `make verify` 已执行并按环境失败归因停止；Gate=`NOT_MET`，等待 `trellis-check`、diff 自审与用户确认 commit plan。

## Phase 0 — Planning freeze

- [x] 执行 `trellis-start`，确认创建任务前为干净 `main`、无活动 Task。
- [x] 读取根/Frontend V2 `AGENTS.md`、Makefile、E2E orchestration、Phase 4/Publishing 文档、三份稳定 spec 与指定归档 Task/evidence。
- [x] 冻结候选 `51bf9c08b31fd6363ee3cb5a2539f03c4f076198`。
- [x] 验证 `fcb6c1d` 及其 archive/journal、先前三组 blocker 的业务/archive/journal 提交均为 `main` 祖先。
- [x] 确认本地仅有 `main`，没有 `codex/frontend-v2-*` 临时分支。
- [x] 只创建 `prd.md` 与 `implement.md`；本任务没有实际技术设计，不创建 `design.md`。
- [x] 用户明确批准最新规划，并授权唯一任务分支；仍禁止未经确认的 commit、merge、push、archive 和 GEO。

执行结果：从冻结候选创建并绑定 `codex/frontend-v2-phase-4-exit-gate-final`，随后运行 `task.py start`；分支基点仍为 `51bf9c08b31fd6363ee3cb5a2539f03c4f076198`，未创建其他分支。

## Phase 1 — Activation and immutable candidate recheck

用户批准后才执行：

1. 重新读取当前 `prd.md` / `implement.md` 与相关稳定 spec。
2. 确认 `git branch --show-current` 为 `main`，`git rev-parse HEAD` 仍为冻结候选。
3. 确认 `git branch --list 'codex/frontend-v2-*'` 无输出。
4. 确认 `git status --short` 除当前 Task 文件外无未识别变化。
5. 从冻结候选创建并切换到 `codex/frontend-v2-phase-4-exit-gate-final`，确认分支 `HEAD` 仍为同一候选。
6. 用 `task.py set-branch` 绑定该唯一分支，再运行 `task.py start` 激活当前 Task。

若 `HEAD` 已变化、出现未知文件或既有同名/其他临时分支，停止并报告；不静默更新候选，不消耗唯一门禁机会。

## Phase 2 — Required environment preflight

将所有输出保存到 `evidence/preflight.txt`，但不记录连接密码或完整 URL。

### PostgreSQL

- 使用已有本地配置导出 host-accessible `DATABASE_URL`。
- 通过项目已有 psycopg 环境只读执行 `SELECT current_database()`，确认 source 可访问。
- 不预建 E2E 数据库；数据库创建/删除继续完全由 `deploy/scripts/e2e-local.sh` 与 `e2e-database.py` 拥有。

### Redis

- 使用独占且非 DB 0 的 `REDIS_URL`。
- 依次只读检查：

  ```bash
  redis-cli -u "$REDIS_URL" DBSIZE
  redis-cli -u "$REDIS_URL" LLEN celery
  redis-cli -u "$REDIS_URL" HLEN unacked
  redis-cli -u "$REDIS_URL" ZCARD unacked_index
  redis-cli -u "$REDIS_URL" CLIENT LIST
  redis-cli -u "$REDIS_URL" --scan --pattern '_kombu.binding.*'
  ```

- 预期 DB、queue、unacked、unacked_index 与 binding key 均为空；除当前诊断客户端外，没有 Worker/Scheduler 使用该 logical DB。

### Ports and workspace

```bash
lsof -nP \
  -iTCP:8000 -iTCP:9001 -iTCP:5173 \
  -iTCP:4173 -iTCP:4174 -iTCP:19009 \
  -sTCP:LISTEN
git status --short --branch
```

预期六个端口无 listener，工作区只有当前 Task 已识别文件。任一条件不满足即停止并归类为环境前置失败，不运行 `make verify`。

执行结果：前两次 PostgreSQL 探针分别因内联命令引号和 Compose 内部主机名不可解析而在数据库访问前停止；第三次确认宿主机映射后发现未安装 `redis-cli`；第四次改用项目已安装的 Python `redis` 5.3.1 完成同等只读检查并通过。最终有效 preflight 证明 PostgreSQL source 可访问且可建库，Redis DB 15 的 `DBSIZE/queue/unacked/unacked_index/binding/external clients` 全为 0，六端口无 listener，工作区 allowlist 通过。上述诊断均发生在门禁前，没有消耗唯一 `make verify`。

## Phase 3 — Single authoritative gate

先创建当前 Task 的 `evidence/`，分别写入候选、北京时间起止时间和退出码。唯一门禁命令仍是：

```bash
make verify
```

使用 shell pipeline 仅做原始输出保存，并保留 `make verify` 的真实退出码：

```zsh
set -o pipefail
task_evidence=.trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-final/evidence
mkdir -p "$task_evidence"
started_at=$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S %z')
printf '%s\n' "$started_at" > "$task_evidence/make-verify.started-at"
{
  printf 'PHASE4_GATE candidate=%s\n' "$(git rev-parse HEAD)"
  printf 'PHASE4_GATE started_at=%s\n' "$started_at"
  printf '%s\n' 'PHASE4_GATE command=make verify'
  make verify
  gate_status=$?
  finished_at=$(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S %z')
  printf '%s\n' "$finished_at" > "$task_evidence/make-verify.finished-at"
  printf 'PHASE4_GATE finished_at=%s\n' "$finished_at"
  printf 'PHASE4_GATE exit_code=%s\n' "$gate_status"
  exit "$gate_status"
} 2>&1 | tee "$task_evidence/make-verify.log"
verify_status=$pipestatus[1]
printf '%s\n' "$verify_status" > "$task_evidence/make-verify.exit-code"
test "$verify_status" -eq 0
```

起止时间同时写入 `make-verify.started-at` / `make-verify.finished-at`，避免只能从日志推断。整个任务不运行独立完整 `make e2e`。

### Required validation evidence

从这一份日志提取并记录实际数量与结果：

1. FastAPI/OpenAPI contract check 与 V1/V2 generated API check；
2. backend Ruff、mypy、unit、integration；
3. V1/V2 lint、typecheck、unit；
4. backend image、V1 production image、V2 production build；
5. V2 real-stack、V1 E2E、V2 fixture E2E；
6. Publishing Flow A、Flow B、PublishedArticle readonly、Issue/repair lifecycle；
7. Compose dev/prod config。

### Optional validation

无。`make verify` 已是完整最终门禁；不再运行完整 `make e2e` 或其他全套检查。若失败，只记录首个真实失败；没有能影响结果的已授权变化时不复验。

执行结果：唯一 `make verify` 于北京时间 `2026-08-12 15:58:31 +0800` 至 `15:58:49 +0800` 运行，退出码 `2`。以下节点通过：FastAPI/OpenAPI contract check、V1/V2 generated API check、backend Ruff、V1/V2 lint、backend mypy、V1/V2 typecheck。Backend unit 为 `180 passed / 1 failed`，失败节点是 `test_production_rejects_development_session_secret`；随后 Makefile 停止，未进入 integration、build、E2E 或 Compose config，也未单独运行完整 `make e2e`。

失败分类为 **ENVIRONMENT**：门禁 shell 使用 `set -a` 读取整个 `.env`，使开发变量 `AI_ALLOW_LOCAL_HTTP=true` 进入 production Settings 单测，先于目标 `SESSION_SECRET` 守卫报错。代码、测试和配置未修改；按批准规则不修正环境后重跑，不做定向复验。

## Phase 4 — Cleanup verification

无论门禁成功或失败，只要 E2E 生命周期曾启动，都执行并保存 cleanup 复核到 `evidence/cleanup-check.txt`。

### PostgreSQL and object storage

- 从日志取得本次精确 `partsignal_e2e_YYYYMMDD_PID` 与存储目录。
- 要求存在数据库与存储的 `E2E_CLEANUP ... status=deleted`；使用 source PostgreSQL 只读确认该精确数据库不存在，并用 `test ! -e` 确认该精确目录不存在。
- 如果门禁在 E2E 前停止，记录 `e2e_stage_reached=no`，只读确认没有本次候选数据库或存储目录，不虚构 cleanup 行。

### Processes and ports

- 核对本次 API、Worker、Scheduler、fake AI、storage、V1 dev server、V1/V2 preview PID 已退出。
- 再次运行六端口 `lsof`；存在本次残留即 cleanup 失败，未知 listener 只报告 owner，不擅自终止。

### Redis

1. 复核 `celery`、`unacked`、`unacked_index` 与其他 queued/unacked 项为空。
2. 复核 `CLIENT LIST`，确认除诊断客户端外没有其他 Worker/Scheduler 使用该 logical DB。
3. 枚举 `_kombu.binding.*`，把键名写入证据；只对枚举出的每个精确键逐个执行 `DEL`，不得通配删除或 `FLUSHDB`。
4. 最终要求 `DBSIZE=0`。

任一数据库、存储、进程、端口或 Redis cleanup 失败，Gate 直接为 `NOT_MET`。

执行结果：`e2e_stage_reached=no`；没有候选数据库、对象存储或服务进程，六端口无 listener。Redis DB 15 的 queue/unacked/unacked_index/binding/external clients 全为 0，最终 `DBSIZE=0`；cleanup=`passed`。

## Phase 5 — Six-category decision

逐类记录 `MET` / `NOT_MET` 与同一次最终候选证据：

1. Product
2. Engineering
3. UX
4. Architecture
5. Contract
6. Documentation

判定公式：

```text
MET = make_verify_exit_code == 0
      AND all_six_categories == MET
      AND unresolved_P0_P1_P2_findings == 0
      AND fixture_real_stack_cleanup_all_passed
      AND generated_types_code_contract_docs_have_no_drift
otherwise NOT_MET
```

历史证据可解释覆盖范围，但不能替代最终候选失败或未执行节点。

最终结果：Product=`NOT_MET_FINAL_EVIDENCE`、Engineering=`NOT_MET`、UX=`NOT_MET_FINAL_EVIDENCE`、Architecture=`MET_BY_EVIDENCE`、Contract=`MET`、Documentation=`MET`；总 Gate=`NOT_MET`。未解决产品/合同/P0/P1/P2 finding 为 0，未解决门禁环境 blocker 为 1。

## Phase 6 — Record result without implementation changes

### Success path

- 仅向 `docs/frontend-v2/07-migration-plan.md` 的 Phase 4 追加最终 `Gate=MET`、候选 commit、`make verify`、关键数量和 cleanup 证据。
- `08-testing-quality-and-acceptance.md`、`09-architecture-decisions.md` 若与最终事实一致则不修改。
- 更新当前 `prd.md` / `implement.md` 的 acceptance 与 execution record，保留完整 evidence。

### Failure path

- [x] 不把 `07` 标记为 `MET`，不修改生产代码、测试、合同、配置、部署或生成类型。
- [x] 在当前 Task 记录失败节点、退出码、环境分类、cleanup 和最小独立 Task `frontend-v2-phase-4-exit-gate-environment-corrected` 建议。
- [x] 不做无变化复验，Gate 保持 `NOT_MET`。

## Phase 7 — Drift and closeout checks

```bash
git diff --check
git diff --exit-code -- \
  frontend/src/shared/api/schema.d.ts \
  frontend-v2/src/shared/api/generated/schema.d.ts
git status --short
```

- [x] 检查生产代码、合同、测试、部署脚本、配置、generated types 与 GEO 文件没有变化。
- [x] 检查 `07/08/09` 与稳定 specs 的最终事实一致；失败路径不修改权威迁移状态。
- [x] `trellis-check`、Task validation、尾随空白检查与 diff 自审完成；唯一已知测试失败仍为已记录的环境污染，按授权不重跑。
- [ ] 提交、归档、journal 或任何其他 Git 写操作执行前，另行提交 commit plan 并取得用户确认。

## Expected changed files

规划阶段：

- `.trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-final/task.json`
- `.trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-final/prd.md`
- `.trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-final/implement.md`

批准执行后：

- 当前 Task 的 `evidence/preflight.txt`
- 当前 Task 的 `evidence/make-verify.log`
- 当前 Task 的 `evidence/make-verify.exit-code`
- 当前 Task 的 `evidence/make-verify.started-at`
- 当前 Task 的 `evidence/make-verify.finished-at`
- 当前 Task 的 `evidence/cleanup-check.txt`
- 当前 Task 的 `prd.md` / `implement.md`
- `docs/frontend-v2/07-migration-plan.md`（仅 Gate 全部满足时）

明确不预计修改：`design.md`、`08`、`09`、生产代码、测试、合同、配置、部署脚本、生成类型或 GEO 文件。

## Current preliminary verdict

`NOT_MET`。唯一 `make verify` 已因环境变量污染在 backend unit 退出 2；cleanup 通过，但最终 integration/build/fixture/real-stack 未执行。当前无已知未解决 Phase 4 产品/合同/P0/P1/P2 finding，不得进入 GEO。

## Execution record — 2026-08-12

- 候选：`51bf9c08b31fd6363ee3cb5a2539f03c4f076198`。
- 分支：`codex/frontend-v2-phase-4-exit-gate-final`；未 commit、merge、push 或 archive。
- 唯一命令：`make verify`；未运行独立完整 `make e2e`。
- 通过：contract check、V1/V2 generated API check、backend Ruff、V1/V2 lint、backend mypy、V1/V2 typecheck。
- 失败：backend unit `180 passed / 1 failed`；环境导出的 `AI_ALLOW_LOCAL_HTTP=true` 先触发 production Settings 守卫，使 session secret 单测的目标错误未出现。
- 未执行：backend integration、backend/V1/V2 build、V2 real-stack、V1 E2E、V2 fixture、Compose dev/prod config。
- Cleanup：E2E 未启动；无临时数据库、存储或本次服务，Redis DB 15 最终 `DBSIZE=0`，端口无 listener。
- 文档：`07/08/09` 保持不动，生产代码、测试、合同、配置、部署和生成类型保持不动。
- 自审：`trellis-check`、Task validation、`git diff --check`、生产/测试/合同/部署、generated types 与 `07/08/09` 零 diff 检查通过；工作区只有当前 Task 9 个文件。
- 建议下一独立 Task：`frontend-v2-phase-4-exit-gate-environment-corrected`，只导出宿主机 `DATABASE_URL` 与独占 `REDIS_URL` 后重新执行一次最终门禁；本任务不创建或实施。
