# Research: Content Editor / Review 的 review state 错误恢复证据

- Query: 核对 `CONTENT_REVIEW_PENDING` 的实际前端 consumer、纯错误投影、Dialog 与 canonical context 恢复状态，以及 `uq_content_versions_one_approved_per_task` unknown 500 在 Content Review Page 的对照行为。
- Scope: internal
- Date: 2026-09-14

## Findings

### 1. 阅读范围与公共合同基线

已完整读取本研究指定的两个页面、三个页面测试/模型测试文件、生成 schema、Frontend V2 业务动作文档与前端状态规范：

- `frontend/src/domains/content/content-editor-page.tsx`：Content Editor 查询、表单、提交 Dialog、错误/冲突和 reload 状态 owner。
- `frontend/src/domains/content/content-editor-page.test.tsx`：Editor loading、mutation、revision conflict、后台 canonical 冻结、reload failure/success、普通 5xx 回归。
- `frontend/src/domains/content/content-editor.model.ts`：表单 schema、动作投影和 `mapContentEditorError`。
- `frontend/src/domains/content/content-editor.model.test.ts`：当前 Editor domain model 的基础动作/表单/payload 单元测试。
- `frontend/src/domains/content/content-review-page.tsx`：Review context、approve/request-changes mutation 与错误处理。
- `frontend/src/domains/content/content-review-page.test.tsx`：Review context、成功 approve/request-changes、409 和初始读取失败测试。
- `frontend/src/shared/api/generated/schema.d.ts`：`ErrorDetail`、两个 command operation 及 ErrorResponse。
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`、`.trellis/spec/frontend/state-management.md`：Content Editor/Review 的状态与恢复约束。

生成 schema 仍显示 `ErrorDetail.code: string`、`details: {[key: string]: unknown}`、必需 `request_id`（`frontend/src/shared/api/generated/schema.d.ts:2106-2117`）；`submitContentVersion` 和 `approveContentVersion` 都已经声明 `409: ErrorResponse`，且没有稳定 500 response（`:9070-9091,9116-9137`）。因此该前端任务不需要新增全局 code enum、修改 OpenAPI 或重新生成 schema。

相关稳定规则如下：前端必须基于 `code` 做 UX、不得解析 message（`docs/frontend-v2/05-business-actions-state-and-api-contract.md:291-297`）；Editor 的 409 保留本地表单，只允许显式 reload（`:181-189`）；Editor 的表单/Tab/Dialog 属于页面本地状态，TanStack Query 持有 server context（`.trellis/spec/frontend/state-management.md:19-30,231-237`）；Review 只消费顶层 `available_actions`，409 保留意见/request ID、刷新 Context 且禁止 replay（`.trellis/spec/frontend/state-management.md:445-497`）。

### 2. `CONTENT_REVIEW_PENDING` 的实际 consumer 是 Content Editor

`submitContentVersion` 由 Editor 的 `submit` mutation 调用（`content-editor-page.tsx:194-199`），而 Content Review Page 只创建 `approve` 与 `requestChanges` 两个 mutation（`content-review-page.tsx:108-121`）。因此 pending partial unique 的错误不会由 Review Page 的退回意见 Dialog 消费，真正的 UI owner 是 Editor 的“提交内容审核” Dialog（`content-editor-page.tsx:458-477,780-844`）。

Editor 现有的提交 Dialog 已具备所需输入保留基础：`comment` 是 Dialog 内本地 state，提交按钮只在 `submitting` 或 `conflict` 时禁用，成功才由父级关闭 Dialog（`content-editor-page.tsx:799-840`；成功路径 `:297-303`）。已有测试证明 submit-review 的 `REVISION_CONFLICT` 会保留备注、code、message、request ID，且 Dialog 保持打开（`content-editor-page.test.tsx:355-382`）。

结论：实现时必须把精确的 `CONTENT_REVIEW_PENDING` 投影到 Editor 的独立 pending blocker；不得把它送入 Review Page，也不得把它显示成 revision conflict。Review Page 不应承担该 code 的 UI 语义。

### 3. Editor 当前状态 owner 与可复用的恢复骨架

当前 Editor 以页面 `conflict` state 保存 `{code, message, requestId?}`（`content-editor-page.tsx:62-66,78-94`）。进入 conflict 时会取消 exact `contentKeys.editorContext(taskId)` 在途查询（`:88-94`）；query 同时被 `enabled: !conflict` 和 `refetchOnWindowFocus: conflict ? false : ...` 阻断（`:80-86`）。这正好提供“pending conflict 后暂停背景 canonical context 自动采用”的状态 owner，不需要全局 store。

`reloadContext` 只通过用户触发的 `context.refetch()` 读取同一个 Editor Context，并要求有数据才返回；失败抛出原始请求错误（`content-editor-page.tsx:96-102`）。`reloadCanonical` 只有 reload 成功后才 reset 表单、base revision、mode、Dialog 和 conflict；失败只写入“重新加载失败，当前冲突与本地输入保持不变”，不清除 conflict（`:322-338`）。`ContentEditorConflictNotice` 从结构化错误显示 code/message/request ID 和 reload failure，reload 按钮在 fetching 时禁用（`:875-920`）。这些行已经满足“失败保留输入/错误/request ID、成功后才采用 canonical、不自动 replay”的恢复形状。

背景 canonical 采用也有明确守卫：`useEffect` 在 `conflict || isDirty` 时直接返回，只有无冲突且无本地 dirty、且服务端 revision 更高时才 reset 表单并更新 baseline（`content-editor-page.tsx:219-229`）。因此 pending blocker 必须进入该同一冻结状态；不能只设置一个独立提示而让 query/background effect 继续覆盖表单。

### 4. 当前错误投影存在的精确缺口

`mapContentEditorError` 当前返回字段错误、form message、request ID 和开放 `code`（`content-editor.model.ts:136-183`），但没有任何 review-pending 专用纯投影。它还直接读取 `error.detail.details.errors`（`:150-153`），因此 `details` 缺失或非对象时可能产生客户端异常；实现必须先做运行时结构守卫，再把 malformed details 当作 form-level fallback，不得通过 message 推断类型。

页面的 `applyMappedMutationError` 只有 `mapped.code === 'REVISION_CONFLICT'` 分支（`content-editor-page.tsx:246-263`）。`submitReview` 更窄：只有 `REVISION_CONFLICT` 交给统一 conflict UI，其他 code 直接 rethrow（`:297-307`）。于是当前 pending code 会落到 `SubmitContentDialog` 的本地 generic `error` catch（`:801-808`），不会保留结构化 code 的独立 blocker 语义，也不会暂停背景 canonical context。

现有冲突展示标题硬编码为“检测到 revision 冲突”（`:896-899`），sticky action 的 blocked reason 也硬编码为“请先重新加载服务端最新版本”（`:684-743`）。因此建议把当前 `ContentEditorConflict` 扩展为带稳定 kind 的 blocker 投影（例如区分 `revision` 与 `content-review-pending`），让 UI 按 kind 显示 pending blocker；保持 `code`、`message`、可选 `requestId` 原样投影。只有 exact `code === 'CONTENT_REVIEW_PENDING'` 才能成为该 kind；`REVISION_CONFLICT` 仍只代表 expected revision stale，其他 code（包括 malformed details、缺 request ID、普通 500）不得进入该分支。

为避免 Dialog 的本地 catch 抹掉结构化状态，submit-review 的 pending 分支应由父级把映射结果写入 blocker state，同时让 Dialog 保持 open；不应自动再调用 `submitContentVersion`。reload 失败继续由现有 `refreshError` 渲染，并保留 Dialog comment/blocker；reload 成功后才允许 reset canonical context、解除 blocker，不 replay 原 POST。

### 5. 已有 Editor 测试覆盖与新增缺口

现有测试已经提供可靠的回归基线：

- 保存时 `REVISION_CONFLICT` 保留本地 title/request ID，只有点击“重新加载最新版本”才采用 server context（`content-editor-page.test.tsx:330-353`）。
- submit-review `REVISION_CONFLICT` 保留 Dialog 备注、code、message、request ID，按钮禁用且只发一次 POST（`:355-382`）。
- conflict 后的 focus/background refresh 不会自动 GET；首次显式 reload 失败仍保留备注和正文，第二次成功才采用 canonical title/body/mode，且 POST 仍只有一次（`:384-450`）。
- 取消 Dialog 只关闭 Dialog，页面 conflict 和 reload 入口仍保留，焦点回到稳定 heading（`:452-474`）。
- submit-review 的 401/403/404/422/500 都走 Dialog 普通错误路径，当前 500 不进入 revision conflict reload 分支（`:476-504`）。

当前 `content-editor.model.test.ts` 没有 `mapContentEditorError` 的测试（文件只覆盖 editorMode、payload、action keys，`:96-161`），所以必须补纯投影矩阵，至少覆盖：

1. `ContentRequestError` + `detail.code === 'CONTENT_REVIEW_PENDING'` + `details: {}`：返回独立 pending kind、原 message、原 request ID，且不返回 revision kind。
2. 同 code 但 `details` 缺失、`errors` 非数组、issue 形状 malformed、缺 request ID：不抛客户端异常，不定位字段；保留 form message/code，request ID 缺失时不伪造。
3. `REVISION_CONFLICT`：仍只返回 revision kind/路径；其他 code、普通 Error、无 detail：generic form error，不进入任何 reload 专用分支。
4. code 匹配必须只用 code；message 改为任意文本不能改变投影结果。

组件测试应在现有 `:355-450` 基础上新增：填入审核备注后返回 exact `CONTENT_REVIEW_PENDING`，断言 Dialog 仍打开、备注/code/request ID/message 保留、页面不显示 revision 文案、不发生第二次 POST；触发窗口 focus 或 query invalidation 也不自动 GET。随后让第一次显式 reload 返回 generic failure，断言 canonical title/body、备注、pending code 和两个 request ID 都保留；第二次 reload 成功才采用新的 canonical context、解除 blocker、更新 action/mode，并断言 POST 仍为一次。

还应覆盖缺 request ID 与 malformed details 的可见 fallback（只显示可用的 form message/code，不显示伪造 ID），以及成功 submit 的既有回归（`:506-546`）。

### 6. Content Review Page 的 approved unknown 500 对照

Review Page 的命令错误 owner 在 `handleCommandError`：它先调用 `mapContentReviewCommandError` 设置 `commandError/requestId`，只有 `error instanceof ContentRequestError && error.status === 409` 才标记 context stale 并 `onRefresh()`（`content-review-page.tsx:145-154`）。因此 approved partial unique 的 unknown 500 当前不会触发 revision reload，也不会自动再次 approve；`approveTarget` 只在 mutation 成功时调用 `acceptCanonical`，失败仅处理错误（`:156-163`）。这是符合冻结合同的现有控制流。

Review 页面目前没有 approve 失败 500 测试：成功 approve 仅覆盖 canonical POST、第二次 GET、动作消失（`content-review-page.test.tsx:270-301`），409 测试覆盖的是 request-changes（`:350-375`）。建议增加一个 approve exact unknown-500 sentinel：首个 GET 成功，approve POST 返回不含数据库细节的普通 500/无稳定 ErrorEnvelope，断言 GET 仍只调用一次、POST 恰好一次、显示 generic server failure/request ID（若框架提供）、不出现 context stale/reload 专用 UI、不产生第二次 POST，也不采用其他 approved version。测试不应冻结默认 500 body/code/media type，且不应要求 500 具备稳定 request ID；若测试使用带 `ErrorEnvelope` 的模拟，只能验证它仍按 generic message 处理而非 revision 分支。

按当前证据，`content-review-page.tsx` 无需 production 修改；除非实现后的最小回归证明现有 generic failure copy 不满足“generic server failure”可见语义，才作局部文案/错误投影调整。不要为 approved unknown 500 增加新的 code、reload 分支、winner 选择或 approve replay。

### 7. 推荐实现/验收测试矩阵

| 场景 | 纯投影/页面可观察结果 | 必须禁止 |
| --- | --- | --- |
| exact `CONTENT_REVIEW_PENDING` | Editor pending blocker；Dialog 打开；备注、code、message、request ID 保留；提交/其他 mutation 被 blocker 禁止 | revision 文案、第二次 POST、message 文本分支 |
| pending + focus/background canonical update | 仍显示旧 Editor Context 与本地输入，GET 不自动增加 | 自动 adoption、静默 reset、自动 submit |
| pending + 显式 reload 失败 | 保留旧输入、pending blocker、原 request ID，并展示 reload failure 可用 message/code/request ID | 清除错误、关闭 Dialog、采用部分 canonical |
| pending + 显式 reload 成功 | 才 reset canonical form/revision/mode，解除 blocker，按服务端 actions 重绘 | replay submit、按旧 comment 再 POST |
| malformed details / missing request ID / other code | form-level generic fallback；可用 code/message/request ID 保留；不崩溃 | 猜字段、猜 pending/revision、伪造 request ID |
| true `REVISION_CONFLICT` | 保持既有 revision conflict UI、显式 reload 行为 | 改 code、改 message、改 status |
| approve exact approved-index unknown 500 | Review Page generic server failure；GET/POST 各一次；页面不 stale/reload、不自动 approve | `REVISION_CONFLICT`、已有批准 409、winner 选择、replay |
| successful submit/approve | 保持当前 canonical response + context refetch/cache invalidation 回归 | 用错误 mapper 改变成功路径 |

后续实现最小相关前端验证命令（在仓库根目录执行）建议为：

- `npm --prefix frontend run test -- src/domains/content/content-editor.model.test.ts src/domains/content/content-editor-page.test.tsx src/domains/content/content-review-page.test.tsx`
- `npm --prefix frontend run typecheck`
- `npm --prefix frontend exec -- eslint --max-warnings 0 src/domains/content/content-editor.model.ts src/domains/content/content-editor.model.test.ts src/domains/content/content-editor-page.tsx src/domains/content/content-editor-page.test.tsx src/domains/content/content-review-page.test.tsx`

### 8. 相关文件与边界

无需修改 `contracts/openapi.yaml`、`backend/app/routers/production.py`、generated schema 或数据库 contract：operation 已有 409，ErrorDetail code 开放 string，approved unknown 500 也不应稳定化。

前端 production owner 应限于：`content-editor.model.ts`、`content-editor-page.tsx`；Review Page 仅在 generic 500 行为的测试证据不满足冻结合同才最小调整 `content-review-page.tsx`。测试 owner 为两个 Editor 文件、`content-review-page.test.tsx`。不要混入 ContentVersion identity、Fact Version、Publication/GEO、全局错误 registry 或新 global store。

## Caveats / Not Found

- 既有 `09-05` 历史研究中曾使用候选名称 `CONTENT_REVIEW_ALREADY_PENDING`；本任务用户已明确冻结为 `CONTENT_REVIEW_PENDING`，本文件及后续 design/implement 必须以新名称为准，不可沿用旧候选。
- 本研究未修改 production code、合同、spec 或测试，也未运行 Vitest/typecheck/ESLint；命令仅是后续 implementation 的验证建议。
- 未使用外部资料；依赖版本由 `frontend/package.json` 当前安装合同提供（React `^19.2.8`、TanStack Query `^5.101.4`、React Hook Form `^7.85.0`、Vitest `^4.1.10`、TypeScript `~5.9.3`、ESLint `^10.8.1`）。
- 本研究只能证明现有前端错误分支与恢复状态，不能证明 PostgreSQL diagnostics、事务 rollback 或默认 500 的真实 server body；这些必须由 backend implementation/check 在真实 current-head PostgreSQL 中验证。approved unknown 500 的默认 JSON body/code/media type 不应在前端测试中冻结。
- `contentRequestError` 对结构化 ErrorEnvelope 要求 code/message/request_id 后才保留 detail（`frontend/src/domains/content/content.api.ts:645-675`）；缺 request ID 的响应会自然退化为无 detail 的 generic `ContentRequestError`。实现不得为缺失 ID 添加猜测值。
