# 配置 IntegrityError 错误合同决策实施计划

> 本文是后续 T2 `configuration identity constraints` 的执行计划。本 T2-C 只冻结计划，不运行 `task.py start`、不实施以下步骤。

## Phase 0：进入 T2 的批准门槛

- [ ] 本任务 `prd.md`、`design.md`、`implement.md` 已完成独立 review。
- [ ] 审批者明确接受 `design.md` 第 3 节的六条 identity contract 与第 4 节的 humanization missing/stale contract。
- [ ] 前置提交 `43c252da`、`a805aeeb`、`1a526da9` 仍在 T2 基线上，未知 IntegrityError 默认 500 sentinel 仍通过。
- [ ] 主工作区在 `main`，开始实施前重新记录 dirty baseline；任何既有脏文件都不纳入 T2。
- [ ] 另建一个独立 T2 implementation task，写明本文件为已批准输入；本 T2-C 不直接转成代码实现任务。
- [ ] 在任何 commit 前向用户提交精确 commit plan 并取得确认；不自动 push。

未满足上述任一项时，不开始 T2。

## Phase 1：数据库与合同基线确认

### 1.1 真实 catalog preflight

- [ ] 在测试数据库 current head 上确认以下 constraint 精确存在：
  - `uq_ai_channel_headers_channel_id`
  - `uq_ai_models_channel_id`
  - `uq_platform_types_slug`
  - `uq_platform_profiles_slug`
  - `uq_platform_prompt_templates_name`
  - `uq_platform_accounts_profile_identifier_normalized`
- [ ] 确认六条 unique violation 都提供 `sqlstate=23505` 和非空 `diag.constraint_name`。
- [ ] 确认 Header identity 是 `casefold()` 后的 `(channel_id, normalized_name)`；AI Model 是 trim 后、区分大小写的 `(channel_id, model_id)`。

若名称或 identity 与设计不同，立即停止；不得在 mapper 中同时接受多个名称，也不得自行创建 migration。

### 1.2 contract-first 修改

- [ ] 在 `contracts/openapi.yaml` 只为 `createAIModel` 增加标准 409 `ErrorEnvelope` response；其他 operation 的 status 集合不变。
- [ ] 在 `backend/app/routers/configuration.py` 只为 create AI Model 的 runtime response metadata 增加 409。
- [ ] 更新 `backend/tests/unit/test_contract.py`：
  - OpenAPI 完整 status 为 `201/400/401/403/404/409/422`；`test_frozen_response_status_signatures_cover_every_operation()` 内的 `expected_by_signature` 依既有惯例排除统一 400，其 tuple 变为 `201/401/403/404/409/422`；
  - 若基线无其他变化，response entry 总数从 1023 变为 1024。
- [ ] 更新 `backend/tests/unit/test_runtime_response_metadata.py`：若基线无其他变化，augmented 总数变为 1024，raw/stripped 总数从 861 变为 862。
- [ ] 同步 `.trellis/spec/backend/error-handling.md` 中三处 response occurrence 基线：1023 改为 1024，861 改为 862；不改变其 diagnostics、unknown 或字段错误语义规则。
- [ ] 运行 `make contract-generate`，只接受 generator 对 `frontend/src/shared/api/generated/schema.d.ts` 生成的 createAIModel 409 response union diff。

此阶段不把领域 code 添加为 OpenAPI enum，不修改 `ErrorDetail` 或 `details` schema。

## Phase 2：Backend identity mapper

### 2.1 AI Header

- [ ] 在 `backend/app/services/ai_configuration.py` 增加单一的 Header duplicate error 构造器，精确返回：
  - `409 AI_CHANNEL_HEADER_NAME_EXISTS`
  - message `该 AI 渠道已存在同名 Header`
  - `body.name` 字段错误及 `ai_channel_header_name_exists` type。
- [ ] create/update 在 revision 校验之后执行必要的同渠道 normalized name 预检；update 排除自身 id。
- [ ] identity 赋值后、`invalidate_channel_models()` 与 SUCCESS audit 前显式 flush。
- [ ] 只把 `23505 + uq_ai_channel_headers_channel_id` 映射为上述错误；其他 IntegrityError 原抛。
- [ ] 失败后 Header、channel revision/enabled 与所有 model test state/revision 均不变。

### 2.2 AI Model

- [ ] 在同一 service 增加单一的 Model duplicate error 构造器，精确返回：
  - `409 AI_MODEL_ID_EXISTS`
  - message `该 AI 渠道已存在相同的 Model ID`
  - `body.model_id` 字段错误及 `ai_model_id_exists` type。
- [ ] create/update 在正确 owner 范围内做可选预检；update 保持 revision 校验优先并排除自身 id。
- [ ] create 保持 audit 前 flush；update 在状态/revision 变更之后、SUCCESS audit 之前显式 flush。
- [ ] 只把 `23505 + uq_ai_models_channel_id` 映射；其他 IntegrityError 原抛。
- [ ] duplicate create/update 失败后无第二行、无配置/revision/test-state 改动、无 SUCCESS audit。

### 2.3 platform profile/prompt

- [ ] 在 `backend/app/services/content_planning.py` 的 `create_platform_profile` 使用共享于预检和 flush 的 `PLATFORM_SLUG_EXISTS` 构造器，补齐设计规定的 `body.slug` details。
- [ ] 只映射 `23505 + uq_platform_profiles_slug`；删除 rollback 后 re-query 分类。
- [ ] 在 `backend/app/services/platform_configuration.py` 的 platform prompt create/update 使用共享错误构造器，补齐 `body.name` details。
- [ ] 只映射 `23505 + uq_platform_prompt_templates_name`；删除 rollback 后 re-query 分类。
- [ ] 保持 prompt update 的目标 Prompt 行锁、revision 校验优先级、Markdown 校验、绑定影响范围读取及成功审计顺序不变；不得新增当前不存在的 prompt-binding advisory lock。

### 2.4 platform type/account

- [ ] 保持 `_flush_platform_type()` 和 `_flush_platform_account()` 的 code/message/status/details 不变，只为 constraint 分支增加显式 `error.orig.sqlstate == "23505"` 条件。
- [ ] 用新增测试补足真实 constraint、并发、预检/DB 等价与原子性证据；除上述识别条件外不重写这两个 production helper。

### 2.5 touched-scope 文档语言

- [ ] 对所有实质修改的 Python module/function/异常分支做 touched-scope documentation pass。
- [ ] 新增或改写的必要注释、docstring、log、异常 message 保持中文；不为显然代码添加机械注释。

## Phase 3：全局自然化 Prompt 语义修正

- [ ] 在 `backend/app/services/platform_configuration.py` 仅把 `prompt is None && expected_revision is not None` 分支改为：
  - `409 HUMANIZATION_PROMPT_MISSING`
  - message `自然化 Prompt 尚不存在`
  - details `{}`。
- [ ] 保持不存在且 `expected_revision=null` 首次创建成功。
- [ ] 保持存在且 revision 不匹配（包括传 null）返回 `409 REVISION_CONFLICT`、message `自然化 Prompt 已被其他请求修改`、details `{}`。
- [ ] 保持 GET 缺失为 204，PUT status metadata 与 OpenAPI 409 声明不变。
- [ ] missing/stale 失败不写 singleton、不递增 revision、不写 `content_humanization_prompt.saved` SUCCESS audit。
- [ ] 不把该分支放入 IntegrityError mapper，不新增 404/412 或新 code。

## Phase 4：Backend 测试实现

### 4.1 AI integration

在 `backend/tests/integration/test_ai_channel_management.py`：

- [ ] 将 T1 的 AI Model duplicate unknown 500 sentinel 替换为已批准的 `AI_MODEL_ID_EXISTS` 合同测试。
- [ ] 以真实 PostgreSQL `23514 ck_ai_models_ck_ai_models_test_status` 进入同一 model flush 边界，断言不同 sqlstate 的 IntegrityError 原对象继续抛出。
- [ ] 以重复 `AIModel.id` 触发真实 PostgreSQL `23505 pk_ai_models`，断言同为 23505 但 constraint 不在 allowlist 时，原 `IntegrityError` 对象仍继续抛出，并验证 rollback/session cleanup。
- [ ] 将上述两条 unknown 反例与前置任务的 global handler regression 组合，冻结默认 500 与无数据库文本泄漏；不新增测试专用生产入口。
- [ ] Header create/update 与 Model create/update 的常见预检路径断言完整 status/code/message/details/request_id。
- [ ] 无共享 identity owner 锁的 Model create 使用两个独立 Session/connection 与 barrier，证明一成功、一具名 409。
- [ ] Header 并发按 channel lock 串行，证明一成功、一具名 409；另绕过预检触发真实 Header constraint mapper 并检查 cause diagnostics，不在共享 channel lock 后放 barrier。
- [ ] Model/ Header 真实 constraint path 都断言 `cause.orig.sqlstate == "23505"` 与精确 `diag.constraint_name`。
- [ ] update 同时 stale 与 duplicate 时断言 `REVISION_CONFLICT` 优先。
- [ ] 逐项断言失败副作用：行数、revision、enabled/test status、audit 均不漂移。

### 4.2 platform integration

- [ ] `test_platform_types.py`：精确合同、真实 diagnostics、两个 Session 的数据库竞争、失败行数/revision。
- [ ] `test_platform_accounts.py`：保留现有预检绕过真实 constraint 测试并补 cause diagnostics；两个 Session 验证 platform lock 串行的一成功/一具名冲突，不使用锁后 barrier。
- [ ] `test_platform_profile_list.py`：profile slug 的预检与 constraint path 返回相同字段 details；global advisory lock 下验证独立 Session observable 结果，并单独触发真实 constraint mapper。
- [ ] `test_platform_workspace.py`：prompt create/update duplicate 的预检与真实 race、stale 优先、audit/revision/绑定原子性；新增 humanization Prompt 四状态矩阵与失败无 SUCCESS audit。
- [ ] `test_prompt_preview_options.py` 作为只读回归目标，确保 Prompt identity mapper 不改变 preview/options 行为。

### 4.3 unit contract/runtime/audit

- [ ] `test_contract.py` 与 `test_runtime_response_metadata.py` 只反映 createAIModel 新增 409，不产生其他 operation 漂移。
- [ ] `test_audit.py`、`test_configuration_audit.py` 保持通过，证明失败路径未伪造成功事件且成功投影不回归。
- [ ] HTTP 测试断言 message/details 精确相等；cause diagnostics 在 service/integration 边界断言，不泄漏到客户端 body。

## Phase 5：Frontend 投影与文档

### 5.1 AI 表单

- [ ] 在 `ai-channel-workspace.model.ts` 增加只按 exact code + structured loc 的 Header/Model field mapper；不建立通用全局错误框架。
- [ ] `ai-channel-workspace-page.tsx` 将 `AI_CHANNEL_HEADER_NAME_EXISTS` 定位到 `name`，保持 `name/isSensitive`，清空 `value`，不设置 revision conflict lock。
- [ ] `ai-channel-models-section.tsx` 将 `AI_MODEL_ID_EXISTS` 定位到 `modelId`，保留全部非 secret 表单值，不 reload、不自动 replay。
- [ ] field mapper 返回并始终展示 request ID；malformed/unknown details 另显示 form summary，message 只用于展示，不作为分支判断。
- [ ] success 才执行既有 invalidation；duplicate failure 不执行 success invalidation。
- [ ] `ai-channel-workspace.model.test.ts` 与 `ai-channel-workspace-page.test.tsx` 覆盖字段映射、request ID、secret 清除、草稿保留、stale/duplicate 分流和无 replay。

### 5.2 已有 platform consumer

- [ ] 在 `prompt-workspace.model.ts` 删除 `PLATFORM_PROMPT_NAME_EXISTS` 在没有合法 structured loc 时仅凭 exact code/message 回填 `fields.name` 的 fallback；message 只能作为 form summary 展示文本，不能决定字段。
- [ ] `prompt-workspace.model.test.ts` 增加 canonical `body.name` details 投影断言，并将既有 empty-details 用例改为断言 form summary + request ID。
- [ ] platform type/account 现有 model/page tests 保持通过；profile 当前无创建 consumer，不新增 UI。
- [ ] 不为自然化 Prompt 新建未使用 frontend code；其恢复政策只进入行为文档。

### 5.3 权威文档与稳定 specs

- [ ] `contracts/database.md` 记录六条 identity 的数据库权威、精确 constraint 与领域 code，不复制前端组件细节。
- [ ] `docs/frontend-v2/05-business-actions-state-and-api-contract.md` 记录 exact code、字段 loc、Header secret 清除、draft/reload/replay 政策及 humanization missing/stale 区分。
- [ ] `.trellis/spec/backend/ai-configuration-guidelines.md` 记录 AI identity mapper、flush/副作用边界与 naturalization Prompt 四状态语义。
- [ ] `.trellis/spec/backend/database-guidelines.md` 补齐 profile/prompt 精确 constraint 与字段错误；保留 type/account 既有规则。
- [ ] `.trellis/spec/backend/error-handling.md` 只同步 1024/862 occurrence 计数；若其通用语义规则也需改变，停止并先修订本 T2-C 边界。

## Phase 6：Required validation

以下顺序先跑最小定向门槛，全部通过后才运行一次正式 contract gate。

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

### 6.3 Frontend targeted tests

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

### 6.5 一次性正式 gate

```bash
make contract-check
```

`make contract-check` 只在以上 targeted checks 全绿的候选上运行一次。如果失败，本 turn 不自动修复后重跑正式 gate，应报告差异并请求方向。

## Phase 7：Optional validation

- `make verify`
- backend 全量 unit/integration
- frontend 全量 Vitest、build 与 E2E
- deployment scripts 与生产 compose 检查

本任务不改变数据库 schema、权限或核心状态机，且 required integration 已覆盖真实 PostgreSQL 与全部受影响 configuration 路径，因此这些重型门槛默认 optional。只有证据表明共享 owner 或 release readiness 受影响，才在获得用户确认后升级。

## Phase 8：独立 review 与收口

由于 T2 改变公开 operation 的 409 status 集合并触及跨层 error recovery，候选通过 required validation 后必须进行一次独立只读 review，重点检查：

- constraint owner 与真实 catalog 名；
- unknown 500 边界是否被保留；
- precheck/DB path 完整合同是否相同；
- flush、rollback、audit、revision/test-state 原子性；
- stale、missing、identity duplicate 的优先级与前端恢复是否分离；
- OpenAPI/runtime/generated 是否原子同步；
- diff 是否越过 `design.md` 第 8 节文件边界。

独立 review 只允许一次完整 review 和最多一次受影响路径的 targeted re-review。re-review 仍发现同一问题或新的 MEDIUM 以上问题时停止，不开始第三轮。

## Stop Conditions

任一条件成立即停止实施并报告证据、当前 diff 与选择，不自行扩大范围：

1. 测试数据库 catalog constraint 名或 identity 与 `design.md` 不一致；
2. 正确实现需要 migration、约束重命名、数据修复或 ORM/schema 变化；
3. 除 createAIModel 409 外还需要改变公开 status、`ErrorDetail` schema、code enum 或公共 API；
4. 发现现有 production consumer 依赖 humanization missing 的 `REVISION_CONFLICT`，或需要新增自然化 Prompt UI 才能完成合同；
5. type/account 除增加 `23505` 条件外还需改变 wire contract、事务 owner 或其他未批准 owner；
6. 正确修复需要跨出 `design.md` 第 8 节允许修改文件、改变权限/状态机或触碰其他领域；
7. 既有 dirty 文件与目标文件发生无法安全分离的重叠；
8. 任一 validation gate 同根因复现，或完成两轮 `repair -> targeted re-check` 后仍失败；
9. 正式 `make contract-check` 一次失败；
10. targeted re-review 后仍有 MEDIUM 以上问题。

## Rollback Boundary

- T2 是一个原子交付 slice：service mapper/humanization code、createAIModel OpenAPI/runtime/generated status、frontend projection、tests、contracts/docs/specs 必须一起保留或一起回滚。
- 不存在 migration 或数据回滚；若实际实现产生 schema/data diff，说明已越界，应停止而不是为其设计回滚。
- 回滚 AI 新 mapper 时，只恢复这些具名 constraint 为 unknown 500；不得恢复全局 `IntegrityError -> REVISION_CONFLICT`。
- type/account 只允许出现 `23505` 识别条件与相应测试 diff；回滚时一并恢复，不得改动其既有正确错误体。
- 文档与稳定 spec 必须跟随实现回滚，不能留下尚未实现的规则；generated client 必须跟随 OpenAPI/runtime 一起回滚。
- 不使用 `git reset --hard`、`git checkout --`、stash、宽路径删除或任何会覆盖用户脏文件的命令。

## T2 Completion Acceptance Criteria

- [ ] 六条 identity 的最终数据库路径均返回 `design.md` 第 3 节的精确 status/code/message/details；凡存在预检，预检结果与其完全相同。
- [ ] 每个最终数据库映射都有真实 PostgreSQL `23505 + diag.constraint_name` 证据；锁串行路径同时有独立 Session observable 并发证据。
- [ ] 未列名、diagnostics 缺失或 constraint 不匹配的 IntegrityError 仍进入默认 500，且客户端不看到数据库文本。
- [ ] Header/Model update 保持 stale revision 优先于 duplicate；humanization missing 不再伪装成 stale。
- [ ] naturalization Prompt 四状态矩阵全部通过，GET 204 与 PUT create 能力不回归。
- [ ] 所有失败路径无第二行、部分写入、错误 revision/test-state、SUCCESS audit 或 failed-session 残留。
- [ ] AI Header duplicate 定位 `name` 且清除 secret；AI Model duplicate 定位 `modelId` 且保留草稿；两者都不自动 reload/replay/invalidate。
- [ ] platform type/account 现有 recovery 不回归，profile/prompt 使用 canonical 字段 details，真正 `REVISION_CONFLICT` 仍独立冻结并显式 reload。
- [ ] 只有 createAIModel 新增 409 operation response；OpenAPI、runtime metadata 与 generated client 完全同步。
- [ ] `contracts/database.md`、Frontend V2 行为文档和三份指定 stable spec 与代码/测试一致；`error-handling.md` 只有 1024/862 基线计数 diff。
- [ ] Required validation 全部实际通过，正式 contract gate 只运行一次；optional gate 若未跑，closeout 说明原因与残余风险。
- [ ] 独立只读 review 无未解决 MEDIUM 以上问题，实际 diff 仅包含批准文件且不纳入既有脏文件。
- [ ] 非平凡 Python touched scope 的注释/docstring/developer-visible text 已按项目中文规则复核并在 closeout 报告。
- [ ] 提交前已向用户展示 commit plan 并取得确认；不自动 push。
