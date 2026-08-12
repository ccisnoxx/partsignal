# Frontend V2 Phase 4 Publishing 完整真实栈 E2E — 实施计划

## 0. Approval gate

- 当前 Task 状态必须保持 `planning`。
- 用户审核并显式批准本规划后，才运行 `python3 ./.trellis/scripts/task.py start 08-12-frontend-v2-publishing-e2e`。
- 项目使用 `main` 单分支工作流；不创建 `codex/frontend-v2-publishing-e2e` 或任何临时分支。
- 实施前记录 `git rev-parse HEAD` 作为 rollback point，并再次确认只存在本 Task 已知 planning artifacts。

## 1. 有序实施清单

1. 读取最终 `prd.md`、`design.md`、`implement.md` 与本任务相关 specs；运行 `trellis-before-dev`，不扩张合同或生产范围。
2. 在 `publication-workspace-real-stack.spec.ts` 调整前置 helper，使 Flow A 开始时只有 approved content/platform/accounts，没有 PublicationWork。
3. 扩展 Flow A：UI START → active row primary handoff → preparation → platform review → screenshot/result → direct PASSED → Article → open issue → create repair → repair primary handoff → resolve。
4. 将 Flow A 的所有 API 断言移到 resolve 后；增加 Work/Article/Issue/repair 的 immutable/history 断言。
5. 保留 Flow B 业务步骤，只移除中途 candidate API probe；改由 switch Dialog + final Context 证明同一 candidate/lineage。
6. 保持独立 PublishedArticle GET-only 用例不变；除非类型 helper 的机械签名需要最小调整，不改其流程或网络边界。
7. 先运行 static/targeted real-stack gate。若发现生产缺陷，停止并报告，不改 runtime、OpenAPI、数据库、依赖或 orchestration。
8. 只有完整目标 gate 与 cleanup assertions 通过后，更新 07/08 与 infra isolation spec 的实际证据。
9. 运行 `trellis-check`、`git diff --check`、最终 diff 审计；确认没有无关文件、重复 flow 或第二套框架。
10. 报告结果。提交前另行给出 commit plan 并等待确认；不自动 commit、push、archive 或记录 session bookkeeping。

## 2. 精确测试实现检查表

### Flow A

- [ ] Ready card 以唯一 approved title 定位，START trigger 来自 server action。
- [ ] START Dialog 明确选择 first account；成功后页面返回 canonical work ID。
- [ ] active row 的“继续准备”进入 `/publishing/work/$workId#preparation`。
- [ ] preparation 切到 second account；platform review、真实截图 upload/complete、result register 均由 UI 提交。
- [ ] 直接选择 PASSED；terminal Workspace 无 mutation controls，并从 canonical link进入同 ID Article。
- [ ] Article 只按 `OPEN_ISSUE` 显示登记入口；选择 `CONTENT_CHANGED` 并以 UI 提交。
- [ ] Issue Workspace no-task 投影同时显示 create repair / resolve；repair-context 只在 Dialog 打开后请求。
- [ ] 创建 repair 后 Issues List 的 primary 为“继续修复”；进入 repair Task Detail 显示 `CREATE_FIRST_DRAFT`，来源 Issue link 可返回。
- [ ] repair task 仍 OPEN 时通过 UI RESOLVE；终态 Issue 无 action。
- [ ] 结束后一次性读取最终 Work/Article/Issue/repair projection，执行 PRD R4 全部断言。

### Flow B

- [ ] FAILED → ACTION_REQUIRED → revision/save/submit/review/approve → switch → register → PASSED 步骤不变。
- [ ] switch candidate title/hash 在 UI Dialog 中断言；不使用中途 API response 驱动或检查下一步。
- [ ] final Context 继续精确断言 FAILED/PASSED content IDs 与六项 event lineage。

## 3. Required validation

### 3.1 Static / touched scope

```bash
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
sh -n deploy/scripts/e2e-local.sh
git diff --check
```

不运行 contract generation/check：本任务不修改 OpenAPI、runtime schema 或 generated types。若 typecheck 暴露合同缺口，停止而不是生成或手改类型。

### 3.2 Redis preflight

```bash
: "${DATABASE_URL:?必须指向可创建 allowlisted E2E database 的本地 PostgreSQL}"
: "${REDIS_URL:?必须指向本次运行独占的 Redis logical DB}"

redis-cli -u "$REDIS_URL" --raw DBSIZE
redis-cli -u "$REDIS_URL" --raw CLIENT LIST
```

进入 gate 的前提：`DBSIZE` 为 `0`，并且没有其他 Worker/Scheduler 使用该 logical DB。若不满足，换一个已确认独占的 logical DB；不清扫共享 Redis、不终止未知进程。

### 3.3 唯一真实栈 gate

```bash
e2e_log=$(mktemp "${TMPDIR:-/tmp}/partsignal-publishing-e2e.XXXXXX.log")
set -o pipefail
DATABASE_URL="$DATABASE_URL" REDIS_URL="$REDIS_URL" \
  deploy/scripts/e2e-local.sh tests/e2e/trusted-types.spec.ts 2>&1 | tee "$e2e_log"
e2e_status=$?
```

该命令必须实际运行脚本固定的全部 V2 real-stack specs，其中目标 `publication-workspace-real-stack.spec.ts` 应有三条通过：扩展 Flow A、既有 Flow B、独立 PublishedArticle GET-only。Content/AI specs 保持既有回归覆盖；V1 只跑轻量 `trusted-types.spec.ts`，不把完整 V1 suite 噪声当作本 Task 默认门禁。

### 3.4 Cleanup assertions

```bash
rg 'E2E_CLEANUP database=partsignal_e2e_[0-9]{8}_[0-9]+ status=deleted' "$e2e_log"
rg 'E2E_CLEANUP storage=.*/partsignal-e2e-storage\.[^ ]+ status=deleted' "$e2e_log"
storage_path=$(sed -n 's/^E2E_CLEANUP storage=\(.*\) status=deleted$/\1/p' "$e2e_log" | tail -n 1)
test -n "$storage_path" && test ! -e "$storage_path"

pg_url=${DATABASE_URL/postgresql+psycopg:/postgresql:}
psql "$pg_url" -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'partsignal_e2e_%';"

redis-cli -u "$REDIS_URL" --raw CLIENT LIST
redis-cli -u "$REDIS_URL" DEL \
  _kombu.binding.celery \
  _kombu.binding.celeryev \
  _kombu.binding.celery.pidbox
test "$(redis-cli -u "$REDIS_URL" --raw DBSIZE)" = 0
test "$e2e_status" -eq 0
rm -f -- "$e2e_log"
```

判据：

- 两条 cleanup log 均存在；PostgreSQL 查询无输出；日志给出的 storage 路径实际不存在。
- 本次 Worker/Beat 停止后只删除已确认属于 Celery 的三个 binding key，再断言独占 logical DB 为空；不得对共享 Redis 使用 `FLUSHDB`。
- cleanup assertion 在业务测试失败时同样必须执行；可用 shell trap/后续人工命令完成，但不能因原测试退出码跳过。
- 任一资源残留使 required gate 失败。

### 3.5 Final hygiene

```bash
git diff --check
git status --short
python3 ./.trellis/scripts/task.py validate 08-12-frontend-v2-publishing-e2e
```

## 4. Optional validation

```bash
npm --prefix frontend-v2 run test -- \
  src/domains/publication/publication-workspace-page.test.tsx \
  src/domains/publication/published-article-detail-page.test.tsx \
  src/domains/publication/published-content-issue-workspace-page.test.tsx

npm --prefix frontend-v2 run e2e -- \
  tests/e2e/publication-workspace.spec.ts \
  tests/e2e/published-articles.spec.ts \
  tests/e2e/published-content-issues.spec.ts

make verify
```

这些已有 component/fixture suites 没有生产代码变更，默认 optional；真实栈 gate 已直接证明目标。只有失败证据指向本次 selector/assertion 重构时才进入修复范围。

## 5. Failure attribution

| 首个失败位置 | 归因步骤 | 本 Task 动作 |
| --- | --- | --- |
| 前置 API 数据创建 | 核对环境、唯一数据、现有 API 合同 | 环境/既有缺陷则停止；不改产品 |
| Ready START / direct PASSED / Article handoff | 与 fixture + backend 既有证据对照，并保留页面/network/response | 若真实栈不成立，报告产品缺陷并停止 |
| Issue open/repair/resolve | 对照 `published-content-issues.spec.ts` 与最终 canonical payload | 若 fixture 与真实栈分歧，报告产品/read-model 缺陷并停止 |
| Flow B | 检查是否由 helper/API-probe 重构造成 | 只修本次引入的测试错误；既有失败不扩张 |
| Content AI / Content / V1 | 检查目标 spec 是否已先通过、diff 是否触及失败路径 | 记录独立失败；不重跑无变化命令、不修无关代码 |
| cleanup | 区分 database/storage trap、Redis ownership 与外部环境 | 完成精确清理，gate 失败并报告；不以业务通过替代 |

同一失败在代码、配置或环境没有针对性变化时不得重复运行。测试一旦暴露需要生产代码、OpenAPI、database 或依赖变更的真实缺陷，本 Task 立即停止并回到用户决策。

## 6. Expected files

### Planned

- `frontend-v2/tests/e2e/publication-workspace-real-stack.spec.ts`
- `docs/frontend-v2/07-migration-plan.md`（仅真实 gate 通过后）
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`（仅真实 gate 通过后）
- `.trellis/spec/infra/e2e-isolation.md`（仅真实 gate 通过后）
- 当前 Task 的 `prd.md`、`design.md`、`implement.md` 与 Trellis metadata

### Explicitly unchanged

- `deploy/scripts/e2e-local.sh`、`deploy/scripts/e2e-database.py`
- `frontend-v2/tests/e2e/published-content-issues.spec.ts`
- `frontend-v2/tests/e2e/fixtures/publication.fixture.ts`
- frontend/backend production runtime、OpenAPI、database、migrations、dependencies、generated types

## 7. Rollback point

- 实施前记录 `main` 的 `HEAD`; 本任务不创建分支。
- 测试代码与成功后证据文档作为一个无 migration 的提交单元；整体回滚即可，无数据修复。
- 每次 E2E 运行的 rollback 是 allowlisted database、临时 storage、本次进程和已确认专用 Redis logical DB 的精确清理。
- 未通过真实 gate 时不更新完成状态文档、不提交“已通过”证据。

## 8. Pre-start checklist

- [x] 现有覆盖矩阵已按源码、归档产物和真实 spec 审计。
- [x] 本任务唯一连续证据缺口与最小单文件测试改动已确定。
- [x] API 前置 / UI command / final read-only boundary 已确定。
- [x] required validation、cleanup、failure attribution 和 rollback 已确定。
- [x] Blocking open questions 为空。
- [x] 用户已审核本次最终规划摘要并在后续消息中明确批准实施。
- [x] 批准后才执行 `task.py start`。
