# Frontend V2 System 抽象回顾 — Implement Plan

## 0. 当前门禁

- [x] 主工作区在 `main`；创建 Task 前 clean。
- [x] `frontend-v2-system-admin-e2e` 已合入并归档。
- [x] 无遗留 `codex/frontend-v2-system-admin-e2e` branch/worktree。
- [x] 已完成必读文档、归档任务与当前 System/Auth/App Shell/API/tests/E2E 审计。
- [x] Task 已创建并在计划批准后启动。
- [x] 用户批准本计划。
- [x] 已执行 `task.py start` 并创建唯一临时分支 `codex/frontend-v2-system-abstraction-review`。

当前已完成任务内最小修正、独立诊断和 Gate 判定；未运行完整 `make verify`，也未 commit、push、创建 PR 或归档。

## 1. 批准后的实施顺序

### Phase A — 启动与隔离

1. 再次确认主工作区仍在 `main`，除当前已知 Task artifacts 外没有未识别变更；不 pull。
2. 再次确认目标临时分支/worktree 不存在。
3. 运行：

```sh
python3 ./.trellis/scripts/task.py start frontend-v2-system-abstraction-review
git switch -c codex/frontend-v2-system-abstraction-review
```

4. 不创建第二分支/worktree，不做 commit/push/PR。

### Phase B — 最小修正

1. 从 Auth owner 导出既有 `authSessionQueryKey`；在 Users/Audit page tests 的 QueryClient 写入 canonical session。
2. 在 Audit filters submit 的转换前拒绝空时间，复用现有 alert；增加一条可观察行为测试。
3. `AdminBoundary` 改为直接 `Outlet`；删除无消费者 `auditKeys.lists/details`。
4. 不改 runtime 权限逻辑、Users/Audit API、OpenAPI、backend、旧 frontend 或 E2E orchestration。

### Phase C — 文档与 Gate 记录

1. 只有 Required Validation 全绿后，更新 `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md`。
2. 写入实际命令、exit code、pass/fail、耗时和 Exit Gate 判定；不记录 password、CSRF、Cookie、request body/header 或 storage state。
3. 无新稳定架构事实则不改 ADR/spec/01/04/05/06/contracts。

实际结果：Required Validation 未全绿，因此未修改 07/08、ADR、spec、contracts 或其他权威设计文档；失败证据仅记录在当前 Task artifacts。

## 2. Required Validation — 最小定向发现阶段

### R1 — 依赖与禁止抽象静态检查

```sh
if rg -n "from ['\"]@/domains|from ['\"]@/routes" frontend-v2/src/design-system frontend-v2/src/shared; then
  exit 1
fi

rg -n "from ['\"]@/(design-system|shared)" \
  frontend-v2/src/domains/auth \
  frontend-v2/src/domains/identity \
  frontend-v2/src/domains/audit

rg -n "Admin|CRUD|Permission|Workflow|Audit" \
  frontend-v2/src/design-system frontend-v2/src/shared
```

第三条为人工归因清单，不以名称匹配自动判错；检查业务 DTO/token/role/status 是否被下沉。

### R2 — System/Auth 定向 Vitest

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

必须由当前观测的 `8 failed | 32 passed` 恢复为全绿，并新增 Audit 空时间行为证据。失败时先归因，不修改 route/auth owner 或放宽断言。

### R3 — strict fixture E2E

```sh
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/auth-session.spec.ts \
  tests/e2e/system-users.spec.ts \
  tests/e2e/system-audit.spec.ts
```

保留全部 Playwright projects；不新建重复 spec。确认 trace 关闭的敏感路径、Users 响应式/批量、Audit mobile Sheet/desktop detail/焦点均通过。

### R4 — Backend authority 定向 integration

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

该阶段只证明现有服务端权威没有回归；任何失败不授权修改 backend/contract。

## 3. Required Validation — 最终门禁前的独立阶段

`Makefile` 的 `verify` 是 fail-fast。为集中发现阻塞项，在最终候选前逐项执行其所有安全独立阶段；一个阶段失败后仍完成不依赖该失败的其他阶段，批量归因。代码/配置/环境没有发生相关变化时不重跑同一失败命令。

```sh
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make build
make e2e
docker compose --env-file .env -f deploy/compose.dev.yaml config --quiet
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend PARTSIGNAL_VERSION=test \
  docker compose --env-file .env -f deploy/compose.prod.yaml config --quiet
```

阶段说明：

- `make test-unit` 覆盖 backend、旧 frontend、frontend-v2；R2 是修复发现环，不能替代该阶段。
- `make e2e` 复用唯一 `deploy/scripts/e2e-local.sh`，随后运行 frontend-v2 全部 Playwright；不建立第二入口。
- real-stack 运行前执行既有 owner/preflight；未知 port/process/database/Redis/storage owner 只报告并停止。
- secret scan、trace/video/screenshot/attachment 与 cleanup 以既有 Auth/Admin real-stack 断言和脚本输出为准，不打印 secret。

## 4. Required Validation — 唯一最终 fail-fast Gate

只有 R1–R4 和第 3 节全部通过、candidate 合理预期成功时，运行一次：

```sh
make verify
```

不得在代码、配置或环境未改变时重复执行。若失败：记录失败 stage、exit code、最小症状和 owner；完成仍安全的独立诊断后，将 Phase 7 判定为 `NOT_MET`。只修复归因当前任务且在已批准范围内的问题。

## 5. Required Validation — 收尾

```sh
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-system-abstraction-review
git status --short --branch
```

完整 diff review：

- 无 route→domain→DS/shared 反向依赖或业务 DTO 下沉。
- 无 role/status eligibility 推导、第二 auth/session/cache/selection owner、silent fallback 或 broad catch。
- 无新 Admin/CRUD/Permission/Audit/workflow framework、机械拆文件、重复 E2E/orchestration/scanner。
- 无 password/CSRF/Cookie/request body/header/storage/trace/video/screenshot/attachment 泄漏。
- 无 backend/contracts/database/旧 frontend/归档任务/无关文件修改。
- 文档、Task artifacts 与实际结果一致。

## 6. Optional Validation

以下默认不运行；只有独立阶段显示相关风险或用户另行要求时执行：

```sh
npm --prefix frontend-v2 run build-storybook
make test-deploy-scripts
```

不做临时浏览器 walkthrough、Lighthouse、性能测试、staging deploy 或 Phase 8/9 E2E；现有 automated evidence 足以覆盖本任务。

## 7. Phase 7 Exit Gate 判定

### `MET`

- P0 = 0；F09/F10/F11 已完成，System 无未关闭 P1；无未经批准的阻塞 P2。
- 八项 shared invariant 复核通过，没有独立 blocker。
- Required Validation 全部通过，最终唯一一次 `make verify` exit 0。
- 07/08 文档与 Task evidence 已记录实际结果。

### `NOT_MET`

- 任一 Required Validation 非零或无法安全运行。
- 存在未关闭 P0/P1、secret 泄漏、第二来源、权限/状态推导或 orchestration ownership 冲突。
- 发现需要修改 OpenAPI/database/permission/public API/backend state machine 的 blocker。
- 文档与实际证据无法保持一致。

## 8. 失败处理、停止与回滚

1. 失败先归因；不通过改测试预期、静默默认、重试循环或减少检查制造通过。
2. 合同/权限/数据库/backend blocker：停止、判 `NOT_MET`、建议独立 Task。
3. 未知 external owner 或 cleanup/secret failure：立即停止，不终止未知进程、不扩大删除。
4. 回滚只反向应用本任务确切 hunks；不使用 reset-hard、checkout、历史改写或宽泛删除。
5. 不自动 commit/push/PR。

## 9. 实际验证结果

| 阶段 | 结果 | 证据 |
| --- | --- | --- |
| R1 依赖与抽象静态检查 | PASS | Design System/shared 无 domain/route 反向导入；名称命中仅为 generated contract types，无业务 DTO 下沉 |
| R2 System/Auth 定向 Vitest | PASS | 9 files、41 tests 全绿；包含 Audit 空时间不请求、不改 URL 的新证据 |
| R3 strict fixture E2E | PASS | Auth/Users/Audit 全 projects 共 22 tests 通过 |
| R4 backend authority integration | PASS | 6 tests 通过 |
| `make contract-check` | PASS | exit 0 |
| `make lint` | PASS | 首次发现本任务 unused binding 后修正；候选重跑 exit 0 |
| `make typecheck` | PASS | exit 0 |
| `make test-unit` | FAIL | backend 200 passed、1 failed；独立执行旧 frontend 205 unit + 24 visual contract 全绿；frontend-v2 311 passed、146 failed |
| `make test-integration` | PASS | 117 tests 通过 |
| `make build` | PASS | backend、旧 frontend、frontend-v2 构建通过 |
| `make e2e` | FAIL | 旧 frontend real-stack 52 tests 全绿并完成 cleanup；frontend-v2 375 passed、31 skipped、4 failed |
| dev/prod compose config | PASS | 两条 `config --quiet` 均 exit 0 |
| 最终 `make verify` | NOT RUN | unit 与 E2E 已非零，candidate 不再合理预期通过；按本计划第 4 节停止 |

### Exit Gate

`NOT_MET`。任务内 P1/P2 已修复且 System vertical slice 的定向证据全绿，但仓库级 Required Validation 仍有四个独立 owner 阻塞；不得用本任务扩修或跳过它们来制造 Gate 通过。

## 10. 当前建议的精确 commit 范围

如用户批准保留当前结果，建议一个 work commit：

```text
refactor(frontend-v2): tighten system ownership boundaries
```

拟包含且仅包含：

- `frontend-v2/src/app/auth/auth-provider.tsx`
- `frontend-v2/src/domains/identity/user-list-page.test.tsx`
- `frontend-v2/src/domains/audit/audit.api.ts`
- `frontend-v2/src/domains/audit/system-audit-page.tsx`
- `frontend-v2/src/domains/audit/system-audit-page.test.tsx`
- `frontend-v2/src/routes/_app/_admin/route.tsx`
- `.trellis/tasks/08-17-frontend-v2-system-abstraction-review/**`

07/08 不在当前 commit 范围：Gate 未全绿，按 Phase C 保持权威文档不变。提交前必须向用户展示实际 diff、validation 和 residual risk 并再次获得确认；不自动归档或 push。
