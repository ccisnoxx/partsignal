# Identity IntegrityError 领域映射实施计划

## Phase 0：规划与启动门槛

- [x] implementation child 已独立创建并关联父任务 `09-04-integrity-error-domain-mapping`。
- [x] 已批准的 T3-C `09-05-identity-integrity-error-contract-decision` 作为冻结输入，不再重新决策合同。
- [x] child 自有 `prd.md`、`design.md`、`implement.md` 和真实 `implement.jsonl`/`check.jsonl`。
- [x] 已完成一次独立只读 planning review；未发现 HIGH、MEDIUM 或 LOW 缺陷，无需定向 re-review。
- [x] 用户已在最新 child planning summary 后明确批准启动。
- [x] 仅在上述门槛满足后执行 `python3 ./.trellis/scripts/task.py start .trellis/tasks/09-05-identity-integrity-error-domain-mapping`。
- [x] 已记录实施开始时所有允许修改文件与只读 owner 的 scoped baseline；保留现有其他脏文件/artifacts。
- [x] 提交前已另行给出精确 commit plan 并获得批准；不自动 push。

## Phase 1：数据库与公共合同 preflight

- [x] 在 current-head 测试数据库确认 `users.username` 唯一约束精确名为 `uq_users_username`。
- [x] 触发真实 duplicate，确认 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name == "uq_users_username"`。
- [x] 确认 username 继续由服务端 `strip().lower()` 后预检和持久化。
- [x] 确认其他 unique/PK 及缺失 diagnostics 不在 username allowlist。
- [x] 确认 `createUser` OpenAPI status 仍为 `201/400/401/403/409/422`，409 使用共享 ErrorResponse；router metadata 和 generated schema 已有相同 wire 能力。
- [x] catalog/diagnostics 与公共合同前提成立，未添加 alias、文本解析、fallback 或 migration。

## Phase 2：Backend mapper

- [x] 在 `backend/app/services/identity.py` 增加唯一 `_user_username_conflict()`，返回精确 `409 USER_USERNAME_EXISTS`、`用户名已存在` 和获批 field-error details。
- [x] 让现有 username precheck 复用构造器，不再返回 `REVISION_CONFLICT`。
- [x] 在新增 User 的既有 flush 边界只识别 `23505 + uq_users_username`；命中后 rollback 并保留异常因果链。
- [x] diagnostics 缺失、sqlstate/constraint 不同的 `IntegrityError` 保持原抛。
- [x] normalize、password hash、默认状态、audit payload、flush/commit 顺序不变；失败不写 SUCCESS audit。
- [x] 未引入全局 mapper/registry、额外锁、自动 retry 或 rollback 后查询。
- [x] 对 touched Python owner 完成中文 comments/docstrings/developer-visible text 检查，只记录非显然职责。

## Phase 3：Backend integration tests

### 3.1 Username contract 与 race

- [x] HTTP precheck duplicate 精确断言 status/code/message/details/request ID，且不再出现 `REVISION_CONFLICT`。
- [x] 两个独立 Session/connection 以 test-only barrier 在双方越过 precheck 后竞争同一 normalized username。
- [x] 断言恰一成功、恰一 `USER_USERNAME_EXISTS`、数据库恰一 User；败者 cause 为真实 `23505 + uq_users_username`。
- [x] 比较预检与 constraint 路径，除 request ID 外 status/code/message/details 完全一致。
- [x] 用真实不同 constraint 的 23505 sentinel 与最小缺失 diagnostics 分支证明 unknown 原抛。
- [x] 断言败者 request ID 无 `user.created` SUCCESS、无第二行/SessionRecord；赢家只有一条成功审计；rollback 后失败 Session 可查询。

### 3.2 Delete 23503 保持不变

- [x] 既有 reference precheck 精确断言动态 message、`details.references` 与 request ID。
- [x] 场景 A：引用事务先插入真实 FK row 并保持未提交；delete 的 lock wait 由 `pg_stat_activity` 观测；引用提交后 delete precheck 返回丰富 `USER_IN_USE`，User/reference 保留且无成功删除审计。
- [x] 场景 B：delete 已取得 User `FOR UPDATE` 并完成零引用预检后由 test-only wrapper 暂停；引用写等待 parent key-share 并被数据库观测；释放 delete 后 delete 成功、引用方得到真实 23503，最终无 User/reference/悬空行。
- [x] fallback sentinel：已提交真实业务 FK row + test-only reference counter bypass，使 delete flush 确定命中真实 23503；断言固定 `USER_IN_USE` message、details `{}`、User/reference 保留、无 SUCCESS audit、Session 可恢复。
- [x] 三类证据均使用 event/barrier、数据库 wait 状态和有界 timeout；未使用 `sleep`、伪造数据库异常或修改 production lock/schema。
- [x] stale revision、active user、非 23503 原抛与既有成功删除路径保持回归覆盖。

## Phase 4：Frontend mapper 与 Dialog

- [x] 在 `user-list.model.ts` 增加 create-user 专用纯 mapper，只按 exact `USER_USERNAME_EXISTS` + exact `['body','username']` 定位字段。
- [x] mapper 输出 username field message 或 form summary fallback，并携带 request ID；message 只展示，不参与分支。
- [x] mapper 不导入 `UserRequestError`，不制造 `user.api.ts` 循环依赖或跨域 error framework。
- [x] `user-list.model.test.ts` 覆盖 canonical loc、details 缺失、malformed errors、unknown loc、其他 code 和 request ID。
- [x] `CreateUserDialog` 对 canonical duplicate 设置 username error 并聚焦；所有失败保留安全草稿、清空 temporary password、保持 Dialog 打开并允许显式重试。
- [x] inline 与 summary 均显示 request ID；malformed/unknown 不猜字段。
- [x] duplicate 不进入 revision freeze/reload，不自动 GET/replay，不调用 `onCreated()` 或成功 invalidation。
- [x] `user-list-page.test.tsx` 覆盖可访问字段错误、focus、safe draft、secret 清除、request ID、显式重试、无成功 invalidation和既有成功行为。

## Phase 5：权威文档与 stable specs

- [x] `contracts/database.md` 记录 normalized username、`uq_users_username`、精确 diagnostics 映射和 unknown 边界。
- [x] Frontend V2 行为文档记录 exact code/loc、safe draft、secret、focus、request ID、retry/reload/replay/invalidation 与 delete 合同不变。
- [x] backend database spec 同步 command allowlist、flush/audit/rollback 和真实 PostgreSQL 证据要求。
- [x] frontend state spec 同步字段恢复、secret 清除和 malformed fallback。
- [x] backend error-handling spec 保持零 diff；完成 touched-scope 文档一致性检查。

## Phase 6：Required validation

先运行以下定向检查；全部通过后才运行一次正式 gate。

### 6.1 Backend integration（真实 PostgreSQL）

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest \
  tests/integration/test_identity_management.py
```

记录通过/失败/跳过数量，并保留精确 diagnostics、race、unknown、delete wait/23503、审计原子性和 Session cleanup 证据。

### 6.2 Backend contract/runtime 回归

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_runtime_response_metadata.py
```

### 6.3 Backend touched static checks

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/services/identity.py \
  backend/tests/integration/test_identity_management.py
UV_CACHE_DIR=.cache/uv uv run --project backend mypy \
  --config-file backend/pyproject.toml \
  backend/app/services/identity.py
```

### 6.4 Frontend behavior

```bash
npm --prefix frontend run test -- \
  src/domains/identity/user-list.model.test.ts \
  src/domains/identity/user-list-page.test.tsx
npm --prefix frontend run typecheck
npm --prefix frontend exec -- eslint \
  src/domains/identity/user-list.model.ts \
  src/domains/identity/user-list.model.test.ts \
  src/domains/identity/user-list-page.tsx \
  src/domains/identity/user-list-page.test.tsx
```

### 6.5 正式 gate 与 scoped diff

默认只运行一次：

```bash
make contract-check
```

若用户明确要求 release/full gate，则以一次 `make verify` 替代，不再运行 `make contract-check`。

```bash
git diff --exit-code -- \
  contracts/openapi.yaml \
  backend/app/routers/identity.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_runtime_response_metadata.py \
  backend/app/errors.py \
  backend/app/models/identity.py \
  backend/app/migration_schema_v1.py \
  frontend/src/domains/identity/user.api.ts \
  frontend/src/shared/api/generated/schema.d.ts \
  .trellis/spec/backend/error-handling.md
git diff --check -- \
  backend/app/services/identity.py \
  backend/tests/integration/test_identity_management.py \
  frontend/src/domains/identity/user-list.model.ts \
  frontend/src/domains/identity/user-list.model.test.ts \
  frontend/src/domains/identity/user-list-page.tsx \
  frontend/src/domains/identity/user-list-page.test.tsx \
  contracts/database.md \
  docs/frontend-v2/05-business-actions-state-and-api-contract.md \
  .trellis/spec/backend/database-guidelines.md \
  .trellis/spec/frontend/state-management.md
```

实施开始时若目标已有用户改动，零 diff 检查必须相对 Phase 0 scoped baseline，而不是覆盖或误报用户内容。

### 6.6 本次实际结果（2026-09-05）

- 真实 PostgreSQL identity integration：`14 passed`，覆盖 username precheck/race/unknown、delete 两种锁序、23503 fallback 与非 23503 原抛。
- backend contract/runtime：`401 passed`；Ruff 与 strict mypy 通过。
- frontend 定向 Vitest：`20 passed`；owned-file ESLint 通过。
- frontend typecheck 仍被范围外且未修改的 `frontend/src/domains/publication/publication-work-page.test.tsx:351` 既有错误阻断；两次观察均仅此一项，不在本任务越界修复。
- 正式 `make contract-check` 只运行一次并通过；只读 owner 零差异、allowed-file `git diff --check` 与 Trellis manifests validation 均通过。
- optional 全量 frontend tests/build/E2E 与完整 backend unit 未运行：定向真实数据库、合同/runtime 和 UI 行为证据已直接覆盖本任务边界，当前不是 release/full gate。

## Phase 7：Optional validation

仅在证据扩大风险、用户明确要求或 release readiness 时执行：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run e2e
```

optional/full-scope gate 不得成为无差别修复循环；一次候选 gate 失败后只做归因和定向检查。

## Phase 8：Independent review 与交付

- [x] scoped diff 只包含 PRD 允许文件，无 migration/router/OpenAPI/generated/runtime count/global handler 改动。
- [x] 检查无宽泛 23505、文本解析、hidden fallback、第二 error registry、自动 replay、secret 保留或无关 UI 变更。
- [x] comments/docstrings/developer-visible text 的 touched-scope 中文检查完成。
- [x] required validation 有实际结果；optional 未运行项和残余风险如实记录。
- [x] 一次独立只读 implementation review 完成；4 个 LOW 经一次受限修订及唯一一次定向 re-review 全部关闭，未发现 MEDIUM/HIGH。
- [x] 提交前已向用户给出精确文件清单与 commit message 计划并取得批准；按本轮授权归档，不 push。

## Stop and Repair Limits

- current-head constraint/diagnostics 与设计不一致，或需要 migration/多个 alias。
- OpenAPI/status/wire、router metadata、generated type、通用 error spec 或其他只读 owner需要变化。
- username race 不能在两个独立 Session 中观察批准 diagnostics，且同一编排根因重复。
- delete 23503 只能通过削弱 production lock、修改 schema 或伪造异常触发。
- 任一 gate 最多两次 `repair -> targeted re-check`；相同根因重复或第二次仍失败即停止。
- 正式 gate 只在定向检查通过后的候选上运行一次；独立 review 只允许一次完整 review 和最多一次定向 re-review。

停止时保留当前 diff，报告失败证据、尝试、受影响文件和可选下一步，不扩大范围。
