# Identity IntegrityError 合同决策实施计划

> 本文是后续 T3 `identity account constraints` 的执行计划。本 T3-C 只冻结计划，不运行 `task.py start`、不实施以下步骤。

## Phase 0：T3-C 收口与独立 T3 入口

- [x] 当前 T3-C 的一次 targeted re-review 已完成，3 个 MEDIUM 和 3 个 LOW 均关闭，且未发现新的 MEDIUM 以上问题。
- [ ] 审批者明确接受 `409 USER_USERNAME_EXISTS` 的完整 wire contract、Frontend recovery、确定性 delete 锁序验收与 `23503` 保持不变决策。
- [ ] 用户在最新 planning summary 之后明确批准进入 T3；批准前不创建或启动 implementation child。
- [ ] 获批后另建 `identity-integrity-error-domain-mapping` child，parent 指向 `09-04-integrity-error-domain-mapping`；不得复用或启动当前 `identity-integrity-error-contract-decision`。
- [ ] 新 implementation child 自有并完成 reviewable `prd.md`、`design.md`、`implement.md`，其中显式写入对本 T3-C 的依赖、精确文件边界、验收和停止条件。
- [ ] 新 implementation child 的 `implement.jsonl`/`check.jsonl` 各包含真实 spec/research entry，seed example 已删除；只对该新 child 执行 `task.py start`。
- [ ] 主工作区仍在 `main`，重新记录 dirty baseline；任何既有脏文件和 artifacts 都不纳入 T3。
- [ ] 在任何 commit 前向用户提交精确 commit plan 并取得确认；不自动 push。

未满足上述任一项时，不开始 T3。本 T3-C 永久保持 planning-only，不持有实现进度或实现提交。

## Phase 1：数据库与合同 preflight

### 1.1 真实 catalog 与 diagnostics

- [ ] 在 current head 测试数据库确认 `users.username` 唯一约束的唯一精确名称为 `uq_users_username`。
- [ ] 触发真实 duplicate，确认 `error.orig.sqlstate == "23505"` 且 `error.orig.diag.constraint_name == "uq_users_username"`。
- [ ] 确认 username 存储与预检继续共用服务端 `strip().lower()`。
- [ ] 确认 `pk_users`、`ck_users_account_type` 与现有 FK 名不被 username allowlist 接受。

若 catalog/diagnostics 与设计不同，立即停止；不添加别名、文本解析、fallback 或 migration。

### 1.2 公共合同零变更基线

- [ ] 确认 `createUser` 的 OpenAPI status 仍为 `201/400/401/403/409/422`，409 仍引用共享 ErrorResponse。
- [ ] 确认 router runtime metadata 已包含 `401/403/409/422` 且 ErrorEnvelope schema identity 正确。
- [ ] 记录 `contracts/openapi.yaml`、generated schema、`test_contract.py`、`test_runtime_response_metadata.py` 基线；T3 不修改它们。

## Phase 2：Backend username mapper

- [ ] 在 `backend/app/services/identity.py` 增加唯一 `_user_username_conflict()`，精确返回：
  - status `409`；
  - code `USER_USERNAME_EXISTS`；
  - message `用户名已存在`；
  - details `{"errors":[{"loc":["body","username"],"msg":"用户名已存在","type":"user_username_exists"}]}`。
- [ ] 让现有 username precheck 使用同一构造器，不再返回 `REVISION_CONFLICT`。
- [ ] 在新增 User 的既有 flush 边界只识别 `23505 + uq_users_username`；识别后 rollback 并 `raise ... from error`。
- [ ] diagnostics 缺失、sqlstate 不同或 constraint name 不同时原异常继续抛出。
- [ ] 保持 normalize、password hash、默认启用/must-change-password、audit 内容与 commit 顺序不变；SUCCESS audit 仍只在 flush 成功后追加。
- [ ] 不新增全局 mapper、registry、repository、额外锁、自动重试或第二次重复查询。
- [ ] 对 touched Python 函数/异常分支做文档语言检查；只为非显然责任保留中文 docstring/comment。

## Phase 3：Backend 测试

在 `backend/tests/integration/test_identity_management.py` 内完成，不新建通用 harness：

### 3.1 Username contract 与 race

- [ ] 常见 HTTP duplicate 精确断言 status/code/message/details/request ID，且不再出现 `REVISION_CONFLICT`。
- [ ] 两个独立 Session/connection 使用只存在于测试中的 barrier，在双方完成 username precheck 后竞争写入；不把 barrier 放进 production。
- [ ] 断言恰一方创建成功、恰一方得到 `USER_USERNAME_EXISTS`、数据库恰一 normalized User。
- [ ] 断言败者 cause 的 `sqlstate=23505`、constraint name=`uq_users_username`；预检与 constraint 路径除 request ID 外响应完全相同。
- [ ] 以真实 `23505` 但不同 constraint 的 sentinel 证明 allowlist；原 `IntegrityError` 对象继续抛出并可清理事务。对缺失 diagnostics 使用最小定向分支测试，不以 mock 替代获批 constraint 的真实 PostgreSQL证据。
- [ ] 用失败 request ID 查询审计，证明无 `user.created` SUCCESS；新 Session 断言无第二行/SessionRecord，赢家只有一条成功审计，失败 Session cleanup 后可查询。

### 3.2 Delete 23503 保持不变

- [ ] 扩充现有 reference precheck 用例，精确断言动态 message、`details.references` 与 request ID。
- [ ] 场景 A 使用两个独立 Session、test-only event/barrier 和有界 timeout：引用事务插入真实 FK row 后保持未提交；启动 delete，并通过 `pg_stat_activity` 确认其等待锁。随后提交引用，断言 delete precheck 返回带 `details.references` 的 `USER_IN_USE`，User/reference 均保留，无成功删除审计。
- [ ] 场景 B 用 test-only wrapper 在 delete 已取得 User `FOR UPDATE` 且完成零引用 precheck 后暂停；启动引用写入并通过 `pg_stat_activity` 确认其等待 parent key-share。释放 delete 后，断言 delete 成功、引用写入得到真实 PostgreSQL `23503`，最终无 User、无引用、无悬空记录。
- [ ] 两个锁序场景不得使用 `sleep` 或只记录非确定性结果；未在 timeout 内观察到预期 wait、异常或最终状态均为失败。
- [ ] 独立 fallback sentinel 保留已提交的真实业务 FK row，并通过 test-only wrapper 让 reference counter 返回零，使 delete flush 确定触发 current-head PostgreSQL `23503`；不修改 production lock 或 schema。
- [ ] fallback sentinel 断言 cause sqlstate 为 `23503`，HTTP/service 映射为 `409 USER_IN_USE`、message `用户仍有业务历史引用，不能删除`、details `{}`；新 Session 断言 User/reference 均保留、无 `user.deleted` SUCCESS audit，失败 Session rollback 后可查询。
- [ ] 保持 stale revision=`REVISION_CONFLICT`、active user=`USER_ACTIVE`、非 23503 原抛的回归断言。

## Phase 4：Frontend mapper 与 Dialog

### 4.1 纯投影

- [ ] 在 `frontend/src/domains/identity/user-list.model.ts` 增加 create-user 专用纯 mapper，输入 generated `ErrorDetail`，只按 exact `USER_USERNAME_EXISTS` + exact `body.username` 定位字段。
- [ ] mapper 输出 username field message、form summary fallback 与 request ID；message 只展示，不参与分支。
- [ ] mapper 不导入 `UserRequestError`，不制造 `user.api.ts` 循环依赖，不抽取跨域 error framework。
- [ ] 在 `user-list.model.test.ts` 覆盖 canonical loc、details 缺失、malformed errors、unknown loc、其他 code 和 request ID。

### 4.2 UI recovery

- [ ] 在 `user-list-page.tsx::CreateUserDialog` 消费 mapper：canonical duplicate 调用 `form.setError('username', ...)` 并聚焦 username。
- [ ] 所有失败都保留 username/display name/account type、清空 temporary password、保持 Dialog 打开并 reset mutation state。
- [ ] canonical inline error 与所有 summary fallback 都显示 request ID；malformed/unknown 不猜字段。
- [ ] duplicate 不进入 revision conflict/delete freeze，不显示 reload、不自动 GET/replay、不调用 `onCreated()`。
- [ ] 在 `user-list-page.test.tsx` 覆盖字段可访问性、focus、safe draft 保留、secret 清除、request ID、显式重试与无成功 invalidation。
- [ ] 保持成功 create 的 Dialog close、form reset 和既有 users query invalidation。

## Phase 5：权威文档与稳定 specs

- [ ] `contracts/database.md` 记录 username normalized identity、`uq_users_username`、`23505 + exact constraint -> USER_USERNAME_EXISTS` 与 unknown 边界；不复制 UI 细节。
- [ ] `docs/frontend-v2/05-business-actions-state-and-api-contract.md` 记录 exact code/loc、request ID、safe draft、temporary password、focus、retry/reload/replay/invalidation 规则，以及 delete `USER_IN_USE` 保持不变。
- [ ] `.trellis/spec/backend/database-guidelines.md` 同步 identity command 的 constraint allowlist、flush/audit/rollback 与真实 PostgreSQL证据要求。
- [ ] `.trellis/spec/frontend/state-management.md` 同步 User create Dialog 的字段恢复、secret 清除和 malformed fallback。
- [ ] `.trellis/spec/backend/error-handling.md` 保持零 diff；其既有通用 structured diagnostics、unknown 500、field error 与 request ID 规则继续作为上位约束。
- [ ] 执行 touched-scope documentation pass，确认代码、合同、docs、specs 和 tests 没有同一事实的冲突版本。

## Phase 6：Required validation

先执行定向 development checks；全部通过后，候选上只运行一次正式 contract gate。

### 6.1 Backend integration（真实 PostgreSQL）

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest \
  tests/integration/test_identity_management.py
```

必须记录通过/失败/跳过数量，并在新增测试输出或 assertion 中证明：精确 23505/constraint、双事务单赢家、precheck/DB error 等价、unknown 原抛、失败无成功审计/部分状态、真实 delete 23503 与 Session cleanup。

### 6.2 Backend contract/runtime 回归

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_runtime_response_metadata.py
```

预期只验证既有合同，无测试数据计数或 signature 修改。

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

### 6.5 正式 contract gate（一次）

默认只运行一次较窄的正式 gate：

```bash
make contract-check
```

若用户明确要求 release/full gate，则以一次 `make verify` **替代** 上述 `make contract-check`，不得两者都运行；`make verify` 已依赖 `contract-check`。

无论选择哪个正式 gate，随后执行 scoped diff 检查：

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

第一条 scoped diff 命令覆盖 `design.md` 第 7.2 节的全部只读 owner；第二条检查全部允许修改文件的 whitespace/error diff。若实施开始时任一路径已有用户改动，必须与 Phase 0 记录的 scoped baseline 比较，不能覆盖或误报用户变更。

## Phase 7：Optional validation

仅在证据把风险扩大到共享 owner、用户明确要求或准备 release 时执行：

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run e2e
```

完整 backend unit、frontend 全套、build 与 E2E 默认 optional。release/full gate 需要 `make verify` 时，按 Phase 6.5 把它作为正式 gate 的唯一入口，而不是在本阶段追加执行。任何 full-scope gate 只能在定向检查全部通过后的候选上运行一次；失败不得在同一回合无差别重跑。

## Phase 8：Diff、review 与交付门槛

- [ ] scoped diff 只包含 `design.md` 第 7.1 节允许的 T3 文件，且无 migration、router、OpenAPI、generated、runtime count 或全局 handler 改动。
- [ ] 检查无 symptom patch、宽泛 23505、文本解析、hidden fallback、第二错误 registry、自动 replay、secret 保留或无关 UI 变更。
- [ ] comments/docstrings/developer-visible text 的 touched-scope 中文检查完成。
- [ ] 执行一次独立只读 review，重点检查 constraint owner、事务 rollback、真实并发/23503 证据、secret 与 request ID；修复后最多一次 targeted re-review。
- [ ] re-review 若仍有同一问题或新 MEDIUM 以上问题，停止并报告。
- [ ] required validation 全部有实际结果；optional 未运行项与残余风险如实记录。
- [ ] 准备 commit 前给出精确文件清单与 commit message 计划并取得用户确认；不自动归档、不 push。

## Stop Conditions

- current head constraint name/diagnostics 与设计不一致，或需要 migration/多个 constraint alias。
- OpenAPI status/wire、router metadata、generated type 或通用 error spec 实际需要变化。
- username race 无法在两个独立 Session 中观察获批 diagnostics，且同一测试编排根因已重复。
- delete 23503 只能通过削弱 production lock、改变 schema 或伪造数据库异常才能触发。
- 任一 gate 两次定向 repair/re-check 后仍失败，或同一根因重复。
- 独立 targeted re-review 仍发现 MEDIUM 以上问题。

发生停止条件时，保留当前 diff，报告原始失败、已尝试修复、受影响文件与可选下一步；不扩大范围或把失败改成猜测成功。
