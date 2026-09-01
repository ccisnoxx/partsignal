# 冻结 Response 合同权威校准

## Goal

以已存在的 router、dependency、service、middleware 与 HTTP sentinel 为权威，逐 operation 校准 `contracts/openapi.yaml` 的 response status、media、schema 和 OpenAPI 可精确表达的 operation-specific Header；然后只通过 `api:generate` 同步 Frontend generated client，并用静态合同测试冻结公共语义。

本 Task 是父 Task `08-31-non-2xx-contract-check` 的 Phase B，依赖已完成并归档的 Phase A `08-31-response-comparator-core`（工作提交 `4ccd6ea7`）。Phase B 只改变公共合同声明、生成类型和静态合同测试，不改变 FastAPI runtime metadata 或任何实际 HTTP 行为。

## Confirmed Facts

- 冻结 OpenAPI 与 `app.openapi()` 的 operation identity 均为 162/162。final matrix 以提交快照 `4dd7441aaae17fad9e16dc17f3fe5283448abac9` 为实施前基线；该快照与 Phase A 工作提交在本 Phase 权威产品路径上无差异。
- `research/final-response-authority-matrix.jsonl` 稳定按 path、method、operationId 排序，包含 1 条 metadata 和 162 条 operation 记录。结构性核对已证明矩阵、基线合同、当前候选合同与 runtime inventory 身份集合一致；这是规划证据，不表示已批准产品改动。
- Phase B 最终 status 出现次数为：`200=120`、`201=21`、`202=3`、`204=20`、`401=160`、`403=158`、`404=119`、`409=105`、`422=149`、`502=1`、`503=3`、`504=1`。与基线相比，新增 `401×35`、`403×43`、`404×31`、`409×9`、`422×69`、`503×1`；删除 `getAuditLog` 的 409 和 `testAIModel` 的 502/504。
- 149 个 operation 存在 path/query/header/cookie/body 解析校验或明确业务 422；其余 13 个不存在 422 入口。FastAPI 自动 `HTTPValidationError` 只证明校验入口；实际 wire shape 由 `validation_error_handler` 编码为项目 `ErrorEnvelope`。
- `error_response()` 总是输出 `code`、`message`、`details`、`request_id`；即使未提供 details，`AppError` 也将其归一为 `{}`。
- `testAIModel` 捕获 provider `AppError`，在 revision 复核后回写 `FAILED` 并以 HTTP 200 返回；provider 502/504 不会逃逸。`discoverAIChannelModels` 仍可逃逸 502/504。
- `completeFileUpload` 的 `StorageUnavailable` 明确映射为 503 `DEPENDENCY_UNAVAILABLE`，且不推进文件状态。
- health `checks` 可省略且可为 null；Content Task Detail GEO basis 是以 `rule_code` 区分的 union；Pydantic 对 generation snapshot 对应位置生成 `anyOf`，各分支目前由互异 `contract_version` literal 区分。
- `exportUsers` 和 `exportPlatformProfiles` 的实际 200 响应是 `text/csv` string，并始终写入非空 `Content-Disposition`。
- middleware 对已处理的正常/错误响应写入 `X-Request-ID`，并对非法 request Header 短路返回 400。本 Phase 只在矩阵中完成该跨切面终态，不写入根 OpenAPI；Phase X 才与 runtime metadata 同批同步。
- login/logout 产生多个 `Set-Cookie` 实例，OpenAPI 单值 Header Object 无法精确表达；继续交由 HTTP sentinel。
- 普通未处理 500 没有稳定业务 code/shape，不新增 `default`/500 ErrorResponse。全局 `IntegrityError` handler 不足以证明所有数据库 operation 都有 409。

## Requirements

1. `research/final-response-authority-matrix.jsonl` 覆盖全部 162 个 operation；每个 `phase_b_statuses` 状态都必须包含 owner symbol、证据类型、`file:line`/测试锚点和 escape/transform 结论。matrix 不得被 runtime、generator 或产品测试读取。
2. 状态权威顺序为：HTTP boundary test/最小 TestClient sentinel；route dependency、权限、CSRF 与 FastAPI 输入校验；明确可逃逸的 `AppError`/`not_found()`/revision/state/provider/storage 路径；handler/middleware 真实 wire 输出。冻结合同与 runtime OpenAPI 仅是待核对声明。
3. 401、403、404、409、422、502、503、504 必须逐 operation 判定；不按 router、HTTP method、DB 访问或外部服务批量套模板。不存在可逃逸路径的状态从冻结合同删除。
4. 149 个 validation-capable operation 的 422 统一引用 `#/components/responses/ErrorResponse`；不引入 `HTTPValidationError`。13 个无校验入口 operation 保持无 422。
5. `ErrorDetail.required` 精确收紧为 `code/message/details/request_id`，并由最小 handler sentinel 证明空 details 仍编码为 `{}`。
6. `testAIModel` 删除 502/504，保持 200 `FAILED` 投影和 revision race 409；`completeFileUpload` 冻结为 `200/401/403/404/409/422/503`。测试只替换外部 seam，不替换被测 command/service owner。
7. 校准 health nullable、GEO basis discriminator 和 generation snapshot `anyOf`；只改真实机器语义，不机械重排等价 component/title/description。
8. 两个 CSV operation 的 200 响应精确声明 `text/csv`、string body 和 required string `Content-Disposition`；`Content-Type` 由 media map 表达。
9. matrix 对全部 operation 记录 optional `X-Request-ID` request Header、非法值 400 与每个 release response 的 required `X-Request-ID` Header；本 Phase 根 OpenAPI diff 不得包含它们。login/logout `Set-Cookie` 不进入单值 Header parity。
10. generated client 只能由 `npm --prefix frontend run api:generate` 生成，不得手工编辑。
11. `backend/tests/unit/test_contract.py` 冻结最终精确 status set、统一 ErrorResponse、特殊 5xx、health/GEO/generation schema 与 CSV media/Header；不复制 Phase A comparator，不读取 matrix 作为产品期望。
12. `check()`、`successful_response()`、Makefile/CI 和默认 `contract-check` 保持不变；不引入 baseline、filter、suppress、allowlist 或 overlay。

## Acceptance Criteria

- [ ] final matrix 为 162/162 唯一、稳定排序记录；每个 Phase B status 都有非空 owner、证据锚点与 escape/transform 结论。
- [ ] 新增/删除的 401、403、404、409、422、502、503、504 全部由逐 operation 调用链证明。
- [ ] 149 个 validation-capable operation 均声明 ErrorResponse 422；13 个无校验入口 operation 不声明 422。
- [ ] `ErrorDetail.required` 精确包含四字段，handler sentinel 证明 `details` 始终存在。
- [ ] `testAIModel` 删除 502/504，service/route sentinel 证明 provider 错误投影为 200 `FAILED`，并保留 revision race 409。
- [ ] `completeFileUpload` 精确为 `200/401/403/404/409/422/503`，storage sentinel 证明 503 与状态不前进。
- [ ] health nullable、GEO discriminator、generation snapshot `anyOf` 与实际 Pydantic schema/serialization 一致。
- [ ] 两个 CSV response 精确声明 `text/csv`、string body 和 required `Content-Disposition`，且两个 HTTP sentinel 通过。
- [ ] `X-Request-ID`/400/response Header 终态已在 matrix 中完成，但根 OpenAPI diff 不包含它们；`Set-Cookie` 不伪造为单值 Header。
- [ ] OpenAPI 通过静态合同测试；generated client 仅由 `api:generate` 产生，`api:check` 与 frontend typecheck 通过。
- [ ] 默认 contract check 继续通过，但不声称已启用完整 response gate。
- [ ] `--response-report` 返回 1 而不是 0/2；剩余差异只对应后续 runtime metadata waves 与 Phase X。
- [ ] 产品 diff 仅包含 `contracts/openapi.yaml`、generated client 和 `backend/tests/unit/test_contract.py`；另允许本 Task planning/research/context 与父 Task child metadata。
- [ ] 独立 critical review 没有发现猜测 status、删除真实 response、改变业务语义、提前写入 Phase X 元数据或手改生成物。

## Out of Scope

- `backend/app/**`、router `responses=`、ErrorEnvelope runtime Pydantic model/metadata helper。
- 权限、CSRF、状态转换、事务、业务 error code、provider/storage 映射或实际 HTTP 行为变更。
- 完整 comparator 启用、删除 `successful_response()`、Makefile/CI 修改。
- 将 `X-Request-ID` request Header、400 或 response Header 写入根 OpenAPI；将 `Set-Cookie` 伪造为单值 Header。
- `integrity-error-domain-mapping`、500 合同、frontend 页面/消费者修改、database migration、生产调用或数据写入。
- ignored operation/status/path、drift baseline、filter、suppress、allowlist、overlay 或 runtime 从冻结合同反向注入 metadata。
- 归档父 Task、`frontend-v2-functional-contract-conformance-baseline`、`v2-live-readonly-acceptance`，或修改后两者的状态/内容。

## Review Gate

本轮只交付可评审规划与 final authority matrix。用户明确批准前，子 Task 保持 `planning`；不运行 `task.py start`，不派发实施，不把本轮开始前已存在的候选产品 diff 视为已批准实施结果。
