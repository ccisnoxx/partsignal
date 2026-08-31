# Content Editor 提交审核冲突恢复设计

## 1. 当前调用链与根因

当前页面的 Editor Context 由 `ContentEditorPage` 的 TanStack Query 持有，表单、base revision、Dialog 与 mutation 错误由 `ContentEditorWorkspace` 持有。

`SAVE` 在 `saveDraft` 的 catch 中调用 `applyMutationError`；`DELETE` 与 `ABANDON` 通过 `runDestructive` 进入同一函数。该函数使用 `mapContentEditorError` 保留服务端字段错误、form message、code 与 request ID，并在 `REVISION_CONFLICT` 时设置 workspace conflict。`ContentDocumentForm` 再投影统一的“重新加载最新版本”入口。

`SUBMIT_REVIEW` 不经过这条路径。`submitReview` 直接 await mutation；异常上抛到 `SubmitContentDialog.submit` 后，被压成 Dialog 私有字符串 `error`。因此 409 的 code/request ID 没有进入统一 owner，reload 入口也不存在。这不是 API adapter 缺失：`contentRequestError` 已把运行时 `ErrorEnvelope` 保存在 `ContentRequestError.detail`，`mapContentEditorError` 也已能读取 `code/message/request_id`。

现有 Context Query 还启用了 `refetchOnWindowFocus: 'always'`，workspace effect 会在表单不 dirty 且收到更高 revision 时自动 reset 并清除 conflict。`SUBMIT_REVIEW` 只允许 clean 表单，故一旦把它接入 conflict 而不同时冻结自动采用，窗口聚焦就可能绕过显式 reload。该约束与 submit 409 修复不可拆开。

## 2. 权威 owner 与边界

### 2.1 当前 owner

- 服务端状态：`contentKeys.editorContext(taskId)` 的 TanStack Query。
- 表单和本地 Markdown：`ContentEditorWorkspace` 的 React Hook Form。
- mutation conflict：`ContentEditorWorkspace` 的 `conflict`、`requestId` 与 `applyMutationError`。
- submit Dialog 备注与开关：workspace/Dialog 页面本地状态。
- API 请求与错误 envelope：`frontend/src/domains/content/content.api.ts`；仓库没有独立的 `content-editor.api.ts`。

### 2.2 目标 owner

将现有 conflict 状态结构化为 `{ code, message, requestId }`，并从 Workspace 提升到同一 Content Editor 页面的 query 边界。提升的唯一理由是 conflict owner 必须同时控制 editor-context 的自动 refetch；它不是第二份状态，也不进入全局 Store。Workspace 通过受控 props 读取和更新这一份 conflict，`SAVE`、`SUBMIT_REVIEW`、`DELETE`、`ABANDON` 全部复用同一个 `enterConflict`/`clearConflict` 边界。

非 conflict 的字段/form 错误仍由 RHF 与现有 Dialog 普通错误 owner 处理。它们不复制 conflict，也不改变 401/403/404/422/5xx 的既有语义。

## 3. 不变量

1. conflict 期间，已采用的 editor context、form baseline 与 base revision 是一个冻结整体；背景 query 不能部分更新 task/action，表单也不能单独 reset。
2. conflict 对象是 code/message/request ID 的唯一来源。页面文档区、ErrorSummary 与 Submit Dialog 可以投影同一对象，但不得各自保存副本。
3. 每次用户确认提交只调用一次 `submit.mutateAsync`。mutation 不配置 retry；catch 只改变本地状态，不递归调用、invalidate 或 refetch。
4. reload 是读操作且永不携带 submit 意图。成功只采用 GET 响应，失败只保留 query error；两者都不调用 mutation。
5. 新动作只能来自 fresh editor context 的 `task.available_actions`、`current_content.available_actions` 和既有 `editorActionKeys` 映射；不得从 409 或 canonical status 推导。
6. 一个失败 refetch 即使仍携带 cache data，也属于失败。只有 `QueryObserverResult` 明确成功且含 data，才能提交 adoption。

## 4. Query 与自动采用控制

Content Editor 页面对现有 query options 做局部覆盖：stable 状态继续保持 `refetchOnWindowFocus: 'always'`；进入 conflict 后改为 `false`，并取消该 exact query key 的在途读取。workspace 的高 revision 同步 effect 在 conflict 存在时直接停止，避免 cache 更新触发表单 reset 或 conflict 清除。

该控制只作用于本页面的 Editor Context observer，不改变 Content API 的其他 query，不改全局 QueryClient，也不增加轮询。进入 conflict 不调用 invalidation，因此 409 后不会自动 GET。

显式 reload 调用当前 query observer 的 `refetch`。`onReload` 只有在 refetch result 明确成功时才 resolve fresh context；result 为 error、缺 data 或请求异常时 reject。Workspace 捕获失败仅用于避免未处理 Promise，详细读取错误继续来自 `context.error`，不增加 `reloadError` state。

## 5. Mutation 处理

### 5.1 SAVE、DELETE、ABANDON

保留现有 reset、try/catch、canonical success 和 related-query invalidation。`applyMutationError` 的 conflict 分支改为写入提升后的结构化 owner；非 conflict 字段/form 错误仍写入 RHF。现有页面 conflict projection补齐 code/message/request ID。

### 5.2 SUBMIT_REVIEW

`submitReview` 在 mutation 前清理上一次普通 submit 错误，但不清除有效 conflict 后偷偷重试。mutation 成功仍关闭 Dialog、写 announcement 并执行当前 `refreshRelated`。

mutation 失败时先调用 `mapContentEditorError`：

- 若 code 为 `REVISION_CONFLICT`，写入唯一 conflict owner，保留 Dialog open/comment，禁用确认提交，并正常结束该事件；异常不得再交给 Dialog 转成普通字符串。
- 若不是 revision conflict，继续抛给 Dialog 当前普通错误路径。401、403、404、422 与普通 5xx 的打开状态、文案边界和重试方式不在本 Task 改变。

为防止用户用旧 revision 手动发起第二次写命令，`resolveStickyActions` 和 Submit Dialog 的确认按钮在 conflict 存在时禁用所有 revision-bearing mutation。禁用只是一致性 UX；服务端仍是最终权威。

## 6. 状态转换

| 当前状态 | 事件 | 下一状态 | 采用/保留规则 |
| --- | --- | --- | --- |
| stable + Dialog open | submit success | stable + Dialog closed | 维持现有 success invalidation，采用后续 canonical context |
| stable + Dialog open | submit 409 | conflict + Dialog open | 保留 form/context/base revision/comment；记录结构化 conflict；无 GET |
| stable + Dialog open | submit 非 409 | stable + Dialog open | 保持现有 Dialog 普通错误；无 conflict、无 GET |
| conflict + Dialog open | cancel | conflict + Dialog closed | 保留 form/context/base revision/conflict；显式丢弃 comment；无网络 |
| conflict | reload success | stable + Dialog closed | 原子 reset form/base revision/mode，采用 fresh context/actions，清 conflict/request ID |
| conflict | reload failure | conflict，Dialog 开关不变 | 所有原值保留；query error 可见；允许再次显式 GET |
| conflict | focus/invalidation signal | conflict | 不自动 GET/采用，不执行任何 mutation |

reload adoption 的顺序必须保证：fresh context 已确认成功；form/base revision/mode 按该 context 重置；Dialog 关闭；conflict 最后清除。这样 re-enable focus refetch 前，页面已处于完整 canonical baseline。

## 7. Dialog 生命周期、错误可访问性与焦点

Dialog 仍只拥有短暂审核备注和非 conflict 普通 error。打开后把焦点放入备注 textarea。结构化 conflict 通过稳定 ID 的 `role="alert"`/atomic live region呈现 code、message 和 request ID，并把读取/重试动作放在同一恢复区域；确认提交在 conflict 下不可执行。

打开 Dialog 时记录触发按钮。普通取消且触发器仍存在可聚焦时返回该按钮。发生 conflict 后，该按钮会被禁用；reload 成功后它还可能因新 `available_actions` 消失。此时 final focus 使用可编程聚焦的 Content Editor 标题或冲突恢复区域作为稳定 fallback，不尝试聚焦已断开或不可用节点。reload 失败不关闭 Dialog，焦点留在 Dialog 内的恢复动作。

## 8. reload 结果与错误投影

- 成功：GET response 的 `current_content` 重置 title/summary/body/tags/change summary 与 revision；task 的 workflow/primary task 和 task/current-content actions直接驱动页面。若服务端改为 review pending，Editor 进入只读并不显示 Review commands。
- 失败：保留原 conflict 的 code/message/request ID。读取失败的 code/message/request ID 若存在，由现有 `ContentRequestError`/query error surface 另外标明它属于 reload；不得覆盖原 mutation conflict，也不得生成第二个 reload state。
- 重试：Dialog 内和页面文档区调用同一个 `reloadCanonical`；一次点击只产生一个 GET。

## 9. API 与合同边界

`submitContentVersion` 与 `commandContentVersion` 已经是一请求一调用，且运行时 adapter 能解析 `ErrorEnvelope`。本 Task 不新建 API owner、不改 request body、不增加 idempotency/retry header，也不改 endpoint。

后端现有 submit-review 路由接收 required `expected_revision` 和 comment，service 在 stale revision 时返回 `409 REVISION_CONFLICT`，统一错误中间件提供 request ID。审计同时确认 `contracts/openapi.yaml` 的该 operation 目前只声明 200；由于本 Task 明确要求 OpenAPI/generated client 不变，该声明缺口仅记录为已知残余，不在实现中添加兼容 schema或猜测字段。

## 10. 影响文件

- `frontend/src/domains/content/content-editor-page.tsx`：唯一 conflict owner、submit catch、query freeze、reload success gate、Dialog projection与焦点。
- `frontend/src/domains/content/content-editor.model.ts`：仅在现有 error mapping 需要导出结构化类型时做最小调整；不得复制 ErrorEnvelope 类型。
- `frontend/src/domains/content/content.api.ts`：原则上无需修改；只有 query options 需要受控 focus 参数且无法在页面组合时，才做最小签名调整。
- `frontend/src/domains/content/content-editor-page.test.tsx`：组件状态机、网络次数、普通错误和焦点回归。
- `frontend/tests/e2e/fixtures/content.fixture.ts`：精确 submit conflict、one-shot reload failure、fresh canonical context 与请求计数。
- `frontend/tests/e2e/content-editor.spec.ts`：浏览器级 conflict/reload/no-replay 验收。

不修改 backend、contracts、generated schema、数据库、共享 Dialog/StickyActionBar、其他 Content surface 或生产数据。

## 11. 已知风险与关闭方式

- Query refetch 失败保留旧 data：通过检查 result success/error 而不是只检查 `.data` 关闭，并用 unit + E2E one-shot failure 证明。
- focus refetch 绕过显式 reload：通过提升唯一 conflict owner、取消在途 exact query、冲突期关闭 focus refetch和同步 effect gate 关闭。
- Dialog comment 被 409 重挂载丢失：测试保持同一 Dialog 和 textarea value；只有取消或成功 adoption 可以丢弃。
- 写命令自动 replay：unit 和 E2E 对 POST 数量做事件前后精确断言；测试覆盖 409、失败 reload、成功 reload、取消。
- normal error 回归：参数化组件测试覆盖 401/403/404/422/5xx，现有 submit success、SAVE conflict、DELETE/ABANDON E2E 继续执行。
