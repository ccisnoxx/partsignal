# Frontend V2 System Admin E2E — Implement Plan

## 0. 当前执行门禁

- [x] 使用 `trellis-start` 完成启动检查。
- [x] 创建当前 Trellis Task，状态保持 `planning`。
- [x] 完成 Users/Audit/backend/contracts/real-stack/orchestration 审计。
- [x] 识别并记录独立 Auth UI blocker。
- [x] 用户授权并已创建独立 `frontend-v2-auth-session-ui` blocker，状态为 `planning`。
- [x] 用户已评审并另行批准该 blocker 的实现规划。
- [x] blocker 实现候选与 Required validation 已通过。
- [ ] blocker 已归档合入 main，且 `/login`、`/account/security` 真实行为重新审计通过。
- [ ] 用户批准刷新后的本 Task 规划。

在以上未完成前：不运行 `task.py start`、不创建分支、不修改代码、不执行 E2E。

## 1. 实施顺序

### Phase A — 重新建立实施基线

1. 确认主工作目录位于 `main`，Users/Audit/Auth blocker 均已归档合入；除当前已识别的 planning artifacts 外不得有脏文件。
2. 确认不存在 `codex/frontend-v2-system-admin-e2e` 分支/worktree；不因 main ahead origin 自动 pull/push。
3. 完整读取 blocker 的 PRD/design/implementation evidence，以及最终 `/login`、`/account/security`、AuthProvider、route guard、相关 tests。
4. 对照本设计复核真实 selector、首次改密 redirect、session refresh 和 error contract；任何偏差先更新规划并请用户批准。
5. 创建唯一分支 `codex/frontend-v2-system-admin-e2e`，运行 `task.py start`。

### Phase B — 单个 real-stack spec

1. 新建 `frontend-v2/tests/e2e/system-admin-real-stack.spec.ts`，沿用现有 real-stack skip/env/baseURL/generated schema 模式。
2. 只实现一个闭环 test；使用默认 ADMIN page 与一个显式 ENGINEER BrowserContext。
3. 加入不泄密的 response/assertion helper、browser event secret flags 和 Node stdlib artifact scan；不提取 request body。
4. 依设计完成 ADMIN UI login/create、ENGINEER UI login/change、UX 403、六类 server 403、reset/revoke、bulk partial、Audit chain、UI delete/history。
5. 在 `finally` 中扫描 artifact 并关闭 ENGINEER context；不得使用临时 Playwright CLI 或全局 browser 清理命令。

### Phase C — 接入唯一 orchestration

1. 在 `deploy/scripts/e2e-local.sh` 的既有 V2 fixed list 中追加 `tests/e2e/system-admin-real-stack.spec.ts`。
2. 保持 `--project=foundation-desktop`、production preview、trace policy、固定端口、数据库/storage/Redis/process owner 不变。
3. 不修改 Makefile、Playwright config、Compose、依赖或 V1 invocation。

### Phase D — 文档与 task evidence

1. 只有实际 gate 通过后更新 `docs/frontend-v2/07-migration-plan.md`：记录 System Admin E2E 已完成及下一项 abstraction review。
2. 更新 `docs/frontend-v2/08-testing-quality-and-acceptance.md`：写入真实 pass 数、耗时、权限/Request ID/secret/cleanup 证据。
3. 将实际命令/结果写入本 Task research/implementation evidence；不写密码、cookie、CSRF、request body 或完整 storage state。
4. 无新稳定架构决策，不更新 ADR/spec；不修改 contracts。

## 2. Required validation：独立诊断

以下阶段在最终真实栈前独立执行；可安全并行的命令都先收集结果，不用 fail-fast full gate 做发现循环。

### 2.1 Deploy shell/static

```sh
bash -n deploy/scripts/e2e-local.sh
backend/.venv/bin/python -m py_compile \
  deploy/scripts/e2e-database.py \
  deploy/scripts/e2e-environment.py
```

### 2.2 Frontend API drift

```sh
npm --prefix frontend-v2 run api:check
```

### 2.3 System targeted unit/component

```sh
npm --prefix frontend-v2 run test -- \
  src/app/layout/app-shell.test.tsx \
  src/domains/identity/user-list.model.test.ts \
  src/domains/identity/user-list-page.test.tsx \
  src/domains/audit/audit.model.test.ts \
  src/domains/audit/system-audit-page.test.tsx
```

### 2.4 Users/Audit strict fixture E2E

```sh
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/system-users.spec.ts \
  tests/e2e/system-audit.spec.ts
```

不限定单一 project；现有 strict suites 继续负责 fixture production artifact 与既有响应式断点，不在 real-stack spec 重复。

### 2.5 Frontend lint/typecheck/production build

```sh
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
```

### 2.6 Backend identity integration nodes

```sh
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest \
  tests/integration/test_identity_management.py::test_user_query_export_and_temporary_password_flow \
  tests/integration/test_identity_management.py::test_user_delete_and_reset_password_boundaries \
  tests/integration/test_identity_management.py::test_single_and_bulk_status_share_transaction_invariants \
  tests/integration/test_identity_management.py::test_audit_log_query_detail_filters_and_current_actor_projection \
  tests/integration/test_identity_management.py::test_user_status_commands_record_success_only
```

这些 nodes 分别覆盖临时密码/403、reset/delete/history、bulk transaction、Audit projection/权限和成功-only 审计；不运行完整 integration suite 做发现循环。

## 3. Required validation：最终候选真实栈

### 3.1 前置只读确认

1. `DATABASE_URL` 指向用户批准、可由宿主访问的本地 PostgreSQL owner；不得读取服务器配置。
2. `REDIS_URL` 指向本 Task 独占的非零 logical DB；用 `e2e-environment.py preflight` 确认无未知 key/client。
3. 8000、9001、5173、4173、4174、19009 无未知 owner；preflight 失败则归因并停止。
4. 独立诊断已全部通过，candidate 合理预期成功。

### 3.2 唯一入口

```sh
DATABASE_URL="$PARTSIGNAL_E2E_HOST_DATABASE_URL" \
REDIS_URL="$PARTSIGNAL_E2E_EXCLUSIVE_REDIS_URL" \
deploy/scripts/e2e-local.sh
```

运行时为上述两个 task-local 环境变量注入已确认的本机 URL，不把凭据写入 task artifact 或 shell debug 输出。不得使用 `set -x`。

记录但不预先伪造：

- 实际 shell exit code；
- V2 real-stack 总 pass 数（现有 13 条 + 新增 1 条的候选预期为 14）；
- 既有 V1 suite 实际 pass/fail 数；
- wall-clock duration；
- spec 内 secret scan 通过；
- `E2E_CLEANUP` 的 Redis/database/storage/port 证据。

脚本顺序中 V2 real-stack 失败会跳过 V1，但 EXIT trap 仍必须执行；若意外失败，不在代码/环境未变化时重复运行。

### 3.3 事后 cleanup 只读验证

- 查询 PostgreSQL，确认本次输出的 `partsignal_e2e_*` 数据库名已不存在；不删除其他库。
- 对本次独占 Redis DB 运行 DB size/client/key 检查，确认无本次 allowlisted key；不 flush。
- 逐个确认 8000、9001、5173、4173、4174、19009 已释放；不终止未知占用。
- 确认临时 storage 路径不存在、没有存活的本次 PID。

## 4. Required validation：收尾

```sh
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-system-admin-e2e
```

然后检查完整 diff：无 fixture/page.route、无 request-body dump、无硬编码真实凭据、无 fallback/409 重放、无新权限判断、无第二 orchestration、无无关修改，文档与实际结果一致。

## 5. Optional validation

仅当实际 diff 触及共享 owner、独立诊断暴露相关风险，或用户另行要求时运行：

```sh
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-integration
```

`make verify` 明确保留给后续 `frontend-v2-system-abstraction-review` / Phase 7 exit gate，不属于本 Task Required 或默认 Optional。

## 6. 失败处理

1. 对每个失败记录 command、exit code、最小症状、root owner 与是否归因当前 diff。
2. 只修复本 Task test/orchestration 接入导致且在批准范围内的问题。
3. API、权限、状态机、数据库、Auth 或 Users/Audit 产品行为失败：停止，提出独立 blocker，不修改测试伪造通过。
4. 可安全独立的未运行诊断继续完成，批量报告当前可发现阻塞。
5. 同一失败只有相关代码、配置或环境发生变化后才可重跑。

## 7. Commit 与交付门禁

1. 所有 Required 验证与 self-review 完成后，向用户展示 commit plan：拟提交文件、提交消息、验证摘要、残余风险。
2. 未获确认不 commit。
3. 获确认后提交到唯一临时分支；不 push、不建 PR。
4. 运行 archive 前说明可能生成 Trellis bookkeeping commit。
5. archive 完成后 fast-forward 合入主工作目录 `main`，验证提交可达，再删除本地临时分支。
6. 最终报告实际 commit/merge/archive/branch cleanup；不得以计划值冒充实际结果。
