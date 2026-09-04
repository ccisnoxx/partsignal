# Research: 公共错误合同与前端消费者影响

- Query: 审计 IntegrityError 的公开错误码/状态合同、运行时 response metadata、生成客户端、契约门禁及前端 REVISION_CONFLICT 消费者，判断数据库约束错误域映射对公共合同和“保留草稿/显式 reload”行为的影响。
- Scope: internal
- Date: 2026-09-04

## Findings

### 1. 搜索范围、统计口径和门禁实证

- 已阅读 `.trellis/workflow.md`、`.trellis/spec/backend/error-handling.md`、相关前端 type-safety/quality spec、`contracts/openapi.yaml`、`backend/app/errors.py`、`backend/app/main.py`、`backend/app/tools/contract_check.py`、相关 routers/services、`backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`、`backend/tests/unit/test_contract_check.py`、相关 integration tests，以及 `docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`docs/frontend-v2/08-testing-quality-and-acceptance.md`。
- OpenAPI 统计口径：用 YAML 解析 `contracts/openapi.yaml` 的 `paths`/HTTP operations/responses，得到 128 个 path、162 个唯一 operationId、1023 个 response entry；其中 409 response entry 为 106 个。所有非成功响应均引用公共 `ErrorResponse`（该 component 在 `contracts/openapi.yaml:4162-4168`），不是 operation-specific error schema。
- 后端 IntegrityError 统计口径：`rg -n 'IntegrityError' backend --glob '*.py'` 共 20 个匹配行、8 个文件；其中 9 个 service 层 `except IntegrityError` 站点，另有 1 个全局 handler。该统计包含 import、函数签名和注册行，不把它们误算成 20 个独立异常路径。
- 前端 REVISION_CONFLICT 统计口径：`rg -n 'REVISION_CONFLICT' frontend/src --glob '*.ts' --glob '*.tsx'` 共 54 行（包含测试和生成文件）；排除 `*.test.*` 及 `shared/api/generated/schema.d.ts` 后，生产源文件有 15 行；`frontend/tests/e2e` 另有 32 行。状态检索以 `status === 409` 等文本形式统计，排除生成文件和测试后有 14 个生产源匹配行；它们不等价于 14 个 revision consumer，因为有些 409 是业务上下文失效或删除 blocker。
- 实际运行 `make contract-check`：后端输出“FastAPI 运行时操作与 OpenAPI 完整契约一致”，前端 `openapi-typescript 7.13.0` 生成临时类型后输出“OpenAPI 类型与根合同一致”，命令成功退出且未修改工作区。

### 2. 现有公共合同冻结状态

#### 2.1 错误 envelope、状态和运行时 metadata

- OpenAPI 的 `ErrorEnvelope`/`ErrorDetail` 是封闭对象，要求 `error` 以及 `code`、`message`、`details`、`request_id`；但 `ErrorDetail.code` 只有 `{type: string}`，没有域错误码 enum（`contracts/openapi.yaml:4191-4205`）。OpenAPI 中找到的错误码 enum 只有 `UserBulkStatusFailure.code` 的 `NOT_FOUND`、`REVISION_CONFLICT`、`LAST_ADMIN_REQUIRED`、`INVALID_STATE_TRANSITION`（`backend/tests/unit/test_contract.py:408-413` 对应合同断言），不是公共 `ErrorDetail.code`。
- `ErrorResponse` 只冻结 JSON schema 和 `X-Request-ID` header（`contracts/openapi.yaml:4162-4168`）。每个 operation 是否可返回 409 由该 operation 显式列出的 status 决定；例如 `createProduct`/`updateProduct` 在 `contracts/openapi.yaml:413,420-432`、`454,461-474`，`createPlatformType`/`updatePlatformType` 在 `1289,1296-1308`、`1312` 后的 responses，`createPlatformAccount`/`updatePlatformAccount` 在 `2634,2641-2654`、`2658` 后的 responses。
- 运行时 `error_responses(*status_codes)` 只将调用方显式传入的状态绑定为 `ErrorEnvelope`，不推断额外状态（`backend/app/errors.py:16-20`）。`_merge_request_context_metadata` 只集中注入 Request-ID parameter、response header、公共 `ErrorResponse` component 及缺省 400，不维护错误码 registry 或 IntegrityError 域映射（`backend/app/main.py:155-218`）。
- 全局 `IntegrityError` handler 仍把所有未被局部捕获的数据库约束异常统一变成 HTTP 409 `REVISION_CONFLICT`（`backend/app/errors.py:76-78`），并在 app 全局注册（`backend/app/main.py:259-261`）。这会把不属于 expected_revision 竞争的未知约束异常投影为版本冲突；当前 OpenAPI 没有任何 operation 的 500 response。
- 该全局 handler 不按 operation 限定 status；因此即使某个 operation 的静态 response 集没有 409，未被局部捕获的 `IntegrityError` 仍可能实际返回 409。`contract_check`/runtime metadata gate 比较的是声明文档，不会通过静态 response 比较发现这种异常分支，需另加运行时 sentinel/operation 级测试。
- 完整 gate 的依据是逐 operation 精确比较**已声明** response status/schema/header；`backend/tests/unit/test_contract.py:37-39` 调 `check(contract) == []`，`backend/tests/unit/test_contract.py:42-98` 冻结 162 operations/1023 responses、公共 400、无 `default`/`4XX`，`backend/tests/unit/test_contract.py:100-` 冻结每个 operation 的精确声明状态签名。它会拒绝运行时 metadata 擅自声明稳定 500，但不会也不应把框架 ordinary unhandled 500 推断为公共 response contract。`backend/app/tools/contract_check.py:1376-1442` 比较全部已声明 response contracts，而非只检查成功响应；运行时 metadata 测试也断言 400、ErrorResponse、headers 和 raw/augmented operation 不漂移（`backend/tests/unit/test_runtime_response_metadata.py:657-692`）。

#### 2.2 IntegrityError 相关码的逐 operation 证据

下表中的“公共冻结”指 status/统一 envelope 已冻结；“code enum”指没有冻结。生成客户端同样只得到开放 `string`，不是这些域码的 union。

| 运行时 code/status | 相关 operationId 与证据 | OpenAPI / generated client | 前端 projection / 结论 |
|---|---|---|---|
| `PRODUCT_ALREADY_EXISTS` / 409 | `createProduct`、`updateProduct`：`backend/app/services/product_facts.py:39-60,395-423,427-484`；routers `backend/app/routers/product_facts.py:111-125,159-176`；OpenAPI `contracts/openapi.yaml:413-432,454-474`。竞态约束只认 `diag.constraint_name == 'uq_products_normalized_brand'`。 | 409 + `ErrorResponse` 已冻结；`ErrorDetail.code` 仍为 string，未有该码 enum。 | 表单 mapper 保留通用 detail，测试明确断言该码（`frontend/src/domains/product/product.api.ts:273-304`、`frontend/src/domains/product/new-product-page.test.tsx:134`）。保持 409/envelope 可复用现合同；若要把码作为类型冻结，才需改 OpenAPI/generated。
| `PLATFORM_TYPE_SLUG_EXISTS` / 409 | `createPlatformType`、`updatePlatformType`：`backend/app/services/platform_configuration.py:390-420,478-499`；routers `backend/app/routers/configuration.py:356-384`；OpenAPI `contracts/openapi.yaml:1289-1308,1312` 后 responses。局部 helper 只认 `uq_platform_types_slug`。 | 409 + 公共 envelope 已冻结；没有 code enum。 | `mapPlatformTypeFormError` 仅根据 structured field errors 映射字段，另以 `revisionConflict` 精确检查 `REVISION_CONFLICT`（`frontend/src/domains/configuration/platform-types.model.ts:105-142`）。可复用现有解析器；无需合同改动即可保持域码。
| `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` / 409 | `createPlatformAccount`、`updatePlatformAccount`：`backend/app/services/publication.py:208-235,272-314`；routers `backend/app/routers/publication.py:203-232`；OpenAPI `contracts/openapi.yaml:2634-2654,2658` 后 responses。竞态 helper 只认 `uq_platform_accounts_profile_identifier_normalized`。 | 409 + 公共 envelope 已冻结；没有 code enum。 | `mapPlatformAccountFormError` 依据 `details.errors[].loc` 映射 `account_identifier`，但不返回 code（`frontend/src/domains/configuration/platform-workspace.model.ts:259-287`）；单元/UI fixture 仍使用该码（`frontend/src/domains/configuration/platform-workspace.model.test.ts:164`、`platform-workspace-page.test.tsx:688`）。如只修约束映射可复用现有字段错误；若前端需要区分域码，应先决定是否扩展 mapper，而不是另建类型系统。
| `PLATFORM_PROMPT_NAME_EXISTS` / 409 | `createPlatformPrompt`、`updatePlatformPrompt`：`backend/app/services/platform_configuration.py:615-653,656-713`；routers `backend/app/routers/configuration.py:1117-1140,1161-`；OpenAPI `contracts/openapi.yaml:1119-1140,1163` 后 responses。竞态 fallback 是 rollback 后按 name 查询。 | 409 + 公共 envelope 已冻结；没有 code enum。 | `mapPromptFormError` 明确按 code 将 name 错误投影到字段（`frontend/src/domains/configuration/prompt-workspace.model.ts:132-148`）；现有行为可复用。
| `PLATFORM_SLUG_EXISTS` / 409 | `createPlatformProfile`：`backend/app/services/content_planning.py:304-346`；router `backend/app/routers/planning.py:231-245`；OpenAPI `contracts/openapi.yaml:910` 后 responses。局部竞态 fallback 按 slug 查询。 | `createPlatformProfile` 的 201/409/422 等状态及公共 envelope 已冻结；没有 code enum。 | 本次源检索未发现该码在前端生产 projection 中作为独立 union；无需因保留现码而改合同，但应由后端决定未知约束的显式失败语义。
| `USER_IN_USE` / 409 | `deleteUser`：`backend/app/services/identity.py:597-634`；router `backend/app/routers/identity.py:340-353`；OpenAPI operationId `deleteUser` 在 `contracts/openapi.yaml:267`，其 DELETE response 含 409。预检查和 flush FK (`sqlstate == '23503'`) 均映射该码；integration 明确断言 `409/USER_IN_USE` 和 references（`backend/tests/integration/test_identity_management.py:675-684`）。 | 409 + 公共 envelope 已冻结；没有 code enum。 | 前端删除确认在 `frontend/src/domains/identity/user-list-page.tsx:917-923` 只看 status 409，因而会把 `USER_IN_USE` 当成 revision-like freeze（见第 3 节）。
| `IDEMPOTENCY_CONFLICT`、`HUMANIZATION_ALREADY_ACTIVE` / 409 | `createGenerationJob`、`createHumanizationJob`、`retryGenerationJob`：`backend/app/services/content_production.py:279-421,424-515,532-551,597-`；对应 operationId/OpenAPI 分别 `contracts/openapi.yaml:2193,2266,2312`。`createHumanizationJob` 局部捕获后按幂等键/活动作业返回明确域码；`createGenerationJob`/retry 的未处理约束可落入全局 handler。 | 相关 operations 已声明 409 + 公共 envelope；没有 code enum。 | 前端只对 `IDEMPOTENCY_CONFLICT` 做幂等 key 清理（如 `frontend/src/domains/content/new-content-task-page.tsx:165`），不是 revision recovery。未知 IntegrityError 若被全局 handler 改写成 `REVISION_CONFLICT`，会错误触发严格 consumer。

因此，当前“已冻结”的是 HTTP 409、公共 ErrorEnvelope、请求 ID、各 operation 的 status signature；IntegrityError 域 code 只在运行时 Python、integration fixtures 和少量前端字符串中形成事实约定，没有在 OpenAPI 或 generated client 中冻结为公共 code union。

### 3. `REVISION_CONFLICT` 前端消费者与草稿/reload 行为

#### 3.1 按 code 精确判断，符合保留草稿原则的路径

- AI 渠道列表只在 `detail.code === 'REVISION_CONFLICT'` 时设置 conflict 并显示重新加载动作（`frontend/src/domains/configuration/ai-channel-list-page.tsx:139-140`）；workspace/platform type model 也使用 detail code 精确 helper（`frontend/src/domains/configuration/ai-channel-workspace.model.ts:433`、`platform-types.model.ts:136-142`、`platform-workspace.model.ts:301-303`）。
- Prompt 编辑保存只在精确 `REVISION_CONFLICT` 时冻结；删除 Dialog 也精确检查 code（`frontend/src/domains/configuration/prompt-workspace-page.tsx:468-479,737-746`）。
- Content editor 在 `REVISION_CONFLICT` 时保留本地 form、携带 request ID 调用 conflict projection，不 reset/merge/replay；submit review 对非该码重新抛出（`frontend/src/domains/content/content-editor-page.tsx:246-263,297-307`）。
- Product Facts workspace/review 只对 `REVISION_CONFLICT` 设置 conflict；`INVALID_STATE_TRANSITION` 等另走显式 reload（`frontend/src/domains/product/fact-workspace-page.tsx:174-208`）。Product Detail 将 `REVISION_CONFLICT`（以及业务上另一个 canonical refresh 码 `IMMUTABLE_VERSION`）映射为 refreshCanonical（`frontend/src/domains/product/product-detail.model.ts:73-80`）。
- GEO correction 明确把 `GEO_PUBLICATIONS_CHANGED` 与 `REVISION_CONFLICT` 两个已知冲突码放入集合，禁止自动 replay 并设置 stale（`frontend/src/domains/geo/geo-observation-correction-page.tsx:79,168-182`）；这是两个不同业务冲突码的显式政策，不是任意 409。

这些路径与前端合同文档一致：Optimistic Concurrency 要求显式“查看最新版本/重新加载”（`docs/frontend-v2/05-business-actions-state-and-api-contract.md:118-127`），Facts workspace 要求保留本地表单及冲突 request ID、只有显式 reload 采用 canonical（`.../05-business-actions-state-and-api-contract.md:155-161`），Error Contract 要求前端基于 code 而不是任意 message（同文件 `:291-295`）。测试验收也要求覆盖 revision conflict、业务 blocker、stale data 并为每个 error code 提供明确 UX（`docs/frontend-v2/08-testing-quality-and-acceptance.md:475-477`）。

#### 3.2 只按 HTTP 409 的消费者和影响

以下是排除测试/生成类型后的 14 个生产源 status-409 匹配；它们需要按 operation 的合法 409 code 集合逐一确认，不能笼统视为 revision consumer：

- 删除确认：用户 `frontend/src/domains/identity/user-list-page.tsx:917-923`；平台 profile `frontend/src/domains/configuration/platform-list-page.tsx:603-612`；平台 type `frontend/src/domains/configuration/platform-types-page.tsx:446-455`；平台 account `frontend/src/domains/configuration/platform-workspace-page.tsx:1148-1156`。它们都用 status 409 禁止确认并保留 Dialog。实证上 `USER_IN_USE` 会被 user path 误判（后端 `backend/tests/integration/test_identity_management.py:675-684`），`PLATFORM_TYPE_IN_USE` 也与真正 stale 码区分（`backend/tests/integration/test_platform_types.py:210-216`）。平台文档同时明确“任意删除 409 冻结确认”（`docs/frontend-v2/05-business-actions-state-and-api-contract.md:351,367,377,426`），所以这是“按所有删除冲突冻结”的既有设计；若本任务的新要求收紧为“只有 expected_revision stale 才进入保留/显式 reload 路径”，这些消费者必须改为 code-aware，并为 blocker 提供独立错误投影。若仍保留“任意删除 409 冻结”策略，则不能把这些 status 判断称为实现错误，但应在公共错误策略中明确该例外。
- Query Topic 编辑/删除：`frontend/src/domains/geo/query-topic-list-page.tsx:575` 和 `:753-754` 均只看 status 409。文档规定 PATCH/DELETE 409 保留输入且不 replay、显式 reload（`docs/frontend-v2/05-business-actions-state-and-api-contract.md:223`）；删除还可能是 `QUERY_TOPIC_IN_USE` 一类 blocker，因此 save/delete 应分 operation 和 code 处理，而不是共享一个 status-only “revisionConflict”。
- Content Review/lifecycle：`frontend/src/domains/content/content-review-page.tsx:145-153` 在任意 409 后标记 context stale 并 refresh；`content-task-lifecycle.tsx:103-110` 在 404 或 409 后失效 detail/list/preview。它们不一定保留用户编辑草稿，但会把 action unavailable/context incomplete/idempotency 等业务码归入 stale refresh；文档对 review/command 要求 409 不 replay（`docs/frontend-v2/08-business-actions-state-and-api-contract.md:189,215`）。
- Publication workspace/article/issue/start：`frontend/src/domains/publication/publication-workspace-actions.tsx:223-226`、`published-content-issue-workspace-actions.tsx:161`、`published-article-detail-page.tsx:292`、`start-publication-dialog.tsx:110-111` 均以 `mapped.status === 409` 设置 context stale 或调用 conflict handler。Publication 后端 409 同时包含 `REVISION_CONFLICT`、`INVALID_STATE_TRANSITION`、`PUBLICATION_CONTEXT_INCOMPLETE`、`IDEMPOTENCY_CONFLICT` 等（`backend/app/services/publication.py:464-524,569-625,896-965`）；是否全部按 stale context 处理需由 operation-specific policy 决定，不能从 status 证明是 revision。
- GEO：`frontend/src/domains/geo/geo.api.ts:301-309` 的 optimization mapper 返回 `stale: error.status === 409`；route/detail 错误也只按 status 409 给出通用失败（`frontend/src/routes/_app/geo/observations/$observationId_.correct.tsx:82`、`frontend/src/domains/geo/geo-observation-detail-page.tsx:397`）。与 correction page 的 code 集合不一致，若这些 UI 涉及输入保留/reload，应改为明确允许的 conflict code；否则应把 `stale` 命名为更宽的“409 domain conflict”而不是 revision。

最明确的前端投影问题是用户删除：`USER_IN_USE` 已被后端测试冻结为 409，但 `user-list-page.tsx:917` 会使 `canDelete` 变为 false（`920-923`），并进入该 Dialog 的显式 reload 文案路径。它不是 expected_revision 竞争。平台 type 删除同样有已证实的 `PLATFORM_TYPE_IN_USE` 与 `REVISION_CONFLICT` 分别返回（`backend/tests/integration/test_platform_types.py:210-216`），而 UI `platform-types-page.tsx:449` 两者 status-only 合流。是否修复所有删除页面取决于新任务是否推翻文档现有“任意删除 409 冻结”策略。

### 4. 哪些建议需要公共合同变更，哪些可复用既有码

#### 不需要公共合同变更（保留 409 + ErrorEnvelope）

1. 将已知 PostgreSQL constraint/sqlstate 映射到现有稳定域码，并让未知约束显式失败：只要继续使用现有 HTTP 409、`ErrorResponse`、`ErrorDetail` 结构和 operation 已声明的 409，OpenAPI、runtime metadata、generated client 无需变化。应复用 `.trellis/spec/backend/error-handling.md` 要求的 `diag.constraint_name`/`sqlstate` 精确匹配和未知 re-raise 方向，不把未知异常再伪装为 `REVISION_CONFLICT`。
2. 修正前端 status-only 误判：解析器已经保留 `detail.code`（例如产品 parser 的 `ProductRequestError`/`mapProductFormError` 在 `frontend/src/domains/product/product.api.ts:267-304`），可在现有 domain mapper 中精确区分 `REVISION_CONFLICT`、`USER_IN_USE`、`PLATFORM_TYPE_IN_USE`、`IDEMPOTENCY_CONFLICT` 等；不必增加新 schema 或第二套全局 code 类型。平台账号表单 mapper 当前丢弃 code（`platform-workspace.model.ts:259-287`），若要在该表单显示不同 UX，只需扩大本地 mapper 返回值并覆盖测试。
3. 保持现有 unique code（`PRODUCT_ALREADY_EXISTS`、`PLATFORM_TYPE_SLUG_EXISTS`、`PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`、`PLATFORM_PROMPT_NAME_EXISTS`、`PLATFORM_SLUG_EXISTS`）及其 `details.errors[].loc`。后端 integration 已证明 pre-check 与 DB race 使用相同 code/details（例如 platform account `backend/tests/integration/test_platform_accounts.py:193-203`、platform type `:193-204`）；前端应继续复用 structured field projection，禁止解析 message。

#### 需要公共合同变更

1. 若决定为未知 IntegrityError 引入**稳定 JSON 500 信封/code/header**或新增 operation-specific 500 response：必须同步 `contracts/openapi.yaml` 的受影响 operation response、router `error_responses(...)`、runtime metadata、`backend/tests/unit/test_contract.py` 的 exact status matrix、运行时 response tests、generated `schema.d.ts` 和 `frontend/scripts/check-openapi.mjs` gate。相反，删除错误 handler、恢复其他未处理异常已经使用的框架默认 500，只是撤销错误 409 映射，不新增可生成的公共 response；此时不得把默认 body/code/header 冻结进测试或合同。
2. 若要把上述域码冻结为可生成的公共 union：需改变 `ErrorDetail.code`（全局影响）或为各 operation 增加命名错误 schema/oneOf，并清点已有所有 AppError code。`frontend/src/shared/api/generated/schema.d.ts:2106-2117` 当前是 `code: string`，`ErrorResponse` 仍只引用 `ErrorEnvelope`；修改会触发 generated client、fixtures、parser 类型和大量 operation contract tests。现有 bulk union（`schema.d.ts:2214` 对应 `UserBulkStatusFailure`）不能作为通用错误码 registry。
3. 若公共 policy 要求删除/command 409 只有 `REVISION_CONFLICT` 才可进入 stale/reload，而现有文档的“任意删除 409 冻结”不再成立，需要更新相应业务合同文档、前端页面行为测试以及可能的 operation-specific error projection；这不是 OpenAPI status 变化，但属于产品/前端行为合同变化，应由主任务明确批准。

### 5. 相关文件和证据索引

- OpenAPI/运行时：`contracts/openapi.yaml:4162-4205`、`backend/app/errors.py:16-20,41-78`、`backend/app/main.py:62-85,155-218,249-261`。
- 完整 response contract gate：`backend/tests/unit/test_contract.py:37-104` 及其后 `expected_by_signature`，`backend/tests/unit/test_runtime_response_metadata.py:657-692`，`backend/app/tools/contract_check.py:1376-1442`；执行入口 `Makefile:16-18`。
- 生成客户端：`frontend/src/shared/api/client.ts:1-9` 使用 `openapi-fetch` 的 `paths`；`frontend/src/shared/api/generated/schema.d.ts:2106-2117` 是开放 string code 的 ErrorDetail；`frontend/scripts/check-openapi.mjs:7-29` 临时生成并 byte-for-byte 比较，`frontend/package.json:19-20` 固定 api generate/check，依赖中观察到 `openapi-typescript ^7.13` 和 `openapi-fetch ^0.17`。
- 前端行为合同：`docs/frontend-v2/05-business-actions-state-and-api-contract.md:118-127,155-161,189,215,223,291-295,351,367,376-377,424-426`；验收合同 `docs/frontend-v2/08-testing-quality-and-acceptance.md:77,85,89,176,182,186,190,223,248,262,268,284,354,475-485`。
- 本地规范：`.trellis/spec/backend/error-handling.md`（精确 constraint 映射、统一 envelope、未知约束不吞）；前端 type-safety/quality spec（生成类型和错误 UX 约束）。

## Caveats / Not Found

- 未在 `contracts/openapi.yaml` 或生成的 `ErrorDetail` 中找到 `PRODUCT_ALREADY_EXISTS`、`PLATFORM_TYPE_SLUG_EXISTS`、`PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`、`PLATFORM_PROMPT_NAME_EXISTS`、`PLATFORM_SLUG_EXISTS`、`USER_IN_USE` 的 enum；也未找到集中式前端 error-code registry/projection。唯一直接列出 `REVISION_CONFLICT` 的通用样式是 user bulk failure union，不能推导为所有 operation 的 ErrorDetail union。
- 未在 `backend/tests` 中找到直接调用/断言 `integrity_error_handler` 对未知 IntegrityError 的 sentinel 测试；现有 integration tests 主要覆盖已知 constraint/sqlstate 以及各 operation 的显式 `REVISION_CONFLICT`。因此全局 handler 的未知约束行为虽可由源码确认，仍缺一条防 SQL 泄漏、错误码不冒充 revision、事务副作用不变的回归证据。
- 本文件只审计公共 API/运行时 metadata/生成 client/前端消费者；没有替代主任务对全部数据库 migration constraint、每个 IntegrityError 触发点和最终 backend 领域映射表的完整盘点。
- 文档对删除场景反复写明“任意删除 409 冻结确认”（例如 `05...:351,367,426`），而用户本次关注“只有真实 expected_revision 冲突进入保留草稿/显式 reload”可能收紧该约定。status-only 删除路径是否应改，是一个需主任务确认的合同策略差异，不应在本只读审计中擅自选定。
- 没有引入外部网络资料；版本证据来自本地 `frontend/package.json`/实际 `make contract-check` 输出。未修改代码、合同、spec、历史 task 或 Git 状态；唯一写入为本 research 文件。
