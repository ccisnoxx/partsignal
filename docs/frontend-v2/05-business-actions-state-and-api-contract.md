# PartSignal V2 业务动作、状态与 API Contract

## 1. 核心原则

PartSignal 领域状态复杂，V2 前端不能再从 status、role、分页数据或页面作者自己的判断重新构造“用户现在能做什么”。

业务文档已经确定：有业务推进含义的资源由服务端返回 typed `workflow_stage` 和唯一 `primary_task`；前端只负责显示映射。`available_actions` 表达可尝试的具体命令，写入入口服务端继续重新校验。

## 2. 三个概念

### `workflow_stage`

回答：“这个对象现在处于用户可理解的哪个业务阶段？”不是数据库所有状态字段的简单拼接。

### `primary_task`

回答：“对当前用户来说，这个对象最应该做的下一件事是什么？”每个业务对象只允许 0 或 1 个。

### `available_actions`

回答：“当前可以尝试哪些具体命令？”适合 overflow、workspace secondary actions、管理员低频命令。Mutation 时服务端必须重新校验。

## 3. 前端 Action Registry

禁止：

```ts
if (status === "PENDING_REVIEW" && role === "ADMIN") {
  // infer action
}
```

建立 `domains/<domain>/actions/`：

```ts
interface ResolvedBusinessAction {
  key: string
  label: string
  intent: "primary" | "secondary" | "danger"
  presentation: "row" | "overflow" | "toolbar"
  href?: string
  command?: string
  disabledReason?: string
  confirmation?: {
    title: string
    description: string
  }
}
```

## 4. 映射职责

服务端：

```json
{
  "workflow_stage": "PENDING_REVIEW",
  "primary_task": "REVIEW_CONTENT",
  "available_actions": ["REVIEW_CONTENT", "ABANDON_DRAFT"]
}
```

Domain Registry：

```ts
const actionRegistry = {
  REVIEW_CONTENT: {
    label: "审核",
    intent: "primary",
    href: ({ id }) => `/content/tasks/${id}/review`,
  },
  ABANDON_DRAFT: {
    label: "放弃草稿",
    intent: "danger",
    command: "abandonDraft",
  },
}
```

Design System：`<RowActions actions={resolvedActions} />`。

三层职责不能混。

## 5. Action Presentation

Primary 来源 `primary_task`，显示在 Table row、Workspace StickyActionBar、Workbench Inbox。Overflow 来源 `available_actions - primary_task`。

新建产品/创建任务/新建观测属于 page-level create action，不属于 existing row 的 `primary_task`。

## 6. Product Action 示例

可能 token：`ENTER_FACTS`、`REVIEW_FACT`、`REVISE_FACT`、`CREATE_CONTENT_TASK`。

事实历史查看不是 row primary action，应该通过对象详情/历史 section 访问。

## 7. Content Action 示例

可能 token：`CREATE_DRAFT`、`GENERATE_CONTENT`、`EDIT_CONTENT`、`REVIEW_CONTENT`、`REVISE_CONTENT`、`START_PUBLICATION`、`VIEW_RESULT`。

UI 不再从 task/generation/content/publication 多个 status 自己组合业务阶段。

## 8. Publication Action 示例

可能包括：`START_PUBLICATION`、`COPY_PUBLICATION_PACKAGE`、`REGISTER_RESULT`、`VERIFY_PUBLICATION`、`REVERIFY_PUBLICATION`、`SWITCH_APPROVED_VERSION`、`CLOSE_PUBLICATION_WORK`。

`PublicationWork` 阶段以服务端契约为准，例如 PREPARING / PLATFORM_REVIEW / AWAITING_VERIFICATION / ACTION_REQUIRED / COMPLETED / CLOSED。

## 9. Published Content Issue

`CREATE_REPAIR_TASK`、`RESOLVE_ISSUE` 是独立动作。修复任务创建成功不等于 issue 已解决，前端不能本地自动推导 resolved。

## 10. Content Version 单主线

业务规则：`ContentTask.current_content_version_id` 是当前内容主线权威指针。AI 草稿、旧版本、被退回版本、已审核版本按领域规则保持只读；当前未审核人工 DRAFT 在允许窗口内可按 revision 保存；被退回版本创建新修订。

因此主编辑 URL 是 `/content/tasks/:taskId/editor`，历史版本 `/content/versions/:versionId` 只读。

## 11. Optimistic Concurrency

核心可变资源使用 revision / expected_revision。冲突 UI：

```text
该对象在你编辑期间已经发生变化。
[查看最新版本] [重新加载]
```

禁止静默覆盖。

## 12. Mutation 规范

Mutation wrapper 不直接操作页面 UI；toast/dialog 由调用层决定；cache invalidation 最小化；服务端返回 canonical object 时优先写回 cache。

### New Content Task

`ContentTaskCreate` 只包含 `product_id`、`fact_version_id`、`platform_profile_id`。`GET /content-tasks/creation-options` 是表单专用薄 read model，一次返回活动 Product 及其非空 `APPROVED` FactVersion、活动 PlatformProfile 和可选 `requested_product_id` 的资格结果；浏览器不得通过 Product/Fact/Platform 列表 waterfall 推导最终资格。

options 只决定显示范围。`POST /content-tasks` 必须在事务锁内重新校验活动 Product、同产品非空批准事实和活动平台；缺少平台 Prompt 只影响后续系统 AI generation job。一次用户提交及同载荷失败重试复用 `crypto.randomUUID()` 生成的 `Idempotency-Key`，修改 payload 或收到 `IDEMPOTENCY_CONFLICT` 后生成新 key，成功后废弃旧 key。

## 13. UI-oriented Read Model

不要把数据库模型原样暴露给列表。

### ProductListItem

至少包含 id/model/brand/category、`fact_status`、`current_fact`、`updated_at`、`workflow_stage`、`primary_task` 和 `available_actions`。`current_fact` 是 `{ version, status } | null`，指向版本号最大的不可变事实；无事实版本时显式返回 `null` 和 `fact_status=NOT_ENTERED`。`updated_at` 表示 Product、事实版本和审核记录中的最近活动时间。

Products URL 与 API 查询参数显式映射：`q → search`、`pageSize → page_size`、`factStatus → fact_status`、`workflowStage → workflow_stage`。后端无需为 URL 命名增加兼容别名。

### ProductDetail

`GET /api/v1/products/{product_id}/detail` 是 `/products/$productId` 的独立 read model；既有 `GET /products/{product_id}` 继续只返回 `Product`。详情响应只包含页面实际消费的 compact projection：canonical `Product`、当前 approved/pending fact 摘要、内容任务数量与最近阶段、发布成果数量与最近结果、GEO compact metrics，以及服务端已排序的 typed Activity。不得返回事实或内容正文、完整跨域对象、review comment 或 Audit details。

该投影在单个 PostgreSQL `REPEATABLE READ` 请求事务内形成，并以固定次数批量查询相关实体；浏览器不得调用事实、内容、发布、GEO 或审计接口自行 join。Activity 的权威来源是各领域追加记录及 Product 成功审计，按 `timestamp DESC, kind ASC, source id DESC` 排序后由服务端截取最近 10 项；前端不合并或重新排序多个时间线。

### ProductFactsDraft

`GET /api/v1/products/{product_id}/facts` 是 `/products/$productId/facts` 的独立 workspace read model，一次返回 compact Product Context、唯一可编辑的 `body_markdown`、`classification`、workspace `revision`、当前 approved/pending fact 摘要、typed `workflow_stage` 和 `available_actions`。当前 database contract 不包含 Evidence URL，因此该 read model 不提供 evidence 字段，浏览器也不得从旧接口恢复第二套事实来源。

`SAVE` 与 `SUBMIT_REVIEW` 的入口是否存在只由 `available_actions` 决定；客户端 dirty、pending 与非空校验只影响已返回动作的 enabled 状态。`PUT /facts` 接收 `ProductFactsDraftUpdate.expected_revision` 并返回 canonical `ProductFactsDraft`；客户端只用该响应更新正文、分级、revision 和 cache。`POST /fact-review-submissions` 接收 `FactReviewSubmissionRequest.expected_revision` 与非空 `change_summary`，服务端从当前已保存 workspace 创建不可变 `PENDING_REVIEW` snapshot；成功后客户端重新读取 workspace actions，不跳转尚未实现的 Fact Review。

两个写入口都由服务端在锁内重新校验产品状态、pending snapshot 和 revision。`REVISION_CONFLICT` 不得静默覆盖：客户端保留本地表单与冲突请求 ID，只有用户显式 reload 才采用最新 canonical workspace。

### ProductFactHistoryList

`GET /api/v1/products/{product_id}/fact-history` 是 `/products/$productId/facts/versions` 的 Product 专用列表 read model。响应在同一个 PostgreSQL `REPEATABLE READ` 请求内返回 `ProductFactsProductContext`、窄 `ProductFactHistoryItem[]`、`page`、`page_size` 与 `total`；item 只包含六列与 detail link 所需的版本身份、状态、数据级别、变更摘要、提交人和提交时间，不包含 Markdown、动作、删除投影或 revision。

版本顺序固定由服务端 `version DESC` 决定，`page_size` 只接受 10/20/50。浏览器不得请求 Product Detail 补标题，不得重新推导业务顺序，也不得把该投影推广为 Content History 或通用 History DTO。既有 `GET /products/{product_id}/fact-versions` 保持完整详情列表合同，继续服务 V1 调用者。

### ContentTaskListItem

`GET /api/v1/content-tasks` 返回 `{items,page,page_size,total}`。显式同时提供 `page/page_size` 时服务端分页；两者同时省略时保留 V1 完整集合语义，只提供一个返回 `422`。服务端处理 `q`、`workflow_stage`、`archive_status` 和 `platform_profile_id`，并按 `updated_at DESC, id DESC` 稳定排序。

Item 必填 id/identifier/product/platform/workflow_stage/primary_task/available_actions/deletion/revision/current content summary/updated_at。`current_content={id,version,source_type}|null` 只来自 `ContentTask.current_content_version_id`；`identifier` 为 `CT-` 加 UUID 前八位大写字符。列表不消费 raw statuses 推导阶段或动作。

### ContentTaskDetail

`GET /api/v1/content-tasks/{content_task_id}/detail` 是 `/content/tasks/$taskId` 的专用 read model；基础 `GET /content-tasks/{id}` 继续返回 command canonical `ContentTask`，不装配跨域详情。响应只包含页面需要的 compact task/product/platform/fact/current_content/generation/review/publishing/source/activity projection，不包含正文、Diff、完整 Review Context、Generation snapshot 或 Publication aggregate。

投影在单个 PostgreSQL `REPEATABLE READ` 请求内以固定查询次数形成。`current_content` 只解析 `ContentTask.current_content_version_id`；latest generation、当前主线 review、publication/source 与 Activity 的选择、排序和最多十项均由服务端完成。历史平台缺失时服务端返回冻结 identity；普通任务没有真实 Query Topic、GEO source 或 repair issue 时 `source=null`，不得制造空对象。客户端只请求该 endpoint，不把 Detail 写进 ListItem cache，不用旧 list row 覆盖 Detail；command 成功或 404/409 时失效对应 detail 与 list canonical cache，不自动重放命令。

### ContentEditorContext

`GET /api/v1/content-tasks/{content_task_id}/editor-context` 是 `/content/tasks/$taskId/editor` 的首屏一致读模型。一次返回 compact task/product/platform、锁定且不可变的 FactVersion Markdown、由 `current_content_version_id` 唯一定位的完整当前 ContentVersion、服务端选择的比较基线与 `ContentDiff`、最近 generation 摘要、当前主线的 compact AI lineage 和真实 source；当前指针为空时 `current_content/comparison_content/diff/current_lineage` 均为 `null`，指针无效时显式返回冲突错误。

该 endpoint 在单个 PostgreSQL `REPEATABLE READ` 请求内以固定查询次数形成，不包含完整 Review/Publication Context、全部版本历史、全部 GenerationJob 历史或完整 generation snapshot。generation-options、exact job snapshot/retry、humanization options 与 destructive preview 仍按用户触发单独请求。

AI Production 只消费 `CREATE_GENERATION_JOB`、`CREATE_HUMANIZATION_JOB` 与 GenerationJob 的 `RETRY` token。`GET /generation-options` 只在确认 Dialog 打开后读取，Prompt revision 和 model 不设浏览器默认值；create/retry/humanization 的同一命令重试复用稳定 `Idempotency-Key`。浏览器不拼装 snapshot，只对已提交或 Editor Context 指向的 `PENDING/RUNNING` job 轮询窄 `GenerationJobList`；观察到 terminal 后停止轮询并失效 Editor Context，当前内容仍只采用服务端 `current_content_version_id`。完整 `GenerationJobDetail.input_snapshot` 只在用户查看时读取，retry 只发送原 job ID。服务端只允许实际 latest job retry，并原样复制其 `input_snapshot`；humanization 创建新 GenerationJob 和基于源版本的新 ContentVersion，源版本不可变。

Editor 只消费 task/version 的 `primary_task` 与 `available_actions`。人工首稿和修订发送完整 `ContentRevisionCreate`（含 `change_summary`）；当前可编辑 HUMAN DRAFT 保存发送 `ContentDraftUpdate`（含 `expected_revision`，不含 `change_summary`）；提交审核发送 canonical revision 的 `CommandRequest`。409 保留本地表单，只允许用户显式重新加载，禁止自动覆盖、合并或重放。

### ContentVersionDetail

`GET /api/v1/content-versions/{content_version_id}/detail` 是 `/content/versions/$versionId` 的专用只读 read model。基础 `GET /content-versions/{id}` 继续返回 command/context 共用的 `ContentVersion`，不为详情页加入跨域 snapshot。新响应在单个 PostgreSQL `REPEATABLE READ` 请求内一次返回完整不可变内容、compact Fact identity、creator、`change_summary`、nullable `updated_at`、是否为 task 当前指针、基于真实 source/based-on 链路的 compact generation lineage，以及只属于目标版本的 review result/timeline。

响应不包含 `available_actions`、完整 ContentTask、Fact Markdown、全部 GenerationJob、全部版本历史或 Publication Context。无 generation/review snapshot 时显式返回 `null`/空数组；浏览器不得调用 Editor Context、Review Context 或 GenerationJob 形成 waterfall。页面对所有 source/status/current-pointer 组合均只读，不从 status 推导命令，也不得修改 `ContentTask.current_content_version_id`。

### PublicationWorkListItem

`GET /api/v1/publication-works` 默认只返回非终态工作，服务端处理 `page/page_size/status`，并按处理优先级、`updated_at DESC` 和稳定 ID 排序。`PublicationWorkListItem` 必填 content、`ContentTaskProductSummary`、platform/account、`workflow_stage`、`primary_task`、`available_actions`、`latest_event` 与 `updated_at`；Product 由 ContentTask 关联投影，latest event 在当前页 work IDs 上批量按 `created_at DESC, id DESC` 选择。有效 work 缺 event 时服务端显式失败，浏览器不得补默认事件、逐行请求或 join Product。

`/publishing/work` 保持三个窄读取：summary、ready items、work list 分别驱动独立 surface，不新增万能 context，也不要求三个 HTTP 响应来自同一 snapshot。Ready 候选包含暂时没有可用账号的已批准当前内容；此时 `matching_accounts=[]`、`available_actions=[]`，且 `ready_count` 使用相同候选定义。浏览器只按 `available_actions.includes("START")` 显示入口，用户必须明确选择响应中的 matching account；创建仍由服务端在事务内重新校验批准内容、current pointer、平台、账号与重复身份。

### PublishedArticle List / Detail

`GET /api/v1/published-articles` 以 `page/page_size/search/sort` 返回一次可绘制的成果行。`search` 覆盖 actual title、来源内容标题、final URL 和冻结平台/账号文本；`PublishedArticleSort` 只允许 `VERIFIED_DESC/ASC`、`PUBLISHED_DESC/ASC`、`TITLE_ASC/DESC`，所有顺序追加 `PublishedArticle.id ASC`。count 与 rows 使用相同搜索谓词，平台/账号展示只使用 PublicationWork 终态 snapshot，浏览器不得对分页结果本地筛选、排序或关联 live 配置。

`GET /api/v1/published-articles/{article_id}` 在同一 `REPEATABLE READ` 请求内以 PublishedArticle 固定的 PASSED verification 定位来源 ContentVersion，复用 `ContentVersionDetail` 返回 immutable Markdown、Fact/generation/review lineage，并附带按 `created_at ASC, id ASC` 排序的 PublicationWork events。服务端校验 Article/Work 同 ID、verification outcome、content version ID/hash；断裂上下文返回 `PUBLICATION_CONTEXT_INCOMPLETE`，前端不跨接口补装。

V2 Article List/Detail 都是 readonly surface，不消费响应中为既有消费者保留的 `available_actions/deletion`，不提供编辑、删除、重新核验或 Published Content Issue 命令。

### GeoObservationListItem

直接返回 compact result facts、关联成果数量、证据摘要和 recorder，不让客户端再抓多个 detail。

## 14. Workspace Read Model

复杂 Workspace 应使用按 surface 收窄的专用 endpoint/context。Editor 使用 `GET /content-tasks/{id}/editor-context`；Review 可使用独立 review context，一次返回审核所需的 immutable version、diff、fact/generation snapshot、quality issues、review history 和审核动作。

这样避免 6–10 个 API waterfall 和 snapshot 不一致，也避免把 Editor、Review、Publication 与完整历史塞进万能 context。

## 15. Workbench Aggregate

首页应有专用 aggregate read model，返回 fact_reviews/content_reviews/publication_verifications/publication_actions/content_issues/geo_accuracy_issues，以及 workflow health、geo summary、recent attention items。

不要在浏览器通过多个分页 list endpoint 计算 dashboard。

## 16. Status Registry

状态 token → label/tone/icon/help text。Status Registry 只负责显示，不负责动作资格。

## 17. Error Contract

推荐稳定错误结构至少表达：`code`、`message`、`request_id`、`field_errors`、`details`。

前端基于 `code` 做 UX，禁止解析任意英文 message 判断业务。

## 18. 权限

服务端负责最终授权和 action eligibility；前端根据 capability 改善体验、隐藏不相关入口，但不把隐藏 UI 当权限边界。

## 19. Contract-First 流程

```text
Domain design
  ↓
OpenAPI / database contract
  ↓
Backend & Frontend parallel
  ↓
openapi-typescript
  ↓
Typecheck
```

V2 不手写与 OpenAPI 重复的 API DTO 类型；允许独立 form schema、UI view model 和 resolved action type。

## 20. 验收检查

每个有业务推进的 list endpoint：

- [ ] `workflow_stage`
- [ ] `primary_task`
- [ ] `available_actions`（若列表需要）
- [ ] 不需要客户端拼多个 endpoint 才能画一行

每个 mutation：

- [ ] 服务端重新校验 action
- [ ] revision/expected_revision（若需要）
- [ ] stable error code
- [ ] audit
- [ ] canonical response

参考业务设计：
https://github.com/ccisnoxx/partsignal/blob/main/docs/GEO%E5%A4%9A%E5%B9%B3%E5%8F%B0%E5%86%85%E5%AE%B9%E8%BF%90%E8%90%A5%E7%B3%BB%E7%BB%9F%E6%96%B9%E6%A1%88%E8%AE%BE%E8%AE%A1.md
