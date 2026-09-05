# 配置 IntegrityError 精确领域映射执行计划

## Phase 0：实施批准门槛

- [x] 上游 `09-04-configuration-integrity-error-contract-decision` 的 `prd.md`、`design.md`、`implement.md` 已获用户批准。
- [x] 本独立 T2 task 已作为 `09-04-integrity-error-domain-mapping` 的子任务创建。
- [x] `implement.jsonl` 与 `check.jsonl` 已配置真实 spec context，不再是 seed-only。
- [x] 本任务 `prd.md`、`design.md`、`implement.md` 完成实施前 review。
- [x] 用户在本轮最终规划摘要之后明确批准本任务进入实施。
- [x] 开始实施前确认当前 checkout 为 `main`、任务状态为 `planning`，记录全部 dirty baseline。
- [x] 确认 `43c252da`、`a805aeeb`、`1a526da9` 仍在当前基线；unknown IntegrityError 默认 500 sentinel 留待 Backend targeted validation 再确认。

未满足上述全部条件时，不运行 `task.py start`，不修改业务代码。

## Phase 1：实施编排与数据库 preflight

### 1.1 文件所有权

- 主会话拥有并修改 root-level contracts/docs、`.trellis/spec/**`、task artifacts，执行 contract generator、跨层整合、最终验证、commit plan 与提交。
- Backend `trellis-implement` 子代理只拥有 `backend/**` 的批准文件；不得修改 frontend、root-level files、contracts、docs/specs，不得运行 Git。其 prompt 必须说明它并非独自在代码库中工作，必须保留并适配用户及其他代理的合法改动。
- Frontend `trellis-implement` 子代理只拥有 `frontend/src/domains/configuration/**` 的批准文件；不得修改 backend、root-level files、contracts、docs/specs、generated schema，不得运行 Git，并遵守同样的并行协作要求。
- 两条写入支线只在 root contract/generator 基线稳定后并行；任何需要跨边界或改变批准合同的发现都交回主会话并停止对应写入。
- Backend/Frontend 检查分别交给对应边界的 `trellis-check`；跨层、公开合同、并发和数据完整性的最终独立 review 使用只读 `critical_reviewer`，不允许其修改文件。

### 1.2 真实 catalog preflight

- [x] 在测试数据库 current head 上确认以下 constraint 精确存在并在真实 unique violation 中提供 `sqlstate=23505` 与非空 `diag.constraint_name`：
  - `uq_ai_channel_headers_channel_id`
  - `uq_ai_models_channel_id`
  - `uq_platform_types_slug`
  - `uq_platform_profiles_slug`
  - `uq_platform_prompt_templates_name`
  - `uq_platform_accounts_profile_identifier_normalized`
- [x] 确认 Header identity 是 `casefold()` 后的 `(channel_id, normalized_name)`；AI Model 是 trim 后、大小写敏感的 `(channel_id, model_id)`。

若 catalog 或 identity 与 `design.md` 不同，立即停止；不得增加别名、猜测名称或自行创建 migration。

## Phase 2：主会话 contract-first 基线

- [x] `contracts/openapi.yaml` 只为 `createAIModel` 增加标准 409 `ErrorEnvelope` response；其他 operation status 不变。
- [x] 主会话运行 `make contract-generate`，只接受 generator 对 `frontend/src/shared/api/generated/schema.d.ts` 生成的 createAIModel 409 union diff。
- [x] 记录生成后的 contract/runtime 预期：若无其他合法基线漂移，response entries 1023→1024、runtime augmented 1024、raw/stripped 861→862。
- [x] 不修改 `ErrorDetail`/`details` schema，不创建 code enum，不手工编辑 generated client。

完成此阶段并确认生成物稳定后，才能并行派发 Backend 与 Frontend 写入支线。

## Phase 3：Backend 支线

### 3.1 AI Header / Model

- [x] 在 `backend/app/services/ai_configuration.py` 增加单一 Header duplicate error 构造器和单一 Model duplicate error 构造器，精确返回 `design.md` 第 3 节合同。
- [x] Header/Model create/update 的预检发生在 revision 校验之后，update 排除自身 id。
- [x] Header 在 identity 赋值后、model invalidation 与 SUCCESS audit 前显式 flush。
- [x] Model create 保持 audit 前 flush；update 在状态/revision 变更之后、SUCCESS audit 前显式 flush。
- [x] 分别只映射 `23505 + uq_ai_channel_headers_channel_id` 与 `23505 + uq_ai_models_channel_id`；其他异常原抛。
- [x] duplicate 失败无第二行、无 revision/enabled/test-state 漂移、无 SUCCESS audit。

### 3.2 Platform resources

- [x] `content_planning.py:create_platform_profile` 的预检和 flush 使用同一 `PLATFORM_SLUG_EXISTS` 构造器并补齐 `body.slug` details；只映射 `23505 + uq_platform_profiles_slug`，移除 rollback 后 re-query 分类。
- [x] `platform_configuration.py` 的 Prompt create/update 使用同一 `PLATFORM_PROMPT_NAME_EXISTS` 构造器并补齐 `body.name` details；只映射 `23505 + uq_platform_prompt_templates_name`，移除 rollback 后 re-query 分类。
- [x] 保持 Prompt 目标行锁、revision 优先级、Markdown 校验、绑定影响范围读取和成功审计顺序；不新增 prompt-binding advisory lock。
- [x] `_flush_platform_type()` 与 `_flush_platform_account()` 只增加显式 `error.orig.sqlstate == "23505"` 条件，错误体和事务 owner 不变。

### 3.3 全局自然化 Prompt

- [x] 仅把 `prompt is None && expected_revision is not None` 分支改为 `409 HUMANIZATION_PROMPT_MISSING`、message `自然化 Prompt 尚不存在`、details `{}`。
- [x] 保持首次创建、存在时 stale/current、GET 204、PUT metadata 和成功审计既有合同。
- [x] missing/stale 失败不写 singleton、revision 或 SUCCESS audit；不把该分支放入 IntegrityError mapper。

### 3.4 Backend tests

- [x] `test_ai_channel_management.py`：Header/Model create/update 完整合同、真实 mapper diagnostics、独立 Session 并发、stale 优先、失败副作用；将 T1 Model duplicate sentinel 更新为已批准 409。
- [x] 在同一 Model flush 边界用真实 `23514 ck_ai_models_ck_ai_models_test_status` 和 `23505 pk_ai_models` 冻结 unknown 原抛、session cleanup、默认 500 与无数据库文本泄漏。
- [x] `test_platform_types.py`：完整合同、真实 diagnostics、两个 Session 竞争、失败行数/revision。
- [x] `test_platform_accounts.py`：保留绕过预检的真实 constraint 测试，补 cause diagnostics；两个 Session 验证锁串行一成功/一冲突。
- [x] `test_platform_profile_list.py`：预检/constraint 等价、全局锁并发结果、真实 mapper diagnostics。
- [x] `test_platform_workspace.py`：Prompt create/update duplicate、真实 race、stale 优先、绑定/audit/revision 原子性、humanization 四状态矩阵。
- [x] `test_contract.py`、`test_runtime_response_metadata.py`：只反映 createAIModel 新增 409。
- [x] HTTP 测试精确断言 message/details/request_id；diagnostics 只在 service/integration 边界断言。

### 3.5 Backend touched-scope documentation pass

- [x] 复核所有实质修改的 Python module/function/异常分支。
- [x] 新增或改写的必要注释、docstring、log、异常 message 使用中文；不为显然代码增加机械注释。

## Phase 4：Frontend 支线

- [x] `ai-channel-workspace.model.ts` 增加只按 exact code + structured loc 的 Header/Model field mapper，不建立全局错误框架。
- [x] `ai-channel-workspace-page.tsx` 将 Header duplicate 定位到 `name`，保留 `name/isSensitive`、清空 `value`，不进入 revision conflict lock。
- [x] `ai-channel-models-section.tsx` 将 Model duplicate 定位到 `modelId`，保留非 secret 草稿，不 reload、不 replay。
- [x] field mapper 始终返回并展示 request ID；malformed/unknown details 显示 form summary，message 仅用于展示。
- [x] duplicate failure 不执行成功 invalidation。
- [x] AI workspace model/page tests 覆盖字段映射、request ID、secret 清除、草稿保留、stale/duplicate 分流和无 replay。
- [x] `prompt-workspace.model.ts` 删除没有合法 structured loc 时按 exact code/message 回填 `fields.name` 的 fallback。
- [x] `prompt-workspace.model.test.ts` 增加 canonical `body.name` 投影，并把 empty-details 用例改为 form summary + request ID。
- [x] platform type/account 既有 consumer 保持通过；不新增 profile 或自然化 Prompt UI。

## Phase 5：主会话文档与稳定 spec 同步

- [x] `contracts/database.md` 记录六条 identity 的数据库权威、精确 constraint 与领域 code，不复制 UI 细节。
- [x] `docs/frontend-v2/05-business-actions-state-and-api-contract.md` 记录 exact code、structured loc、Header secret、draft/reload/replay 和 humanization missing/stale。
- [x] `.trellis/spec/backend/ai-configuration-guidelines.md` 记录 AI mapper、flush/副作用与 humanization 四状态。
- [x] `.trellis/spec/backend/database-guidelines.md` 补齐 profile/prompt 精确 constraint 与字段错误，保留 type/account 既有规则。
- [x] `.trellis/spec/backend/error-handling.md` 只同步 1024/862 occurrence 计数；若通用语义需变更则停止。
- [x] 主会话整合后核对实际 diff 未超出 `design.md` 第 8 节文件边界，没有覆盖既有脏内容。

## Phase 6：Required targeted validation

按以下顺序执行；较早门槛失败时停止后续门槛，按同一 gate 最多两轮 `repair -> targeted re-check` 收敛。

### 6.1 Backend unit

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_runtime_response_metadata.py \
  backend/tests/unit/test_audit.py \
  backend/tests/unit/test_configuration_audit.py
```

### 6.2 真实 PostgreSQL integration

```bash
docker compose --env-file .env -f deploy/compose.dev.yaml run --rm backend-test pytest \
  tests/integration/test_ai_channel_management.py \
  tests/integration/test_platform_types.py \
  tests/integration/test_platform_accounts.py \
  tests/integration/test_platform_profile_list.py \
  tests/integration/test_platform_workspace.py \
  tests/integration/test_prompt_preview_options.py
```

### 6.3 Frontend targeted Vitest

```bash
npm --prefix frontend run test -- \
  src/domains/configuration/ai-channel-workspace.model.test.ts \
  src/domains/configuration/ai-channel-workspace-page.test.tsx \
  src/domains/configuration/prompt-workspace.model.test.ts \
  src/domains/configuration/prompt-workspace-page.test.tsx \
  src/domains/configuration/platform-types.model.test.ts \
  src/domains/configuration/platform-workspace.model.test.ts \
  src/domains/configuration/platform-workspace-page.test.tsx
```

### 6.4 Lint、type 与 generated consistency

```bash
UV_CACHE_DIR=.cache/uv uv run --project backend ruff check \
  backend/app/services/ai_configuration.py \
  backend/app/services/platform_configuration.py \
  backend/app/services/content_planning.py \
  backend/app/services/publication.py \
  backend/app/routers/configuration.py \
  backend/tests/integration/test_ai_channel_management.py \
  backend/tests/integration/test_platform_types.py \
  backend/tests/integration/test_platform_accounts.py \
  backend/tests/integration/test_platform_profile_list.py \
  backend/tests/integration/test_platform_workspace.py \
  backend/tests/unit/test_contract.py \
  backend/tests/unit/test_runtime_response_metadata.py
npm --prefix frontend exec -- eslint \
  src/domains/configuration/ai-channel-workspace.model.ts \
  src/domains/configuration/ai-channel-workspace-page.tsx \
  src/domains/configuration/ai-channel-models-section.tsx \
  src/domains/configuration/ai-channel-workspace.model.test.ts \
  src/domains/configuration/ai-channel-workspace-page.test.tsx \
  src/domains/configuration/prompt-workspace.model.ts \
  src/domains/configuration/prompt-workspace.model.test.ts \
  --max-warnings 0
make typecheck
git diff --check
```

## Phase 7：一次性正式 gate

只在 Phase 6 全绿的候选上运行一次：

```bash
make contract-check
```

若正式 gate 失败，本 turn 不自动修复后重跑；报告差异并请求方向。

## Phase 8：独立 review

- [x] 使用只读 `critical_reviewer` 完成一次全量 review，覆盖真实 catalog、unknown 500、precheck/DB 等价、原子性、missing/stale/duplicate 优先级、OpenAPI/runtime/generated 同步和文件边界。
- [x] 若发现明确 in-scope 问题，由主会话核验后交回原文件 owner 或由主会话修复 root-level 文件；最多一次 repair 与一次受影响路径 targeted re-review。
- [x] targeted re-review 仍发现同一问题、新 MEDIUM 以上问题或 gate 未收敛时停止，不开始第三轮。

## Phase 9：Optional validation

- `make verify`
- backend 全量 unit/integration
- frontend 全量 Vitest、build 与 E2E
- deployment scripts 与生产 compose 检查

本任务不改数据库 schema、权限或核心状态机，Required validation 已覆盖真实 PostgreSQL 和全部受影响配置路径，因此上述重型门槛默认 optional。只有证据表明共享 owner 或 release readiness 受影响时，才先向用户说明成本和收益并取得授权。

## Phase 10：提交与收口

- [x] 最终检查实际 diff、dirty baseline、文档/合同/代码/测试一致性以及 Python 中文 documentation pass。
- [x] 主会话向用户展示精确 commit plan，区分本任务文件与既有未识别脏文件，并取得一次确认。
- [x] 只提交用户确认的本任务文件；不 amend、不自动 push。
- [ ] 提交完成后再进入 Trellis finish/archive/journal 流程；运行可能产生 bookkeeping commit 的命令前先说明。

## Stop Conditions

以下任一条件成立即停止并报告证据、当前 diff 与选择：

1. catalog constraint、identity 或 diagnostics 与批准设计不一致；
2. 正确实现需要 migration、constraint rename、data repair、ORM/schema 变化；
3. 除 createAIModel 409 外需要改变公共 status、ErrorDetail schema、code enum 或其他 API；
4. 现有 production consumer 依赖旧 humanization missing 语义，或必须新增 UI；
5. type/account 除 `23505` 条件外还需改变 wire contract 或事务 owner；
6. 正确修复需超出 `design.md` 第 8 节允许文件、改变权限/状态机或触碰其他领域；
7. 既有 dirty 文件与目标文件无法安全分离；
8. 同一 validation 根因复现，或两轮 repair 后仍失败；
9. 一次性 `make contract-check` 失败；
10. targeted re-review 后仍有 MEDIUM 以上问题。

## Rollback Boundary

- T2 是原子 slice：service mapper/humanization、OpenAPI/runtime/generated、frontend projection、tests、contracts/docs/specs 必须一起保留或一起回滚。
- 若出现 schema/data diff，说明已经越界，应停止而不是设计 migration 回滚。
- 回滚新 mapper 时只恢复已批准 constraint 为 unknown 500；不得恢复全局 `IntegrityError -> REVISION_CONFLICT`。
- type/account 的 `23505` 条件与测试一起回滚；不得改变其既有错误体。
- 文档/spec/generated 必须跟随实现回滚，不留下尚未实现的规则。
- 不使用 `git reset --hard`、`git checkout --`、stash 或宽路径删除覆盖用户脏文件。
