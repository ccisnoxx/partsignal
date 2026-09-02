# Research：Runtime Response Metadata Wave 2 operation ownership

- 日期：2026-09-02（Asia/Shanghai）
- 范围：`backend/app/routers/product_facts.py`、`planning.py`、`production.py` 的真实注册 operation，Phase B final matrix，冻结/runtime OpenAPI，既有聚焦与行为测试。
- 目标：为 Phase D 提供完整、不抽样的 operation ownership/验收矩阵；本文件不是 production input、baseline、allowlist 或 filter。

## 1. 结论

- 真实注册 inventory 共 **58** 个 operation：`product_facts=18`、`planning=19`、`production=21`。
- Phase B status occurrence：`200=42`、`201=7`、`202=3`、`204=6`、`401=58`、`403=58`、`404=50`、`409=35`、`422=57`。
- 57 个 operation 包含显式 422；唯一不含 422 的 operation 是 `listQueryTopics`。
- 当前 Wave 2 runtime 投影产生 **258** 条 comparator failure：`missing_status=201`（401×58、403×58、404×50、409×35）与 `schema_drift=57`。57 个 runtime 422 均自动指向 `HTTPValidationError`；目标均为项目 `ErrorEnvelope`。
- 成功 response 当前已经与冻结合同一致：42 个 200、7 个 201、3 个 202 均为 `application/json` + 表中 schema，6 个 204 均无 body；全部 operation-specific response Header 为 none。
- Wave 2 无 5xx、CSV 或其他特殊 media/Header。全局 `X-Request-ID` request/response Header 与非法值 400 属 Phase X，不进入本表目标 status/Header。

## 2. Owner 解释

每行的 `Phase B statuses` 是唯一 status authority。下列公共 owner 适用于表中相应状态，表的“特殊 owner”只列逐 operation 不同的 404/409：

- 401：`backend/app/deps.py::_resolve_current_session`，缺失/失效 Cookie 逃逸到 HTTP 401。
- 403：同一 `_resolve_current_session` 的临时密码 gate，以及写路径现有权限/CSRF dependency；Phase B matrix 已逐 operation 证明，不从 dependency 名称反推。
- 422：真实 path/query/header/cookie/body 解析产生 `RequestValidationError`，由 `backend/app/errors.py::validation_error_handler` 转换为项目 ErrorEnvelope。删除类 route 的典型输入 owner 是 `require_csrf`；其他 route 的输入 owner 是其 endpoint 参数/body。表中“是”表示必须显式覆盖自动 `HTTPValidationError`。
- 404/409：表中列出 Phase B matrix 的实际 route/service owner symbol；同名状态必须沿现有调用链逃逸，不允许 metadata 实施改写 owner。

## 3. product_facts（18）

| Method/path | operationId | Phase B statuses | 422 | Success schema/media/Header | 特殊 404/409 runtime owner |
|---|---|---|---|---|---|
| GET `/api/v1/products` | `listProducts` | `200,401,403,422` | 是 | 200 `application/json` → `ProductList`; Header none | — |
| POST `/api/v1/products` | `createProduct` | `201,401,403,409,422` | 是 | 201 JSON → `Product`; Header none | 409 `_product_identity_conflict` (`services/product_facts.py`) |
| GET `/api/v1/products/{product_id}` | `getProduct` | `200,401,403,404,422` | 是 | 200 JSON → `Product`; Header none | 404 `get_product` route |
| GET `/api/v1/products/{product_id}/detail` | `getProductDetail` | `200,401,403,404,422` | 是 | 200 JSON → `ProductDetail`; Header none | 404 `product_detail_out` |
| PATCH `/api/v1/products/{product_id}` | `updateProduct` | `200,401,403,404,409,422` | 是 | 200 JSON → `Product`; Header none | 404 `update_product`; 409 `_product_identity_conflict` |
| DELETE `/api/v1/products/{product_id}` | `deleteProduct` | `204,401,403,404,409,422` | 是 | 204 no-body; Header none | 404/409 `delete_product` service |
| GET `/api/v1/products/{product_id}/facts` | `getProductFactsDraft` | `200,401,403,404,422` | 是 | 200 JSON → `ProductFactsDraft`; Header none | 404 `get_product_facts` route |
| PUT `/api/v1/products/{product_id}/facts` | `replaceProductFactsDraft` | `200,401,403,404,409,422` | 是 | 200 JSON → `ProductFactsDraft`; Header none | 404/409 `replace_product_facts` |
| GET `/api/v1/products/{product_id}/fact-history` | `listProductFactHistory` | `200,401,403,404,422` | 是 | 200 JSON → `ProductFactHistoryList`; Header none | 404 `list_product_fact_history` |
| GET `/api/v1/products/{product_id}/fact-versions` | `listFactVersions` | `200,401,403,404,422` | 是 | 200 JSON → `FactVersionList`; Header none | 404 `list_fact_versions` route |
| POST `/api/v1/products/{product_id}/fact-review-submissions` | `submitProductFactReview` | `201,401,403,404,409,422` | 是 | 201 JSON → `FactVersion`; Header none | 404/409 `submit_fact_review` |
| GET `/api/v1/products/{product_id}/fact-review-context` | `getProductFactReviewContext` | `200,401,403,404,422` | 是 | 200 JSON → `ProductFactReviewWorkspace`; Header none | 404 `get_product_fact_review_context` |
| GET `/api/v1/fact-versions/{fact_version_id}` | `getFactVersion` | `200,401,403,404,422` | 是 | 200 JSON → `FactVersion`; Header none | 404 `get_fact_version` route |
| DELETE `/api/v1/fact-versions/{fact_version_id}` | `deleteFactVersion` | `204,401,403,404,409,422` | 是 | 204 no-body; Header none | 404/409 `delete_fact_version` |
| GET `/api/v1/fact-versions/{fact_version_id}/review-context` | `getFactReviewContext` | `200,401,403,404,422` | 是 | 200 JSON → `FactReviewContext`; Header none | 404 `get_fact_review_context` |
| POST `/api/v1/fact-versions/{fact_version_id}/approve` | `approveFactVersion` | `200,401,403,404,409,422` | 是 | 200 JSON → `FactVersion`; Header none | 404/409 `transition_fact_version` |
| POST `/api/v1/fact-versions/{fact_version_id}/request-changes` | `requestFactVersionChanges` | `200,401,403,404,409,422` | 是 | 200 JSON → `FactVersion`; Header none | 404/409 `transition_fact_version` |
| POST `/api/v1/fact-versions/{fact_version_id}/retire` | `retireFactVersion` | `200,401,403,404,409,422` | 是 | 200 JSON → `FactVersion`; Header none | 404/409 `transition_fact_version` |

## 4. planning（19）

| Method/path | operationId | Phase B statuses | 422 | Success schema/media/Header | 特殊 404/409 runtime owner |
|---|---|---|---|---|---|
| GET `/api/v1/query-topics` | `listQueryTopics` | `200,401,403` | **否** | 200 JSON → `QueryTopicList`; Header none | — |
| GET `/api/v1/query-topics/list-items` | `listQueryTopicItems` | `200,401,403,422` | 是 | 200 JSON → `QueryTopicListPage`; Header none | — |
| POST `/api/v1/query-topics` | `createQueryTopic` | `201,401,403,422` | 是 | 201 JSON → `QueryTopic`; Header none | — |
| PATCH `/api/v1/query-topics/{query_topic_id}` | `updateQueryTopic` | `200,401,403,404,409,422` | 是 | 200 JSON → `QueryTopic`; Header none | 404/409 `update_query_topic` |
| DELETE `/api/v1/query-topics/{query_topic_id}` | `deleteQueryTopic` | `204,401,403,404,409,422` | 是 | 204 no-body; Header none | 404/409 `delete_query_topic` |
| GET `/api/v1/platform-profiles` | `listPlatformProfiles` | `200,401,403,422` | 是 | 200 JSON → `PlatformProfileList`; Header none | — |
| POST `/api/v1/platform-profiles` | `createPlatformProfile` | `201,401,403,404,409,422` | 是 | 201 JSON → `PlatformProfile`; Header none | 404/409 `create_platform_profile` |
| GET `/api/v1/content-tasks` | `listContentTasks` | `200,401,403,422` | 是 | 200 JSON → `ContentTaskList`; Header none | — |
| POST `/api/v1/content-tasks` | `createContentTask` | `201,401,403,404,409,422` | 是 | 201 JSON → `ContentTask`; Header none | 404 `lock_active_platform`; 409 `create_content_task` |
| GET `/api/v1/content-tasks/creation-options` | `getContentTaskCreationOptions` | `200,401,403,422` | 是 | 200 JSON → `ContentTaskCreationOptions`; Header none | — |
| GET `/api/v1/content-tasks/{content_task_id}` | `getContentTask` | `200,401,403,404,422` | 是 | 200 JSON → `ContentTask`; Header none | 404 `get_content_task` route |
| GET `/api/v1/content-tasks/{content_task_id}/detail` | `getContentTaskDetail` | `200,401,403,404,422` | 是 | 200 JSON → `ContentTaskDetail`; Header none | 404 `content_task_detail_out` |
| GET `/api/v1/content-tasks/{content_task_id}/editor-context` | `getContentEditorContext` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentEditorContext`; Header none | 404 `content_editor_context_out`; 409 `_optional_text` |
| DELETE `/api/v1/content-tasks/{content_task_id}` | `deleteContentTask` | `204,401,403,404,409,422` | 是 | 204 no-body; Header none | 404/409 `_lock_manual_observation_chain` |
| POST `/api/v1/content-tasks/{content_task_id}/cancel` | `cancelContentTask` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentTask`; Header none | 404/409 `cancel_content_task` |
| POST `/api/v1/content-tasks/{content_task_id}/archive` | `archiveContentTask` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentTask`; Header none | 404/409 `archive_content_task` |
| POST `/api/v1/content-tasks/{content_task_id}/restore` | `restoreContentTask` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentTask`; Header none | 404/409 `restore_content_task` |
| GET `/api/v1/content-tasks/{content_task_id}/permanent-deletion-preview` | `getContentTaskPermanentDeletionPreview` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentTaskPermanentDeletionPreview`; Header none | 404/409 `_lock_manual_observation_chain` |
| POST `/api/v1/content-tasks/{content_task_id}/permanent-delete` | `permanentlyDeleteContentTask` | `204,401,403,404,409,422` | 是 | 204 no-body; Header none | 404/409 `_lock_manual_observation_chain` |

## 5. production（21）

| Method/path | operationId | Phase B statuses | 422 | Success schema/media/Header | 特殊 404/409 runtime owner |
|---|---|---|---|---|---|
| GET `/api/v1/content-tasks/{content_task_id}/generation-options` | `getContentTaskGenerationOptions` | `200,401,403,404,409,422` | 是 | 200 JSON → `GenerationOptions`; Header none | 404/409 `get_generation_options` route |
| GET `/api/v1/platform-prompts/{platform_prompt_id}/preview-options` | `getPlatformPromptPreviewOptions` | `200,401,403,404,422` | 是 | 200 JSON → `PlatformPromptPreviewOptions`; Header none | 404 `get_platform_prompt_preview_options` |
| POST `/api/v1/content-tasks/{content_task_id}/generation-jobs` | `createGenerationJob` | `202,401,403,404,409,422` | 是 | 202 JSON → `GenerationJob`; Header none | 404 `create_generation_job`; 409 `_create_job` |
| POST `/api/v1/content-versions/{content_version_id}/humanization-jobs` | `createHumanizationJob` | `202,401,403,404,409,422` | 是 | 202 JSON → `GenerationJob`; Header none | 404 `create_humanization_job`; 409 `_create_job` |
| GET `/api/v1/content-tasks/{content_task_id}/generation-jobs` | `listGenerationJobs` | `200,401,403,404,422` | 是 | 200 JSON → `GenerationJobList`; Header none | 404 `list_generation_jobs` route |
| GET `/api/v1/generation-jobs/{generation_job_id}` | `getGenerationJob` | `200,401,403,404,422` | 是 | 200 JSON → `GenerationJobDetail`; Header none | 404 `get_generation_job` route |
| POST `/api/v1/generation-jobs/{generation_job_id}/retry` | `retryGenerationJob` | `202,401,403,404,409,422` | 是 | 202 JSON → `GenerationJob`; Header none | 404 `retry_generation_job`; 409 `_create_job` |
| GET `/api/v1/content-tasks/{content_task_id}/content-versions` | `listContentTaskVersions` | `200,401,403,404,422` | 是 | 200 JSON → `ContentVersionList`; Header none | 404 `list_content_task_versions` route |
| POST `/api/v1/content-tasks/{content_task_id}/manual-versions` | `createManualContentVersion` | `201,401,403,404,409,422` | 是 | 201 JSON → `ContentVersion`; Header none | 404 `create_manual_content_version`; 409 `_require_approved_task_fact` |
| GET `/api/v1/content-versions/{content_version_id}` | `getContentVersion` | `200,401,403,404,422` | 是 | 200 JSON → `ContentVersion`; Header none | 404 `get_content_version` route |
| GET `/api/v1/content-versions/{content_version_id}/detail` | `getContentVersionDetail` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentVersionDetail`; Header none | 404/409 `get_content_version_detail` |
| PUT `/api/v1/content-versions/{content_version_id}` | `updateContentDraft` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentVersion`; Header none | 404/409 `update_content_draft` |
| DELETE `/api/v1/content-versions/{content_version_id}` | `deleteContentDraft` | `204,401,403,404,409,422` | 是 | 204 no-body; Header none | 404/409 `delete_content_draft` |
| GET `/api/v1/content-tasks/{content_task_id}/review-context` | `getContentTaskReviewContext` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentReviewContext`; Header none | 404 `get_content_task_review_context`; 409 `_content_review_context` |
| GET `/api/v1/content-versions/{content_version_id}/review-context` | `getContentReviewContext` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentReviewContext`; Header none | 404 `get_content_review_context`; 409 `_content_review_context` |
| POST `/api/v1/content-versions/{content_version_id}/revisions` | `createContentRevision` | `201,401,403,404,409,422` | 是 | 201 JSON → `ContentVersion`; Header none | 404 `create_content_revision`; 409 `_require_approved_task_fact` |
| POST `/api/v1/content-versions/{content_version_id}/abandon` | `abandonContentVersion` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentVersion`; Header none | 404/409 `abandon_content_version` |
| POST `/api/v1/content-versions/{content_version_id}/submit-review` | `submitContentVersion` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentVersion`; Header none | 404/409 `transition_content_version` |
| POST `/api/v1/content-versions/{content_version_id}/approve` | `approveContentVersion` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentVersion`; Header none | 404/409 `transition_content_version` |
| POST `/api/v1/content-versions/{content_version_id}/request-changes` | `requestContentVersionChanges` | `200,401,403,404,409,422` | 是 | 200 JSON → `ContentVersion`; Header none | 404/409 `transition_content_version` |
| GET `/api/v1/content-versions/{content_version_id}/compare/{other_version_id}` | `compareContentVersions` | `200,401,403,404,422` | 是 | 200 JSON → `ContentDiff`; Header none | 404 `compare_content_versions` route；跨任务比较的业务 422 仍由同 route owner |

## 6. Helper 与实现边界审计

- `backend/app/errors.py::error_responses(*status_codes)` 只把调用方传入的 status 绑定至 `ErrorEnvelope` 和稳定 description，每次返回新 mapping；没有默认 status、router/method 推断或共享可变模板。
- `backend/app/schemas/common.py::ErrorEnvelope/ErrorDetail` 已由 Wave 1 建立，`code/message/details/request_id` 均 required，`details.default={}`；handler 与 metadata 复用同一 owner。
- Wave 2 只需要在三个 router import `error_responses` 并逐 decorator 显式传入该 operation 的非 success status。success status/model/media/Header 继续由现有 decorator 拥有。
- `listQueryTopics` 必须调用 `error_responses(401, 403)`，不能为了“统一”加入 422；其余 57 个按表显式包含 422。
- 没有证据支持修改 `errors.py`、`common.py`、合同、generated client、comparator 或 service。

## 7. 既有行为测试 ownership

Required 的轻量 HTTP sentinel 可直接复用：

- `backend/tests/unit/test_contract.py::test_query_topic_delete_rejects_non_admin_and_missing_csrf`
- `backend/tests/unit/test_contract.py::test_query_topic_delete_rejects_anonymous_request`
- `backend/tests/unit/test_contract.py::test_product_delete_requires_valid_revision_before_business_command`
- `backend/tests/unit/test_contract.py::test_content_revision_routes_reject_invalid_tags`
- `backend/tests/unit/test_contract.py::test_content_draft_update_rejects_empty_tags_before_business_command`

它们覆盖匿名/角色/CSRF、path/query/body 422 与项目 ErrorEnvelope，且能证明 decorator 改动没有绕开 FastAPI validation/dependency。更深的 service、事务、状态转换已有 PostgreSQL integration owner：

- 产品/事实 workspace 与审核：`test_product_detail.py` 的 update、fact review context/commands/conflict tests。
- Query Topic revision：`test_query_topic_list.py::test_query_topic_create_update_audit_and_revision_conflict`。
- 内容任务创建/idempotency：`test_content_task_creation.py::test_create_content_task_revalidates_qualification_and_idempotency`。
- 归档/恢复/永久删除聚合：`test_publication_workflow.py::test_content_task_delete_and_archive_permanent_delete_lifecycle`。
- 草稿保存/删除与 parent pointer：`test_content_draft_lifecycle.py::test_human_draft_can_be_saved_then_deleted_with_parent_pointer_restored`。
- 内容审核状态转换与不可变输入：`test_content_review.py::test_content_review_commands_revalidate_and_preserve_immutable_inputs`。
- generation command/retry/dispatch 的业务不变量由 `test_generation.py`、`test_generation_dispatch.py` 和 `test_generation_reliability.py` 现有测试拥有。

由于实现边界只改 decorator metadata，不调用或重构 service，Required 运行轻量 HTTP sentinel、完整 Wave 1+2 metadata parity、contract comparator regression、ruff/mypy 和 diff scope gate即可。上述 PostgreSQL integration node 可作为 optional full-suite 深度回归；若实施 diff 越过 decorator/test inventory，立即停止并重新规划，而不是靠加测试扩大范围。

## 8. 风险与停止条件

- 最大风险是批量复制相似 status，漏掉 `listQueryTopics` 的无 422、201/202/204 success 或逐 route 404/409 差异。
- 第二风险是只比较 status set，未发现 422 仍指向 `HTTPValidationError`；因此必须运行完整 comparator 和逐 operation ErrorEnvelope 断言。
- 第三风险是误把 Phase X 的 400/Header 或 Phase E 的 router 纳入本 Wave；scope/diff gate 必须阻断。
- 如果 Wave 2 投影在只改 decorator 后仍有 success schema/media/Header drift，停止并回到 authority 审计；不得过滤 failure、修改 comparator 或重构共享 schema。
