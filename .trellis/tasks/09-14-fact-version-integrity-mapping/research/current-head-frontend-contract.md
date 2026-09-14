# Research: Fact Workspace current-head 前端与公共合同

- Query: 核对 `FactWorkspace` 对 `FACT_REVIEW_PENDING`、`REVISION_CONFLICT` 与 unknown 500 的错误投影、恢复和 no-replay 行为，并确认 `submitProductFactReview` 的 OpenAPI、router runtime metadata、generated schema 在 current-head 保持零结构 diff。
- Scope: mixed（内部前端、backend router/合同测试、OpenAPI/generated schema、稳定规格与业务文档）
- Date: 2026-09-14

## Findings

### 1. 公共合同基线与 current-head 证据

- `contracts/openapi.yaml:619-643` 的 `submitProductFactReview` 为 `POST /api/v1/products/{product_id}/fact-review-submissions`，operationId 为 `submitProductFactReview`，成功 201，错误状态包含 401/403/404/409/422；409 使用 `#/components/responses/ErrorResponse`。`contracts/openapi.yaml:4192-4206` 将 `ErrorEnvelope.error` 和开放 `ErrorDetail.code: string`、`message: string`、`details: object`、`request_id: string` 定义为现有 wire shape，没有 code enum，也没有稳定 500 response。
- `backend/app/routers/product_facts.py:287-310` 是唯一 submit router owner：`response_model=FactVersionOut`、`status_code=201`、`responses=error_responses(401, 403, 404, 409, 422)`，调用 `submit_fact_review_command` 后只投影 canonical `FactVersion`。`replaceProductFactsDraft` 在 `backend/app/routers/product_facts.py:220-240` 是 PUT workspace owner，不应承担 FactVersion INSERT 错误语义。
- `backend/tests/unit/test_contract.py:245-259` 把 `submitProductFactReview` 固定在 `(201, 401, 403, 404, 409, 422)` 签名；`backend/tests/unit/test_contract.py:37-98` 还固定所有 operation 的 Request-ID 参数、400 ErrorResponse、每个响应的 `X-Request-ID`，并禁止 `default`/`4XX`。因此复用 409 既有 envelope 或让 unknown IntegrityError 走默认 500 都不要求改静态合同。
- `backend/tests/unit/test_runtime_response_metadata.py:287-305` 的 runtime expected status 同样固定 `submitProductFactReview` 为 201/401/403/404/409/422；`backend/tests/unit/test_runtime_response_metadata.py:639-695` 比较 runtime 与静态合同且检查 request-context 合并不改变业务 route metadata；`:1041-1054` 固定 ErrorEnvelope required wire shape，并证明 `IntegrityError` 不在全局 exception handlers。当前两文件定向测试通过。
- `frontend/src/shared/api/generated/schema.d.ts:2450-2515` 表明 `ProductFactsDraft` 的 `available_actions` 仅为 `SAVE | SUBMIT_REVIEW`，`FactReviewSubmissionRequest` 只含 `expected_revision/change_summary`，`FactVersion` 状态/动作也是既有开放业务模型；`frontend/src/shared/api/generated/schema.d.ts:6455-6489` 的 generated `submitProductFactReview` 保持 201/400/401/403/404/409/422，ErrorDetail `code` 仍是 `string`（`:2106-2117`）。
- `frontend` `npm run api:check`（openapi-typescript 7.13.0）通过并报告“OpenAPI 类型与根合同一致”，说明 current-head `contracts/openapi.yaml` 与 generated schema 无需 diff。此项是生成比对证据，不是手工猜测。

### 2. 当前 Fact Workspace 错误投影与恢复路径

- `frontend/src/domains/product/fact-workspace.model.ts:49-65` 的 `mapFactWorkspaceError`/`mapFactReviewError` 通过 `mapProductFormError` 映射结构化 details，并仅从 `ProductRequestError.detail.code` 读取 code；没有 message 文本分支。`factWorkspaceErrorKind`（`:67-72`）只将 404/403 映射为专用初始页面状态，其他错误为 generic。
- `frontend/src/domains/product/fact-workspace-page.tsx:121-140` 在两个 mutation 前取消同一 facts query，避免旧 GET 覆盖工作区；`:145-154` 只有在没有 dirty 表单且服务端 revision 变高时才接收后台快照。`:232-239` 的 sticky actions 完全消费 `workspace.available_actions`，不从产品 status/角色推导提交资格。
- 保存 `REVISION_CONFLICT` 的现有路径在 `fact-workspace-page.tsx:164-185` 保留表单字段错误、form message 与 request ID，并仅对精确 code 设置 `conflict`；编辑器在 `:280-289` 将该 conflict 作为“重新加载最新版本”入口。`reloadCanonical`（`:212-221`）仅在用户点击 reload 且 GET 返回 canonical 数据后 reset 表单、revision、conflict 和 request ID。现有测试 `fact-workspace-page.test.tsx:176-210` 证明 SAVE 的本地正文保留、request ID 展示、显式 reload 后采用 canonical；没有 POST submit stale 的测试。
- submit 的 `REVISION_CONFLICT` 路径在 `fact-workspace-page.tsx:188-209` 只设置 page-level `conflict/requestId`，不自动调用 `onReload`；Dialog 仍由 `SubmitReviewDialog` 保持打开，符合“不自动 POST”，但当前 Dialog 的确认按钮没有“必须先 reload”闸门，因此用户可在没有点击 editor reload 的情况下再次发 POST。该 gap 需在实现阶段明确覆盖（若合同只要求 pending no-replay，也至少应证明 stale submit 不进入 pending 分支）。
- `FACT_REVIEW_PENDING` 的现有路径在 `fact-workspace-page.tsx:199-208` 精确按 `mapped.code` 触发 `onReload()`，没有把 pending 设置到 `conflict`，所以不会进入 revision-conflict 文案/编辑器分支；`SubmitReviewDialog` 在 `:434-447` 显示结构化 form message 与 request ID并保持 Dialog。`onReload` 成功后 query 的 `workspace` props 会重新由 server `available_actions` 驱动（`:232-239`），已有 `fact-workspace-page.test.tsx:266-300` 只覆盖成功提交后的 refetch 和隐藏提交按钮，不覆盖 409 pending。
- **pending 的当前缺口**：`submitReview` 的 pending catch 没有记录“pending blocker 已确认”状态，也没有关闭/锁定 Dialog；`SubmitReviewDialog` 确认按钮在 `fact-workspace-page.tsx:486-490` 只由 `submitting` 控制，因而在 pending 刷新成功、甚至刷新失败后仍可再次点击并调用 `submitProductFactReview`。这直接不满足“已存在 pending 时不得继续提供重复提交”以及“显式 reload 成功前禁止再次 POST”的冻结要求。最小修正应在 product page/Dialog owner 内保留备注和错误/request ID，同时在 pending 409 后禁止二次 POST，提供可验证的显式 reload 成功门槛，并让 reload 失败保留现场；不应改 `replaceProductFactsDraft`。
- pending 刷新失败时，`FactWorkspacePage:82-96` 仍保留 stale `facts.data`，并由 `FactWorkspaceRefreshFailure:541-550` 显示“刷新失败，已保留当前编辑内容”和重试入口；Dialog 内原 pending message/request ID仍由 `:441-446` 保留。该 stale-data 结构符合 `.trellis/spec/frontend/state-management.md:180-181,192` 的“不卸载 dirty editor/单独重试”要求，但缺少针对 pending blocker 的重复提交锁和针对 refresh 成功/失败的专门测试。
- `fact-workspace.model.ts:74-124` 的 action resolver 已显式穷尽未知 action token（`:124-126` 的 `assertNever`），服务端返回 `available_actions: ['SAVE']` 时不会生成提交按钮；当前测试 `fact-workspace.model.test.ts:27-69` 已覆盖 action token 收敛与未知 token 显式失败。实现测试应把这个已存在的服务端 action 收敛与 pending race 连接起来，而不是在浏览器自行推断 pending 状态。

### 3. unknown 500、other code 与 malformed details

- `submitProductFactReview` API wrapper `frontend/src/domains/product/product.api.ts:174-189` 只在 `result.data` 存在时返回成功，否则调用 `productRequestError`。`productRequestError:255-271` 仅当完整 ErrorEnvelope 被识别时携带 detail，否则构造 `ProductRequestError("提交事实审核失败（HTTP n）")`；因此 unknown 500 不会被 page 当成 pending 或 revision，也不会自动 reload/replay。
- `mapProductFormError:273-304` 对无 detail 的错误返回 generic form summary；对有 detail 的错误则直接读取 `error.detail.details.errors`（`:281-299`）。`isErrorEnvelope:307-320` 只验证 `code/message/request_id` 是 string，没有验证 `details` 是否存在、是否为非 null object，也没有拒绝空 request ID。
- 因此 other code 在结构合法时会显示 server message/request ID，但 page 只对精确 `REVISION_CONFLICT`、`FACT_REVIEW_PENDING`、`INVALID_STATE_TRANSITION` 分支（`fact-workspace-page.tsx:199-207`），不会按 message 猜类型；unknown 500 无 detail 时走 generic summary，不自动重试。
- **malformed details gap**：如果运行时 ErrorEnvelope 有合法 `code/message/request_id` 但 `details: null` 或缺失，`isErrorEnvelope` 仍通过，而 `mapProductFormError` 对 `null.errors` 会抛 `TypeError`，错误页/submit Dialog无法安全展示 summary。若 `request_id` 缺失，`isErrorEnvelope` 返回 false而回落 generic summary；但空字符串 request ID 会被接受，可能仍触发精确 pending 分支且不展示有效 request ID。冻结要求的“malformed details、other code 或缺少 request ID 走安全 summary fallback”尚未有 Fact Workspace 测试或完整 runtime guard。
- 最小允许前端边界优先是 `fact-workspace.model.ts` 的纯错误 projection/runtime guard 与 `fact-workspace-page.tsx` 的 pending/reload gate，再补 `fact-workspace-page.test.tsx`、`fact-workspace.model.test.ts`。`product.api.ts` 是多个 Product domain 共用的解析 owner，除非实现证明无法在 Fact Workspace projection 层安全隔离，否则不应为本任务扩展其跨页面行为；禁止按 `message`/`str(error)` 识别约束。

### 4. no-replay 与 canonical read model 证据

- SAVE 成功使用 mutation canonical response 并 reset 表单（`fact-workspace-page.tsx:169-175`）；submit 成功先关闭 Dialog、再 invalidate facts/lists/details（`:188-198`），现有测试 `:266-300` 证明停留在当前页并按 refetch 后 `available_actions` 隐藏重复提交入口。
- `reloadCanonical`（`:212-221`）是唯一显式采用最新 facts workspace 的 helper；其成功会清理 conflict/request ID并采用 `factWorkspaceValues(canonical)`，其失败当前直接 return（`:212-214`），依赖外层 query stale/error surface 保留现场。实施时必须区分“pending 409 后自动发起的 refetch”与“用户显式点击后成功采用 canonical”，并确保失败不能清掉原错误/request ID。
- 当前页面没有任何 `submitProductFactReview` retry loop、winner 查询、version 猜测或按数据库 message 解析；POST 调用只在 Dialog submit handler `:434-447` 用户事件触发。需要新增的 no-replay 证据应使用 POST 调用次数断言，而不是只断言错误文本。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:155-161` 规定 ProductFactsDraft 的 actions 来自 server、两个写入口在锁内重新校验，`REVISION_CONFLICT` 保留本地表单且只有用户显式 reload 采用 canonical；`docs/frontend-v2:157-159` 规定 POST 成功后重读 workspace actions。
- `.trellis/spec/frontend/state-management.md:154-206` 将 Product Facts 作为可编辑 workspace 基线：query stale data 不卸载 editor/DirtyGuard，available actions 由服务端返回，pending 为 `409 FACT_REVIEW_PENDING` 并刷新服务端动作，unknown/初始错误不伪造成功。该规格目前没有 exact `request_id`/no-replay/pending-refresh-failure 测试矩阵的 Fact-specific 条目，I5 实施可做最小稳定语义补充。
- `docs/frontend-v2:189-191` 已明确 Content Editor 的类似区分（`CONTENT_REVIEW_PENDING` 需显式 reload 成功前禁止再次 POST、malformed details/other code/missing request ID fallback）和 Content Review unknown 500 generic/no-replay；这些是相邻 Content domain 的参考模式，不应把 Content code 或 Content Editor owner 引入 Fact Workspace。

### 5. 现有测试覆盖与验证结果

- 已有 Fact Workspace component 测试 `frontend/src/domains/product/fact-workspace-page.test.tsx:131-344` 共 9 个场景（与 model 测试共计 12 个），覆盖 canonical save、SAVE revision conflict 显式 reload、后台 refetch 失败保留 dirty、跨产品切换、成功 submit 后 action 收敛、DirtyGuard、RETIRED read-only 与 403/404 request ID；**未覆盖** POST `FACT_REVIEW_PENDING` 409、pending 409 与 precheck/flush 合同等价、pending reload failure/success、POST no-replay、malformed details、other code、missing/empty request ID、unknown 500 generic。
- `frontend` `npm test -- --run src/domains/product/fact-workspace-page.test.tsx src/domains/product/fact-workspace.model.test.ts` 通过：2 个 test files、12 tests passed。
- `frontend` `npm run typecheck` 失败于 `frontend/src/domains/publication/publication-work-page.test.tsx:351:37`：`TS2345: Argument of type '[never, never]' is not assignable to parameter of type 'never'`。错误位于未修改的 publication 测试，与本 Fact Workspace/本研究范围无关；I5 不应修改该 publication 文件，也不应将该 optional/unrelated failure 归因于本任务。若实现不触碰该路径，不要在没有相关变更时反复运行同一失败门禁。
- `frontend` owned-file ESLint 命令 `npx eslint src/domains/product/fact-workspace-page.tsx src/domains/product/fact-workspace-page.test.tsx src/domains/product/fact-workspace.model.ts src/domains/product/fact-workspace.model.test.ts --max-warnings 0` 通过（current-head，无输出）。
- `backend` `uv run pytest tests/unit/test_contract.py tests/unit/test_runtime_response_metadata.py -q` 通过；该 gate 证明当前静态/runtime operation status、ErrorResponse/request-ID metadata 与无全局 IntegrityError handler 均未漂移，但不能代替 FactVersion 真实 PostgreSQL diagnostics/rollback 测试。
- `frontend` `npm run api:check` 通过（openapi-typescript 7.13.0），证明 generated schema 与 `contracts/openapi.yaml` 一致；当前任务默认 `contracts/openapi.yaml`、router metadata、generated schema、contract/metadata tests 均零 diff。

### 6. I5 最小实现/验证边界建议

允许修改的前端最小集合：

1. `frontend/src/domains/product/fact-workspace.model.ts`：增加面向本页的结构化错误安全投影，精确消费 `code`/有效 request ID/合法 details，不读取 message 判型；malformed details、other code、missing/empty request ID回到 generic summary。
2. `frontend/src/domains/product/fact-workspace-page.tsx`：仅补 pending error 的显式 reload/成功采用 canonical、reload 失败保留错误与 request ID、Dialog 备注保留、pending blocker 下禁止第二次 POST；保持 `REVISION_CONFLICT` 独立，不把 pending 或 unknown 500映射为 revision。
3. `frontend/src/domains/product/fact-workspace-page.test.tsx`、`frontend/src/domains/product/fact-workspace.model.test.ts`：补 exact pending message/request ID、POST 只一次、reload failure/success、canonical available_actions 隐藏提交、revision conflict 分支隔离、unknown 500 无 reload/replay、malformed/other/missing ID fallback。

不应修改：`frontend/src/domains/product/product.api.ts`（除非证据证明共享解析 owner 必须修复且取得跨页面范围批准）、`frontend/src/shared/api/generated/schema.d.ts`、`contracts/openapi.yaml`、`backend/app/routers/product_facts.py`、`backend/tests/unit/test_contract.py`、`backend/tests/unit/test_runtime_response_metadata.py`、数据库 schema/migration、`replaceProductFactsDraft` owner，以及 Content/Publication/GEO 文件。

后端/HTTP 侧由主 implementation 任务增加真实 PostgreSQL exact diagnostics 和事务证据；前端只能验证结构化响应投影，不应 mock database `IntegrityError` 作为最终证据。required 前端命令建议：

```bash
cd frontend && npm test -- --run src/domains/product/fact-workspace-page.test.tsx src/domains/product/fact-workspace.model.test.ts
cd frontend && npm run typecheck  # 若仍命中未修改的 publication TS2345，记录并停止归因
cd frontend && npm run lint -- --quiet  # 或项目约定的 owned-file ESLint 精确命令
```

### 7. Files found

- `frontend/src/domains/product/fact-workspace-page.tsx`：Fact Workspace query、表单、保存/提交 mutation、错误恢复、Dialog 与 action presentation owner。
- `frontend/src/domains/product/fact-workspace-page.test.tsx`：当前 9 个 component 场景；无 POST pending/unknown 500 regression。
- `frontend/src/domains/product/fact-workspace.model.ts`：Fact 表单 schema、错误映射和 server action token resolver。
- `frontend/src/domains/product/fact-workspace.model.test.ts`：表单 payload、actions、未知 token 测试；无错误 projection matrix。
- `frontend/src/domains/product/product.api.ts:30-39,157-189,255-320`：ProductRequestError、facts mutation wrapper、ErrorEnvelope runtime guard 与共享 details 映射。
- `frontend/src/shared/api/generated/schema.d.ts:2106-2117,2450-2515,6455-6489`：ErrorDetail、Fact workspace/submit payload/FactVersion 与 operation responses。
- `backend/app/routers/product_facts.py:220-240,287-310`：`replaceProductFactsDraft` 与 `submitProductFactReview` router owners/metadata。
- `backend/tests/unit/test_contract.py:37-98,245-259`：静态 OpenAPI metadata、operation response status/signature。
- `backend/tests/unit/test_runtime_response_metadata.py:287-305,639-695,1041-1054`：runtime status/contract parity、ErrorEnvelope 与无全局 IntegrityError handler。
- `contracts/openapi.yaml:619-643,4192-4206`：submit operation、ErrorEnvelope/ErrorDetail schema。
- `.trellis/spec/frontend/state-management.md:154-206`：Product Facts workspace state、pending/revision/refetch 错误矩阵及 required tests。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:155-161,187-191`：ProductFactsDraft、Content Editor pending/unknown 500 参考合同。
- `.trellis/tasks/09-05-content-integrity-error-contract-decision/prd.md`、`design.md`、`implement.md`：T4-C 已批准决策、五个 implementation split 与 I5 required validation；相关 `research/contract-decision-matrix.md` 与 `research/fact-version-integrity.md`：FactVersion owner/分类/合同基线。

## External references

- 未使用外部资料；本研究只依赖 current-head 代码、OpenAPI/generated 类型、Trellis 稳定规格和已批准 T4-C research。PostgreSQL `23505`/diagnostics 的外部证据已在 `.trellis/tasks/09-05-content-integrity-error-contract-decision/research/fact-version-integrity.md` 记录，本文件不重复扩展。

## Related specs

- `.trellis/spec/frontend/state-management.md:154-206`：workspace server state、动作 token、pending/revision/refresh error handling。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md:155-161,189-191`：Product Facts 与相邻 Content pending/unknown 500 前端合同。
- `.trellis/spec/backend/error-handling.md`：unknown IntegrityError/default 500 与结构化 ErrorEnvelope 规则（本研究只核对其前端可见边界）。
- `.trellis/spec/backend/database-guidelines.md`：FactVersion Product lock、pending 唯一性与不可变状态约束（本研究未修改）。
- `contracts/openapi.yaml:619-643,4192-4206`：HTTP operation、ErrorResponse 与开放 ErrorDetail code。

## Caveats / Not Found

- 研究未实施生产代码、未修改任何 contracts/generated/spec/test 文件；没有真实 PostgreSQL catalog/constraint diagnostics 或事务 rollback evidence。I5 必须补 `uq_fact_versions_product_id` 与 `uq_fact_versions_one_pending_per_product` 的真实 catalog/`orig.diag.constraint_name`、exact/negative classifier、两个 Session race、rollback/session reuse 和 HTTP no-leak 证据。
- 当前 `isErrorEnvelope`/`mapProductFormError` 的 malformed-details 行为是基于代码路径审计发现，尚无 regression test；尤其 `details: null` 会在 `mapProductFormError:282` 触发运行时异常，需由 implementation 先加纯 projection guard 再补测试。
- “pending 409 后发起的 onReload”当前是自动 refetch；冻结要求还需在实现设计中明确是先自动刷新并锁定 Dialog，还是必须由用户点击显式 reload，但两种方案均必须在 reload 成功前禁止 POST、成功后采用 server `available_actions`，失败时保留原 pending message/request ID 与安全草稿。不能把按钮隐藏当安全控制，server `submit_fact_review` 仍需按 Product lock/pending precheck/精确 diagnostics 最终裁决。
- `api:check` 只证明 OpenAPI/generated schema 一致，不证明 HTTP response body/header 在真实 request 中的具体值；后端 pending 409 integration test 仍须断言 `error.request_id == X-Request-ID`、`details == {}`、status/code/message 与 precheck path 等价。
- frontend typecheck 的 publication TS2345 当前是既有、未修改且与本任务无关的环境/测试阻断；不修改、不归因、不重复无关门禁。
