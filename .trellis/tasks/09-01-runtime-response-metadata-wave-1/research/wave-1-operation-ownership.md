# Research: Runtime Response Metadata Wave 1 operation ownership

- Query: 盘点 foundation、configuration、identity、files 路由在 Phase B 冻结逐操作矩阵中的 operation 集合、最终 response status、422 分界、成功 media/header 特殊点，以及当前 route/test owner。
- Scope: mixed（内部代码、冻结矩阵、OpenAPI 与现有 backend tests）
- Date: 2026-09-01

> 2026-09-02 恢复注记：逐 operation 的 method/path/operationId/status authority 未被 `09-02-response-schema-composition-authority-repair` 改变。该前置 Task 已以 `7be5b979` 把不可满足的 closed-base `allOf` 修正为展平、closed schema；本文件中关于旧 composition 漂移的诊断只保留为历史背景，不再授权 Wave 1 添加 custom schema hook 或修改 `schemas/configuration.py`。

## Findings

### 结论与边界

- Wave 1 共 61 个 operation：foundation 2、identity 15、configuration 39、files 5。operation identity 取冻结矩阵的 `method + path + operationId`；矩阵总计 162 个 operation，本文件只列 route owner 在 `backend/app/main.py` 或三个目标 router 的行。
- 最终 status 集合全部来自 Phase B 归档文件 `.trellis/tasks/archive/2026-09/09-01-frozen-contract-authority-reconciliation/research/final-response-authority-matrix.jsonl` 的 `phase_b_statuses`，不是从当前 runtime metadata 推测。当前 route decorators 仍主要只声明成功响应，因此这份清单是 Wave 1 目标而非已实施状态。
- 按矩阵逐行复核，Wave 1 有 53 个 operation 显式包含 422、8 个 operation 不含 422。8 个 validation-free operation 是：`getLiveHealth`、`getReadyHealth`、`getAuditLogFilterOptions`、`getCsrfToken`、`getCurrentUser`、`getContentHumanizationPrompt`、`listPlatformPrompts`、`listPlatformTypes`。
- 成功响应默认是 JSON（相应 `response_model`）；204 是 no-body。唯一成功 media/header 特殊点是 `exportUsers` 与 `exportPlatformProfiles`：HTTP 200 为 `text/csv` string，并有 `Content-Disposition` 下载头。`getLiveHealth`/`getReadyHealth` 的 `HealthResponse.checks` 可省略且可为 `null`。`login`/`logout` 写入多个 `Set-Cookie`，不能用一个 OpenAPI Header Object 精确表达；本 Wave 不改 Cookie 行为，继续由 HTTP sentinel 保护。
- 本 Wave 的通用契约 owner 是 `backend/tests/unit/test_contract.py:37-292` 的逐 operation status signature（不应只保留代表路由）。专项 wire/行为 owner 见各表的“测试 owner”列；若只列 contract test，表示当前没有找到更窄的已存在 route sentinel，实施时应为该 operation 增加/扩展定向 metadata 测试。

### 逐操作清单：foundation（2）

| method/path | operationId | Phase B 最终 statuses | 422 显式 | 成功 media/header 特殊点 | 当前 route owner | 当前 test owner |
|---|---|---|---|---|---|---|
| GET `/api/health/live` | `getLiveHealth` | `200` | 否 | JSON `HealthResponse`；`checks` optional 且可 null | `backend/app/main.py:88-96` `live_health` | `backend/tests/unit/test_contract.py:37-44,1260-1263`；`test_request_context.py:9-24` |
| GET `/api/health/ready` | `getReadyHealth` | `200, 503` | 否 | JSON `HealthResponse`；依赖未就绪逃逸为 503，`checks` optional/null | `backend/app/main.py:99-116` `ready_health` | `backend/tests/unit/test_contract.py:37-44`；当前未发现独立 ready route sentinel |

### 逐操作清单：identity（15）

| method/path | operationId | Phase B 最终 statuses | 422 显式 | 成功 media/header 特殊点 | 当前 route owner | 当前 test owner |
|---|---|---|---|---|---|---|
| POST `/api/v1/auth/login` | `login` | `200, 401, 422` | 是 | JSON `AuthSession`；route 写入两个 `Set-Cookie` 实例（多实例行为不进入 OpenAPI Header parity） | `backend/app/routers/identity.py:103-124` `login` | `backend/tests/unit/test_contract.py:37-56`；`backend/tests/integration/test_identity_management.py:86-174,376-447` |
| POST `/api/v1/auth/logout` | `logout` | `204, 401, 403, 422` | 是 | 204 no-body；route 删除两个 Cookie 实例 | `backend/app/routers/identity.py:127-137` `logout` | `backend/tests/unit/test_contract.py:37-78`；`backend/tests/integration/test_identity_management.py:86-174` |
| GET `/api/v1/auth/me` | `getCurrentUser` | `200, 204, 401` | 否 | 200 JSON `UserOut`；无 Cookie 时合法 204 no-body | `backend/app/routers/identity.py:139-149` `get_current_user` | `backend/tests/unit/test_contract.py:37-44`；`backend/tests/integration/test_identity_management.py:86-174` |
| GET `/api/v1/auth/csrf` | `getCsrfToken` | `200, 401, 403` | 否 | JSON `CsrfToken`；CSRF Cookie 无效为 403 | `backend/app/routers/identity.py:152-158` `get_csrf_token` | `backend/tests/unit/test_contract.py:37-54`；`backend/tests/integration/test_identity_management.py:86-174` |
| POST `/api/v1/auth/change-password` | `changePassword` | `204, 401, 403, 422` | 是 | 204 no-body | `backend/app/routers/identity.py:161-175` `change_password` | `backend/tests/unit/test_contract.py:73-78`；`backend/tests/integration/test_identity_management.py:376-447` |
| GET `/api/v1/users` | `listUsers` | `200, 401, 403, 422` | 是 | JSON `UserList` | `backend/app/routers/identity.py:178-197` `list_users` | `backend/tests/unit/test_contract.py:58-72`；`backend/tests/integration/test_identity_management.py:175-538` |
| POST `/api/v1/users` | `createUser` | `201, 401, 403, 409, 422` | 是 | JSON `UserOut` | `backend/app/routers/identity.py:200-213` `create_user` | `backend/tests/unit/test_contract.py:113-119`；`backend/tests/integration/test_identity_management.py:175-538` |
| POST `/api/v1/users/bulk-status` | `bulkUpdateUserStatus` | `200, 401, 403, 422` | 是 | JSON `UserBulkStatusResult`；业务失败项投影在 200 内，不新增状态 | `backend/app/routers/identity.py:216-239` `bulk_update_user_status` | `backend/tests/unit/test_contract.py:58-72`；`backend/tests/integration/test_identity_management.py:804-1162` |
| GET `/api/v1/users/export` | `exportUsers` | `200, 401, 403, 422` | 是 | **CSV 特殊项**：`text/csv` string + `Content-Disposition` | `backend/app/routers/identity.py:242-265` `export_users` | `backend/tests/unit/test_contract.py:58-72,1492-1524`；`backend/tests/integration/test_identity_management.py:175-538` |
| PATCH `/api/v1/users/{user_id}` | `updateUser` | `200, 401, 403, 404, 409, 422` | 是 | JSON `UserOut` | `backend/app/routers/identity.py:268-285` `update_user` | `backend/tests/unit/test_contract.py:120-143`；`backend/tests/integration/test_identity_management.py:804-1162` |
| DELETE `/api/v1/users/{user_id}` | `deleteUser` | `204, 401, 403, 404, 409, 422` | 是 | 204 no-body；需要 `expected_revision` | `backend/app/routers/identity.py:288-308` `delete_user` | `backend/tests/unit/test_contract.py:205-222`；`backend/tests/integration/test_identity_management.py:539-803` |
| POST `/api/v1/users/{user_id}/reset-password` | `resetUserPassword` | `200, 401, 403, 404, 409, 422` | 是 | JSON `UserOut` | `backend/app/routers/identity.py:311-331` `reset_user_password` | `backend/tests/unit/test_contract.py:120-143,313-347`；`backend/tests/integration/test_identity_management.py:539-803` |
| GET `/api/v1/audit-logs` | `listAuditLogs` | `200, 401, 403, 422` | 是 | JSON `AuditLogList` | `backend/app/routers/identity.py:334-366` `list_audit_logs` | `backend/tests/unit/test_contract.py:58-72`；`backend/tests/integration/test_identity_management.py:1165-1369` |
| GET `/api/v1/audit-logs/filter-options` | `getAuditLogFilterOptions` | `200, 401, 403` | 否 | JSON `AuditLogFilterOptions` | `backend/app/routers/identity.py:369-379` `get_audit_log_filter_options` | `backend/tests/unit/test_contract.py:45-54`；`backend/tests/integration/test_identity_management.py:1165-1369` |
| GET `/api/v1/audit-logs/{audit_log_id}` | `getAuditLog` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AuditLogDetail`; 409 `AUDIT_PROJECTION_FAILED` 是未捕获的明确业务路径 | `backend/app/routers/identity.py:382-394` `get_audit_log` | `backend/tests/unit/test_contract.py:120-143,295-310`；`backend/tests/integration/test_identity_management.py:1165-1369` |

### 逐操作清单：configuration（39）

| method/path | operationId | Phase B 最终 statuses | 422 显式 | 成功 media/header 特殊点 | 当前 route owner | 当前 test owner |
|---|---|---|---|---|---|---|
| GET `/api/v1/content-humanization-prompt` | `getContentHumanizationPrompt` | `200, 204, 401, 403` | 否 | 200 JSON `ContentHumanizationPromptOut`；未配置合法 204 no-body | `backend/app/routers/configuration.py:302-317` `get_content_humanization_prompt` | `backend/tests/unit/test_contract.py:45-56`；当前未发现独立 route sentinel |
| PUT `/api/v1/content-humanization-prompt` | `putContentHumanizationPrompt` | `200, 401, 403, 409, 422` | 是 | JSON `ContentHumanizationPromptOut` | `backend/app/routers/configuration.py:320-338` `put_content_humanization_prompt` | `backend/tests/unit/test_contract.py:105-112`；当前未发现独立 route sentinel |
| GET `/api/v1/platform-types` | `listPlatformTypes` | `200, 401, 403` | 否 | JSON `PlatformTypeList` | `backend/app/routers/configuration.py:341-346` `list_platform_types` | `backend/tests/unit/test_contract.py:45-54,714-753`；`backend/tests/integration/test_platform_types.py:47-221` |
| POST `/api/v1/platform-types` | `createPlatformType` | `201, 401, 403, 409, 422` | 是 | JSON `PlatformTypeOut` | `backend/app/routers/configuration.py:349-368` `create_platform_type` | `backend/tests/unit/test_contract.py:114-119,714-753`；`backend/tests/integration/test_platform_types.py:47-221` |
| PATCH `/api/v1/platform-types/{platform_type_id}` | `updatePlatformType` | `200, 401, 403, 404, 409, 422` | 是 | JSON `PlatformTypeOut` | `backend/app/routers/configuration.py:371-391` `update_platform_type` | `backend/tests/unit/test_contract.py:120-143,714-753`；`backend/tests/integration/test_platform_types.py:47-221` |
| DELETE `/api/v1/platform-types/{platform_type_id}` | `deletePlatformType` | `204, 401, 403, 404, 409, 422` | 是 | 204 no-body；需要 `expected_revision` | `backend/app/routers/configuration.py:394-413` `delete_platform_type` | `backend/tests/unit/test_contract.py:205-222,714-753`；`backend/tests/integration/test_platform_types.py:47-221` |
| GET `/api/v1/platform-profiles/export` | `exportPlatformProfiles` | `200, 401, 403, 422` | 是 | **CSV 特殊项**：`text/csv` string + `Content-Disposition` | `backend/app/routers/configuration.py:416-439` `export_platform_profiles` | `backend/tests/unit/test_contract.py:58-72,1492-1524`；`backend/tests/integration/test_platform_profile_list.py:51-191` |
| GET `/api/v1/platform-profiles/{platform_profile_id}` | `getPlatformProfile` | `200, 401, 403, 404, 422` | 是 | JSON `PlatformProfileDetail`；actor-aware read dependency | `backend/app/routers/configuration.py:443-458` `get_platform_profile` | `backend/tests/unit/test_contract.py:79-104,580-631`；`backend/tests/integration/test_platform_workspace.py:43-145` |
| GET `/api/v1/platform-prompts` | `listPlatformPrompts` | `200, 401, 403` | 否 | JSON `PlatformPromptList` | `backend/app/routers/configuration.py:461-467` `list_platform_prompts` | `backend/tests/unit/test_contract.py:45-54`；当前未发现独立 list route sentinel |
| POST `/api/v1/platform-prompts` | `createPlatformPrompt` | `201, 401, 403, 409, 422` | 是 | JSON `PlatformPromptDetail` | `backend/app/routers/configuration.py:470-489` `create_platform_prompt` | `backend/tests/unit/test_contract.py:114-119`；当前未发现独立 create route sentinel |
| GET `/api/v1/platform-prompts/{platform_prompt_id}` | `getPlatformPrompt` | `200, 401, 403, 404, 422` | 是 | JSON `PlatformPromptDetail` | `backend/app/routers/configuration.py:492-502` `get_platform_prompt` | `backend/tests/unit/test_contract.py:79-104`；当前未发现独立 get route sentinel |
| PUT `/api/v1/platform-prompts/{platform_prompt_id}` | `updatePlatformPrompt` | `200, 401, 403, 404, 409, 422` | 是 | JSON `PlatformPromptDetail` | `backend/app/routers/configuration.py:505-525` `update_platform_prompt` | `backend/tests/unit/test_contract.py:120-143`；当前未发现独立 update route sentinel |
| DELETE `/api/v1/platform-prompts/{platform_prompt_id}` | `deletePlatformPrompt` | `204, 401, 403, 404, 409, 422` | 是 | 204 no-body；需要 `expected_revision` | `backend/app/routers/configuration.py:528-548` `delete_platform_prompt` | `backend/tests/unit/test_contract.py:205-222`；当前未发现独立 delete route sentinel |
| POST `/api/v1/platform-logo-candidates` | `createPlatformLogoCandidate` | `201, 401, 403, 409, 422, 503` | 是 | JSON `PlatformLogoCandidate` | `backend/app/routers/configuration.py:551-570` `create_platform_logo_candidate` | `backend/tests/unit/test_contract.py:197-199`；`backend/tests/unit/test_platform_logo_import.py:33-219`; `backend/tests/unit/test_platform_branding.py:27-215` |
| PATCH `/api/v1/platform-profiles/{platform_profile_id}` | `updatePlatformProfile` | `200, 401, 403, 404, 409, 422` | 是 | JSON `PlatformProfileOut` | `backend/app/routers/configuration.py:573-594` `update_platform_profile` | `backend/tests/unit/test_contract.py:120-143,580-631`；`backend/tests/integration/test_platform_profile_list.py:192-233`；`backend/tests/unit/test_platform_branding.py:119-170` |
| POST `/api/v1/platform-profiles/{platform_profile_id}/enable` | `enablePlatformProfile` | `200, 401, 403, 404, 409, 422` | 是 | JSON `PlatformProfileOut` | `backend/app/routers/configuration.py:618-631` `enable_platform_profile` | `backend/tests/unit/test_contract.py:120-143`；`backend/tests/integration/test_platform_profile_list.py:192-233` |
| POST `/api/v1/platform-profiles/{platform_profile_id}/disable` | `disablePlatformProfile` | `200, 401, 403, 404, 409, 422` | 是 | JSON `PlatformProfileOut` | `backend/app/routers/configuration.py:634-647` `disable_platform_profile` | `backend/tests/unit/test_contract.py:120-143`；`backend/tests/integration/test_platform_profile_list.py:192-233` |
| DELETE `/api/v1/platform-profiles/{platform_profile_id}` | `deletePlatformProfile` | `204, 401, 403, 404, 409, 422` | 是 | 204 no-body；需要 `expected_revision` | `backend/app/routers/configuration.py:650-669` `delete_platform_profile` | `backend/tests/unit/test_contract.py:205-222,580-631`；`backend/tests/integration/test_platform_profile_list.py:192-233` |
| GET `/api/v1/ai-channels` | `listAIChannels` | `200, 401, 403, 422` | 是 | JSON `AIChannelList` | `backend/app/routers/configuration.py:672-691` `list_ai_channels` | `backend/tests/unit/test_contract.py:58-72,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| POST `/api/v1/ai-channels` | `createAIChannel` | `201, 401, 403, 422` | 是 | JSON `AIChannelOut` | `backend/app/routers/configuration.py:694-710` `create_ai_channel` | `backend/tests/unit/test_contract.py:73-77`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| GET `/api/v1/ai-channels/{channel_id}` | `getAIChannel` | `200, 401, 403, 404, 422` | 是 | JSON `AIChannelOut` | `backend/app/routers/configuration.py:713-718` `get_ai_channel` | `backend/tests/unit/test_contract.py:79-104`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| GET `/api/v1/ai-channels/{channel_id}/usage-summary` | `getAIChannelUsageSummary` | `200, 401, 403, 404, 422` | 是 | JSON `AIChannelUsageSummary` | `backend/app/routers/configuration.py:721-732` `get_ai_channel_usage_summary` | `backend/tests/unit/test_contract.py:79-104`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| GET `/api/v1/ai-channels/{channel_id}/audit-logs` | `listAIChannelAuditLogs` | `200, 401, 403, 404, 422` | 是 | JSON `AuditLogList` | `backend/app/routers/configuration.py:735-749` `list_ai_channel_audit_logs` | `backend/tests/unit/test_contract.py:79-104`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| PATCH `/api/v1/ai-channels/{channel_id}` | `updateAIChannel` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AIChannelOut` | `backend/app/routers/configuration.py:752-770` `update_ai_channel` | `backend/tests/unit/test_contract.py:120-143`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| PUT `/api/v1/ai-channels/{channel_id}/api-key` | `replaceAIChannelApiKey` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AIChannelOut`；secret value must remain redacted | `backend/app/routers/configuration.py:773-793` `replace_ai_channel_api_key` | `backend/tests/unit/test_contract.py:120-143,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| POST `/api/v1/ai-channels/{channel_id}/enable` | `enableAIChannel` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AIChannelSummary` | `backend/app/routers/configuration.py:815-828` `enable_ai_channel` | `backend/tests/unit/test_contract.py:120-143,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| POST `/api/v1/ai-channels/{channel_id}/disable` | `disableAIChannel` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AIChannelSummary` | `backend/app/routers/configuration.py:831-844` `disable_ai_channel` | `backend/tests/unit/test_contract.py:120-143,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| DELETE `/api/v1/ai-channels/{channel_id}` | `deleteAIChannel` | `204, 401, 403, 404, 409, 422` | 是 | 204 no-body；需要 `expected_revision` | `backend/app/routers/configuration.py:847-866` `delete_ai_channel` | `backend/tests/unit/test_contract.py:205-222,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| POST `/api/v1/ai-channels/{channel_id}/discover-models` | `discoverAIChannelModels` | `200, 401, 403, 404, 409, 422, 502, 504` | 是 | JSON `DiscoveredModelList`；provider 502/504 逃逸 | `backend/app/routers/configuration.py:869-906` `discover_ai_channel_models` | `backend/tests/unit/test_contract.py:223-228,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| POST `/api/v1/ai-channels/{channel_id}/headers` | `createAIChannelHeader` | `201, 401, 403, 404, 409, 422` | 是 | JSON `AIChannelOut`；header secret redaction | `backend/app/routers/configuration.py:909-930` `create_ai_channel_header` | `backend/tests/unit/test_contract.py:183-196,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| PATCH `/api/v1/ai-channel-headers/{header_id}` | `updateAIChannelHeader` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AIChannelOut`；header secret redaction | `backend/app/routers/configuration.py:933-953` `update_ai_channel_header` | `backend/tests/unit/test_contract.py:120-143,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| DELETE `/api/v1/ai-channel-headers/{header_id}` | `deleteAIChannelHeader` | `204, 401, 403, 404, 409, 422` | 是 | 204 no-body；需要 `expected_channel_revision` | `backend/app/routers/configuration.py:956-975` `delete_ai_channel_header` | `backend/tests/unit/test_contract.py:205-222,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| GET `/api/v1/ai-channels/{channel_id}/models` | `listAIModels` | `200, 401, 403, 404, 422` | 是 | JSON `AIModelList` | `backend/app/routers/configuration.py:978-992` `list_ai_models` | `backend/tests/unit/test_contract.py:79-104`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| POST `/api/v1/ai-channels/{channel_id}/models` | `createAIModel` | `201, 401, 403, 404, 422` | 是 | JSON `AIModelOut` | `backend/app/routers/configuration.py:995-1017` `create_ai_model` | `backend/tests/unit/test_contract.py:113-119`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| PATCH `/api/v1/ai-models/{model_id}` | `updateAIModel` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AIModelOut` | `backend/app/routers/configuration.py:1020-1037` `update_ai_model` | `backend/tests/unit/test_contract.py:120-143`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| POST `/api/v1/ai-models/{model_id}/test` | `testAIModel` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AIModelOut`；provider 502/504 在 service 捕获后投影为 200 `FAILED`，不声明 502/504 | `backend/app/routers/configuration.py:1040-1057` `test_ai_model` | `backend/tests/unit/test_contract.py:120-143,273-283,1356-1454`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| POST `/api/v1/ai-models/{model_id}/enable` | `enableAIModel` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AIModelOut` | `backend/app/routers/configuration.py:1080-1091` `enable_ai_model` | `backend/tests/unit/test_contract.py:120-143`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| POST `/api/v1/ai-models/{model_id}/disable` | `disableAIModel` | `200, 401, 403, 404, 409, 422` | 是 | JSON `AIModelOut` | `backend/app/routers/configuration.py:1094-1105` `disable_ai_model` | `backend/tests/unit/test_contract.py:120-143`；`backend/tests/integration/test_ai_channel_management.py:108-595` |
| DELETE `/api/v1/ai-models/{model_id}` | `deleteAIModel` | `204, 401, 403, 404, 409, 422` | 是 | 204 no-body；需要 `expected_revision` | `backend/app/routers/configuration.py:1108-1127` `delete_ai_model` | `backend/tests/unit/test_contract.py:205-222,643-711`；`backend/tests/integration/test_ai_channel_management.py:108-595` |

### 逐操作清单：files（5）

| method/path | operationId | Phase B 最终 statuses | 422 显式 | 成功 media/header 特殊点 | 当前 route owner | 当前 test owner |
|---|---|---|---|---|---|---|
| POST `/api/v1/files/upload-intents` | `createFileUploadIntent` | `201, 401, 403, 422` | 是 | JSON `UploadIntent` | `backend/app/routers/files.py:35-50` `create_upload_intent` | `backend/tests/unit/test_contract.py:73-77`；当前未发现独立 route sentinel |
| POST `/api/v1/files/{file_id}/complete` | `completeFileUpload` | `200, 401, 403, 404, 409, 422, 503` | 是 | JSON `FileRecordOut`；storage unavailable 明确 503 且状态不前进 | `backend/app/routers/files.py:53-66` `complete_file_upload` | `backend/tests/unit/test_contract.py:223-225,1456-1490` |
| GET `/api/v1/files/{file_id}` | `getFileRecord` | `200, 401, 403, 404, 422` | 是 | JSON `FileRecordOut` | `backend/app/routers/files.py:69-74` `get_file_record` | `backend/tests/unit/test_contract.py:79-104`；当前未发现独立 route sentinel |
| POST `/api/v1/files/{file_id}/abort` | `abortFileUpload` | `200, 401, 403, 404, 409, 422` | 是 | JSON `FileRecordOut` | `backend/app/routers/files.py:77-88` `abort_file_upload` | `backend/tests/unit/test_contract.py:120-143,178-182`；当前未发现独立 route sentinel |
| GET `/api/v1/files/{file_id}/download-url` | `getFileDownloadUrl` | `200, 401, 403, 404, 409, 422` | 是 | JSON `SignedUrl`；非 VERIFIED 文件明确 409 | `backend/app/routers/files.py:91-104` `get_file_download_url` | `backend/tests/unit/test_contract.py:120-143,178-182`；当前未发现独立 route sentinel |

### 错误/metadata owner 约束

- 唯一 wire schema owner 是 `backend/app/errors.py:14-43` 的 `AppError`/`error_response` 输出和 `backend/app/schemas/common.py` 的公共模型区（当前文件中可见 `common.py:63-220` 为 identity/shared schemas；`ErrorEnvelope` 的静态合同见 `contracts/openapi.yaml` components）。Wave 1 不应引入第二套错误层级、错误映射或 `HTTPValidationError`；显式 422 必须引用项目 `ErrorEnvelope`，实际 `RequestValidationError` 仍由 `backend/app/errors.py:51-62` 处理。
- request context 的真实跨切面 owner 是 `backend/app/main.py:53-85`：所有已处理响应写 `X-Request-ID`，非法 request ID 短路 400。它属于 Phase X 的独立同步边界；Wave 1 只复用/不改其 HTTP 行为，也不在本 Wave 扩展全局 400/Header contract。
- runtime response metadata helper 如放在 `backend/app/errors.py`，只能复用 ErrorEnvelope schema/description 等声明结构；上表每个 operation 的 status 必须按 final matrix 单独提供，不能把统一的 401/403/404/409 集合作为路由模板。

### 测试 ownership 与实施验收映射

- Contract signature owner：`backend/tests/unit/test_contract.py:37-292` 已逐 operation 收集 162 个 operation 的精确 status 集合；Wave 1 实施测试必须筛选上表全部 61 个 operation 并比较 runtime metadata 与冻结合同，不能从中抽几个代表。
- Shared wire owner：`backend/tests/unit/test_contract.py:1266-1276` 已锁定 `code/message/details/request_id` 四字段与空 `details`；`backend/tests/unit/test_contract.py:1279-1354` 已锁定 health nullable 与 CSV static media/header；这些是 Phase B 静态/HTTP 事实，不能通过 runtime helper 另造 schema。
- Identity behavior owner：`backend/tests/integration/test_identity_management.py:86-174`（session/login/me）、`:175-538`（list/create/export）、`:539-803`（delete/reset）、`:804-1162`（bulk status）、`:1165-1369`（audit）。登录/登出多 Cookie 的最终逐实例 sentinel 仍由 Phase X 任务承接。
- Configuration behavior owner：`backend/tests/integration/test_ai_channel_management.py:108-595` 覆盖 AI channel/model/header/discovery/test 操作；`test_platform_types.py:47-221` 覆盖 platform type；`test_platform_profile_list.py:51-` 与 `test_platform_workspace.py:43-145` 覆盖 profile；`test_prompt_preview_options.py:89-` 覆盖 prompt preview；logo 相关 owner 是 `backend/tests/unit/test_platform_logo_import.py:33-219`、`test_platform_branding.py:27-215`、`test_platform_logo_cleanup.py:45-147`。Humanization/prompt CRUD 的现有独立 route sentinel 未在本轮搜索中找到。
- Files behavior owner：当前只找到 `backend/tests/unit/test_contract.py:1456-1490` 的 complete storage 503 sentinel，以及 `:1492-1524` 的 CSV sentinel（CSV 属 identity/configuration）；create intent、record get、abort、download-url 当前没有同等粒度的独立 route test owner。

### 计数复核

从矩阵执行的筛选为：

```text
route evidence matches backend/app/main.py or
backend/app/routers/{configuration,identity,files}.py
foundation     2
identity      15
configuration 39
files          5
total         61
```

Wave 1 status 计数（按 operation 是否含 status，不按 response occurrence）：**53 个含 422、8 个不含 422**；所有 61 个至少有一个成功 status。

## Code patterns

- Route decorators currently mostly expose only success metadata, with explicit alternate success 204 on `getCurrentUser` and `getContentHumanizationPrompt` (`identity.py:139-144`, `configuration.py:302-308`) and explicit status codes 201/204 on create/delete routes. This explains why runtime response metadata needs operation-specific additions rather than a wholesale business change.
- Validation-capable routes receive typed path/query/header/cookie/body inputs, e.g. `identity.py:178-187`, `configuration.py:376-383`, `files.py:56-62`; actual validation wire is transformed by `validation_error_handler` (`errors.py:51-62`) to the same four-field ErrorEnvelope.
- Authentication/permission ownership is visible through typed dependencies (`CurrentSession`, `OptionalCurrentSession`, `CurrentUser`, `AdminUser`, `CsrfProtected`, `EngineerUser`) in `identity.py:14-22`, `configuration.py` imports/route signatures, and `files.py:10-12`; status metadata must follow matrix row evidence, not dependency-name templates.
- CSV routes directly construct `Response(media_type="text/csv", headers={"Content-Disposition": ...})` at `identity.py:260-265` and `configuration.py:433-439`; runtime metadata must describe this output without changing the HTTP response path.
- `complete_file_upload` delegates to the service and returns projected model (`files.py:53-66`); Phase B separately freezes the service's storage-unavailable 503, so Wave 1 metadata must declare it but must not alter service/transaction/state behavior.
- AI discovery and model test intentionally differ: discovery returns provider 502/504 through the route (`configuration.py:869-906`), while model test delegates to a command whose provider failure is projected to 200 (`configuration.py:1040-1057`; `test_contract.py:1356-1454`). They must not share an indiscriminate 5xx template.

## Related specs

- `.trellis/spec/backend/error-handling.md:1-58`：AppError + ErrorEnvelope 是唯一 API wire error；显式约束冲突保留具体 code/details，不把所有 IntegrityError 或业务错误映射为一个状态。
- `.trellis/spec/backend/quality-guidelines.md:20-62`：TestClient 依赖和轻量请求测试要求；metadata 变更需要实际请求测试且不以 warning filter 隐藏问题。
- `.trellis/spec/frontend/quality-guidelines.md`：`api:check`/generated contract 是前端门禁，但本 Wave 明确不修改 `contracts/openapi.yaml` 或 generated client。
- 父任务 Phase C design/implement：Wave 只同步 `backend/app/schemas/common.py`、`errors.py`、`main.py`、目标 routers 与定向测试；不改 service、permission、transaction、状态转换、实际 error-domain mapping。

## Caveats / Not Found

- 本轮只读调查，没有运行 `task.py start`、没有 Git 操作，也没有修改产品代码、OpenAPI、generated client、父任务材料或其他 task artifacts；唯一写入是本 research 文件。
- 当前 route/test owner 不是“每个 operation 已有独立 metadata 回归”的证明。`test_contract.py:37-292` 的 status signature 是全量静态 owner；多个 humanization、prompt CRUD、部分 files operation 只有该静态 owner，没有找到独立 route HTTP sentinel，需要规划阶段明确新增的逐操作测试覆盖。
- 计数必须以表格和矩阵筛选命令复核，不要复用本文件早期草稿中的错误数字：正确总数为 foundation 2 + identity 15 + configuration 39 + files 5 = **61**；不含 422 的 operation 是 **8**（`getLiveHealth`、`getReadyHealth`、`getAuditLogFilterOptions`、`getCsrfToken`、`getCurrentUser`、`getContentHumanizationPrompt`、`listPlatformPrompts`、`listPlatformTypes`），含 422 的 operation 是 **53**。
- `getCurrentUser` 的 204 response 与成功 200 使用不同 body 语义；`getContentHumanizationPrompt` 同样如此。metadata helper 不能把所有 204 当成一个统一 response shape，也不能给 204 添加 body。
- `login`/`logout` 的多实例 `Set-Cookie` 不应被压缩为一个文档 header；本 Wave 只保留现有 cookie 代码路径，Phase X 的 HTTP sentinel 承担数量/属性验证。
- `X-Request-ID` request/response header 与非法值 400 的全局 metadata 属 Phase X；本 Wave 的 operation-specific response metadata 测试不能因此扩大为全量 request-context contract。
- `contracts/openapi.yaml`、runtime OpenAPI 和 authority matrix 都不是无需核验的行为权威；status 是 Phase B 已按调用链冻结的目标，实际 HTTP 行为仍由 route/dependency/service/handler sentinel 保护。
