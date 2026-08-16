# Frontend V2 System Admin E2E — Implement Plan

## 0. 当前执行门禁

- [x] 主工作区位于 `main` 且工作树干净；本地 `main` ahead origin 不触发 pull/push。
- [x] 已完整读取根目录与 `frontend-v2/AGENTS.md`、Trellis workflow、当前 Task 三份文档。
- [x] `frontend-v2-users`、`frontend-v2-system-audit`、`frontend-v2-auth-session-ui` 均已完成并归档。
- [x] 已重新审计 `/login`、`/account/security`、AuthProvider/route guard/logout、Users、Audit、backend identity/audit、现有 tests 与 `e2e-local.sh`。
- [x] Auth UI 前置 blocker 已解除。
- [x] 用户已批准本刷新计划；Task 已启动并创建唯一临时分支 `codex/frontend-v2-system-admin-e2e`。

用户已确认单一 work commit plan，并授权随后归档收尾；当前尚未 commit、push 或创建 PR。

## 1. 批准后的实施顺序

### Phase A — 启动与分支

1. 再次确认 primary workspace 为 `main` 且仅包含用户已知变更；不 pull/push/PR/历史改写。
2. 确认没有同名 branch/worktree。
3. 按批准运行 `python3 ./.trellis/scripts/task.py start frontend-v2-system-admin-e2e`。
4. 创建唯一临时分支 `codex/frontend-v2-system-admin-e2e`；不创建第二工作线。

### Phase B — 单个 real-stack spec

1. 新建 `frontend-v2/tests/e2e/system-admin-real-stack.spec.ts`，沿用 real-stack env skip、external base URL、generated API types 和 `expectSecretsAbsent`。
2. 一个 test 内使用默认 ADMIN context 和一个显式 ENGINEER context；ENGINEER context 在 `finally` 关闭。
3. 按 design 实现 UI login/create/forced change、System nav/route 403、六个真实 API 403、reset 后 401、bulk partial、Audit filter/lazy Detail、delete/history。
4. 核心 mutation 全走 UI；API request 只做权限、canonical session 与 safe read 断言。
5. secret 集合覆盖全部 password、实际 CSRF 和 cookie value；禁止 body/header/storage/trace/video/screenshot/attachment 输出。

### Phase C — 接入唯一 orchestration

1. 在 `deploy/scripts/e2e-local.sh` 当前 V2 fixed list 中追加 `tests/e2e/system-admin-real-stack.spec.ts`。
2. 保持 `--project=foundation-desktop`、production preview、fixed ports、DB/Redis/storage/process owner 与 EXIT trap 不变。
3. 不修改 Makefile、Playwright config、Compose、依赖或 V1 invocation。

### Phase D — 文档与证据

1. 只有最终 gate 通过后更新 `docs/frontend-v2/07-migration-plan.md`，记录 System Admin E2E 实际完成与 Phase 7 下一项 abstraction review。
2. 更新 `docs/frontend-v2/08-testing-quality-and-acceptance.md`，记录实际 pass/fail、耗时、权限、Request ID、secret scan 与 cleanup 证据。
3. 在当前 Task implementation evidence 写入实际命令、exit code 和结果；不写 password、Cookie、CSRF、request body、header 或 storage state。
4. 无新稳定架构/合同决策，不改 ADR/spec/OpenAPI/database contract。

## 2. Required validation：可独立执行的诊断阶段

这些阶段用于在最终 fail-fast 编排前一次收集所有当前可发现问题。可安全独立执行的阶段应分别完成；单个失败不授权修复无关问题。

### D1 — Shell 与 cleanup owner 静态检查

```sh
bash -n deploy/scripts/e2e-local.sh
backend/.venv/bin/python -m py_compile \
  deploy/scripts/e2e-database.py \
  deploy/scripts/e2e-environment.py
```

复核 diff：新 spec 只接入现有 fixed list，未改变 `trap cleanup EXIT`、database allowlist、Redis allowlist、storage prefix、PID 或固定端口 owner。

### D2 — API drift

```sh
npm --prefix frontend-v2 run api:check
```

### D3 — Auth / System targeted unit-component

```sh
npm --prefix frontend-v2 run test -- \
  src/app/auth/auth-provider.test.tsx \
  src/app/providers.test.tsx \
  src/app/layout/app-shell.test.tsx \
  src/domains/auth/login-page.test.tsx \
  src/domains/auth/account-security-page.test.tsx \
  src/domains/identity/user-list.model.test.ts \
  src/domains/identity/user-list-page.test.tsx \
  src/domains/audit/audit.model.test.ts \
  src/domains/audit/system-audit-page.test.tsx
```

### D4 — 既有 strict fixture E2E

```sh
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/auth-session.spec.ts \
  tests/e2e/system-users.spec.ts \
  tests/e2e/system-audit.spec.ts
```

保持现有全部 Playwright projects；这些 strict suites 继续覆盖 fixture contract、响应式和交互，不在新 real-stack spec 复制。

### D5 — Frontend lint / typecheck / production build

```sh
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
```

### D6 — Backend identity/audit 定向 integration nodes

```sh
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest \
  tests/integration/test_identity_management.py::test_auth_session_probe_distinguishes_anonymous_and_invalid_sessions \
  tests/integration/test_identity_management.py::test_user_query_export_and_temporary_password_flow \
  tests/integration/test_identity_management.py::test_user_delete_and_reset_password_boundaries \
  tests/integration/test_identity_management.py::test_single_and_bulk_status_share_transaction_invariants \
  tests/integration/test_identity_management.py::test_audit_log_query_detail_filters_and_current_actor_projection \
  tests/integration/test_identity_management.py::test_user_status_commands_record_success_only
```

分别覆盖匿名/撤销 session、首次改密/403、reset/delete/history、bulk partial/最后管理员、Audit projection/权限和 success-only 审计。

### D7 — 禁止模式与敏感产物静态检查

```sh
if rg -n \
  'page\.route|route\.fulfill|postData\(|allHeaders\(|storageState|testInfo\.attach|page\.screenshot' \
  frontend-v2/tests/e2e/system-admin-real-stack.spec.ts; then
  exit 1
fi
```

人工 diff review 同时确认：无 Mock/fixture import、无 request/response body dump、无 secret 进入 URL/metadata/assertion message、无第二 scanner/helper framework。真实 API request 的 `data` 仅用于发送权限验证 payload，不记录请求正文。

## 3. Required validation：最终 fail-fast 编排

### 3.1 前置只读确认

1. `DATABASE_URL` 指向用户批准且宿主可访问的本地 PostgreSQL owner；不读取服务器配置。
2. `REDIS_URL` 指向本 Task 独占的非零 logical DB；运行现有 preflight 证明无未知 key/client。
3. 8000、9001、5173、4173、4174、19009 没有未知 owner；失败则停止，不终止未知进程。
4. D1–D7 已完成，candidate 合理预期成功。

### 3.2 唯一 fail-fast 入口

```sh
DATABASE_URL="$PARTSIGNAL_E2E_HOST_DATABASE_URL" \
REDIS_URL="$PARTSIGNAL_E2E_EXCLUSIVE_REDIS_URL" \
deploy/scripts/e2e-local.sh
```

两个 task-local 变量只在运行时注入已批准 URL；不 `set -x`，不写入 Task artifact。

记录实际值，不以计划值冒充结果：

- shell exit code 与 wall-clock duration；
- V2 real-stack 实际 pass/fail 数；当前候选预期由 14 增至 15，但验收只认实际输出；
- V1 suite 实际 pass/fail 数；
- spec 内 password/CSRF/cookie artifact scan 结果；
- `E2E_CLEANUP` 的 Redis/database/storage/process/port 证据。

脚本为 fail-fast：V2 失败时 V1 不运行，但 EXIT trap 仍必须清理。发生意外失败后先完成尚未运行且仍安全的独立诊断；代码、配置或环境未改变时不重跑同一失败命令。

### 3.3 事后 cleanup 只读验证

- 只查询脚本实际输出的 `partsignal_e2e_*` 数据库名，确认不存在；不删除其他库。
- 检查本次独占 Redis DB 的 size/client/allowlisted keys，确认无本次残留；不 flush。
- 确认本次 `mktemp` storage 路径不存在、本次 PID 均退出。
- 逐个确认 8000、9001、5173、4173、4174、19009 已释放；发现未知占用只报告。

## 4. Required validation：收尾

```sh
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-system-admin-e2e
```

最后检查完整 diff：

- 无产品/backend/contract/schema/permission 变更；
- 无 `page.route`、Mock API、fixture、固定成功路径；
- 无 request-body/header dump、secret 回显、storage export 或 trace/video artifact；
- 无硬编码 revision、409 重放、fallback、第二权限判断、第二 orchestration 或万能 helper；
- 文档、Task evidence 与实际命令结果一致，且无无关文件。

## 5. Optional validation

只有 diff 触及共享 owner、独立诊断显示相关风险或用户另行要求时运行：

```sh
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-integration
```

`make verify` 明确留给 `frontend-v2-system-abstraction-review` 或发布门禁，不属于本 Task Required/Optional 默认流程。

## 6. 失败处理

1. 记录 command、exit code、最小症状、root owner 和是否归因当前 diff；不记录 secret/body/header。
2. 只修复本 Task selector/wait/assertion/secret scan 调用/fixed-list 接入问题。
3. Auth、Users、Audit、API、权限、session、database 或产品行为失败：停止并提出 blocker，不修改测试制造通过。
4. cleanup 或 secret 检查失败：立即停止；不得用扩大删除、关闭未知进程或减少扫描绕过。
5. 可安全独立的未运行诊断继续完成后批量报告；同一失败只在相关代码、配置或环境改变后重跑。

## 7. Commit 与交付门禁

1. 所有 Required validation 和 self-review 完成后，先展示 commit plan：拟提交文件、提交边界、commit message、验证结果和残余风险。
2. 未获用户确认不 commit；任何时候都不自动 push/PR。
3. 用户确认后才提交到唯一临时分支。
4. `task.py archive` 前说明可能产生 Trellis bookkeeping commit并等待确认。
5. 后续 fast-forward 合入 `main` 和删除本地临时分支必须以实际 clean 状态为前提；不改写历史。

## 8. 实际实施与验证结果

- Phase A–C 已完成：Task 状态为 `in_progress`，分支为 `codex/frontend-v2-system-admin-e2e`；只新增一个 real-stack spec，并在既有 V2 fixed list 追加一行。
- D1、D2、D4–D7 通过：shell/Python syntax、API drift、strict fixture E2E `22 passed`、lint、typecheck、production build、backend integration `6 passed / 6.18s`，禁止模式检查无匹配。
- D3 唯一非零结果来自未改动的 `user-list-page.test.tsx` 7 条和 `system-audit-page.test.tsx` 1 条；两者均因独立 component harness 未包裹归档 Auth UI 引入的 `AuthProvider` 而失败。逐文件复现稳定，当前 diff 未修改该 owner，本 Task 不扩围。
- 唯一最终 fail-fast 编排通过：V2 real-stack `15 passed (1.2m)`，V1 E2E `52 passed (5.5m)`，退出码 `0`，总耗时 `417s`。
- 新场景实际完成 ADMIN/ENGINEER UI 生命周期、六个真实 API 403、reset 后 `401/AUTH_REQUIRED`、bulk `1` 成功 + `1` 个 `LAST_ADMIN_REQUIRED`、create/reset/bulk Request ID 审计、lazy Detail 与删除后历史保留。
- secret/artifact scan 通过；未生成 trace/video/screenshot/storage state/attachment，未输出 request body/header。
- EXIT trap 报告 Redis DB 14 key 删除、六端口释放、临时数据库 drop、临时 storage 移除；事后只读核验为 Redis DB 14 `0` key、临时数据库 `0`、storage 不存在、六端口全部空闲。
- 按约束未运行 `make verify`。
