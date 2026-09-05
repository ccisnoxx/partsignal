# 配置 IntegrityError 错误合同决策设计

## 1. 设计结论

本任务冻结以下原则：

1. AI Header 与 AI Model 的 identity duplicate 是合法输入之间的可纠正冲突，应新增各自的具名 409，而不是继续 unknown，也不能复用语法错误或 revision 错误。
2. platform type/account 的现有 code、message、status、字段级 `details` 和前端恢复合同已经完整；T2 原样复用 wire/recovery 合同，并按父任务识别协议补齐必要的 `23505` 判断与真实数据库证据。
3. platform profile/prompt 复用现有 code、message、status，但将当前空 `details` 收敛为结构化字段错误；真实数据库路径改为精确 constraint 识别。
4. 全局自然化 Prompt 不存在且请求携带 revision 时复用既有 `HUMANIZATION_PROMPT_MISSING`，只在资源存在且 revision 不一致时使用 `REVISION_CONFLICT`。
5. 任何未列入矩阵、不是 PostgreSQL `23505`、或 constraint name 不匹配的 `IntegrityError` 都继续作为 unknown 抛出，由前置任务恢复的默认 500 边界处理。

## 2. 权威证据与当前状态

### 2.1 数据库身份约束

SQLAlchemy naming convention 为 `uq_%(table_name)s_%(column_0_name)s`。结合当前 ORM、迁移、父任务矩阵与已完成 T1 的真实 PostgreSQL sentinel，T2 只允许识别下列最终名称：

| 资源 | 业务 identity | 最终 constraint name | 证据 owner |
| --- | --- | --- | --- |
| AI Header | `(channel_id, normalized_name)`；`normalized_name` 来自 Header 名 `casefold()` | `uq_ai_channel_headers_channel_id` | `backend/app/db.py`、`backend/app/models/ai_generation.py`、`backend/alembic/versions/0009_config_center.py` |
| AI Model | `(channel_id, model_id)`；trim 后精确、区分大小写 | `uq_ai_models_channel_id` | 同上；T1 sentinel 已观察该 constraint |
| platform type | `slug` | `uq_platform_types_slug` | `backend/app/models/configuration.py` 与现有精确 mapper |
| platform profile | `slug` | `uq_platform_profiles_slug` | `backend/app/models/configuration.py` 与 naming convention |
| platform prompt | `name` | `uq_platform_prompt_templates_name` | `backend/alembic/versions/0031_reusable_platform_prompts.py` 显式命名；表后续重命名不改 constraint 名 |
| platform account | `(platform_profile_id, lower(btrim(account_identifier)))` | `uq_platform_accounts_profile_identifier_normalized` | `backend/alembic/versions/0026_publication_account_dedup.py` 与现有精确 mapper |

T2 开始映射前仍须用测试数据库当前 head catalog 再确认这六个名称。若实际 catalog 与本表不同，不能添加别名或同时接受多个猜测名称，应触发停止条件。

### 2.2 当前后端行为

- `ai_configuration.py` 的 Header create/update 在身份写入之后调用 `invalidate_channel_models()`，其 SELECT 可能触发 autoflush；当前没有 duplicate 预检或具名 constraint mapper。
- AI Model create 已显式 `flush()`，update 则在追加 SUCCESS audit 后才由 commit flush；两者当前都没有具名 mapper。T1 的真实重复模型测试因此正确观察到默认 500。
- platform type `_flush_platform_type()` 已匹配 `uq_platform_types_slug` 并返回字段错误，但当前未显式检查 `sqlstate=23505`。
- platform account `_flush_platform_account()` 已匹配 `uq_platform_accounts_profile_identifier_normalized`，预检和约束路径共享同一错误构造器，但同样未显式检查 `sqlstate=23505`。
- platform profile 与 platform prompt 当前在捕获任意 `IntegrityError` 后 rollback，再重新查询是否存在重复值；这种分类会丢失原始原因边界，必须改为 `sqlstate + constraint_name` 精确识别。
- `put_content_humanization_prompt()` 当前将“singleton 不存在且 `expected_revision != null`”返回成 `REVISION_CONFLICT`，但此时没有可比较的当前 revision。

### 2.3 当前公共合同与 consumer

- `ErrorDetail.code` 是开放字符串，`details` 是开放 object；新增稳定 code 不要求引入 enum 或公共 code registry。
- Header create/update 与 Model update 已在 OpenAPI 和 runtime metadata 声明 409；Model create 当前缺少 409。
- `putContentHumanizationPrompt` 已声明 409；它的 status 集合不变。
- generated client 只会因 Model create 新增 409 response 而变化，不会为开放字符串 code 生成新类型。
- 当前 Frontend V2 没有调用全局自然化 Prompt GET/PUT 的生产页面；本 T2 只同步行为文档和后端测试，不新增 UI。
- AI Header dialog 当前对任意失败都会清空 `value`；Model dialog 保留全部表单值。两者目前只有精确 `REVISION_CONFLICT` 恢复分支，identity duplicate 仍只显示 form summary。
- platform type/account 已按 `details.errors[].loc` 投影字段；Prompt mapper 也能读取结构化字段错误，并有既有 exact-code fallback；当前没有 platform profile 创建 consumer。

### 2.4 当前测试证据与缺口

- `backend/tests/integration/test_ai_channel_management.py` 的 T1 sentinel 已用真实 PostgreSQL 证明 AI Model duplicate 当前为默认 500、constraint 不泄漏；正常 CRUD 已覆盖 revision conflict，但 Header/Model identity 409 尚无测试。
- `test_platform_types.py` 已断言 `PLATFORM_TYPE_SLUG_EXISTS` 与 slug loc；仍需补完整 message/details、cause diagnostics 和独立 Session 竞争证据。
- `test_platform_accounts.py` 已通过绕过预检触发真实 account constraint，并断言既有 code/details；仍需补 cause diagnostics 与两个独立 Session 的锁串行结果。
- platform profile/prompt 尚无能够冻结预检与真实 constraint 等价性的完整 integration coverage；全局自然化 Prompt GET/PUT 也没有四状态 HTTP 测试。
- 前端的 `platform-types.model.test.ts`、`platform-workspace.model.test.ts` 与 `prompt-workspace.model.test.ts` 已分别覆盖现有字段投影；AI workspace tests 目前只覆盖 revision 恢复与 secret 清除，没有 identity duplicate 字段映射。

## 3. Identity duplicate 精确合同

所有响应继续使用统一 `ErrorEnvelope`；其中 `error.request_id` 由当前请求生成。本矩阵冻结 `code`、`message`、HTTP status 与完整 `details` 内容。

| constraint | HTTP | code | message | details |
| --- | ---: | --- | --- | --- |
| `uq_ai_channel_headers_channel_id` | 409 | `AI_CHANNEL_HEADER_NAME_EXISTS` | `该 AI 渠道已存在同名 Header` | `{"errors":[{"loc":["body","name"],"msg":"该 AI 渠道已存在同名 Header","type":"ai_channel_header_name_exists"}]}` |
| `uq_ai_models_channel_id` | 409 | `AI_MODEL_ID_EXISTS` | `该 AI 渠道已存在相同的 Model ID` | `{"errors":[{"loc":["body","model_id"],"msg":"该 AI 渠道已存在相同的 Model ID","type":"ai_model_id_exists"}]}` |
| `uq_platform_types_slug` | 409 | `PLATFORM_TYPE_SLUG_EXISTS` | `平台类型 slug 已存在` | `{"errors":[{"loc":["body","slug"],"msg":"平台类型 slug 已存在","type":"platform_type_slug_exists"}]}` |
| `uq_platform_profiles_slug` | 409 | `PLATFORM_SLUG_EXISTS` | `平台 slug 已存在` | `{"errors":[{"loc":["body","slug"],"msg":"平台 slug 已存在","type":"platform_slug_exists"}]}` |
| `uq_platform_prompt_templates_name` | 409 | `PLATFORM_PROMPT_NAME_EXISTS` | `Prompt 名称已存在` | `{"errors":[{"loc":["body","name"],"msg":"Prompt 名称已存在","type":"platform_prompt_name_exists"}]}` |
| `uq_platform_accounts_profile_identifier_normalized` | 409 | `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` | `该平台已存在相同的运营账号标识` | `{"errors":[{"loc":["body","account_identifier"],"msg":"该平台已存在相同的运营账号标识","type":"platform_account_identifier_exists"}]}` |

### 3.1 code 选择依据

- `AI_CHANNEL_HEADER_NAME_EXISTS` 表达的是渠道内 Header normalized identity 冲突。`INVALID_HEADER` 只表示语法、保留名或值规则失败，不能复用；`AI_CHANNEL_NAME_EXISTS` 只存在于一个前端测试 fixture，运行时与数据库都没有 AI channel name 唯一合同，也不能复用。
- `AI_MODEL_ID_EXISTS` 表达渠道内 provider `model_id` 冲突。当前没有语义相同的既有码；使用新的资源级 code 比继续 500 或复用 `REVISION_CONFLICT` 更可观察。
- platform profile/prompt 的既有码已被 service 或前端使用，原因语义正确；无需制造同义新 code。补全字段级 `details` 是对开放 object 的收敛，使预检、DB race 与现有表单投影一致。
- platform type/account 已有结构完整的 wire/recovery 合同，原样复用可避免无意义合同漂移；implementation 只允许增加父任务要求的 `23505` 识别条件和测试，不改变错误体。

### 3.2 unknown 边界

只有同时满足以下条件才映射上表错误：

1. 捕获到 SQLAlchemy `IntegrityError`；
2. `error.orig.sqlstate == "23505"`；
3. `error.orig.diag.constraint_name` 与表中唯一一个名称完全相等。

缺少 diagnostics、sqlstate 不同、constraint 不同或未来新增约束时，原异常必须继续抛出。不得解析异常文本、按请求字段猜测、用 rollback 后查询结果替代诊断，也不得使用 `REVISION_CONFLICT` 兜底。

## 4. 全局自然化 Prompt 合同

### 4.1 状态矩阵

| 服务端 singleton | 请求 `expected_revision` | 结果 |
| --- | --- | --- |
| 不存在 | `null` | 200，首次创建 revision 0 |
| 不存在 | 任意整数 | `409 HUMANIZATION_PROMPT_MISSING`，message=`自然化 Prompt 尚不存在`，details=`{}` |
| 存在 | 等于当前 revision | 200，更新并递增 revision |
| 存在 | `null` 或不等于当前 revision 的整数 | `409 REVISION_CONFLICT`，message=`自然化 Prompt 已被其他请求修改`，details=`{}` |

GET 合同保持不变：singleton 不存在返回 204，存在返回 200 与当前 canonical revision。由此，资源缺失与 stale revision 在 PUT 响应 code 上已经可区分，重新 GET 后还可分别观察 204 与 200。

### 4.2 选择与备选方案

- 推荐复用 `HUMANIZATION_PROMPT_MISSING`：`backend/app/services/content_production.py` 已在内容生成前置条件使用该 code，稳定 AI configuration spec 也将其冻结为同一缺失事实；PUT 可使用更贴合当前动作的既有 message，而无需新建同义 code。
- 不选 `REVISION_CONFLICT`：资源不存在时没有当前 revision，声称 stale 会让前端进入错误的“加载新版本”语义。
- 不选 404：该 endpoint 是合法的 singleton upsert，GET 已把未配置建模为 204，且同一个 PUT 在 `expected_revision: null` 时能够创建资源；409 更准确表示请求前提与当前可创建状态冲突。
- 不选 412：项目没有用 HTTP conditional headers 建模 revision；单独引入新 status 会扩大 contract/runtime/generated/frontend 范围而没有语义收益。
- `details` 保持 `{}`：这是资源级状态，不是某个输入字段无效，也不需要在错误体复制不存在的 current revision。

## 5. 前端恢复合同

| code | 字段/状态投影 | 草稿与恢复 | 禁止行为 |
| --- | --- | --- | --- |
| `AI_CHANNEL_HEADER_NAME_EXISTS` | `body.name -> name`；不进入 conflict lock | 保留 `name`、`isSensitive`，清空 `value`，聚焦/标记 Header 名；用户改名并重新输入值后显式提交 | 不 reload、不自动 replay、不把 secret 留在表单或错误对象 |
| `AI_MODEL_ID_EXISTS` | `body.model_id -> modelId`；不进入 conflict lock | 保留显示名、Model ID 与参数 JSON，用户改 Model ID 后显式提交 | 不 reload、不自动 replay、不触发成功 invalidation |
| `PLATFORM_TYPE_SLUG_EXISTS` | 现有 `body.slug` inline 错误 | 保留输入，修正后显式提交 | 不进入 revision conflict 恢复 |
| `PLATFORM_SLUG_EXISTS` | 未来 consumer 将 `body.slug` inline 投影；当前 T2 不新增页面 | 保留安全输入；无 consumer 时按 form summary + request ID 展示 | 不用 message 判断冲突 |
| `PLATFORM_PROMPT_NAME_EXISTS` | `body.name` inline 错误 | 保留 name 与 Markdown 草稿，修正后显式提交 | 不冻结 revision，不自动 replay |
| `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` | 现有 `body.account_identifier -> accountIdentifier` inline 错误 | 保留输入，修正后显式提交 | 不 reload、不自动 replay |
| `HUMANIZATION_PROMPT_MISSING` | 资源级错误，不定位字段 | 保留本地 Markdown；显式 GET。若 204，切换为 create baseline (`expected_revision=null`)，仍需用户再次确认提交 | 不把旧 revision 自动改成 null 后立即重放 |
| `REVISION_CONFLICT` | 只按精确 code 进入 stale 模式 | 冻结旧基线并显式 GET；200 时展示 canonical revision，同时保留未提交草稿供用户人工复核/合并后再次提交 | 不自动覆盖、不自动合并、不自动 replay |

所有结构化错误都必须展示 request ID，包括已成功定位字段的错误。若字段 `details` 缺失、结构错误或包含未知 loc，前端还必须在 form summary 显示服务端 message；不得从 message 文本推断字段。message 可以作为展示文本，但不是分支条件。

当前没有自然化 Prompt 管理 consumer，因此 T2 只把最后两行写入 Frontend V2 行为文档并以 backend HTTP 测试冻结，不创建占位 UI、client wrapper 或未使用 mapper。

## 6. 后端事务与优先级设计

### 6.1 flush 与 mapper owner

- 每个 identity 的错误构造器和精确 flush mapper 放在拥有该写操作的 service module；不新增全局 constraint registry，也不把领域知识放进全局 handler。
- 可保留预检以提供常见路径的及时反馈，但数据库约束始终是并发最终权威。预检和 constraint mapper必须调用同一错误构造器。
- Header create/update 必须在 identity 写入后显式 flush，再执行 `invalidate_channel_models()` 和追加 SUCCESS audit，避免 SELECT autoflush 把失败发生点藏在副作用过程中。
- Model create 保持在 audit 前 flush；Model update 在递增 revision、改变测试状态后、追加 SUCCESS audit 前显式 flush。已识别的 constraint helper 先 rollback 再以原 `IntegrityError` 为 cause 抛领域异常；未知异常原抛并由既有 request/session owner 清理。
- profile/prompt 移除“捕获任意 IntegrityError → rollback → re-query 分类”的路径，改成只匹配本设计的 `23505 + constraint_name`。
- type/account 的错误构造与 constraint allowlist 已符合设计；T2 只为 helper 补上显式 `sqlstate == "23505"` 条件，不重写事务或错误体。

### 6.2 revision 优先级

更新路径保持当前先后次序：锁定 owner → 校验 `expected_revision` → identity 预检/写入/flush。若一个请求既使用 stale revision 又提交重复 identity，结果必须是 `REVISION_CONFLICT`；只有 revision 当前时才可能返回 identity duplicate。

资源缺失独立于上述规则：全局自然化 Prompt 根本不存在时，即使请求携带某个历史 revision，也返回 `HUMANIZATION_PROMPT_MISSING`。

### 6.3 失败原子性

- Header duplicate：不新增/改写 Header，不改变 channel enabled/revision，不失效任一 model 的 enabled、revision 或 test state，不追加 SUCCESS audit。
- Model duplicate：create 不新增第二行；update 不改变目标 model identity、revision、enabled/test state；不追加 SUCCESS audit。
- type/profile/prompt/account duplicate：不新增第二行，不递增既有记录 revision，不留下绑定或其他部分状态；有成功审计的路径不能写 SUCCESS audit。
- Humanization Prompt missing/stale：不创建或改写 singleton，不递增 revision，不追加 `content_humanization_prompt.saved` SUCCESS audit。
- 映射后的 request session 与 unknown 500 request session 都必须可由既有 owner 正确 rollback/close，后续请求不能出现 failed-session 残留。

## 7. 合同与文档同步决策

| owner | T2 决策 | 理由 |
| --- | --- | --- |
| `contracts/openapi.yaml` | 修改：仅为 `createAIModel` 增加 409 response | 其他受影响 operation 已声明 409；开放 code/details schema 不变 |
| `backend/app/routers/configuration.py` | 修改：仅为 create AI Model runtime metadata 增加 409 | 使 runtime metadata 与 OpenAPI operation response 对齐 |
| 其他 configuration/planning/publication routers | 不修改 | 相关 operation 已有 409 metadata |
| `frontend/src/shared/api/generated/schema.d.ts` | 由 generator 更新 | 仅 createAIModel response status union 新增 409 |
| `contracts/database.md` | 修改 | 记录 PostgreSQL identity 权威、constraint 与领域结果；不复制 UI 细节 |
| `docs/frontend-v2/05-business-actions-state-and-api-contract.md` | 修改 | 冻结字段投影、secret、missing/stale 与禁止 replay 行为 |
| `.trellis/spec/backend/ai-configuration-guidelines.md` | 修改 | 冻结 AI identity mapper 与自然化 Prompt missing/stale 语义 |
| `.trellis/spec/backend/database-guidelines.md` | 修改 | 补齐 profile/prompt 的精确 constraint mapper 与字段错误 |
| `.trellis/spec/backend/error-handling.md` | 修改：仅同步 response occurrence 基线计数 | 通用 diagnostics/unknown/字段错误规则不变，但 1023/861 会因 createAIModel 409 变为 1024/862 |

按当前 contract test 基线，新增 createAIModel 409 后：冻结 response entry 总数由 1023 变为 1024，runtime augmented response 总数同为 1024，raw/stripped runtime response 总数由 861 变为 862；OpenAPI/generated 的完整 status 集合由 `201/400/401/403/404/422` 变为 `201/400/401/403/404/409/422`，而 `test_frozen_response_status_signatures_cover_every_operation()` 内的 `expected_by_signature` 按既有惯例排除统一的 400，其 tuple 由 `201/401/403/404/422` 变为 `201/401/403/404/409/422`。若 T2 开始前无关合同已经合法变化，应以当时基线重新计算，不得为了匹配旧计数回退新合同。

## 8. 后续 T2 精确文件边界

### 8.1 允许修改

Contract 与文档：

- `contracts/openapi.yaml`
- `contracts/database.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `.trellis/spec/backend/ai-configuration-guidelines.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/error-handling.md`，仅同步 contract/runtime response occurrence 计数

Backend production/runtime：

- `backend/app/services/ai_configuration.py`
- `backend/app/services/platform_configuration.py`
- `backend/app/services/content_planning.py`，仅 `create_platform_profile`
- `backend/app/services/publication.py`，仅为 platform account flush mapper 增加 `23505` 识别条件
- `backend/app/routers/configuration.py`，仅 create AI Model response metadata

Backend tests：

- `backend/tests/integration/test_ai_channel_management.py`
- `backend/tests/integration/test_platform_types.py`
- `backend/tests/integration/test_platform_accounts.py`
- `backend/tests/integration/test_platform_profile_list.py`
- `backend/tests/integration/test_platform_workspace.py`
- `backend/tests/unit/test_contract.py`
- `backend/tests/unit/test_runtime_response_metadata.py`

Generated/frontend：

- `frontend/src/shared/api/generated/schema.d.ts`，只允许 generator 输出
- `frontend/src/domains/configuration/ai-channel-workspace.model.ts`
- `frontend/src/domains/configuration/ai-channel-workspace-page.tsx`
- `frontend/src/domains/configuration/ai-channel-models-section.tsx`
- `frontend/src/domains/configuration/ai-channel-workspace.model.test.ts`
- `frontend/src/domains/configuration/ai-channel-workspace-page.test.tsx`
- `frontend/src/domains/configuration/prompt-workspace.model.ts`，删除不依赖 structured loc 的 exact-code 字段回填
- `frontend/src/domains/configuration/prompt-workspace.model.test.ts`

### 8.2 仅作 validation target，不预期修改

- `backend/app/models/**`、`backend/alembic/**`：只核对约束，不改 schema/migration。
- `backend/app/routers/planning.py`、`backend/app/routers/publication.py`：现有 409 metadata 不变。
- `backend/tests/integration/test_prompt_preview_options.py`：验证 Prompt 使用方不回归。
- `backend/tests/unit/test_audit.py`、`backend/tests/unit/test_configuration_audit.py`：验证审计投影不回归。
- `frontend/src/domains/configuration/platform-types.model.test.ts`、`platform-workspace.model.test.ts`、`prompt-workspace-page.test.tsx`：验证既有投影/页面行为。

### 8.3 明确禁止扩张

- 不修改 global exception handler 或恢复未知 IntegrityError 的旧 409 映射。
- 不新增 code enum、全局 constraint registry、兼容别名、消息解析或第二套错误类型。
- 不修改数据库结构、约束名称、权限、状态机、部署配置或生产数据。
- 不新增全局自然化 Prompt 前端页面/API wrapper。
- 不顺带实现 AI channel name 唯一、其他领域约束或 UI 视觉改造。

## 9. 并发与测试策略

共享锁会影响如何构造可靠测试，不能机械地在已持有同一锁之后放置 barrier：

- AI Model create、platform type create、platform prompt create/update 等没有共同 identity owner 锁的路径，使用两个独立 Session/connection 与 barrier，使双方先通过预检再竞争数据库约束；断言恰一成功、一方得到矩阵中的领域错误。
- AI Header 写入按 channel 行锁串行；platform profile create 使用全局 prompt-binding advisory lock；platform account 写入按 platform 行锁串行。对这些路径，用两个独立 Session 证明 observable 结果仍是一成功、一具名冲突，不在共享锁后设置会死锁的 barrier。
- 对被锁串行且通常由预检拦截的路径，另以真实 PostgreSQL 暂时绕过预检的定向测试触发最终 constraint mapper，并断言异常 cause 的 `sqlstate` 与 `diag.constraint_name`；不能用纯 mock 代替数据库证据。
- AI Model duplicate sentinel 转为已知 409 后，在同一 model flush 边界保留两条真实 PostgreSQL unknown 反例：`23514 ck_ai_models_ck_ai_models_test_status` 证明 sqlstate 分支，`23505 pk_ai_models` 证明 constraint allowlist。两者都断言原 `IntegrityError` 对象继续抛出、事务已清理；再由前置任务的 global handler regression 证明默认 500 与无数据库文本泄漏，避免为测试制造新的生产入口。
- update duplicate 还要证明 stale revision 优先于 identity duplicate。
- HTTP 层对每个新增/变化合同断言完整 ErrorEnvelope；service 层或 integration fixture 断言 cause diagnostics 与失败副作用。

## 10. 备选方案取舍

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| AI duplicate 继续 unknown 500 | 拒绝 | 这是数据库明确、用户可纠正且可稳定识别的 identity 冲突；500 无法支持字段恢复 |
| AI duplicate 使用 `REVISION_CONFLICT` | 拒绝 | identity 与 stale revision 的恢复动作不同，会错误锁定表单并要求 reload |
| Header duplicate 使用 `INVALID_HEADER` | 拒绝 | Header 名本身可能完全合法，只是 normalized identity 已存在 |
| Header duplicate复用 fixture 的 `AI_CHANNEL_NAME_EXISTS` | 拒绝 | fixture 不构成运行时合同，且指向 channel name 而非 Header identity |
| profile/prompt 保持空 `details` | 拒绝 | 会让同类 identity 冲突无法稳定字段定位，也使预检与数据库路径难以形成统一字段合同 |
| humanization missing 新增同义 code | 拒绝 | `HUMANIZATION_PROMPT_MISSING` 已是稳定缺失事实，没有必要产生第二语义源 |
| humanization missing 改 404/412 | 拒绝 | 与合法 singleton upsert、GET 204 和现有 body revision 机制不一致，并扩大 status 合同 |
| 为所有约束建立全局 registry | 拒绝 | 领域 message/details 与事务 owner 位于 service，本任务没有跨域共享实现压力 |

## 11. 风险与控制

- 最大风险是 flush 位置不当导致失败前已经写 SUCCESS audit 或使 Header/model 状态失效；通过显式 flush 顺序与失败副作用断言控制。
- 第二风险是测试只覆盖预检而没有覆盖真实 constraint；通过 diagnostics cause 与独立 Session 场景控制。
- 第三风险是前端把任何 409 当 revision conflict；通过 exact-code mapper、字段投影与禁止 replay 测试控制。
- 第四风险是静态 OpenAPI、runtime metadata 与 generated client 只更新一部分；三者必须作为同一原子 slice 修改和回滚，并以 `make contract-check` 一次性收口。
