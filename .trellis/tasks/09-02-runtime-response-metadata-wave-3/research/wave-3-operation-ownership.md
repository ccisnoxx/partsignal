# Research：Runtime Response Metadata Wave 3 Operation Ownership

- 日期：2026-09-02（Asia/Shanghai）
- 范围：`publication.py`、`observation.py`、`workbench.py` 的真实注册 route，当前 `app.openapi()`、冻结 OpenAPI、Phase B final matrix 与既有行为 tests。
- 性质：完整 review inventory；不是 production baseline、allowlist、filter、overlay 或 status 推断输入。

## 1. Inventory 与当前 drift

- 四方联结得到 **43** 个唯一 operation：`publication=30`、`observation=12`、`workbench=1`。
- success occurrence：`200=34`、`201=6`、`204=3`。JSON success 均为 `application/json`，204 均无 body，所有 success 的 operation-specific Header 为 none。
- error/status occurrence：`401=43`、`403=43`、`404=32`、`409=37`、`422=39`。无 5xx、`4XX`、`default` 或其他特殊 status。
- no-422 operation 精确为 4：`listPublicationReadyItems`、`getPublicationWorkbenchSummary`、`getDashboardSummary`、`getWorkbench`。
- 初始规划时点 Wave 3 / 全局 comparator 均为 197 failures：155 `missing_status`（401×43、403×43、404×32、409×37）及 42 `schema_drift`（422×39、GEO success×3）。前置 identity 修复后的实施启动基线为 194 failures：相同 155 `missing_status` 与 39 个 422 `schema_drift`，success drift 为 0；当前 Wave 3 candidate 已为零差异、退出 0。

## 2. 共用 Runtime Owner

下表“特殊 404/409 owner”列出 operation-specific 的实际逃逸/转换 owner；其余共同 owner 为：

- success：表中 route decorator 的 `response_model` / `status_code` 及 endpoint 返回路径；
- 401：`backend/app/deps.py::_resolve_current_session`；
- 403：`_resolve_current_session` 临时密码 gate，以及相应 route 的 `assert_account_types` / `CsrfProtected`；
- 422：route path/query/header/body/filter validation 产生 `RequestValidationError`，由 `backend/app/errors.py::validation_error_handler` 转换为项目 `ErrorEnvelope`；
- metadata schema：`backend/app/schemas/common.py::ErrorEnvelope` 与 `backend/app/errors.py::error_responses` 是唯一 owner。

Status set 只能逐行取自 Phase B matrix；共同 owner 说明不得用来反推另一行的 status。

## 3. Publication（30）

| Router owner | Method/path | operationId | Success status / schema / media / Header | Phase B statuses | 422 | 特殊 404/409 runtime owner |
|---|---|---|---|---|---|---|
| `publication.get_publication_package` | GET `/api/v1/content-versions/{content_version_id}/publication-package` | `getPublicationPackage` | 200 `PublicationPackage`; JSON; H none | `200,401,403,404,409,422` | 是 | 404/409 `_lock_approved_publication_context` (`services/publication.py`) |
| `publication.list_publication_ready_items` | GET `/api/v1/publication-ready-items` | `listPublicationReadyItems` | 200 `PublicationReadyItemList`; JSON; H none | `200,401,403` | **否** | — |
| `publication.get_publication_workbench_summary` | GET `/api/v1/publication-workbench-summary` | `getPublicationWorkbenchSummary` | 200 `PublicationWorkbenchSummary`; JSON; H none | `200,401,403` | **否** | — |
| `publication.list_platform_accounts` | GET `/api/v1/platform-accounts` | `listPlatformAccounts` | 200 `PlatformAccountList`; JSON; H none | `200,401,403,422` | 是 | — |
| `publication.create_platform_account` | POST `/api/v1/platform-accounts` | `createPlatformAccount` | 201 `PlatformAccount`; JSON; H none | `201,401,403,404,409,422` | 是 | 404/409 `lock_active_platform` (`services/platform_configuration.py`) |
| `publication.update_platform_account` | PATCH `/api/v1/platform-accounts/{platform_account_id}` | `updatePlatformAccount` | 200 `PlatformAccount`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `_lock_platform_account`; 409 `lock_active_platform` |
| `publication.enable_platform_account` | POST `/api/v1/platform-accounts/{platform_account_id}/enable` | `enablePlatformAccount` | 200 `PlatformAccount`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `_lock_platform_account`; 409 `lock_active_platform` |
| `publication.disable_platform_account` | POST `/api/v1/platform-accounts/{platform_account_id}/disable` | `disablePlatformAccount` | 200 `PlatformAccount`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `_lock_platform_account`; 409 `lock_active_platform` |
| `publication.delete_platform_account` | DELETE `/api/v1/platform-accounts/{platform_account_id}` | `deletePlatformAccount` | 204 no-body; H none | `204,401,403,404,409,422` | 是 | 404 `_lock_platform_account`; 409 `delete_platform_account` (`services/publication.py`) |
| `publication.create_work` | POST `/api/v1/publication-works` | `createPublicationWork` | 201 `PublicationWork`; JSON; H none | `201,401,403,404,409,422` | 是 | 404 `_lock_approved_publication_context`; 409 `_ensure_unique_identity` |
| `publication.list_publication_works` | GET `/api/v1/publication-works` | `listPublicationWorks` | 200 `PublicationWorkList`; JSON; H none | `200,401,403,409,422` | 是 | 409 `_work_list_item` (`services/publication_queries.py`) |
| `publication.get_publication_work` | GET `/api/v1/publication-works/{work_id}` | `getPublicationWork` | 200 `PublicationWork`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 route `get_publication_work`; 409 `_work_list_item` |
| `publication.get_publication_workspace_context` | GET `/api/v1/publication-works/{work_id}/workspace-context` | `getPublicationWorkspaceContext` | 200 `PublicationWorkspaceContext`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `publication_workspace_context`; 409 `_work_list_item` |
| `publication.update_preparation` | PATCH `/api/v1/publication-works/{work_id}/preparation` | `updatePublicationPreparation` | 200 `PublicationWork`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `_lock_platform_account`; 409 `_lock_work` |
| `publication.mark_platform_review` | POST `/api/v1/publication-works/{work_id}/platform-review` | `markPublicationPlatformReview` | 200 `PublicationWork`; JSON; H none | `200,401,403,404,409,422` | 是 | 404/409 `_lock_work` |
| `publication.register_result` | PUT `/api/v1/publication-works/{work_id}/result` | `registerPublicationResult` | 200 `PublicationWork`; JSON; H none | `200,401,403,404,409,422` | 是 | 404/409 `_lock_work` |
| `publication.switch_content_version` | POST `/api/v1/publication-works/{work_id}/content-version` | `switchPublicationContentVersion` | 200 `PublicationWork`; JSON; H none | `200,401,403,404,409,422` | 是 | 404/409 `_lock_work` |
| `publication.verify_work` | POST `/api/v1/publication-works/{work_id}/verifications` | `verifyPublicationWork` | 200 `PublicationWork`; JSON; H none | `200,401,403,404,409,422` | 是 | 404/409 `_lock_work`; verification 状态机继续由 service 拥有 |
| `publication.close_work` | POST `/api/v1/publication-works/{work_id}/close` | `closePublicationWork` | 200 `PublicationWork`; JSON; H none | `200,401,403,404,409,422` | 是 | 404/409 `_lock_work` |
| `publication.list_published_articles` | GET `/api/v1/published-articles` | `listPublishedArticles` | 200 `PublishedArticleList`; JSON; H none | `200,401,403,409,422` | 是 | 409 `_article_item` (`services/publication_queries.py`) |
| `publication.get_published_article` | GET `/api/v1/published-articles/{article_id}` | `getPublishedArticle` | 200 `PublishedArticle`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `get_content_version_detail`; 409 `_article_item` |
| `publication.preview_article_permanent_deletion` | GET `/api/v1/published-articles/{article_id}/permanent-deletion-preview` | `previewPublishedArticlePermanentDeletion` | 200 `PublishedArticlePermanentDeletionPreview`; JSON; H none | `200,401,403,404,409,422` | 是 | 404/409 `_published_article_deletion_scope` |
| `publication.permanently_delete_article` | POST `/api/v1/published-articles/{article_id}/permanent-delete` | `permanentlyDeletePublishedArticle` | 204 no-body; H none | `204,401,403,404,409,422` | 是 | 404/409 `_published_article_deletion_scope` |
| `publication.open_content_issue` | POST `/api/v1/published-articles/{article_id}/issues` | `openPublishedContentIssue` | 201 `PublishedContentIssue`; JSON; H none | `201,401,403,404,409,422` | 是 | 404 `get_content_version_detail`; 409 `_article_item` |
| `publication.list_published_content_issues` | GET `/api/v1/published-content-issues` | `listPublishedContentIssues` | 200 `PublishedContentIssueList`; JSON; H none | `200,401,403,409,422` | 是 | 409 `_article_item` |
| `publication.get_published_content_issue` | GET `/api/v1/published-content-issues/{issue_id}` | `getPublishedContentIssue` | 200 `PublishedContentIssue`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `get_content_version_detail`; 409 `_article_item` |
| `publication.get_published_content_issue_workspace_context` | GET `/api/v1/published-content-issues/{issue_id}/workspace-context` | `getPublishedContentIssueWorkspaceContext` | 200 `PublishedContentIssueWorkspaceContext`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `get_content_version_detail`; 409 `_article_item` |
| `publication.get_repair_context` | GET `/api/v1/published-content-issues/{issue_id}/repair-context` | `getPublishedContentRepairContext` | 200 `PublishedContentRepairContext`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `get_content_version_detail`; 409 `_article_item` |
| `publication.create_published_content_repair_task` | POST `/api/v1/published-content-issues/{issue_id}/repair-task` | `createPublishedContentRepairTask` | 201 `ContentTask`; JSON; H none | `201,401,403,404,409,422` | 是 | 404/409 `create_repair_task` (`services/publication.py`) |
| `publication.resolve_content_issue` | POST `/api/v1/published-content-issues/{issue_id}/resolve` | `resolvePublishedContentIssue` | 200 `PublishedContentIssue`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `get_content_version_detail`; 409 `_article_item` |

## 4. Observation / GEO（12）

| Router owner | Method/path | operationId | Success status / schema / media / Header | Phase B statuses | 422 | 特殊 404/409 runtime owner |
|---|---|---|---|---|---|---|
| `observation.list_geo_observations` | GET `/api/v1/geo-observations` | `listGeoObservations` | 200 `GeoObservationList`; JSON; H none | `200,401,403,409,422` | 是 | 409 `geo_observations_out` (`services/geo_observation.py`) |
| `observation.list_geo_observation_items` | GET `/api/v1/geo-observations/list-items` | `listGeoObservationItems` | 200 `GeoObservationListPage`; JSON; H none | `200,401,403,409,422` | 是 | 409 `geo_observation_list_items_out` |
| `observation.get_geo_observation` | GET `/api/v1/geo-observations/{observation_id}` | `getGeoObservation` | 200 `GeoObservation`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `get_geo_observation`; 409 `geo_observations_out` |
| `observation.get_geo_observation_detail` | GET `/api/v1/geo-observations/{observation_id}/detail` | `getGeoObservationDetail` | 200 `GeoObservationDetail`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `get_geo_observation_detail`; 409 `_geo_observation_detail_evidence` |
| `observation.get_geo_observation_correction_context` | GET `/api/v1/geo-observations/{observation_id}/correction-context` | `getGeoObservationCorrectionContext` | 200 `GeoObservationCorrectionContext`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `get_geo_observation_detail`; 409 `_geo_observation_detail_evidence` |
| `observation.delete_geo_observation` | DELETE `/api/v1/geo-observations/{observation_id}` | `deleteGeoObservation` | 204 no-body; H none | `204,401,403,404,409,422` | 是 | 404/409 `_lock_manual_observation_chain` |
| `observation.list_geo_observation_publications` | GET `/api/v1/geo-observation-publications` | `listGeoObservationPublications` | 200 `GeoPublicationCandidateList`; JSON; H none | `200,401,403,404,422` | 是 | 404 route `list_geo_observation_publications` |
| `observation.create_geo_observation` | POST `/api/v1/geo-observations` | `createGeoObservation` | 201 `GeoObservation`; JSON; H none | `201,401,403,404,409,422` | 是 | 404/409 `create_geo_observation` |
| `observation.get_geo_metrics` | GET `/api/v1/geo-metrics` | `getGeoMetrics` | 200 `GeoMetrics`; JSON; H none | `200,401,403,422` | 是 | — |
| `observation.get_geo_insights` | GET `/api/v1/geo-insights` | `getGeoInsights` | 200 `GeoInsights`; JSON; H none | `200,401,403,404,409,422` | 是 | 404 `_validate_geo_insight_filters`; 409 `_geo_insight_filter_options` |
| `observation.create_geo_optimization_task` | POST `/api/v1/geo-insights/optimization-content-tasks` | `createGeoOptimizationContentTask` | 201 `ContentTask`; JSON; H none | `201,401,403,404,409,422` | 是 | 404 `_validate_geo_insight_filters`; 409 `_geo_insight_filter_options` |
| `observation.get_dashboard_summary` | GET `/api/v1/dashboard/summary` | `getDashboardSummary` | 200 `DashboardSummary`; JSON; H none | `200,401,403` | **否** | — |

## 5. Workbench（1）

| Router owner | Method/path | operationId | Success status / schema / media / Header | Phase B statuses | 422 | 特殊 404/409 runtime owner |
|---|---|---|---|---|---|---|
| `workbench.get_workbench` | GET `/api/v1/workbench` | `getWorkbench` | 200 `WorkbenchAggregate`; JSON; H none | `200,401,403,409` | **否** | 409 `_geo_accuracy_items` (`services/workbench.py`) |

## 6. Phase X Boundary

Phase B matrix 对上述 43 行分别记录：

- request `X-Request-ID`：optional；
- 非法值：400 `ErrorEnvelope`；
- 每个 release response：required `X-Request-ID` Header；
- `release_statuses_after_phase_x - phase_b_statuses = {400}`。

这些是 Phase X 的跨切面 metadata，不进入任何 Wave 3 decorator `responses` 参数或测试 expected status set。当前 frozen/runtime OpenAPI 中 Wave 3 的 400 和 response `X-Request-ID` Header 数量均为 0。

## 7. Per-operation Acceptance Rule

表中每一行必须同时满足：

1. router、runtime OpenAPI、冻结合同、Phase B matrix 各有且仅有同一个 `(path, method, operationId)`；
2. runtime response key set 与 `Phase B statuses` 完全相等；
3. success status/schema/media/Header 与表中目标相同，204 无 body；
4. 每个 non-success response 的 JSON schema 为唯一 `ErrorEnvelope`；
5. 422 “是/否”精确匹配，不得依赖 FastAPI 自动 `HTTPValidationError`；
6. 表中 404/409 owner 仍沿原调用链逃逸或转换；metadata 不增加、删除或重映射实际行为；
7. 无 5xx、`4XX`、`default`、operation-specific response Header 或 Phase X 400/Header；
8. 将完整 43-operation 投影交给 production comparator 后 failure list 为 `[]`。

## 8. Resolved Pre-start Prerequisites

- 三个 GEO success response 的 discriminator mapping URI 已由独立 prerequisite commit `89245be8` 在 schema authority owner 修复；Wave 3 启动基线不再包含 success drift，三个 router 不接管 schema identity。
- 全局 response failures 与 Wave 3 完全相等，因此 Wave 3 零差异后 report 应退出 0；父计划旧的 Phase X 前非零预期已在实施前修正。
- 实施启动基线已实测为 194 条/退出 1；当前 candidate 已实测为零差异/退出 0。

两项均已由用户在 `task.py start` 前确认并解决；本 Task 没有通过留差异或扩大 scope 隐式处理。
