# 配置 IntegrityError 精确领域映射实施设计

## 1. 设计状态与权威输入

本任务不重新做合同决策。以下已批准文档是本设计的上游权威输入：

- `.trellis/tasks/09-04-configuration-integrity-error-contract-decision/prd.md`
- `.trellis/tasks/09-04-configuration-integrity-error-contract-decision/design.md`
- `.trellis/tasks/09-04-configuration-integrity-error-contract-decision/implement.md`

若本任务文档与上游已批准合同出现差异，停止实施并回到 planning 修正文档；不得在代码中选择其中一个版本或增加兼容分支。数据库 catalog、现有代码和测试只用于验证实现前提，不能自行改变已批准的产品合同。

## 2. 核心不变量

1. 只有 `IntegrityError.orig.sqlstate == "23505"` 且 `IntegrityError.orig.diag.constraint_name` 精确命中 allowlist 时，才映射领域 409。
2. 未列名、diagnostics 缺失、sqlstate 不同或 constraint 不匹配的异常继续原抛，由全局默认 500 边界处理。
3. 预检用于常见路径反馈，PostgreSQL constraint 是并发最终权威；两条路径调用同一领域错误构造器。
4. revision 校验优先于 identity duplicate；可能失败的 flush 优先于 SUCCESS audit 和不可保留副作用。
5. OpenAPI、runtime response metadata、generated client 与测试必须作为同一原子 contract slice 变更。
6. 前端只按 exact code 与 structured loc 分流；message 只用于展示，不能决定字段或恢复策略。

## 3. Identity duplicate 精确合同

| constraint | HTTP | code | message | details |
| --- | ---: | --- | --- | --- |
| `uq_ai_channel_headers_channel_id` | 409 | `AI_CHANNEL_HEADER_NAME_EXISTS` | `该 AI 渠道已存在同名 Header` | `{"errors":[{"loc":["body","name"],"msg":"该 AI 渠道已存在同名 Header","type":"ai_channel_header_name_exists"}]}` |
| `uq_ai_models_channel_id` | 409 | `AI_MODEL_ID_EXISTS` | `该 AI 渠道已存在相同的 Model ID` | `{"errors":[{"loc":["body","model_id"],"msg":"该 AI 渠道已存在相同的 Model ID","type":"ai_model_id_exists"}]}` |
| `uq_platform_types_slug` | 409 | `PLATFORM_TYPE_SLUG_EXISTS` | `平台类型 slug 已存在` | `{"errors":[{"loc":["body","slug"],"msg":"平台类型 slug 已存在","type":"platform_type_slug_exists"}]}` |
| `uq_platform_profiles_slug` | 409 | `PLATFORM_SLUG_EXISTS` | `平台 slug 已存在` | `{"errors":[{"loc":["body","slug"],"msg":"平台 slug 已存在","type":"platform_slug_exists"}]}` |
| `uq_platform_prompt_templates_name` | 409 | `PLATFORM_PROMPT_NAME_EXISTS` | `Prompt 名称已存在` | `{"errors":[{"loc":["body","name"],"msg":"Prompt 名称已存在","type":"platform_prompt_name_exists"}]}` |
| `uq_platform_accounts_profile_identifier_normalized` | 409 | `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` | `该平台已存在相同的运营账号标识` | `{"errors":[{"loc":["body","account_identifier"],"msg":"该平台已存在相同的运营账号标识","type":"platform_account_identifier_exists"}]}` |

Identity 语义保持现状：Header 使用 `(channel_id, casefold(name))`；AI Model 使用 `(channel_id, trim(model_id))` 且大小写敏感；platform account 使用 `(platform_profile_id, lower(btrim(account_identifier)))`。开始修改 mapper 前必须从测试数据库 current head catalog 验证六个 constraint 名和 diagnostics。

## 4. Backend owner 与事务顺序

### 4.1 AI Header / Model

- `backend/app/services/ai_configuration.py` 是 Header/Model duplicate error 构造、预检和精确 mapper 的唯一 owner。
- Header create/update：锁定 channel → revision 校验 → normalized name 预检/赋值 → 显式 flush → `invalidate_channel_models()` → SUCCESS audit。
- Model create/update：锁定正确 owner → revision 校验（update）→ identity 预检/赋值与状态变更 → 显式 flush → SUCCESS audit。
- 已识别 duplicate 先 rollback，再以原 `IntegrityError` 为 cause 抛领域错误；未知异常保持原对象向外抛，由既有 request/session owner 清理。

### 4.2 Platform resources

- `backend/app/services/content_planning.py:create_platform_profile` 使用共享于预检和 flush 的 `PLATFORM_SLUG_EXISTS` 构造器，移除 rollback 后 re-query 分类。
- `backend/app/services/platform_configuration.py` 的 Prompt create/update 使用共享 `PLATFORM_PROMPT_NAME_EXISTS` 构造器，保持目标行锁、revision、Markdown、绑定读取与成功审计顺序。
- platform type 与 account 只在既有 mapper 条件中增加 `sqlstate == "23505"`；不改变其 wire contract、事务 owner 或错误体。
- 不新增全局 constraint registry，不把领域 code 放入 global exception handler。

### 4.3 失败原子性

- Header duplicate 不改变 Header、channel revision/enabled、任何 model enabled/revision/test state，也不写 SUCCESS audit。
- Model duplicate 不创建第二行；update 不改变 identity、revision、enabled/test state，也不写 SUCCESS audit。
- type/profile/prompt/account duplicate 不新增第二行，不递增 revision，不留下绑定或其他部分状态。
- mapped 409 与 unknown 500 均不得留下 failed-session 污染。

## 5. 全局自然化 Prompt 状态机

| singleton | `expected_revision` | 结果 |
| --- | --- | --- |
| 不存在 | `null` | 200，首次创建 revision 0 |
| 不存在 | 任意整数 | `409 HUMANIZATION_PROMPT_MISSING`，message=`自然化 Prompt 尚不存在`，details=`{}` |
| 存在 | 等于当前 revision | 200，更新并递增 revision |
| 存在 | `null` 或其他整数 | `409 REVISION_CONFLICT`，message=`自然化 Prompt 已被其他请求修改`，details=`{}` |

GET 缺失继续返回 204；PUT status 集合不变。missing/stale 均不创建或更新 singleton、不递增 revision、不写 `content_humanization_prompt.saved` SUCCESS audit。该分支不是 IntegrityError mapper，也不新增 404、412 或新 code。

## 6. Frontend 投影与恢复

| code | 字段投影 | 保留/清除 | 恢复行为 |
| --- | --- | --- | --- |
| `AI_CHANNEL_HEADER_NAME_EXISTS` | `body.name -> name` | 保留 `name/isSensitive`，清空 `value` | 用户改名、重新输入 secret 后显式提交 |
| `AI_MODEL_ID_EXISTS` | `body.model_id -> modelId` | 保留全部非 secret 草稿 | 用户修改 Model ID 后显式提交 |
| `PLATFORM_PROMPT_NAME_EXISTS` | 仅合法 `body.name` loc 投影 | 保留 name 与 Markdown 草稿 | 用户修正后显式提交；无 loc 时显示 summary |
| `HUMANIZATION_PROMPT_MISSING` | 资源级，不定位字段 | 保留本地 Markdown | 显式 GET；204 后切换 create baseline，仍需再次确认提交 |
| `REVISION_CONFLICT` | 只按 exact code 进入 stale 模式 | 冻结旧基线并保留未提交草稿 | 显式 GET/人工复核，禁止自动合并或 replay |

所有错误都展示 request ID。Malformed/unknown details 使用 form summary；不得从 message 推断字段。Identity duplicate 不进入 conflict lock、不 reload、不自动 replay、不执行成功 invalidation。当前没有自然化 Prompt production consumer，因此只更新行为文档和 backend 测试，不创建未使用的前端代码。

## 7. 公共合同与文档同步

- `contracts/openapi.yaml`：只为 `createAIModel` 增加标准 409 `ErrorEnvelope` response。
- `backend/app/routers/configuration.py`：只同步 create AI Model runtime 409 metadata。
- `frontend/src/shared/api/generated/schema.d.ts`：只接受 `make contract-generate` 生成的 createAIModel 409 union diff，禁止手工修改。
- contract/runtime 基线在无其他合法漂移时为：response entries 1023→1024、runtime augmented 1024、raw/stripped 861→862；完整 status 集合增加 409。
- `contracts/database.md` 记录六条 identity 的数据库权威、constraint 与领域 code。
- Frontend V2 行为文档记录字段定位、secret、draft/reload/replay 和 humanization missing/stale。
- `.trellis/spec/backend/ai-configuration-guidelines.md` 与 `database-guidelines.md` 更新已实现稳定规则。
- `.trellis/spec/backend/error-handling.md` 只同步 1024/862 occurrence 计数；若通用语义也需改变，停止并回到 planning。

## 8. 文件边界

### 8.1 允许修改

Contract/docs/spec：

- `contracts/openapi.yaml`
- `contracts/database.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `.trellis/spec/backend/ai-configuration-guidelines.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/error-handling.md`，仅 occurrence 计数

Backend production/runtime：

- `backend/app/services/ai_configuration.py`
- `backend/app/services/platform_configuration.py`
- `backend/app/services/content_planning.py`，仅 `create_platform_profile`
- `backend/app/services/publication.py`，仅 account mapper 的 `23505` 条件
- `backend/app/routers/configuration.py`，仅 create AI Model metadata

Backend tests：

- `backend/tests/integration/test_ai_channel_management.py`
- `backend/tests/integration/test_platform_types.py`
- `backend/tests/integration/test_platform_accounts.py`
- `backend/tests/integration/test_platform_profile_list.py`
- `backend/tests/integration/test_platform_workspace.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`

Generated/frontend：

- `frontend/src/shared/api/generated/schema.d.ts`，generator only
- `frontend/src/domains/configuration/ai-channel-workspace.model.ts`
- `frontend/src/domains/configuration/ai-channel-workspace-page.tsx`
- `frontend/src/domains/configuration/ai-channel-models-section.tsx`
- `frontend/src/domains/configuration/ai-channel-workspace.model.test.ts`
- `frontend/src/domains/configuration/ai-channel-workspace-page.test.tsx`
- `frontend/src/domains/configuration/prompt-workspace.model.ts`
- `frontend/src/domains/configuration/prompt-workspace.model.test.ts`

### 8.2 仅作 validation target

- `backend/app/models/**`、`backend/alembic/**`
- `backend/app/routers/planning.py`、`backend/app/routers/publication.py`
- `backend/tests/integration/test_prompt_preview_options.py`
- `backend/tests/unit/test_audit.py`、`backend/tests/unit/test_configuration_audit.py`
- `frontend/src/domains/configuration/platform-types.model.test.ts`
- `frontend/src/domains/configuration/platform-workspace.model.test.ts`
- `frontend/src/domains/configuration/prompt-workspace-page.test.tsx`

### 8.3 禁止修改

- global exception handler、数据库 schema/migration/data、权限、状态机、部署配置。
- 其他领域 mapper、code enum、兼容别名、消息解析、全局 registry。
- 自然化 Prompt 新 UI/API wrapper，以及超出本设计的视觉或架构改造。

## 9. 并发与测试设计

- 无共享 identity owner 锁：AI Model、platform type、platform prompt 使用两个独立 Session/connection 与 barrier，使双方通过预检后竞争 constraint，证明一成功、一具名 409。
- 锁串行路径：AI Header、platform profile、platform account 使用两个独立 Session 验证可观察结果，不在持有共享锁后放 barrier；另绕过预检触发真实 constraint mapper。
- 每个数据库 mapper 断言 cause 的 `sqlstate` 与精确 `constraint_name`。
- AI Model flush 边界保留两条 unknown 反例：真实 `23514 ck_ai_models_ck_ai_models_test_status` 和 `23505 pk_ai_models`，断言原异常继续抛出，并结合 global handler regression 冻结 500 与无数据库文本泄漏。
- stale+duplicate、完整 ErrorEnvelope、失败行数/revision/test-state/audit/session cleanup 均必须有定向断言。

## 10. 停止条件与回滚

出现以下任一情况立即停止，不自行扩大范围：catalog/identity 与批准设计不符；需要 migration/data repair；除 createAIModel 409 外需改变公共 API；需要新增自然化 Prompt UI；type/account 需改变既有 wire/owner；正确实现超出允许文件；既有 dirty 内容无法安全分离；同一 validation 根因重复或两轮 repair 后仍失败；一次性 `make contract-check` 失败；targeted re-review 后仍有 MEDIUM 以上问题。

T2 是原子交付 slice：service mapper/humanization、OpenAPI/runtime/generated、frontend projection、tests、contracts/docs/specs 一起保留或一起回滚。不得使用 `git reset --hard`、`git checkout --`、stash 或宽路径删除覆盖用户脏文件。
