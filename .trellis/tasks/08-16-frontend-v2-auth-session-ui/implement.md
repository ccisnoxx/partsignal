# Frontend V2 Auth Session UI — Implement Plan

## 0. 当前执行门禁

- [x] 用户授权独立创建 `frontend-v2-auth-session-ui` blocker Task。
- [x] Task 已创建，规划阶段保持 `planning`。
- [x] 已核对 V2 route/AuthProvider、OpenAPI/backend must-change contract、既有测试与唯一 real-stack owner。
- [x] PRD、design 与 implement plan 已形成可评审版本。
- [x] 用户批准本规划并明确授权实现。
- [x] 已运行 `task.py start`，Task 状态为 `in_progress`。

实现与 Required validation 已完成；未获 commit plan 确认前不提交。`frontend-v2-system-admin-e2e` 继续保持 `planning`。

## 1. 实施顺序

### Phase A — 建立基线

1. 确认主工作目录仍在 `main`，除已识别的两个 planning Task 外无未识别脏文件；不自动 pull/push。
2. 重新完整读取待修改的 AuthProvider、route、AppShell、测试与生成 route tree；若 contract/owner 已变化，先刷新规划。
3. 运行 `task.py start frontend-v2-auth-session-ui`；不创建临时分支。

### Phase B — canonical Auth session

1. 在 `auth-provider.tsx` 增加 direct async `signIn` 与 `changePassword`，复用现有 request error 与 session Query owner。
2. login 成功清除非 Auth Query 并写入 AuthSession；change 成功必须 refetch 服务端状态。
3. 不把 password 放入 Query mutation、storage、URL 或日志；只为非显而易见的 cache/session 边界补中文注释。
4. 扩充 provider tests，先证明 exact payload、CSRF、cache replacement、refresh 与失败路径。

### Phase C — routes 与页面

1. 新增 `domains/auth/login-page.tsx`、`account-security-page.tsx` 及对应 tests；使用已安装 RHF/Zod/design-system primitives。
2. 新增顶层 `/login` 与 `/account/security` route 文件，保持 route 只做组合。
3. 修改 `_app/route.tsx` 实现共同 loading/error/anonymous/must-change boundary，只有 active session 才 mount App Shell。
4. 在 Account Menu 增加修改密码 Link；保留现有 logout owner。
5. 通过既有 router plugin 更新 `routeTree.gen.ts`，不手写生成结果之外的 route registry。
6. 更新 `providers.test.tsx` 与 `app-shell.test.tsx` 覆盖受影响行为。

### Phase D — production artifact 与 real stack

1. 新增 strict `auth-session.spec.ts`，spec-local 声明 Auth API state，mobile/desktop 覆盖核心状态；显式关闭 trace。
2. 将 Foundation fixture 改为显式 active ADMIN session，使 Foundation smoke 继续验证 App Shell。
3. 新增 desktop `auth-session-real-stack.spec.ts`，用 seed ENGINEER 完成 UI login → forced change → admin 403 → logout。
4. 只把该 real-stack spec 追加到 `deploy/scripts/e2e-local.sh` 既有 V2 fixed list；不增加 config、脚本或资源 owner。
5. 扫描 Playwright output，确认测试密码不在附件或持久文件；不输出请求体、cookie、CSRF 或 storage state。

### Phase E — 文档与证据

1. 只在实际验证通过后更新 `docs/frontend-v2/07-migration-plan.md` 与 `08-testing-quality-and-acceptance.md`。
2. 在本 Task research/implementation evidence 记录实际命令、exit code、pass 数、耗时和 cleanup；不记录秘密值。
3. 对照 PRD 检查 code/tests/docs 一致；无 contract/database/backend 变更。
4. 更新 E2E Task 的 blocker 状态为“实现候选已通过、待提交归档后重新审计”，但不 start E2E Task。

## 2. Required validation：独立诊断

先独立运行可安全发现问题的阶段；不以重复 full gate 作为诊断循环。

### 2.1 Targeted unit/component

```sh
npm --prefix frontend-v2 run test -- \
  src/app/auth/auth-provider.test.tsx \
  src/app/providers.test.tsx \
  src/app/layout/app-shell.test.tsx \
  src/domains/auth/login-page.test.tsx \
  src/domains/auth/account-security-page.test.tsx
```

### 2.2 Contract drift

```sh
npm --prefix frontend-v2 run api:check
```

### 2.3 Strict production-artifact E2E

```sh
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/auth-session.spec.ts \
  tests/e2e/foundation-smoke.spec.ts
```

两个 Playwright project 均运行；Auth spec 自身 trace off，检查 mobile/desktop。不得使用临时 Playwright CLI session。

### 2.4 Frontend static/build

```sh
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
bash -n deploy/scripts/e2e-local.sh
```

### 2.5 Backend authoritative integration node

```sh
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test \
  pytest tests/integration/test_identity_management.py::test_user_query_export_and_temporary_password_flow
```

该 node 已覆盖真实 login、must-change allowlist、change-password、旧密码失效与新密码生效；Auth Task 不修改它，只确认前端依赖的权威状态机仍成立。

## 3. Required validation：唯一真实栈

在上述诊断通过、且 task-local PostgreSQL/Redis owner 已按既有脚本要求确认后，使用唯一入口：

```sh
DATABASE_URL="$PARTSIGNAL_E2E_HOST_DATABASE_URL" \
REDIS_URL="$PARTSIGNAL_E2E_EXCLUSIVE_REDIS_URL" \
deploy/scripts/e2e-local.sh
```

记录实际 exit code、V2/V1 pass 数、wall-clock、Auth secret scan 与 `E2E_CLEANUP` 数据库/Redis/storage/port 证据。不得使用 `set -x` 或把环境变量值写入 task artifact。

失败时不在环境/代码未变化的情况下重跑；先完成仍可安全执行的独立诊断并统一归因。cleanup 仍必须由既有 EXIT trap 完成。

## 4. Required validation：收尾

```sh
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-auth-session-ui
```

检查完整 diff：无第二 auth state、无 password cache/storage/artifact、无客户端权限权威、无 guessed field、无 broad fallback、无新依赖、无第二 orchestration、无无关改动；代码/测试/文档与实际结果一致。

## 5. Optional validation

只有共享影响证据、required failure 归因或用户另行要求时运行：

```sh
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-integration
```

`make verify` 与 Phase 7 完整 exit gate 留给后续 abstraction review，不属于本 blocker 默认范围。

## 6. 失败处理

1. 记录失败 command、exit code、最小症状、root owner 与是否由当前 diff 引起。
2. 只修复当前批准范围内的 Auth UI、route、test 或 fixed-list 接入问题。
3. backend/API/database/permission/state-machine 缺陷或真实栈 owner 不唯一：停止并回到 planning，不加兼容 fallback。
4. secret artifact 命中：停止，先删除不安全产物并修正记录边界；不得把 sentinel 写入报告。
5. 同一失败只有相关代码、配置或环境变化后才重跑。

## 7. Commit 与交付门禁

1. Required validation 与 self-review 通过后，先向用户展示拟提交文件、提交消息、验证结果与残余风险。
2. 未获确认不 commit；不 push、不建 PR。
3. 用户确认后在 `main` 提交实现。
4. archive 前说明 `task.py archive` 可能创建 Trellis bookkeeping commit，并遵守单独确认要求。
5. Auth Task 归档完成后只更新 E2E blocker 证据并请求下一步；不得自动 start 当前 E2E Task。
