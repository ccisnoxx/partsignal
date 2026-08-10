# Frontend V2 Content Review — Design

## 1. Gap Analysis

### 1.1 已有能力

- 蓝图已经定义 task route、immutable Markdown、Review Panel、sticky actions，以及一次加载 content/diff/quality/fact/generation/timeline 的边界（`docs/frontend-v2/03-page-and-workflow-blueprint.md:180`）。
- 后端 `get_content_review_context` 已能从一个确切 `content_version_id` 装配 `ContentReviewContext`：内容、任务、锁定事实、canonical diff、冻结 generation/humanization lineage、当前动作和累计审核历史（`backend/app/services/review.py:188`）。
- `ContentReviewContext` 已是 OpenAPI 中的唯一 DTO；`quality_issues` 随 `content` 返回，不需要复制字段或新增兼容结构。
- approve / request-changes 已存在，均校验 reviewer account type、CSRF；service 在锁内校验 revision、当前指针、状态和业务资格，并追加 `ContentReviewRecord`。
- Frontend V2 Content domain 已拥有 query keys、API owner、结构化 `ContentRequestError` 和 canonical mutation/refetch 习惯；Task action registry 已将 `REVIEW_CONTENT` 指向 canonical review route。
- Product Fact Review 已验证 Dialog 意见校验、token 驱动动作、409 保留输入、request ID、canonical refetch、focus return、Timeline、MarkdownPreview、StickyActionBar、WorkspaceShell 和响应式交互。
- Content fixture、Playwright production-build webServer 与 real-stack 脚本可直接扩展，不需新 runner 或依赖。

### 1.2 真实缺口

1. **路由身份缺口**：V2 route 只有 `taskId`，既有 GET 只接受 `content_version_id`。若先读 Task Detail/Editor Context 才能找到版本，会违反一次 read model，并在两个请求之间产生 current pointer 竞态。
2. **一致性缺口**：既有 version-scoped router 没有显式建立 `REPEATABLE READ`；task route 必须在解析 current pointer 前建立隔离级别。
3. **页面缺口**：V2 尚无 Review route、页面 model/page、Content API review query/mutations 或对应测试。
4. **合同覆盖缺口**：现有 OpenAPI 未声明 task-scoped review route；content approve/request-changes 的 response/error contract 覆盖不完整，需要把实际 403/409/422 结构化错误明确化。
5. **后端验证缺口**：现有测试零散覆盖 content transition，但没有 task-scoped canonical snapshot、完整 approve/request-changes HTTP 权限/CSRF/revision/error 矩阵。
6. **端到端缺口**：fixture 无 Content Review projection 与命令状态机；real-stack 没有独立 content approve 和 request-changes 流程。
7. **展示语义缺口**：后端没有“事实一致性已通过”或“平台适配已通过”的 verdict 字段。客户端不得自行生成结论，只能展示事实 Markdown、服务端 quality issues、平台与冻结生成依据供人工审核。
8. **生成合同冲突**：新增 OpenAPI 路径会使 V1 完整生成类型漂移；必须获得仅更新 `frontend/src/shared/api/schema.d.ts` 的明确例外，否则 `make contract-check` 必然失败。

当前数据库账号类型只有 `ADMIN` / `ENGINEER`，且既有两个 content decision endpoint 都允许这两类账号，因此没有可真实构造的第三种“只读 reviewer”角色。本任务不扩张权限模型；无权限只读验收以服务端 `available_actions=[]` 的 canonical projection 覆盖，后端另行证明未认证、CSRF 与既有 reviewer policy 的命令边界。

## 2. Review Context 结论

### 2.1 结论

**需要调整 read-model 入口，不需要调整 `ContentReviewContext` 数据结构。**

新增：

`GET /api/v1/content-tasks/{content_task_id}/review-context`

该入口在单个 `REPEATABLE READ` 请求内：

1. 按 task ID 读取 `ContentTask`；
2. 从唯一权威 `current_content_version_id` 解析当前内容；
3. 复用现有 Content Review Context 装配逻辑和同一个 OpenAPI `ContentReviewContext` schema；
4. 返回当前 snapshot，或对不存在/不可形成上下文显式返回结构化 404/409。

保留既有 `GET /content-versions/{content_version_id}/review-context`，因为 V1 Content Editor 正在直接消费它（`frontend/src/features/content-editor/ContentEditorPage.tsx:207`）。不替换、不降级、不增加 fallback。

### 2.2 证据

- 蓝图要求 task route 一次读全量上下文（`docs/frontend-v2/03-page-and-workflow-blueprint.md:180-184`）。
- 当前 service 已装配所有请求字段，且只在目标版本等于 task current pointer 时返回动作（`backend/app/services/review.py:214-240`）。因此字段扩张和第二 DTO 都没有事实依据。
- 数据库合同规定 `current_content_version_id` 是唯一主线权威（`contracts/database.md:307,405`），禁止浏览器以最大版本号或另一个上下文猜测。
- 既有 version route 只能从 `content_version_id` 进入（`backend/app/routers/production.py:425-436`），不能满足 task direct URL。
- Review records 已定义为 append-only，request changes 必须非空（`contracts/database.md:109,440`），现有命令 service 应继续作为唯一状态转换 owner。

## 3. Backend Design

### 3.1 Read Model

- 在 `production.py` 的 task-scoped route 开头设置 `REPEATABLE READ`，与 Product Fact task/product-scoped read model 一致。
- service 新增按 task ID 解析 current pointer 的明确入口；把现有装配体收敛为一个内部实现供两个公共入口复用，避免复制查询与 DTO。
- task 不存在：404。
- task 存在但没有 current content：409，返回明确稳定错误码 `CONTENT_REVIEW_NOT_AVAILABLE`。
- current pointer 失联、事实绑定或生成 lineage 不完整：继续使用结构化 `REVIEW_CONTEXT_INCOMPLETE` 409，不猜测其他版本。
- 不修改 `_content_history` 的累计 task history 语义；它是现有 Content Review 合同，不套用 Fact Review 的 exact-parent 规则。

### 3.2 Commands

- 复用现有 version-scoped approve / request-changes endpoints；read model 返回当前 `content.id` 和 `content.revision`，客户端不新增 task-scoped command。
- approve payload 使用既有 `CommandRequest`；request changes 使用既有 `RequestChangesCommand`。
- 服务端继续校验 ADMIN/ENGINEER、CSRF、current pointer、expected revision、REVIEW_PENDING、已批准事实与 blocking issues。
- request changes trim 后非空；不通过前端校验替代服务端校验。
- 命令成功只改变允许的状态/revision/批准元数据并追加 review/audit history；不可改写内容、生成 snapshot 或旧记录。

### 3.3 OpenAPI

- 新增 task-scoped GET，响应沿用 `ContentReviewContext`。
- 明确 GET 的 200 / 404 / 409；approve / request-changes 的 200 / 403 / 409 / 422 结构化错误。
- 不新增 DTO alias、兼容字段或第二套 action enum。

## 4. Frontend Design

### 4.1 Ownership

- route 文件仅解析 `$taskId` 并渲染 Content domain page。
- `content.api.ts` 独占 review query key、task-scoped GET、approve 和 request-changes mutations；错误继续使用 `ContentRequestError`。
- `content-review.model.ts` 只处理本 domain 的展示映射、服务端 token 到两个动作的 exhaustive 映射、trim 非空意见校验和 timeline projection。
- `content-review-page.tsx` 组合现有设计系统组件；不建立跨 domain Review abstraction。

### 4.2 页面结构

- `WorkspaceShell`：主列展示标题、摘要、只读 canonical Markdown；Review Panel 展示 canonical diff、四组证据与 timeline。
- canonical diff 直接消费 read model 的确定性比较结果；没有基线时显示明确空状态，不在客户端另取历史版本计算。
- quality issues 只按服务端 `severity` 分为 blocking / warnings；空列表显示明确空状态。
- fact consistency 展示锁定 FactVersion 标识、分类和 `body_markdown`，供审核人与 canonical content 对照；不声称自动一致。
- platform adaptation 展示 task platform identity，以及 generation/humanization snapshot 中已有的平台、模型、Prompt/input 摘要；人工版本或无 snapshot 时明确显示“无生成快照，需人工核对”。
- review timeline 直接显示服务端排序结果，不在浏览器跨接口合并。
- 状态视觉复用 Content domain 已有 workflow stage registry + `Badge`；仓库没有公共 `StatusBadge`，本任务不为此发明一个。

### 4.3 动作与状态

- `available_actions` 中只识别 `APPROVE`、`REQUEST_CHANGES`；页面不会用 status 推导动作，也不会在 Review 页渲染 `SUBMIT_REVIEW`。
- APPROVE 使用现有确认 Dialog；REQUEST_CHANGES 使用带必填 textarea 的 Dialog。
- mutation pending 时禁用相关动作，避免本地双击；不引入幂等重放机制。
- 成功：关闭 Dialog、清除本次意见、`refetch()` task review context，并使 Content task detail/list/editor family query 失效但不强制 waterfall。
- 409：映射结构化错误、保留 Dialog 与意见、显示 request ID、标记当前上下文陈旧并 refetch；不自动再次提交。
- 403 / 422 / 网络错误：保留输入并在 Dialog 内显示字段或表单级反馈；有 request ID 时显示。
- 初次错误提供 Retry；如有已缓存 canonical snapshot，显示陈旧提示而非清空整个页面。
- Dialog 关闭后焦点回到原触发按钮，沿用 Fact Review 已验证实现。

## 5. Test Design

### 5.1 Backend

- 新 focused integration test 覆盖 task current pointer 解析、同一 DTO 的 diff/fact/lineage/timeline/actions、无 current pointer、断裂 context、历史版本无动作。
- HTTP 覆盖 authenticated read、approve、request changes、意见 trim、CSRF、账号权限、expected revision、非当前版本、非法状态、blocking issue、fact eligibility 和 ErrorEnvelope request ID。
- 断言 approve/request changes 追加记录且不改写 Markdown/snapshot/旧 review records。

### 5.2 Frontend Unit/Component

- model：只按 token 返回两个动作、空白意见拒绝、timeline/issue 映射、未知动作显式失败或被现有 contract exhaustiveness 捕获。
- page：loading/error/retry、readonly states、Dialog validation/focus return、409 input/request ID/canonical refetch、success refetch。

### 5.3 Fixture Playwright

- 扩展现有 Content fixture，而非建第二套 mock server。
- 覆盖 direct URL、refresh、Back/Forward；REVIEW_PENDING、APPROVED、CHANGES_REQUESTED、tokenless readonly；approve/request changes；CSRF/expected_revision/409/structured errors；canonical refetch；loading/error/retry；375/768/1024/1440；keyboard、focus return；console/pageerror/requestfailed。
- 断言首屏不存在 Task Detail/Editor/资源列表 waterfall，且冲突命令只提交一次。

### 5.4 Real Stack

- 新增一份独立 spec，创建两套相互隔离的数据：流程 A 提交待审后批准；流程 B 提交待审后退回并验证意见与 canonical state。
- UI 执行业务 mutation；只用 API 完成前置编排和结果读取，遵守 isolation spec。
- 将 spec 接入现有 `e2e-local.sh`，不新建 runner。

## 6. Minimality Decisions

- 复用一个 DTO、一个 service assembler、一个 Content API owner 和现有组件。
- 不把 Fact Review 抽成通用框架；两个 domain 的业务合同不同，当前没有稳定抽象压力。
- 不新增 verdict、聚合表、缓存、workflow engine、依赖或 V1 页面。
- 不把 Content Review 命令改为 task-scoped；已有 version-scoped 命令正好携带 canonical ID + revision 并由服务端最终校验。

## 7. Risks and Rollback Points

- **current pointer 竞态**：由 task-scoped `REPEATABLE READ` + command lock/revision 解决；回滚点是删除新增 GET，不影响既有 version route。
- **动作误授权**：UI 只消费 token，backend 重验；回滚页面不会削弱服务端安全边界。
- **409 丢意见/重复提交**：Dialog state 与 refetch 解耦，禁止自动 replay；可单独回滚 mutation UI 而保留 read-only page。
- **快照语义误导**：无服务端 verdict 时只展示依据；若未来有正式 verdict，再通过独立合同任务扩展。
- **V1 合同生成漂移**：仅允许更新生成文件；若不授权，则本设计无法同时满足 task-scoped contract 和 `make contract-check`，不得实施替代 waterfall。
- **real-stack 数据串扰**：每流程独立唯一实体与显式清理；失败时可先回滚脚本接入而保留 focused spec 调试。
