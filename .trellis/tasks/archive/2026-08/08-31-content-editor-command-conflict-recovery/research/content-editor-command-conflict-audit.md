# Content Editor 命令冲突恢复审计

## 结论

`SUBMIT_REVIEW` 的 409 只停留在 Dialog 普通错误状态，是因为它没有进入 `ContentEditorWorkspace.applyMutationError`。API adapter 与 model mapping 已能保留 `ErrorEnvelope`；缺口位于页面 mutation orchestration 和 Dialog catch，不需要后端、OpenAPI、generated client 或数据库修改。

同时确认一个与目标直接相关的 reload 缺口：当前 `onReload` 只取 refetch result 的 `.data`。失败 refetch 可保留旧 cache data，因此现有实现可能在网络读取失败时重置表单、清除 conflict，并把旧 context误当最新 canonical response。规划必须以 refetch success/error 为准。

## 1. 前端 owner 与路径

### Editor query

- `frontend/src/domains/content/content-editor-page.tsx:72-93`：`ContentEditorPage` 创建 editor-context query；已有 data 时的背景错误单独展示；`onReload` 当前只返回 `(await context.refetch()).data`。
- `frontend/src/domains/content/content.api.ts:193-207`：query key 是 `contentKeys.editorContext(taskId)`；GET editor-context；`refetchOnWindowFocus: 'always'`、`retry: false`、`retryOnMount: false`。
- `frontend/src/domains/content/content-editor-page.tsx:173-184`：表单不 dirty 且 query revision 更高时自动 reset，随后清除 conflict/request ID。

### 统一 mutation conflict

- `frontend/src/domains/content/content-editor-page.tsx:107-116`：workspace 当前持有 `baseRevision`、`conflict`、`requestId`、Dialog open 等页面状态。
- `frontend/src/domains/content/content-editor-page.tsx:201-213`：`applyMutationError` 调用 `mapContentEditorError`，写字段/form error、request ID，并对 `REVISION_CONFLICT` 设置 conflict。
- `frontend/src/domains/content/content-editor-page.tsx:229-240`：SAVE catch 复用该函数。
- `frontend/src/domains/content/content-editor-page.tsx:250-259`：DELETE/ABANDON 的共享 `runDestructive` catch 复用该函数。
- `frontend/src/domains/content/content-editor-page.tsx:262-272`：显式 reload 成功路径负责重置表单、revision、mode并清除 conflict/request ID。
- `frontend/src/domains/content/content-editor-page.tsx:342-365`：同一 conflict 投影到文档工作区；ErrorSummary 读取 form error 与 request ID。

### SUBMIT_REVIEW 偏离

- `frontend/src/domains/content/content-editor-page.tsx:243-248`：`submitReview` 没有 reset/catch/apply，直接 await mutation；只在成功后关闭 Dialog并刷新相关 query。
- `frontend/src/domains/content/content-editor-page.tsx:647-684`：Dialog 私有保存 `comment` 与字符串 `error`；所有异常都被压成 `caught.message` 或泛化文案。它没有 code/request ID/reload props。
- 结果：submit 409 不进入 workspace conflict；审核备注虽因 Dialog 保持挂载而暂时保留，但错误语义与其他 Editor command 分叉。

### API 与 error mapping

- `frontend/src/domains/content/content.api.ts:347-378`：SAVE、SUBMIT、ABANDON 的 API owner 均在 `content.api.ts`；仓库不存在 `content-editor.api.ts`。
- `frontend/src/domains/content/content.api.ts:417-437`：SUBMIT/ABANDON 共用 `commandContentVersion`，一次调用只执行一次 `api.POST`，未配置 replay/idempotency fallback。
- `frontend/src/domains/content/content.api.ts:439-453`：DELETE 复用同一 `contentRequestError` 边界。
- `frontend/src/domains/content/content.api.ts:645-660`：运行时 parser 从 `ErrorEnvelope.error` 读取 code、message、details、request_id 并保存在 `ContentRequestError`。
- `frontend/src/domains/content/content-editor.model.ts:136-183`：`mapContentEditorError` 已输出 fields、formMessage、requestId 与 code。

## 2. 本地状态与必须保留的数据

RHF 表单字段来自 `ContentEditorFormValues`，包括 `title`、`summary`、`body_markdown`、`tags_text` 与 `change_summary`。workspace 另持有 base revision、mode、document/diff tab和 Dialog open；Submit Dialog 持有审核 comment。submit 409 后这些值均不得被 query effect、Dialog 重挂载或 reload failure 清除。

`SUBMIT_REVIEW` 当前只在表单 clean 时 enabled，但“本地输入”仍包括已呈现的 Markdown/metadata、RHF baseline、可能尚未离开焦点的输入值和 Dialog comment。不得因为 clean 条件假设表单可安全被背景 canonical context 替换。

## 3. 动作与 canonical adoption

- `frontend/src/domains/content/content-editor.model.ts:111-133`：Editor action key 只从 task/current-content `available_actions` 映射。
- `frontend/src/domains/content/content-editor-page.tsx:568-640`：Sticky actions 只对服务端 token 做 enabled 投影；submit 要求 clean，SAVE 要求 dirty。
- `frontend/src/domains/content/content-editor-page.tsx:482-500`：Task panel直接呈现 server `workflow_stage` 与 `primary_task`。

因此显式 reload 成功不能只更新 revision 或表单；必须采用整个 editor context，使 task `primary_task`、task/current-content `available_actions`、current content、diff/lineage 与 mode来自同一响应快照。reload 失败则任何一项都不采用。

## 4. 后端合同确认

- `backend/app/routers/production.py:524-545`：submit-review endpoint 接收 `CommandRequest`，返回 `ContentVersionOut`。
- `backend/app/services/review.py:340-411`：service 锁定/读取内容版本并执行 revision 与状态校验；成功推进为 review pending。
- `backend/app/services/review.py:350-357`：共享审核状态机在任何 transition 前比较 expected/current revision，stale 时抛出 `409 REVISION_CONFLICT`，message 为“内容版本已被其他请求修改”；同一函数由 submit-review、approve 与 request-changes 复用。
- `backend/app/services/review_policy.py:26-29`：`submit-review` 的合法状态转换为 `DRAFT → PENDING_REVIEW`。
- `backend/tests/integration/test_content_review.py:227-256`：现有 approve HTTP 集成测试通过同一 transition owner 冻结 `REVISION_CONFLICT`、409 与 request ID；`backend/tests/integration/test_content_editor_context.py:374-387` 覆盖 submit-review 成功和新的 Editor action projection。目前没有 submit-review HTTP stale 专项用例，前端本 Task 不以此为由修改后端测试。
- 统一错误中间件输出 `{ error: { code, message, details, request_id } }`。

该合同已经足够支持前端修复。不得因本 Task 新增后端响应字段、自动 retry、幂等 key 或兼容 code。

## 5. OpenAPI/generated 边界

`contracts/openapi.yaml:1917-1926` 的 submit-review operation 当前只声明 200；generated schema 的 operation response 也只含 200。运行时仍可能返回由统一中间件生成的 401/403/404/409/422/5xx `ErrorEnvelope`，前端 shared adapter已按该统一 shape 解析。

用户明确要求 OpenAPI、generated client 和 backend 不变，因此该 operation 的非 2xx 声明缺口只作为已知残余记录，不进入本 Task。实现不得通过手写第二个 generated type 或猜测兼容字段绕过它。

## 6. 现有测试与缺口

### Component

- `frontend/src/domains/content/content-editor-page.test.tsx:327-350` 已覆盖 SAVE 409：本地 title/request ID 保留，显式 reload 后采用服务端 title；尚未覆盖 failed refetch 的 stale data 风险。
- `frontend/src/domains/content/content-editor-page.test.tsx:352-391` 只覆盖 submit success/dirty gate/comment payload，没有 submit 409、请求次数、Dialog保留、reload failure 或普通错误矩阵。

### Playwright

- `frontend/tests/e2e/content-editor.spec.ts:256-272` 覆盖 SAVE conflict，断言一个 PUT、显式 reload 后第二个 GET。
- `frontend/tests/e2e/content-editor.spec.ts:274-298` 覆盖 submit success并核对一次 command request。
- `frontend/tests/e2e/content-editor.spec.ts:300-337` 覆盖 DELETE/ABANDON success。
- 尚无 submit 409、failed reload、Dialog comment 保留、no replay 和 conflict cancel 覆盖。

### Fixture

- `frontend/tests/e2e/fixtures/content.fixture.ts:40` 的 `EditorMutationMode` 只有 success/revision-conflict。
- `frontend/tests/e2e/fixtures/content.fixture.ts:1477-1491` 的 editor GET 总是成功，但已有 `editorContextRequests` 计数。
- `frontend/tests/e2e/fixtures/content.fixture.ts:1597-1604` 的 revision-conflict 只用于 SAVE，并先推进服务端 title/revision。
- `frontend/tests/e2e/fixtures/content.fixture.ts:1617-1660` 的 submit/abandon command 总是成功，没有 submit conflict 分支；已有 `editorCommandRequests` 可用于精确 POST 次数断言。

fixture 需要最小增加 command-specific conflict 与 one-shot GET failure，不得把本 Task扩展成通用故障注入框架。

## 7. Dialog 与焦点证据

当前 Submit Dialog 没有传 `DialogContent.finalFocus`，备注 textarea 也没有 autofocus；错误只有一个 `role="alert"` 字符串。仓库已有 `DialogContent.finalFocus` 和断开 trigger 时回退稳定 heading 的先例，能够在 domain 内复用，不需要改 primitive。

conflict 后 Submit action必须禁用旧 revision，再关闭 Dialog时原按钮可能无法接收焦点；reload 成功后该 action还可能从 canonical actions 中消失。因此 final focus 必须检查 trigger 是否仍连接且可聚焦，否则回到 Content Editor 标题/冲突恢复区。

## 8. 结论与实施边界

最小正确修复位于 `content-editor-page.tsx` 的页面 query/mutation/Dialog orchestration，加上定向 component 与 fixture/E2E 覆盖。`content.api.ts` 和 model 已提供需要的合同能力，原则上无需行为修改。任何全局 QueryClient、共享 Dialog、后端、OpenAPI 或 generated client 变更都超出本 Task。
