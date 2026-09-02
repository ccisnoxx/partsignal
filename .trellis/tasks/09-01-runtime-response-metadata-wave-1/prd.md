# 运行时 Response Metadata Wave 1

## Goal

让 foundation、configuration、identity、files 路由的 FastAPI runtime OpenAPI response metadata 与经 authority repair 修正后的逐 operation 公共合同一致，同时保持现有 HTTP status、body、Header、权限、校验、事务、状态转换和 error-domain mapping 不变。

本 Task 是父 Task `08-31-non-2xx-contract-check` 的 Phase C，拥有一个可独立 review 的目标：只收敛 Wave 1 的 61 个 operation。初版规划已经批准并进入实施。

2026-09-02 恢复说明：`09-02-response-schema-composition-authority-repair` 已通过工作提交 `7be5b979` 修正冻结合同、generated client 与 runtime schema authority，并通过归档提交 `7f3b789b` 完成归档。旧的 success-schema composition workaround 已被推翻并由前置 Task 接管；本 Task 不再修改 `backend/app/schemas/configuration.py` 的 schema composition，只继续 61 个 operation 的 runtime response metadata。

## Confirmed Facts

- Phase A `08-31-response-comparator-core` 已归档，并提供纯 `compare_response_contracts()` 与只读 `--response-report`；默认 live gate 尚未启用完整 response comparator。
- Phase B 最终矩阵包含 1 条 metadata 与 162 条 operation，结构校验通过；当前冻结 `contracts/openapi.yaml` 也完整解析为 162 个 operation。Wave 1 的实际 router inventory 为 foundation 2、configuration 39、identity 15、files 5，共 61 个 operation。
- 冻结合同中的统一 wire shape 是 `{error: {code, message, details, request_id}}`；四个内部字段均 required。当前 `error_response()` 已始终输出这四个字段，但 runtime OpenAPI 没有项目 `ErrorEnvelope` model。
- 锁定版本为 FastAPI 0.139.0、Pydantic 2.13.4。FastAPI 自动 422 metadata 指向 `HTTPValidationError`；自定义 `RequestValidationError` handler 不会自动改变 OpenAPI metadata，但实际 422 body 已是项目 ErrorEnvelope。
- Wave 1 中两个 CSV operation `exportUsers`、`exportPlatformProfiles` 的实际响应为 `text/csv` 且始终有 `Content-Disposition`，冻结合同已准确声明；runtime metadata 当前仍是 `application/json` 且未声明该 Header。
- `getReadyHealth` 可实际返回 503，冻结合同已声明，runtime metadata 当前只声明 200；`getLiveHealth` 当前 200 metadata 已一致。
- 逐 operation 状态、422 分界、特殊 5xx、response shape 和 owner 以 `research/wave-1-operation-ownership.md` 从 Phase B final matrix 提取的 61 行清单为本 Task 的验收输入；该研究文件不是生产 input、baseline 或 allowlist。
- 主工作区在 `main`，开始规划时已有 544 项无关未提交变更；它们全部属于本 Task 外部状态，必须保持不动且不得纳入提交。
- authority repair 已把相关公共派生 response schema 修正为展平、closed object，并恢复默认 Pydantic JSON Schema owner；Wave 1 不得重引入 `__get_pydantic_json_schema__`、Pydantic 私有 handler、硬编码 component ref 或旧 `allOf` 断言。

## Requirements

1. 在 `backend/app/schemas/common.py` 建立唯一运行时 wire schema：外层 `ErrorEnvelope.error` 包含且要求 `code`、`message`、`details`、`request_id`；不得创建第二套异常层级、业务错误类型、error code 映射或状态映射。
2. `backend/app/errors.py` 的错误响应序列化和 OpenAPI metadata 必须复用同一 ErrorEnvelope schema owner，确保 handler 实际 wire shape 与 runtime schema 不再分别维护；序列化后的字段、层级、值和 HTTP 状态必须与现状语义等价。
3. response metadata helper 只能复用 ErrorEnvelope model 与稳定 description 等声明结构。每个 operation 必须在自身 route decorator 明确传入 Phase B matrix 规定的 status；helper 不得自行推断或默认套用统一 401/403/404/409/422/5xx 集合。
4. Wave 1 的 61 个 operation 必须逐项使用 Phase B `phase_b_statuses`。不得按 router、HTTP method、依赖类型或服务类型批量猜测状态；特殊状态包括 `getReadyHealth` 503、`discoverAIChannelModels` 502/504、`createPlatformLogoCandidate` 503、`completeFileUpload` 503，以及 `testAIModel` 不得声明 502/504。
5. Phase B 标记为 validation-capable 的 53 个 Wave 1 operation 必须显式声明 422 ErrorEnvelope；其余 8 个无 validation path 的 operation不得为抑制 FastAPI 自动 422而虚构 422、`4XX` 或 `default`。实际 FastAPI/Pydantic 校验入口、失败 status 和 handler 行为保持不变。
6. `backend/app/main.py` 同步两个 health endpoint 的 response metadata；只为 `getReadyHealth` 增加矩阵规定的 503，不改变数据库/Redis readiness probe、catch 边界或实际返回。
7. 两个 CSV route 的 200 runtime metadata 必须精确为 `text/csv` string，并声明 required string `Content-Disposition`；不得保留额外 `application/json`、重复声明 `Content-Type` 或改变实际 CSV bytes、文件名、查询、权限与 Header。
8. 契约测试必须覆盖本 Task 拥有的全部 61 个 operation，而不是代表性抽样；测试必须冻结 Wave 1 operation inventory，使用 Phase A 的同一纯 comparator 验证本 Task 子集为零差异，并逐项核对显式 422 指向项目 ErrorEnvelope。
9. 测试中的 domain projection 只能是 test-only 验收输入：不得向 production comparator 增加 filter，不得提交全量报告 baseline、allowlist、ignored operation/status/path 或 frozen-contract overlay。
10. 无 filter 的全局 `--response-report` 在 Phase D/E/X 未完成时允许且预期返回 1；退出 0 需要调查是否越界提前完成后续 Wave，退出 2 必须阻断。本 Task 的 61-operation 子集必须零差异。
11. 保留现有 route/HTTP sentinels，证明 ErrorEnvelope、Pydantic 422、health、AI provider 200 失败投影、文件存储 503 状态不前进和两个 CSV 实际行为不变。不得为了 metadata 绿灯修改 service、permission、CSRF、transaction、状态转换或 actual error-domain mapping。
12. 不修改 `contracts/openapi.yaml`、`frontend/src/shared/api/generated/schema.d.ts`、Makefile、CI、数据库合同或 generated client；Phase B 冻结合同是本 Task 只读 authority。
13. `getAuditLog` 及相关 configuration success schema 的 composition authority 已由 `7be5b979` 修正；本 Task 必须直接消费修正后的展平 schema，不得重引入旧 custom hook、私有 Pydantic API、硬编码 ref、runtime overlay 或 `schema_drift` 过滤。`backend/app/schemas/configuration.py` 不再属于本 Task 的必要 touch set。

## Acceptance Criteria

- [ ] Wave 1 inventory 精确为 61 个唯一 operation：foundation 2、configuration 39、identity 15、files 5；逐 operation 的 method/path/operationId/status/特殊 shape 与 `research/wave-1-operation-ownership.md` 全部一致。
- [ ] 对这 61 个 operation 投影冻结合同与 `app.openapi()` 后，`compare_response_contracts()` 返回空列表；未抽样、未忽略任何本 Task operation/status/media/header/schema。
- [ ] runtime OpenAPI 只出现一套项目 ErrorEnvelope wire schema，结构保持 `{error: {code, message, details, request_id}}`，内部四字段 required；所有本 Task 显式错误 response 复用该 model。
- [ ] 53 个有 422 的 Wave 1 operation 的 runtime 422 都是项目 ErrorEnvelope；8 个无 422 的 operation 保持无 422，不出现 `HTTPValidationError`、`4XX` 或 `default` 替代。
- [ ] `getReadyHealth` runtime metadata 为 `200/503`；`getLiveHealth` 保持仅 200；两者实际 HTTP 行为测试不变。
- [ ] `discoverAIChannelModels` 保留 502/504，`createPlatformLogoCandidate` 与 `completeFileUpload` 保留 503，`testAIModel` 不出现 502/504；全部以 Phase B 矩阵为准。
- [ ] `exportUsers` 与 `exportPlatformProfiles` 的 runtime 200 只声明 `text/csv` string 和 required string `Content-Disposition`；现有下载 HTTP sentinel 继续通过。
- [ ] ErrorEnvelope handler、非法输入 422、AI model provider 失败投影为 200、file complete storage failure 为 503 且不推进状态等既有 route/service sentinels继续通过，证明 metadata 同步未改变行为。
- [ ] 无 filter 的全局 response report 退出码恰为 1，剩余差异只属于后续 Wave/Phase X；没有 baseline、allowlist、production filter 或 overlay。
- [ ] `contracts/openapi.yaml` 与 generated client 无本 Task diff；实际 diff 不包含 service、permission、transaction、状态转换、error-domain mapping 或无关 dirty artifacts。
- [ ] runtime success schema 继续使用 authority repair 后的默认展平、closed Pydantic schema；Wave 1 diff 不重引入 custom composition hook 或旧 `allOf` 期望。
- [ ] required validation 全部通过，独立 review 没有发现漏 operation、猜测状态、第二套错误映射、行为变化或后续 Phase 越界。

## Out of Scope

- Phase D（product/content runtime metadata）。
- Phase E（publication/GEO/workbench runtime metadata）。
- Phase X（全局 `X-Request-ID` request Header、非法值 400、所有 response Header 与 login/logout 多实例 Cookie sentinel 同步）。
- Phase F（完整 comparator 默认门禁启用、删除 `successful_response()`/首个 2xx 旧路径）。
- `integrity-error-domain-mapping` 及任何数据库 `IntegrityError` 业务域归属调整。
- 修改冻结 OpenAPI、generated client、service、permission、CSRF、transaction、状态转换、实际 HTTP 状态/body/Header 或业务 error code。
- 修改 `backend/app/schemas/configuration.py` 的 schema composition、模型字段、validation、serialization、service-facing 类型或 wire payload；这些 authority 修订已由前置 Task 完成。
- frontend 页面、数据库 migration、生产环境调用、数据写入、无关 router 重构或通用错误框架。

## Review Gate

初版规划已获批准并进入实施；2026-09-02 用户明确要求在已归档 authority repair 基线上恢复。后续若还需越过 61-operation metadata、共享 ErrorEnvelope 与聚焦测试边界，必须停止并请求批准。
