# Implement — Frontend V2 Phase 4 Exit Gate Closeout

> 当前状态：唯一完整门禁已执行并按失败归因停止；Gate=`NOT_MET`，用户已批准既定 commit plan 与归档收尾。

## Phase 0 — Approval and candidate freeze

- [x] 用户明确批准当前 `prd.md` / `implement.md` 并要求执行；同时明确禁止未经确认的 commit、merge、push、archive，因此未删除远端旧分支。
- [x] 只读确认候选为本地 `main` commit `65b332e51499fb76e27feabcd1e4129b60b69ff9`，没有新的 blocker 修复提交遗漏。
- [x] 创建用户指定且唯一获授权的 `codex/frontend-v2-phase-4-exit-gate-closeout`；除当前 Task 文件外无未识别改动。
- [x] 绑定分支并运行 `task.py start`，Task 状态由 `planning` 进入 `in_progress`。
- [x] 未创建其他分支，未 commit、merge、push、archive。

### Blocker commit reachability

```bash
for commit in \
  eea4c10b89c8631d00d125f4acfd64eec9447945 \
  8408a117dbe0a7eac53e9548c404f937c55aa774 \
  baa21a4464cc541ae497884e55b28cb3232f27e1 \
  6f90b082966b00ac3c8689e05b865d08bd6be9e2 \
  66979793de3d8e19e17510bdd475d4f6366a4ca3 \
  930a1c5c37fa682f35c9d6d4a30a7c4e3a4b20be \
  0a27716a2592e90b3b62f2e843543ab38992e768 \
  d4622869bdeb64e998da43f8ec4e1b2404637201 \
  65b332e51499fb76e27feabcd1e4129b60b69ff9
do
  git merge-base --is-ancestor "$commit" main
done
```

### Branch hygiene

```bash
git branch --list 'codex/frontend-v2-*'
git branch -r --list 'origin/codex/frontend-v2-*'
```

执行结果：本地仅有当前用户指定的 closeout 分支；远端仍存在已合并的 `origin/codex/frontend-v2-agent-rules`。用户同时禁止未经确认的 push，因此未删除该远端 ref；此仓库卫生项继续未满足，但不改变被验证的候选 commit。

## Phase 1 — Environment preflight

- [x] 使用已有项目配置向 shell 提供 host-accessible PostgreSQL 与任务独占 Redis DB 15；凭据未写入仓库日志。
- [x] PostgreSQL source 连接成功，当前数据库为 `partsignal`。
- [x] Redis DB 15 运行前 `DBSIZE/LLEN celery/HLEN unacked/ZCARD unacked_index` 均为 0；除当前诊断客户端外无 DB 15 客户端。
- [x] `8000/9001/5173/4173/4174/19009` 无外部 listener。
- [x] 创建当前 Task `evidence/`，只保存门禁输出、退出码与 cleanup 复核；未创建脚本。

```bash
redis-cli -u "$REDIS_URL" DBSIZE
redis-cli -u "$REDIS_URL" LLEN celery
redis-cli -u "$REDIS_URL" HLEN unacked
redis-cli -u "$REDIS_URL" ZCARD unacked_index
redis-cli -u "$REDIS_URL" CLIENT LIST
lsof -nP \
  -iTCP:8000 -iTCP:9001 -iTCP:5173 -iTCP:4173 -iTCP:4174 -iTCP:19009 \
  -sTCP:LISTEN
mkdir -p .trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-closeout/evidence
```

预期：`DBSIZE/LLEN/HLEN/ZCARD` 均为 0；`CLIENT LIST` 除当前诊断客户端外没有连接该 logical DB 的 Worker/Scheduler；`lsof` 无输出。只读检查不满足时不启动门禁。

## Phase 2 — Single exit gate

根 `Makefile` 已证明 `verify -> ... -> e2e`，因此只运行了以下一次完整入口，没有运行第二次 `make e2e`：

```bash
set -o pipefail
make verify 2>&1 | tee .trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-closeout/evidence/make-verify.log
verify_status=$pipestatus[1]
printf '%s\n' "$verify_status" > .trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-closeout/evidence/make-verify.exit-code
test "$verify_status" -eq 0
```

记录最终候选 commit、北京时区开始/结束时间、退出码及以下节点的精确数量/结果：

1. contract-check 与 V1/V2 generated API check；
2. backend Ruff、mypy、unit、integration；
3. V1/V2 lint、typecheck、unit；
4. backend image、V1 production image、V2 production build；
5. 固定 V2 real-stack、V1 E2E、V2 fixture E2E；
6. Publishing Flow A、Flow B、PublishedArticle readonly、Issue/repair/resolve lifecycle；
7. Compose dev/prod config checks。

如果失败：停止完整门禁，不重复 `make e2e`，按产品/合同/测试/环境/cleanup 分类并记录 owner。只有代码、配置或环境发生了能影响该失败节点的有针对性变化，且该变化另有授权时，才运行该节点的最小定向复验；closeout Task 内不修生产问题。

执行结果：北京时间 `2026-08-12 14:47:13` 至 `14:47:31`，退出码 `2`。contract check、V1/V2 API check、Ruff、V1/V2 lint、mypy、V1/V2 typecheck 均通过；backend unit 为 `180 passed / 1 failed`，随后按规则停止，未进入 integration/build/e2e。

## Phase 3 — Cleanup verification

### PostgreSQL and storage

- [x] 日志确认 `e2e_stage_reached=no`；门禁在 backend unit 停止，没有创建 E2E 数据库或对象存储目录，因此没有 `E2E_CLEANUP` 行。
- [x] 使用 source PostgreSQL 只读查询，`partsignal_e2e_20260812_%` 候选数据库为 none。
- [x] 没有本次存储路径，不执行删除。

### Processes and ports

- [x] E2E 脚本未启动，因此没有本次 API、Worker、Scheduler、fake provider、storage 或 preview PID。
- [x] 重新运行端口检查，`8000/9001/5173/4173/4174/19009` 无 listener。

```bash
lsof -nP \
  -iTCP:8000 -iTCP:9001 -iTCP:5173 -iTCP:4173 -iTCP:4174 -iTCP:19009 \
  -sTCP:LISTEN
```

### Redis

- [x] `celery`、`unacked`、`unacked_index` 均为 0，且无其他 queued/unacked 工作项。
- [x] `CLIENT LIST` 除当前诊断客户端外没有 DB 15 Worker/Scheduler。
- [x] `SCAN` 结果为空，没有 `_kombu.binding.*` 元数据，因此没有执行 `DEL`。
- [x] 最终 `DBSIZE=0`。

```bash
redis-cli -u "$REDIS_URL" LLEN celery
redis-cli -u "$REDIS_URL" HLEN unacked
redis-cli -u "$REDIS_URL" ZCARD unacked_index
redis-cli -u "$REDIS_URL" CLIENT LIST
redis-cli -u "$REDIS_URL" SCAN 0 MATCH '_kombu.binding.*' COUNT 1000
redis-cli -u "$REDIS_URL" DBSIZE
```

## Phase 4 — Six-category decision

对每类记录 `MET` / `NOT_MET` 与直接证据：

1. Product：三资源 URL、Flow A/B、readonly Article、Issue/repair lifecycle。
2. Engineering：唯一 `make verify` 全绿，fixture/real-stack/build/静态检查齐全。
3. UX：responsive、keyboard/focus、history/direct/refresh、状态与 no-overflow。
4. Architecture：server-driven、单 read model、依赖方向、无第二 owner/抽象/fallback。
5. Contract：OpenAPI/runtime/generated types/错误矩阵/snapshot 一致，未解决 P0/P1/P2 为 0。
6. Documentation：实现、合同、稳定 spec、`07/08/09` 与 closeout 记录一致。

判定规则：

```text
MET = six_categories_all_met
      AND unresolved_P0_P1_P2_findings == 0
      AND make_verify_exit_code == 0
      AND fixture_real_stack_cleanup_all_passed
otherwise NOT_MET
```

最终结果：Product=`MET_BY_ARCHIVED_EVIDENCE`、Engineering=`NOT_MET`、UX=`MET_BY_ARCHIVED_EVIDENCE`、Architecture=`MET_BY_EVIDENCE`、Contract=`MET`、Documentation=`MET`；总 Gate=`NOT_MET`。

## Phase 5 — Record outcome without implementation changes

### Success path

- [ ] 仅向 `docs/frontend-v2/07-migration-plan.md` 的 Phase 4 追加最终 `Gate=MET`、候选 commit、`make verify` 结果、关键 test/build/E2E 数量与 cleanup 证据。
- [ ] `08-testing-quality-and-acceptance.md` 与 `09-architecture-decisions.md` 若仍与事实一致则保持不动。
- [ ] 更新当前 `prd.md` / `implement.md` 的 acceptance 与 execution record；保留 `evidence/make-verify.log` 和退出码。

### Failure path

- [x] 未改 `07` 为 `MET`，未修改生产代码、合同、测试或编排。
- [x] 当前 Task 已记录候选、命令、退出码、首个失败节点、完整日志、TEST 分类、backend Publication test owner 与 cleanup。
- [x] 建议最小独立 Task `publication-work-reference-filter-unit-contract-correction`；Gate 保持 `NOT_MET`，历史归档记录不动。

## Phase 6 — Drift and closeout checks

```bash
git diff --check
git diff --exit-code -- \
  frontend/src/shared/api/schema.d.ts \
  frontend-v2/src/shared/api/generated/schema.d.ts
git status --short
```

- [x] 除当前 Task 文档与 evidence 外无工作区变化；无生产代码、权威文档、generated types、build artifact 或新抽象漂移。
- [x] 已呈交精确 commit plan，用户确认只提交当前 Task 六个文件；仍不 push。
- [ ] `task.py archive` / journal 可能创建 Trellis bookkeeping commits，执行前单独说明并取得符合项目规则的确认。
- [ ] 提交/归档完成后工作区干净。

## Expected changed files

- 当前规划阶段：
  - `.trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-closeout/task.json`
  - `.trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-closeout/prd.md`
  - `.trellis/tasks/08-12-frontend-v2-phase-4-exit-gate-closeout/implement.md`
- 门禁执行阶段：
  - 当前 Task `evidence/make-verify.log`
  - 当前 Task `evidence/make-verify.exit-code`
  - 当前 Task `prd.md` / `implement.md`
  - `docs/frontend-v2/07-migration-plan.md`（仅 Gate 全绿时）
- 不预计修改 `08`、`09`、生产代码、合同、测试、配置、部署、generated types 或任何 GEO 文件。

## Current preliminary verdict

`NOT_MET`。唯一 `make verify` 已执行并在 backend unit 的 stale SQL-text assertion 失败，退出码为 2；按归因规则未修复、未重跑、未进入 E2E。远端已合并的 `origin/codex/frontend-v2-agent-rules` 仍因无 push 授权保留。

## Execution record — 2026-08-12

- 候选：`65b332e51499fb76e27feabcd1e4129b60b69ff9`。
- 唯一完整命令：`make verify`；未运行独立 `make e2e`。
- 通过：FastAPI/OpenAPI contract、V1/V2 generated API check、backend Ruff、V1/V2 lint、backend mypy、V1/V2 typecheck。
- 失败：backend unit `180 passed / 1 failed`；`test_publication_reference_filter_includes_terminal_history` 的整条 SQL 字符串断言误匹配共享 SELECT projection 中的合法状态 `CASE`。
- 归因：TEST；生产 `list_publication_works()` 的引用筛选仍不附加非终态 WHERE，未发现产品/合同缺陷。
- Cleanup：E2E 未启动；无临时数据库、存储或服务进程，Redis DB 15 最终 `DBSIZE=0`，端口无 listener。
- 证据：`evidence/make-verify.log`、`evidence/make-verify.exit-code`、`evidence/cleanup-check.txt`。
- 未修改 `docs/frontend-v2/07-migration-plan.md`、`08`、`09`、生产代码、合同、测试、generated types、配置或 GEO。
- `trellis-check` 与 diff 自审完成：Task validation、`git diff --check`、generated types/`07/08/09` 无漂移检查通过；唯一工作区变化为当前 Task 六个文件。项目测试状态仍为上述 backend unit failure，按用户要求未修复或重跑。
- `trellis-update-spec` 复核后不更新稳定 spec：本 Task 没有改变可执行合同或实现约定，SQL 文本断言漂移由建议的独立测试 Task 负责，避免把未修复的一次性失败写成稳定规则。
