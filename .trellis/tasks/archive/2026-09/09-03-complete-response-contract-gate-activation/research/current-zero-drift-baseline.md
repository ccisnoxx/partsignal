# Research: 当前静态/运行时 Response Contract 零漂移基线

- Query: 对 `contracts/openapi.yaml` 与生产 `app.openapi()` 做完整结构化审计；确认全部 operation、operationId 与 response status/media/schema/Header 的现状，统计 response occurrence、`X-Request-ID` 覆盖及 Response Object `links`。
- Scope: mixed（内部合同、运行时 OpenAPI、生产 comparator 与定向测试；未访问外部服务）
- Date: 2026-09-03

## Findings

### 执行命令与退出码

以下命令均为只读。第二条直接导入生产实现 `compare_response_contracts()`，未使用 baseline、filter 或 allowlist。

```text
uv run --project backend python - <<'PY' ... yaml.safe_load(Path('contracts/openapi.yaml')); app.openapi(); operation_map(); compare_response_contracts() ... PY
EXIT_CODE=0

uv run --project backend python -m app.tools.contract_check contracts/openapi.yaml --response-report
RESPONSE_REPORT_EXIT_CODE=0

uv run --project backend python -m app.tools.contract_check contracts/openapi.yaml
DEFAULT_CHECK_EXIT_CODE=0

uv run --project backend pytest -q \
  backend/tests/unit/test_contract.py::test_runtime_openapi_matches_frozen_operations \
  backend/tests/unit/test_contract.py::test_static_request_context_metadata_covers_all_operations_and_responses \
  backend/tests/unit/test_runtime_response_metadata.py::test_runtime_request_context_covers_all_operations_and_responses \
  backend/tests/unit/test_runtime_response_metadata.py::test_wave_response_comparator_has_no_differences \
  backend/tests/unit/test_runtime_response_metadata.py::test_wave_2_response_comparator_has_no_differences \
  backend/tests/unit/test_runtime_response_metadata.py::test_wave_3_response_comparator_has_no_differences
......                                                                   [100%]
TARGETED_TEST_EXIT_CODE=0
```

### 全文档结构化计数

| 项目 | 静态合同 | 运行时 `app.openapi()` |
|---|---:|---:|
| OpenAPI version | `3.1.0` | `3.1.0` |
| path 数量 | 128 | 128 |
| operation 数量 | 162 | 162 |
| operationId 数量 | 162 | 162 |
| operationId 唯一 | 是 | 是 |
| response occurrence | 1023 | 1023 |
| `X-Request-ID` response Header 覆盖 | 1023/1023 | 1023/1023 |
| 缺少 `X-Request-ID` response Header | 0 | 0 |
| Response Object `links` occurrence | 0 | 0 |
| 非 1xx/204/205/304 的 no-body 异常 | 0 | 0 |
| 文档内 `$ref` 总数 | 2525 | 2525 |
| 外部 `$ref` | 0 | 0 |
| 未解析的本地 `$ref` | 0 | 0 |

静态和运行时的 operation key 集（path + method）相等，缺失/额外均为 `[]`；operationId 集也相等，缺失/额外均为 `[]`。两侧按排序后的 operationId 序列 SHA-256 均为：

```text
98e6c8a9938e160620bf842c92015919ff64fa5d2061f4675ba119e04c4d1ae9
```

为保留完整集合证据，排序后的 162 个 operationId 如下；探针输出的 static/runtime 两行完全相同：

```text
abandonContentVersion|abortFileUpload|approveContentVersion|approveFactVersion|archiveContentTask|bulkUpdateUserStatus|cancelContentTask|changePassword|closePublicationWork|compareContentVersions|completeFileUpload|createAIChannel|createAIChannelHeader|createAIModel|createContentRevision|createContentTask|createFileUploadIntent|createGenerationJob|createGeoObservation|createGeoOptimizationContentTask|createHumanizationJob|createManualContentVersion|createPlatformAccount|createPlatformLogoCandidate|createPlatformProfile|createPlatformPrompt|createPlatformType|createProduct|createPublicationWork|createPublishedContentRepairTask|createQueryTopic|createUser|deleteAIChannel|deleteAIChannelHeader|deleteAIModel|deleteContentDraft|deleteContentTask|deleteFactVersion|deleteGeoObservation|deletePlatformAccount|deletePlatformProfile|deletePlatformPrompt|deletePlatformType|deleteProduct|deleteQueryTopic|deleteUser|disableAIChannel|disableAIModel|disablePlatformAccount|disablePlatformProfile|discoverAIChannelModels|enableAIChannel|enableAIModel|enablePlatformAccount|enablePlatformProfile|exportPlatformProfiles|exportUsers|getAIChannel|getAIChannelUsageSummary|getAuditLog|getAuditLogFilterOptions|getContentEditorContext|getContentHumanizationPrompt|getContentReviewContext|getContentTask|getContentTaskCreationOptions|getContentTaskDetail|getContentTaskGenerationOptions|getContentTaskPermanentDeletionPreview|getContentTaskReviewContext|getContentVersion|getContentVersionDetail|getCsrfToken|getCurrentUser|getDashboardSummary|getFactReviewContext|getFactVersion|getFileDownloadUrl|getFileRecord|getGenerationJob|getGeoInsights|getGeoMetrics|getGeoObservation|getGeoObservationCorrectionContext|getGeoObservationDetail|getLiveHealth|getPlatformProfile|getPlatformPrompt|getPlatformPromptPreviewOptions|getProduct|getProductDetail|getProductFactReviewContext|getProductFactsDraft|getPublicationPackage|getPublicationWork|getPublicationWorkbenchSummary|getPublicationWorkspaceContext|getPublishedArticle|getPublishedContentIssue|getPublishedContentIssueWorkspaceContext|getPublishedContentRepairContext|getReadyHealth|getWorkbench|listAIChannelAuditLogs|listAIChannels|listAIModels|listAuditLogs|listContentTaskVersions|listContentTasks|listFactVersions|listGenerationJobs|listGeoObservationItems|listGeoObservationPublications|listGeoObservations|listPlatformAccounts|listPlatformProfiles|listPlatformPrompts|listPlatformTypes|listProductFactHistory|listProducts|listPublicationReadyItems|listPublicationWorks|listPublishedArticles|listPublishedContentIssues|listQueryTopicItems|listQueryTopics|listUsers|login|logout|markPublicationPlatformReview|openPublishedContentIssue|permanentlyDeleteContentTask|permanentlyDeletePublishedArticle|previewPublishedArticlePermanentDeletion|putContentHumanizationPrompt|registerPublicationResult|replaceAIChannelApiKey|replaceProductFactsDraft|requestContentVersionChanges|requestFactVersionChanges|resetUserPassword|resolvePublishedContentIssue|restoreContentTask|retireFactVersion|retryGenerationJob|submitContentVersion|submitProductFactReview|switchPublicationContentVersion|testAIModel|updateAIChannel|updateAIChannelHeader|updateAIModel|updateContentDraft|updatePlatformAccount|updatePlatformProfile|updatePlatformPrompt|updatePlatformType|updateProduct|updatePublicationPreparation|updateQueryTopic|updateUser|verifyPublicationWork
```

### Response status/media/header 全量签名

生产 comparator 的完整调用结果：

```json
{
  "compare_response_contracts_failure_count": 0,
  "compare_response_contracts_failures": []
}
```

两侧 status occurrence 计数完全一致：

```json
{"200":120,"201":21,"202":3,"204":20,"400":162,"401":160,"403":158,"404":119,"409":106,"422":149,"502":1,"503":3,"504":1}
```

两侧 media occurrence 计数完全一致：

```json
{"application/json":1001,"text/csv":2}
```

两侧 response Header occurrence 计数完全一致：

```json
{"content-disposition":2,"x-request-id":1023}
```

因此 comparator 已对 162 个 operation 的全部 1023 个 response occurrence 执行 status 集、Response Object、media key/schema/encoding、Header key/machine shape 及递归 schema machine shape 比较，结果零差异；并且没有触发 invalid/unsupported、missing/extra status、schema drift、media drift、header drift 或 links failure。

### 关键 JSON Pointer 与源代码证据

- 静态文档从 [`contracts/openapi.yaml:22`](../../../../contracts/openapi.yaml:22) 开始 `paths`；健康检查和登录的代表 response 分别位于 [`contracts/openapi.yaml:23`](../../../../contracts/openapi.yaml:23)、[`contracts/openapi.yaml:38`](../../../../contracts/openapi.yaml:38)、[`contracts/openapi.yaml:54`](../../../../contracts/openapi.yaml:54)。结构化探针覆盖全部 128 个 path，而非只抽样这些路径。
- 静态 request-context component 位于 [`contracts/openapi.yaml:4092`](../../../../contracts/openapi.yaml:4092)：`#/components/parameters/RequestIdHeader`（字段 [`/components/parameters/RequestIdHeader`](../../../../contracts/openapi.yaml:4099)）、`#/components/headers/RequestIdResponseHeader`（[`/components/headers/RequestIdResponseHeader`](../../../../contracts/openapi.yaml:4138)）和 `#/components/responses/ErrorResponse`（[`/components/responses/ErrorResponse`](../../../../contracts/openapi.yaml:4162)）。
- 静态完整 CSV 证据在 [`/paths/~1api~1users~1export/get/responses/200`](../../../../contracts/openapi.yaml:221)，保留 `Content-Disposition` 与 `text/csv`；探针计数为两个 CSV response、两个 `content-disposition` occurrence。
- 代表性的 response pointer `/paths/~1api~1health~1live/get/responses/200` 同时含 `application/json` schema `#/components/schemas/HealthResponse` 与 `X-Request-ID` ref；其 400 pointer `/paths/~1api~1health~1live/get/responses/400` 解析到 `#/components/responses/ErrorResponse`。所有其余 response pointer 均以相同结构化规则遍历。
- `X-Request-ID` component 的 static schema 是 `type: string`、`minLength: 1`、`maxLength: 100`、`pattern: '^[\x20-\x7E]+$'`，见 [`contracts/openapi.yaml:4099-4107`](../../../../contracts/openapi.yaml:4099) 与 [`contracts/openapi.yaml:4138-4144`](../../../../contracts/openapi.yaml:4138)。探针逐 response 解引用并校验 required/machine schema，static/runtime 坏 Header pointer 均为 `[]`。
- 生产 operation map 位于 [`backend/app/tools/contract_check.py:216`](../../../../backend/app/tools/contract_check.py:216)；完整 comparator 入口位于 [`backend/app/tools/contract_check.py:1363`](../../../../backend/app/tools/contract_check.py:1363)，response 比较 owner 位于 [`backend/app/tools/contract_check.py:1139`](../../../../backend/app/tools/contract_check.py:1139)。
- runtime request-context owner 位于 [`backend/app/main.py:42`](../../../../backend/app/main.py:42)（常量）、[`backend/app/main.py:53`](../../../../backend/app/main.py:53)（schema）、[`backend/app/main.py:155`](../../../../backend/app/main.py:155)（merge）和 [`backend/app/main.py:344`](../../../../backend/app/main.py:344)（custom OpenAPI cache builder）。
- 现有测试同样冻结 162 operation 与 1023 response occurrence，见 [`backend/tests/unit/test_contract.py:42-49`](../../../../backend/tests/unit/test_contract.py:42)；逐 operation request Header、400 与 response Header 断言见 [`backend/tests/unit/test_contract.py:71-97`](../../../../backend/tests/unit/test_contract.py:71)。

### Components 结构审计

静态完整 components 计数为：`securitySchemes=1`、`parameters=16`、`headers=1`、`requestBodies=3`、`responses=3`、`schemas=355`。运行时完整 components 计数为：`securitySchemes=1`、`parameters=1`、`headers=1`、`responses=1`、`schemas=336`。

这不是 response drift：runtime FastAPI document 只发布运行时 route 实际生成/引用的组件，静态合同还保留路径参数、CSRF/分页/幂等参数、请求体及两个命名 response component；静态合同的这些 component 仍可由所有内部 ref 解析。生产 response comparator 比较的是每个 response occurrence 解引用后的 response machine shape 与递归 schema shape，结果为 `[]`。

静态-only component 名称差异（未作为 response comparator failure）：

- parameters（15）：`AIChannelHeaderId`、`AIChannelId`、`AIModelId`、`ContentTaskId`、`ContentVersionId`、`CsrfHeader`、`FactVersionId`、`FileId`、`GenerationJobId`、`IdempotencyKey`、`Page`、`PageSize`、`PlatformProfileId`、`PlatformTypeId`、`ProductId`。
- requestBodies（3）：`CommandRequest`、`RequestChangesCommand`、`RevisionRequest`。
- responses（2）：`ContentVersionResponse`、`FactVersionResponse`。
- schemas（42）：`AIChannel`、`AIChannelHeader`、`AIModel`、`AccuracyStatus`、`AuditLog`、`CitationSourceType`、`ContentHumanizationPrompt`、`ContentReviewAction`、`ContentTask`、`ContentTaskStatus`、`ContentVersion`、`ContentVersionStatus`、`FactReviewAction`、`FactReviewDecision`、`FactVersion`、`FileCategory`、`FileRecord`、`GenerationInputSnapshot`、`GenerationJob`、`GenerationJobStatus`、`GenerationJobType`、`GeoArticleResult`、`GeoObservation`、`GeoObservationDetail`、`GeoObservationListSort`、`HumanizationInputSnapshot`、`PageInfo`、`PlatformAccount`、`PlatformLogo`、`PlatformProfile`、`PlatformType`、`Product`、`ProductDetailActivityKind`、`ProductDetailActivityTargetKind`、`PublicationVerification`、`PublicationWork`、`PublicationWorkEvent`、`PublishedArticle`、`PublishedContentIssue`、`QueryTopic`、`RecommendationStatus`、`User`。

runtime-only schema 名称（23）是 Pydantic/FastAPI 的输出模型命名（例如 `UserOut`、`ProductOut`、`ContentTaskOut`、`PublicationWorkOut` 等），并非 response occurrence 的机器语义差异。两侧 component section 的关键 request-context owner 均存在且值一致：runtime 仅有 `RequestIdHeader`、`RequestIdResponseHeader`、`ErrorResponse` 三个新增/合并组件。

### External references / versions

- 合同声明 OpenAPI `3.1.0`，见 [`contracts/openapi.yaml:1`](../../../../contracts/openapi.yaml:1)。
- backend 依赖范围见 [`backend/pyproject.toml:12`](../../../../backend/pyproject.toml:12) 与 [`backend/pyproject.toml:23`](../../../../backend/pyproject.toml:23)：`fastapi>=0.115,<1`、`pyyaml>=6.0,<7`。
- 本次使用环境实际版本：FastAPI `0.139.0`、Pydantic `2.13.4`、Starlette `1.3.1`、PyYAML `6.0.3`。
- 未使用外部网页或网络 API；本基线以仓库静态合同、生产 runtime builder、生产 comparator 和定向 pytest 为唯一证据。

## Caveats / Not Found

- 当前默认 CLI `check()` 仍是旧版 successful-response/legacy gate；[`backend/app/tools/contract_check.py:1376`](../../../../backend/app/tools/contract_check.py:1376) 的 docstring 明确写着 response comparator 尚未接入默认 gate。无过滤 `--response-report` 已独立退出 0；本研究不修改 gate、baseline、filter、allowlist 或任何产品代码。
- static/runtime components 的名称与数量不相等（尤其 runtime schema 使用 `*Out` 命名），但 operation key、operationId 集及完整 response status/media/schema/Header comparator 均零差异；不要把 component inventory 的生成命名差异误解释为 response contract drift。
- `links` 的零计数专指 OpenAPI Response Object 的 `links` machine field（comparator 在 [`backend/app/tools/contract_check.py:1164`](../../../../backend/app/tools/contract_check.py:1164) 检查的字段）。合同 schema 中存在业务属性 `WorkbenchMultiLinkCount.links`，见 [`contracts/openapi.yaml:8823`](../../../../contracts/openapi.yaml:8823)，它不是 Response Object `links`，不应计入该门禁。
- 未运行需要 PostgreSQL/Redis 或真实 HTTP 业务数据的集成测试；本支线目标是静态/runtime OpenAPI 结构与 response comparator 零漂移，相关定向测试已全部通过。
