# Research: OpenAPI `allOf` authority defect and impact

## Evidence Summary

- Date: 2026-09-02
- Authority inspected: `contracts/openapi.yaml`、Pydantic schema owners、generated TypeScript、Phase A comparator、已归档 Phase B 材料、暂停的 Phase C diff 与 critical review。
- Defect: 派生 schema 通过 `allOf` 引用 `additionalProperties: false` 的基础 object 后增加字段。JSON Schema 2020-12 对所有分支同时求交，基础分支会把派生字段判为额外字段；真实成功 payload 因而不可满足。
- Comparator limitation by design: comparator 比较两份 schema 的机器形状；两边具有同一个不可满足结构时仍会返回 `[]`。这不是 comparator filter bug，必须增加 instance validation 作为独立证据。

## Full Component Inventory

冻结合同共有 15 个 `allOf` component，完整扫描确认其基础引用最终均为 closed object：

1. `AuditLogDetail` → `AuditLog`
2. `QueryTopic` → `QueryTopicCreate`
3. `QueryTopicListItem` → `QueryTopic`
4. `PlatformLogoUpload` → `PlatformLogoUploadInput`
5. `PlatformPromptUpdate` → `PlatformPromptCreate`
6. `PlatformPromptListItem` → `PlatformPromptReference`
7. `PlatformPromptDetail` → `PlatformPromptListItem`
8. `ContentTask` → `ContentTaskCreate`
9. `ContentTaskListItem` → `ContentTask`
10. `GenerationJobDetail` → `GenerationJob`
11. `PlatformAccount` → `PlatformAccountCreate`
12. `GeoInsightPublicationOption` → `GeoInsightOption`
13. `GeoInsightRatePoint` → `GeoInsightRateValue`
14. `GeoInsightDecliningContent` → `GeoInsightContentPerformance`
15. `GeoInsightLongUnmentionedContent` → `GeoInsightContentPerformance`

`AuditLogDetail` 的两个分支还分别声明 `additionalProperties: false`，因此基础字段与详情字段会互相拒绝；其余 component 即使派生分支省略 closure，closed 基础分支仍会拒绝新增字段。

## Affected Success Operations

引用闭包扫描得到 37 个唯一 operation：

| operationId | success root / affected component |
|---|---|
| `getAuditLog` | `AuditLogDetail` |
| `listQueryTopics` | `QueryTopic` |
| `createQueryTopic` | `QueryTopic` |
| `listQueryTopicItems` | `QueryTopic`, `QueryTopicListItem` |
| `updateQueryTopic` | `QueryTopic` |
| `listPlatformProfiles` | `PlatformLogoUpload` via `PlatformProfileList` |
| `createPlatformProfile` | `PlatformLogoUpload` via `PlatformProfile` |
| `getPlatformProfile` | `PlatformLogoUpload` via `PlatformProfileDetail` |
| `updatePlatformProfile` | `PlatformLogoUpload` via `PlatformProfile` |
| `enablePlatformProfile` | `PlatformLogoUpload` via `PlatformProfile` |
| `disablePlatformProfile` | `PlatformLogoUpload` via `PlatformProfile` |
| `listPlatformPrompts` | `PlatformPromptListItem` |
| `createPlatformPrompt` | `PlatformPromptDetail`, `PlatformPromptListItem` |
| `getPlatformPrompt` | `PlatformPromptDetail`, `PlatformPromptListItem` |
| `updatePlatformPrompt` | `PlatformPromptDetail`, `PlatformPromptListItem` |
| `listContentTasks` | `ContentTask`, `ContentTaskListItem`, `PlatformLogoUpload` |
| `createContentTask` | `ContentTask` |
| `getContentTask` | `ContentTask` |
| `getContentTaskDetail` | `PlatformLogoUpload` |
| `getContentEditorContext` | `PlatformLogoUpload` |
| `getContentTaskReviewContext` | `ContentTask` |
| `cancelContentTask` | `ContentTask` |
| `archiveContentTask` | `ContentTask` |
| `restoreContentTask` | `ContentTask` |
| `getGenerationJob` | `GenerationJobDetail` |
| `getContentReviewContext` | `ContentTask` |
| `listPublicationReadyItems` | `PlatformAccount` |
| `listPlatformAccounts` | `PlatformAccount` |
| `createPlatformAccount` | `PlatformAccount` |
| `updatePlatformAccount` | `PlatformAccount` |
| `enablePlatformAccount` | `PlatformAccount` |
| `disablePlatformAccount` | `PlatformAccount` |
| `getPublishedContentIssueWorkspaceContext` | `ContentTask` |
| `getPublishedContentRepairContext` | `ContentTask`, `QueryTopic` |
| `createPublishedContentRepairTask` | `ContentTask` |
| `getGeoInsights` | four `GeoInsight*` derived components |
| `createGeoOptimizationContentTask` | `ContentTask` |

## Design Options

### Recommended: flatten each public derived component

- 合并基础与派生 properties/required，在最终完整 object 上声明 `additionalProperties: false`。
- 与 `ContractModel(extra="forbid")` 的 Pydantic 默认 JSON Schema 和真实 validation/serialization 一致。
- 删除自定义 schema hooks 与 private handler dependency。
- generated TypeScript 从 intersections 变为与 runtime wire owner 一致的完整 object；13 个类型严格双向等价。`ContentTask` / `ContentTaskListItem` 的旧 intersection 曾把派生层 nullable `platform_profile_id` 与基础层 non-null 定义求交而错误收窄，展平后恢复 runtime 一直允许的 nullable response；实际 payload 不变。

### Rejected default: open base + `unevaluatedProperties: false`

- 理论上可保留 composition，但需要为独立基础 wire type 增加 closed wrapper，并让 runtime generator 精确表达外层 closure。
- 会继续需要自定义 Pydantic schema owner，扩大 comparator/generator/client 的 composition 复杂度。
- 当前问题不需要多态继承语义；展平是更小、更直接的公共机器合同。

## Validation Mechanism

- 建议在 backend dev extra 增加 `jsonschema>=4.23,<5` 并更新 `backend/uv.lock`。
- 使用 `Draft202012Validator`、`referencing.Registry/Resource` 和 format checker，把完整 OpenAPI document 注册为 resource。
- 以真实 Pydantic `model_dump(mode="json")` 验证静态与 runtime component；额外字段作为负例。
- 对 37 个 operation 仅投影双方相关成功 response，再调用生产 `compare_response_contracts()` 并直接断言完整 failure list 为空。

## Dirty-Tree and Ownership Boundary

- 当前工作区存在 556 项未提交变化。
- `09-01-runtime-response-metadata-wave-1` 的 route/ErrorEnvelope metadata 与测试仍未提交并已暂停；本 Task 只接管 schema authority 修复所必需的 contract/generated/runtime schema/test hunks。
- 不回退、覆盖或提交其他 dirty artifacts；后续 commit 必须按 hunk/文件 owner 明确拆分，并在执行前单独获得用户批准。
