# Research: prior-task-evidence

- Query: 梳理前置 Trellis 任务对 IntegrityError 领域映射、409 合同/门禁、operationId 范围、前端恢复语义、已完成工作与遗留缺口的约束。
- Scope: internal
- Date: 2026-09-04

## Findings

### 1. 当前任务的历史定位与不可重复工作

`08-30-frontend-v2-functional-contract-conformance-baseline` 是只读审计/规划任务，不是实现授权。其最终快照确认 37 条 canonical route 仍存在、冻结 OpenAPI/runtime/generated client 的完整 response contract 已由独立任务收敛，但明确保留了未实施项；`integrity-error-domain-mapping` 在收尾时仍“暂缓、未创建、未启动”（`.trellis/tasks/archive/2026-09/08-30-frontend-v2-functional-contract-conformance-baseline/prd.md:5,9-11,66-76`；`research/route-conformance-matrix.md:9-25`）。

基线的逐路由之外缺口表是本任务的直接历史依据：全局 `IntegrityError` 被 `backend/app/errors.py` 伪装成 `REVISION_CONFLICT`，会使客户端错误地走“刷新 revision”恢复，且隐藏唯一键、外键、CHECK 等真实业务原因；该项列为 P1、唯一后续 Task 为 `integrity-error-domain-mapping`（`research/route-conformance-matrix.md:111-120`）。依赖表把它标为 3F，目标是“已知 constraint 在 service owner 映射，未知显式失败”，建议在 3E 新门禁之后接入但明确“不与 3E 合并”（`research/route-conformance-matrix.md:159-178`）。

因此本任务禁止重复完成以下历史工作：37-route 前端基线审计、OpenAPI/generated/runtime response parity、non-2xx comparator 算法及其默认门禁接线、Wave 1/2/3 runtime metadata、GEO schema identity、Phase X request metadata、以及 Publication event-time 修复。这些任务已归档为 completed 或作为独立前置修复完成；当前只应在真实业务/service owner 处解决异常分类与显式失败语义。

### 2. 409 与 IntegrityError 的权威边界

历史 authority audit 没有把“访问数据库”当作 409 证据。409 的允许来源是 revision/state/idempotency/context、`in_use()` 以及已确认的 `IntegrityError` 路径；必须由逐 operation 的 route/dependency/service/provider/storage 调用链证明，不能为所有数据库 operation 补 409（`.trellis/tasks/archive/2026-09/08-31-non-2xx-contract-check/research/route-response-authority-audit.md:14-24`）。同一文件明确记载：全局 IntegrityError handler 不足以证明每个数据库 operation 都稳定返回 409；普通异常、第三方异常和理论 500 均不得猜测性加入合同（`:50-63`）。

Frozen authority matrix 的 verifier 也把这一规则写成可执行约束：404/409 的实际 evidence 不能指向通用 `backend/app/errors.py` 构造器，而必须指向真实 endpoint/service owner（`.trellis/tasks/archive/2026-09/09-01-frozen-contract-authority-reconciliation/research/verify_authority_matrix.py:297-312`）；矩阵状态必须逐 operation 与当前 route/dependency/service 调用图一致（`:901-968`）。因此本任务的映射 owner 应靠近产生约束语义的 service/command，而不是在通用错误 handler 中按异常类型统一猜测。

`08-31` 的最终设计进一步冻结：统一 `AppError`/`ErrorEnvelope` 仍是运行时错误信封 owner，不能新建第二套业务错误类型、错误码 registry 或异常层级；共享 metadata helper 只能复用 wire shape，不能批量生成 401/403/404/409（`.trellis/tasks/archive/2026-09/08-31-non-2xx-contract-check/research/route-response-authority-audit.md:50-57`；`design.md:9-24,116-158`）。当真正的 HTTP status、业务 error code、权限或异常映射需要改变时，必须拆成独立业务/合同 Task，而不是藏在 response gate 中（`prd.md:32-46,94-100`）。

### 3. 需纳入审查的 operationId 集合

最终 Phase B matrix 是 162 operation 的静态、runtime 与矩阵身份闭集（`authority-matrix-validation.json:260-263`；`verify_authority_matrix.py:909-923`）。其中 `phase_b_statuses` 含 409 的 operation 共 106 个；以下列表从 `final-response-authority-matrix.jsonl` 的逐 operation 行（各行同时给出 409 的 service/route evidence）读取，不能被理解为“每个 operation 都实际会由 IntegrityError 触发”：

- AI/config（matrix `:4-24`）：`deleteAIChannelHeader`、`updateAIChannelHeader`、`deleteAIChannel`、`updateAIChannel`、`replaceAIChannelApiKey`、`disableAIChannel`、`discoverAIChannelModels`、`enableAIChannel`、`createAIChannelHeader`、`deleteAIModel`、`updateAIModel`、`disableAIModel`、`enableAIModel`、`testAIModel`。
- Audit/content（matrix `:27-65`）：`getAuditLog`、`putContentHumanizationPrompt`、`createContentTask`、`deleteContentTask`、`archiveContentTask`、`cancelContentTask`、`getContentEditorContext`、`createGenerationJob`、`getContentTaskGenerationOptions`、`createManualContentVersion`、`permanentlyDeleteContentTask`、`getContentTaskPermanentDeletionPreview`、`restoreContentTask`、`getContentTaskReviewContext`、`deleteContentDraft`、`updateContentDraft`、`abandonContentVersion`、`approveContentVersion`、`getContentVersionDetail`、`createHumanizationJob`、`getPublicationPackage`、`requestContentVersionChanges`、`getContentReviewContext`、`createContentRevision`、`submitContentVersion`。
- Facts/files/generation/GEO（matrix `:67-90`）：`deleteFactVersion`、`approveFactVersion`、`requestFactVersionChanges`、`retireFactVersion`、`abortFileUpload`、`completeFileUpload`、`getFileDownloadUrl`、`retryGenerationJob`、`getGeoInsights`、`createGeoOptimizationContentTask`、`listGeoObservations`、`createGeoObservation`、`listGeoObservationItems`、`deleteGeoObservation`、`getGeoObservation`、`getGeoObservationCorrectionContext`、`getGeoObservationDetail`。
- Platform/configuration（matrix `:92-115`）：`createPlatformAccount`、`deletePlatformAccount`、`updatePlatformAccount`、`disablePlatformAccount`、`enablePlatformAccount`、`createPlatformLogoCandidate`、`createPlatformProfile`、`deletePlatformProfile`、`updatePlatformProfile`、`disablePlatformProfile`、`enablePlatformProfile`、`createPlatformPrompt`、`deletePlatformPrompt`、`updatePlatformPrompt`、`createPlatformType`、`deletePlatformType`、`updatePlatformType`。
- Product/publication（matrix `:117-150`）：`createProduct`、`deleteProduct`、`updateProduct`、`submitProductFactReview`、`replaceProductFactsDraft`、`listPublicationWorks`、`createPublicationWork`、`getPublicationWork`、`closePublicationWork`、`switchPublicationContentVersion`、`markPublicationPlatformReview`、`updatePublicationPreparation`、`registerPublicationResult`、`verifyPublicationWork`、`getPublicationWorkspaceContext`、`listPublishedArticles`、`getPublishedArticle`、`openPublishedContentIssue`、`permanentlyDeletePublishedArticle`、`previewPublishedArticlePermanentDeletion`、`listPublishedContentIssues`、`getPublishedContentIssue`、`getPublishedContentRepairContext`、`createPublishedContentRepairTask`、`resolvePublishedContentIssue`、`getPublishedContentIssueWorkspaceContext`。
- Topic/user/workbench（matrix `:154-163`）：`deleteQueryTopic`、`updateQueryTopic`、`createUser`、`deleteUser`、`updateUser`、`resetUserPassword`、`getWorkbench`。

Matrix 的逐行 409 evidence 还表明，许多 409 是显式 state/revision/context/in-use owner，而不一定是 IntegrityError。例如 publication 命令集中由 `_lock_work` 证实（matrix `:130-139`，evidence `backend/app/services/publication.py:462`），用户更新/删除由 identity service 证实（`:157,160-162`），而 `getAuditLog` 的 409 来自 `_projection_failed`（`:27`）。实现时须逐 owner 区分这些既有语义，不能把它们都归入新的数据库约束映射。

### 4. Response contract gate 已完成，不能再次实现或改变业务映射

`08-31-non-2xx-contract-check` 最终状态已完成：162 operation、1023 response occurrence、完整 status/media/schema/header comparator 已激活；`check()` 只调用唯一完整 comparator，`successful_response()`、首个 2xx shortcut 与 `--response-report` 已删除（`.trellis/tasks/archive/2026-09/08-31-non-2xx-contract-check/prd.md:9-17`）。Phase F 的最终验证包括 `make contract-check`、backend checker/unit、Ruff/mypy、frontend `api:check` 及旧符号扫描，均通过；并且明确不重新增加 report-only 实现（`.trellis/tasks/archive/2026-09/09-03-complete-response-contract-gate-activation/implement.md:80-88`）。

该 gate 的职责是检测 contract drift，不是决定业务错误映射。其要求是逐 status 比较、非 2xx schema/header/body 机器语义比较、fail-closed diagnostics、无 allowlist/baseline/filter/默认 ErrorResponse 覆盖（`08-31-non-2xx-contract-check/prd.md:32-46,75-92`；`09-03-complete-response-contract-gate-activation/design.md:49-68,93-123`）。任何 status、error code 或异常映射变化都属于本独立任务或另一个业务任务；不要修改 `backend/app/tools/contract_check.py`、OpenAPI、generated client、runtime metadata、Makefile/CI 或 frontend checker 以“顺便”解决 IntegrityError（`09-03-complete-response-contract-gate-activation/prd.md:56-63`）。

特别需要保留的 response 事实：统一 `ErrorEnvelope.error` 的 `code/message/details/request_id` 由 `error_response()` 产生，`details` 是实际必填；普通未处理异常的 500 没有稳定业务 code/shape，历史任务拒绝猜测性纳入（`08-31-non-2xx-contract-check/research/route-response-authority-audit.md:38-48`）。这意味着未知约束不能静默变成 `REVISION_CONFLICT`，也不能为了让 response parity 通过而强行宣称一个新的稳定 409 code；删除错误 handler 后应恢复框架默认 500，并仅固定 status 与不泄漏边界。若未来需要稳定 JSON 500，再由独立 contract-first Task 同步相关合同。

### 5. 前端恢复语义与本任务的边界

前端基线规定：服务端 `available_actions`、workflow/primary/deletion/revision projection 是资格和状态唯一来源；隐藏按钮不是安全控制。409 mutation 的标准语义是保留本地内容/草稿，显式重新 GET canonical state，再由用户判断，禁止盲目 replay；该规则覆盖事实、内容、配置、草稿、用户等更新/删除（`.trellis/tasks/archive/2026-09/08-30-frontend-v2-functional-contract-conformance-baseline/research/route-conformance-matrix.md:61-73,79-105,108`；`08-30-v2-live-readonly-acceptance/research/authenticated-readonly-scope.md:170-190`）。

已关闭的 Content Editor `SUBMIT_REVIEW` 冲突恢复统一为 conflict owner，只有显式 reload 成功才采用 canonical context；保存/删除/放弃冲突则保留 dirty 内容并显式 reload（`route-conformance-matrix.md:18,71`）。GEO correction 的 409 要显式 reload 并在 dirty guard 下替换 canonical context；GEO publications changed 要保留输入（`:91-94`）。Publication workspace 的 stale 409 要显式 reload；其 verification/event/PublishedArticle 是 append-only immutable history（`:79-84`）。

因此 IntegrityError 映射不能把未知约束编码成客户端可恢复的 `REVISION_CONFLICT`。若某个已知唯一/外键/检查约束确实是可解释的业务冲突，必须由对应 service owner 映射到既有、准确的 error code/status/details；只有该明确 code 被客户端约定为可恢复时，才可走对应的保留本地输入、重新获取、人工判断路径。未知约束、数据库故障或不能安全分类的异常必须显式失败，不能触发错误的 revision refresh、重试或自动登录。

### 6. Live readonly acceptance 的历史结论不能被改写

`08-30-v2-live-readonly-acceptance` 最终结果仍是 `FAIL`，Query Topic 列表 GET 422 被实际观察两次；该任务没有因后续 contract checker 或其他修复而改写状态（`.trellis/tasks/archive/2026-09/08-30-v2-live-readonly-acceptance/prd.md:121-153`；`research/authenticated-readonly-final-summary.md:3-24,36-40`）。认证审计要求 401/403/CSRF 失败停止，不自动重登录；409/未知 blocker 不盲目 replay（`prd.md:75-109`；`research/authenticated-readonly-resume-summary.md:18-36`）。Wave 3 只执行过低风险 TEST 对象闭环，Publication/GEO/AI/正式发布/永久删除等高风险流程保持 BLOCKED/NOT_RUN，不能由本任务顺便启动（`research/wave3-business-execution-summary.md:3-32`；`research/wave4-risk-matrix.md:3-22`）。

### 7. 相关并发/事件时间决策

独立的 Publication event-time task 证明 `_work_event` 是唯一生产 writer，Work 行锁后从 PostgreSQL `clock_timestamp()` 取候选时间，并保留 `latest_created_at + 1µs` 单调下限；其 HTTP 409 `INVALID_STATE_TRANSITION` 与零副作用必须保持不变（`.trellis/tasks/archive/2026-09/09-02-publication-event-time-order-authority-repair/prd.md:17-46,63-73`；`design.md:20-30,58-84`；`research/validation-results.md:3-20`）。这项历史决策说明：并发/state 409 与 IntegrityError 不能混为一个泛化异常；本任务若触及 publication service，只能保留已有锁、状态和错误路径，不能改变事件顺序或错误合同。

## Related Specs

- `.trellis/workflow.md`：研究输出必须落在当前 Task 的 `research/`；研究角色不读取 `implement.jsonl`/`check.jsonl`。
- `.trellis/spec/backend/error-handling.md`（被 `08-31` research 引用）：`AppError`、`ErrorEnvelope`、409/422 映射与合同检查边界。
- `.trellis/spec/backend/quality-guidelines.md`、`.trellis/spec/guides/cross-layer-thinking-guide.md`、`.trellis/spec/guides/code-reuse-thinking-guide.md`：跨层 source metadata/runtime behavior/boundary sentinel 分层，复用现有错误 owner，不复制比较器或引入第二错误类型系统。
- `.trellis/spec/backend/publication-workbench-guidelines.md`：Publication lock、事件顺序与既有 409 状态边界（事件时间 task `research/root-cause-and-authority.md:109-114` 引用）。

## Files Found

以下为本次实际完整读取的任务文档/研究材料（`implement.jsonl`、`check.jsonl` 按 researcher 角色隔离规则未读取）：

- `.trellis/workflow.md`：Trellis 阶段与研究工件规则。
- `.trellis/tasks/archive/2026-09/08-30-frontend-v2-functional-contract-conformance-baseline/prd.md`、`design.md`、`implement.md`、`research/route-conformance-matrix.md`、`task.json`：37-route 基线、独立缺口与依赖顺序。
- `.trellis/tasks/archive/2026-09/08-31-non-2xx-contract-check/prd.md`、`design.md`、`implement.md`、`research/response-drift-classification.md`、`research/route-response-authority-audit.md`、`task.json`：完整 response gate、错误来源和 out-of-scope。
- `.trellis/tasks/archive/2026-09/08-31-response-comparator-core/prd.md`、`design.md`、`implement.md`、`task.json`：纯 comparator core 与 mutation 边界。
- `.trellis/tasks/archive/2026-09/09-01-frozen-contract-authority-reconciliation/prd.md`、`design.md`、`implement.md`、`research/authority-matrix-validation.json`、`research/final-response-authority-matrix.jsonl`、`research/verify_authority_matrix.py`、`task.json`：162 operation authority matrix、逐 status owner 与 fail-closed verifier。
- `.trellis/tasks/archive/2026-09/09-01-runtime-response-metadata-wave-1/prd.md`、`design.md`、`implement.md`、`research/wave-1-operation-ownership.md`、`task.json`：foundation/config/identity/files metadata wave。
- `.trellis/tasks/archive/2026-09/09-02-response-schema-composition-authority-repair/prd.md`、`design.md`、`implement.md`、`research/allof-authority-defect.md`、`task.json`：response schema composition/static authority 修复。
- `.trellis/tasks/archive/2026-09/09-02-runtime-response-metadata-wave-2/prd.md`、`design.md`、`implement.md`、`research/wave-2-operation-ownership.md`、`research/validation-results.md`、`task.json`：product/content/planning/production metadata wave。
- `.trellis/tasks/archive/2026-09/09-02-runtime-response-metadata-wave-3/prd.md`、`design.md`、`implement.md`、`research/wave-3-operation-ownership.md`、`research/baseline-touch-set.md`、`task.json`：publication/GEO/workbench metadata wave。
- `.trellis/tasks/archive/2026-09/09-02-geo-response-schema-identity-repair/prd.md`、`design.md`、`implement.md`、`research/schema-identity-audit.md`、`research/baseline-touch-set.md`、`task.json`：GEO runtime component identity 修复。
- `.trellis/tasks/archive/2026-09/09-02-cross-cutting-request-context-metadata/prd.md`、`design.md`、`implement.md`、`research/request-context-authority-audit.md`、`research/generated-client-cookie-and-isolation-audit.md`、`task.json`：X-Request-ID/400/response header metadata。
- `.trellis/tasks/archive/2026-09/09-03-complete-response-contract-gate-activation/prd.md`、`design.md`、`implement.md`、`research/checker-call-chain.md`、`research/current-zero-drift-baseline.md`、`research/integration-history-audit.md`、`research/test-mutation-matrix.md`、`task.json`：Phase F 默认门禁激活与最终 zero-drift。
- `.trellis/tasks/archive/2026-09/08-30-v2-live-readonly-acceptance/prd.md`、`design.md`、`implement.md`、`research/authenticated-readonly-execution-summary.md`、`research/authenticated-readonly-final-summary.md`、`research/authenticated-readonly-resume-summary.md`、`research/authenticated-readonly-scope.md`、`research/current-environment-baseline.md`、`research/live-readonly-execution-summary.md`、`research/staging-runtime-identity-gate.md`、`research/wave3-business-execution-summary.md`、`research/wave3-reversible-business-scope.md`、`research/wave4-risk-matrix.md`、`task.json`：线上只读/低风险测试结果、409 恢复和高风险停止条件。
- `.trellis/tasks/archive/2026-09/09-02-publication-event-time-order-authority-repair/prd.md`、`design.md`、`implement.md`、`research/root-cause-and-authority.md`、`research/baseline-touch-set.md`、`research/validation-results.md`、`task.json`：与 409/state 并发边界相关的独立 Publication 前置修复。

## Caveats / Not Found

- 未读取任何 `implement.jsonl` 或 `check.jsonl`，这是 Trellis researcher 角色隔离要求；本文件依据可读的 prd/design/implement/research/task.json 及已归档的静态证据。
- `final-response-authority-matrix.jsonl` 的 106 个 409 是 Phase B 合同/调用链状态集合，不是 106 个已被真实数据库 IntegrityError 触发的样本；历史材料没有给出完整的 constraint-name→operationId 映射表。实施前必须从当前 service owner、数据库约束定义和真实 targeted regression 建立该映射，未知约束不得猜测。
- `08-31` 的历史 authority matrix 记录基于其 source revision，且当时工作树可包含并行 dirty 状态；不要把历史 evidence 的行号或 hash 当成当前代码未变化的证明。当前任务应由主 agent 对实际 diff 和当前源码重新验证。
- 历史线上验收包含公开环境的失败/阻断证据，但没有授权本任务重新访问公网、执行业务写入或修改前端；这些状态必须保留，不应被本任务的 backend 错误映射工作改写。
- 本研究没有修改代码、合同、spec、归档任务或 Git；唯一写入是当前任务的本 research 文件。
