# 冻结 Response 合同权威校准设计

## 1. 边界、所有权与文件集合

```text
HTTP sentinel / router / dependency / service / handler / middleware
                              │
                              └─ final authority matrix（审计证据）
                                                │
                                                ├─ contracts/openapi.yaml
                                                ├─ backend 静态合同测试
                                                └─ api:generate → generated client
```

`contracts/openapi.yaml` 是唯一可编辑产品合同。matrix 不是 generator/runtime input，不被产品测试当作第二份期望。Phase B 不修改 runtime metadata，所以完整 response report 保持非零是预期中间态。

Phase B 最终产品文件精确为：

- `contracts/openapi.yaml`
- `frontend/src/shared/api/generated/schema.d.ts`（只由 `api:generate` 生成）
- `backend/tests/unit/test_contract.py`

规划/证据文件精确为：

- 本 Task 的 `task.json`、`prd.md`、`design.md`、`implement.md`、`implement.jsonl`、`check.jsonl`
- `research/final-response-authority-matrix.jsonl`
- 父 Task `task.json` 中的 child 关系

本轮开始前已存在的 `research/verify_authority_matrix.py` 和 `research/authority-matrix-validation.json` 不在批准设计内：前者 1697 行，超过项目对 task-only verifier 的 300 行成本边界。两者本轮保持不动，实施/提交不依赖也不纳入它们。

当前 `main`/`origin/main` 在本轮中被外部推进到 `e898c061`，该提交已把上述 verifier、Phase B 产品候选 diff 与无关 artifacts 混合提交。这不改变批准的 Phase B 文件边界，但使实施前必须先由用户选择接受该提交为候选基线，或另行授权可恢复的清理。本 Task 不自行 reset、revert、force-push 或重写历史。

## 2. Final Authority Matrix

matrix 按 `(path, method, operationId)` 唯一定位并稳定排序。每行保存基线 `current_contract_statuses`、Phase B 终态 `phase_b_statuses`、Phase X 后 `release_statuses_after_phase_x`、逐 status 证据、validation 来源、特殊 shape、request-ID 终态与 Cookie sentinel 状态。

| Status | Operation 数 | 逐 operation 判定方法 |
| --- | ---: | --- |
| 2xx | 164 个 response | route decorator、显式 `Response`、HTTP 或返回类型证据 |
| 401 | 160 | `_resolve_current_session`、无效 optional Cookie，或 operation 自身凭据错误 |
| 403 | 158 | 临时密码 gate、`CsrfProtected`、角色 dependency 或 service 权限拒绝 |
| 404 | 119 | 可逃逸 `not_found()`/等价分支；UUID path 本身不证明 404 |
| 409 | 106 | revision/state/idempotency/in-use/context/integrity 的明确可逃逸分支 |
| 422 | 149 | path/query/header/cookie/body validation 或明确业务 validation；wire 引用 ErrorResponse |
| 502 | 1 | 仅 `discoverAIChannelModels`，provider/transport 错误可逃逸 |
| 503 | 3 | `getReadyHealth`、`createPlatformLogoCandidate`、`completeFileUpload` |
| 504 | 1 | 仅 `discoverAIChannelModels`，provider timeout 可逃逸 |

`getAuditLog` 保留 409：`_project_details` 的安全投影失败由 `_projection_failed()` 转换为 `AUDIT_PROJECTION_FAILED`，且 route 未捕获该 `AppError`；已有 HTTP sentinel 覆盖该路径。`testAIModel` 的 provider 502/504 被 command 捕获并转为 200 `FAILED`，因此删除；它的 revision race 409 仍保留。`completeFileUpload` 的 service owner 明确可逃逸 401/403/404/409/422/503，Phase B 终态为 `200/401/403/404/409/422/503`。

### 2.1 422 分界

以下 13 个 operation 没有 validation path，不冻结 422：

- `getLiveHealth`、`getReadyHealth`
- `getAuditLogFilterOptions`
- `getCsrfToken`、`getCurrentUser`
- `getContentHumanizationPrompt`
- `getDashboardSummary`
- `listPlatformPrompts`、`listPlatformTypes`
- `listPublicationReadyItems`、`getPublicationWorkbenchSummary`
- `listQueryTopics`
- `getWorkbench`

其余 149 个 operation 冻结 422 ErrorResponse。FastAPI 自动 metadata 只用于定位 validation path；`validation_error_handler` sentinel 证明 wire 是 `ErrorEnvelope`，不是 `HTTPValidationError`。

## 3. 公共 Schema 与 Header

### ErrorEnvelope

`AppError.details = details or {}` 且 `error_response()` 无条件写四字段，所以 `ErrorDetail.required` 收紧为 `code/message/details/request_id`。最小 TestClient sentinel 用非法 `X-Request-ID` 触发无业务 details 的 `AppError`，断言 `details == {}` 且四字段精确存在。

### Health

`HealthResponse.checks` 是 `dict[str, str] | None = None`。根 schema 保持字段 optional，并允许 `object | null`；`GET /api/health/live` sentinel 断言 `{status: "ok", checks: null}`。

### GEO basis

`ContentTaskDetailGeoBasis` 使用 `Field(discriminator="rule_code")`。`ContentTaskDetailGeoOptimization.properties.basis` 保留三分支 `oneOf`，增加 `discriminator.propertyName=rule_code` 与 literal-to-schema mapping。受影响的成功 operation 是 `getContentTaskDetail` 和 `getGeoInsights`。

### Generation snapshot unions

Pydantic 对普通 Python union 生成 `anyOf`。根合同同步四个公共位置：`GenerationJobDetail.input_snapshot`（五分支）、`GenerationInputSnapshot`（三分支）、`GenerationTrace.input_snapshot`（三分支）、`HumanizationTrace.input_snapshot`（两分支）。受影响的成功 response 是 `getGenerationJob`、`getContentVersionDetail`、`getContentReviewContext`。分支目前由 required 且互异的 `contract_version` literal 区分；未来分支重叠时必须重新进入公共合同决策。

### CSV 与 Headers

`exportUsers` 和 `exportPlatformProfiles` 直接返回 `Response(media_type="text/csv", headers={"Content-Disposition": ...})`。根 OpenAPI 的 200 response 使用 `content.text/csv.schema.type=string` 和 required string `Content-Disposition`；`Content-Type` 不重复声明 Header。

matrix 为每个 operation 记录 optional request `X-Request-ID`、非法值 400 和所有 release response 的 required response Header。本 Phase 不写入根 OpenAPI，以免 request parameter gate 在 runtime metadata 未同步时提前失败。login/logout 的多实例 `Set-Cookie` 只由 HTTP sentinel 管理。

## 4. Frontend 公共合同影响

`api:generate` 预期仅产生：受影响 operation 的精确 non-2xx response 类型；optional `HealthResponse.checks` 的 `object | null`；GEO discriminator literal/enum 信息；generation/humanization snapshot TypeScript union；两个 CSV `Content-Disposition` 从 optional 收紧为 required string。

如 frontend typecheck 要求修改 consumer，Phase B 停止并回父 Task 拆分，不越界修改页面。

## 5. 静态测试与独立 Review

`backend/tests/unit/test_contract.py` 更新已有精确 status-set 断言，并增加 ErrorEnvelope、特殊 5xx、health/GEO/generation、CSV media/Header 与最小 HTTP/service sentinel。测试不读 matrix，不复制 Phase A `$ref` resolver、schema canonicalizer 或 comparator。

critical reviewer 独立抽取 root contract diff 中所有新增/删除 status，回指 route/dependency/service/HTTP 证据；单独核对 149/13 validation 分界、特殊 5xx、公共 schema、CSV Header、Phase X 边界和 generated 来源。review 必须明确确认没有猜测 status、删除真实 response、改变业务语义或修改 `backend/app/**`。

## 6. 中间态与回滚

Phase B 完成后默认旧 `contract_check`、`api:check` 和 typecheck 应通过。`--response-report` 必须返回 1：0 与“不修改 runtime metadata”的中间态矛盾，2 表示文档/机器语义无效。剩余差异只能对应后续 runtime metadata waves C–E 与 Phase X；Phase F 才启用完整 comparator。

Phase C 开始前可原子回滚 OpenAPI、generated client 和静态测试；Phase C 之后优先 roll-forward，必须回退时按 `F → X → E → D → C → B` 逆序恢复。
