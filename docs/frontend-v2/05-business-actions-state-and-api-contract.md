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

`CREATE_REPAIR_TASK`、`RESOLVE` 是独立动作。修复任务创建成功不等于 issue 已解决，前端不能本地自动推导 resolved。OPEN 问题的修复任务为 `OPEN` 时主任务是 `CONTINUE_REPAIR`；修复任务为 `COMPLETED` 或 `CANCELLED` 时都进入 `AWAITING_RESOLUTION / CONFIRM_RESOLUTION`，仍需显式提交解决记录。

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

V2 Article List 保持 readonly 且无操作列。Detail 的成果 payload 仍不可编辑，但消费 `OPEN_ISSUE` 或 `HANDLE_CONTENT_ISSUE + open_issue_id` 完成 Issue lifecycle 的最小交接；不提供成果编辑、删除、重新核验或 GEO 命令。

### PublishedContentIssue List / Workspace

`GET /api/v1/published-content-issues` 只按服务端 `status/page/page_size` 分页，列表 DTO 已包含六列、repair task ID 和动作投影；浏览器不得逐行读取 Article/Task。`GET /api/v1/published-content-issues/{issue_id}/workspace-context` 在单个 `REPEATABLE READ` 请求内返回 `issue + article + repair_task`，并校验 Issue/Article、PASSED verification、来源 ContentVersion ID/hash 与 repair source identity。

Workspace 首屏不得并发 issue detail、Article detail 和 ContentTask detail。`repair-context` 只属于动作选项，在 `CREATE_REPAIR_TASK` Dialog 打开时读取；POST 仍在锁内重新验证 revision、Fact 资格与唯一 repair source。409 保留本地输入且不自动重放，显式 reload 后重新消费服务端 tokens。

### QueryTopicListItem

`GET /api/v1/query-topics/list-items` 是 `/geo/topics` 的 V2 专用分页 read model；既有 `GET /api/v1/query-topics` 继续返回完整 `QueryTopicList`，供 V1、New Observation 和 Correction Workspace 读取全部选项。新 endpoint 只接受 `q/sort/page/page_size`，由服务端完成 canonical question 与 variants 搜索、稳定排序、count 和分页，不把完整列表语义改成分页，也不允许浏览器对当前页二次筛选或排序。

每个 item 一次返回 canonical question、intent、稳定 variants、`primary_task`、`available_actions`、`revision`、ADMIN-only `deletion`，以及所有角色可见的三类业务引用摘要：Content Task 直接引用、GEO Optimization 来源、Observation。引用由 Query Topic 服务 owner 使用同一组批量查询形成；浏览器不得逐行补请求，也不得从引用数量推导开始观测、编辑或删除资格。`USE_FOR_OBSERVATION` 是唯一主入口并携带 canonical `/geo/observations/new?queryTopicId=...` handoff；三类引用链接只进入已实现且可精确筛选的 Content Task 或 Observation 列表。

create/update 入口使用短 Dialog；canonical question 与 variants 的 trim、空值拒绝、去重和稳定顺序由服务端请求 schema 统一保证。PATCH/DELETE 必须提交 `expected_revision`；409 保留本地编辑输入且不得自动重放，只有显式 reload 才恢复服务端 canonical revision。DELETE 只在服务端同时投影 `DELETE` 和空 blocker 时执行；成功 mutation 失效完整 Topic options、V2 Topic list、GEO Insights，以及 New Observation、Correction Context、GEO/Content 引用消费者的真实 query keys。

### GeoObservationListItem

`GET /api/v1/geo-observations/list-items` 是 `/geo/observations` 的 V2 专用紧凑 read model；既有 `GET /api/v1/geo-observations` 继续返回完整 `GeoObservation` 并服务 V1。新响应只包含链尾观测的标准问题/搜索词、Product identity、统一 GEO 平台、发现/提及/准确 compact counts、关联成果数量、证据数量、recorder、观测时间与 `available_actions`，不含 notes、citation、文章 URL、attachment ID 或详情正文。

query 显式固定为 `search/product_id/geo_platform/accuracy/date_from/date_to/sort/page/page_size`。`search` 由服务端匹配 canonical question、raw prompt/search query、Product brand/part number；其他筛选、`OBSERVED_DESC|OBSERVED_ASC` 排序、count 和 `10|20|50` 分页也全部在服务端完成。URL 的 `q/productId/geoPlatform/accuracy/from/to/sort/page/pageSize` 只按这一组名称映射，不提供 alias；浏览器不得对分页结果本地过滤、排序、join Product/Query Topic 或逐行补请求。

manual 的 discovered/mentioned 由数据库约束保证完整，accuracy 的 null/`UNJUDGEABLE` 通过 `positive_count/assessed_count/total_count` 明确表达未评估；legacy `discovered=null` 表示未采集。投影缺少 Product、recorder、query、platform、manual result 或必填事实时返回结构化 409，不以 0 或空文案补齐。`CORRECT` 与 `DELETE` 只按服务端 `available_actions` 显示；`/geo/observations/{id}` 是 canonical readonly Detail，`CORRECT` 指向当前尾的 `/geo/observations/{id}/correct`。

### GeoObservationDetail

`GET /api/v1/geo-observations/{observation_id}/detail` 是 V2 Detail 唯一 read model；既有单条 GET、collection 与 POST 继续返回基础 `GeoObservation` 供 V1 和 command canonical response 使用。新响应以 `observation_kind` generated discriminator 分为 Legacy 与 Manual：Legacy 返回完整旧记录、Query Topic、Product、展开的 Published Articles 和 evidence；Manual 返回 selected/root/tail、Product 与服务端排序的完整 root→tail correction history，每个节点包含完整 `ManualGeoObservation`、nullable Query Topic 和该节点直接新增的 evidence。

Detail 在单个 `REPEATABLE READ` 请求中批量读取链、recorder、文章事实/终态 snapshot、citation 和 FileRecord，并统一签发 evidence 短期 URL。浏览器不得逐文件、逐成果或跨旧 GET join，也不得根据 `created_at/is_current/supersedes_id` 重排历史或推导资格。route-valid UUID 与服务端规范化 UUID 按大小写不敏感的身份比较，响应内部链身份仍精确校验。Legacy 才显示 answer summary、recommendation 和 citation；Manual 才显示逐篇 discovered、mentioned 和 accuracy，历史 null 保持“未记录/未判断”。所有节点均 readonly；CORRECT 指向服务端给出的链尾 canonical URL，DELETE 只在链尾 `available_actions` 包含 token 时复用既有确认命令。DELETE 成功后失效已知链节点 Detail、Correction Context、GEO List/Insights、Query Topic list-items 与对应 Product Detail。

### New GeoObservation

`/geo/observations/new` 直接组合既有权威接口：Product 使用服务端分页搜索，Query Topic 使用 `GET /api/v1/query-topics`，选择 Product 后使用 `GET /api/v1/geo-observation-publications?product_id=...` 读取完整合格 Published Article 候选。当前首屏没有真实 waterfall 或一致性缺口，因此不增加 creation-options read model，浏览器也不得跨分页 join 或自行推导文章资格。

创建只提交 `GeoObservationCreate`：逐篇 `discovered` 与 `mentioned` 必须由用户显式选择，`accuracy` 可为空，附件必须先完成既有 upload-intent → object store → complete 流程；新建请求不提交 `supersedes_id`，也不承载 legacy `recommendation/citation`。当前 POST 合同没有 `Idempotency-Key`，前端以同步提交锁和 pending 禁用保证单次请求；409 `GEO_PUBLICATIONS_CHANGED` 只允许显式重读候选并保留仍有效输入，不自动 replay。

创建成功后失效 GEO List、Insights、Query Topic list-items 与受影响 Product Detail cache，并直接使用 POST canonical response 的 `id` 导航 `/geo/observations/{id}`；不得通过 List 搜索发现新 ID。新建页只创建根观测，Correction 继续由后端 append-only 命令及锁内资格校验负责，原 Observation 不可在本页修改。

### GeoObservationCorrectionContext

`GET /api/v1/geo-observations/{observation_id}/correction-context` 是 `/geo/observations/$observationId/correct` 的唯一首屏 read model。响应组合现有 `ManualGeoObservationDetail`、服务端当前 Published Article 候选及其尾节点初始事实、以及仅在历史 Query Topic 为空时提供的 Topic 选项；请求链内任一历史 ID 时，`detail.chain_tail_id` 是 canonical URL 和后续 `supersedes_id` 的唯一来源。Legacy、缺失记录、无 `CORRECT` 资格或损坏链必须显式失败，浏览器不得并发 Detail、候选和 Topic 接口自行 join。

Correction 继续复用 `POST /api/v1/geo-observations`，不增加专用写入协议。Product、Search Platform、Search Query 和非空 Query Topic 从上下文冻结；表单只持有本次 `tested_at`、当前候选的完整显式事实、新 Evidence ID 与新 Notes。历史节点、历史结果和历史 Evidence 始终只读且不得重新提交；服务端在锁内重新校验 actor、当前尾、冻结字段、候选全集和证据未复用。

`GEO_PUBLICATIONS_CHANGED` 与 `REVISION_CONFLICT` 到达后禁止自动重放。页面保留草稿与已完成上传，只有用户显式刷新上下文后才按 Published Article ID 合并仍有效事实、为新增候选保留 `null`、移除退出候选，并用新 `chain_tail_id` 无历史记录地 replace canonical URL。成功时先解除 DirtyGuard，再按 POST 响应 ID 进入新 Detail，并失效 GEO List/Detail/Correction Context、Insights、Query Topic list-items 与对应 Product Detail cache。

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
## 21. GEO Insights read model 与优化任务

- `/geo/insights` 与 `/geo/insights/print` 只使用同一个 `GET /api/v1/geo-insights` read model 绘制筛选选项、趋势、平台、内容、覆盖、建议与数据质量；浏览器不组合 Observation 分页接口计算指标。
- canonical URL 固定为 `from/to/productId/contentPlatformId/geoPlatform/publishedArticleId/queryTopicId`，显式映射七个 API query 参数；日期缺失时写回 UTC 当日及前 29 日。
- Print 复用 Screen 的 URL schema、query key、格式化与报告 rows；只从响应 `filter_options` 读取筛选标签，缺失已选标签时显式失败，不显示 UUID fallback。
- Print route 保留鉴权与 Query provider，但移除普通 AppShell 导航、账户和面包屑；不读取 creation-options、不发 mutation，打印仅调用浏览器原生 `window.print()`。
- 内容与覆盖行只消费服务端 `primary_task` 和 required nullable `optimization_action`。前端不根据 section、status、rate 或 Recommendation 推断优化资格。
- 优化 Dialog 按需复用 Content Task creation-options，完整 source+target body 的相同人工重试复用 `Idempotency-Key`；409/stale 不自动重放，保留输入并要求显式刷新 Insights 与 options。
- 成功采用 POST 响应 ID 进入 Content Task Detail，并失效 Insights、Content Task list、目标 Product detail；Coverage 来源另失效 Topic list。

## 22. Platform List readiness 与管理命令

- `/settings/platforms` 继续使用 `GET /api/v1/platform-profiles`。显式 `page/page_size` 启用服务端搜索、类型/启停/readiness 筛选和分页；两者都省略时保留既有完整参考集合语义。
- `configuration_complete` 与 `configuration_status` 只表达是否绑定 Prompt。独立 `readiness_status` 按“缺 Prompt优先；否则零启用账号为缺账号；其余完整”投影；`enabled_platform_account_count` 才是“N 个可用”的权威数量，`platform_account_count` 继续表示全部账号。
- 同一响应返回不受当前筛选影响的 readiness summary 和按名称、ID 稳定排序的 `platform_type_options`。普通已认证用户获得 `primary_task=null`、空 actions 与 `deletion=null`；浏览器不得通过管理员 Platform Type endpoint 或当前页反推选项与权限。
- ENABLE、DISABLE 与 DELETE 都提交当前行 revision；DELETE 使用 required `expected_revision` query。409 只提示并刷新 canonical list，不自动重放。服务端在行锁内重新校验 revision、目标状态、权限与实时 blocker。

## 23. Platform Workspace Core read model 与 revision 编辑

- `/settings/platforms/$platformId` 首屏只消费 `GET /api/v1/platform-profiles/{platform_profile_id}`。响应在一次 `REPEATABLE READ` 中返回 `profile/account_summary/reference_summary/platform_type_options`；不得先读 Platform List 搜索当前行，也不得无条件 waterfall Account、Prompt 或 Type endpoints。
- Detail 对所有当前已认证角色开放。ADMIN 的 `profile.primary_task/available_actions/deletion` 复用 Platform List 投影；ENGINEER 得到 `primary_task=null`、空 actions 与 `deletion=null`。写 endpoint 继续由服务端最终校验 ADMIN，浏览器不通过 `isAdmin` 补动作。
- canonical Tab 为 `overview|accounts|generation`。Accounts 仅进入时按平台读取；Prompt options 仅 ADMIN 进入 Generation 时读取。Prompt options 使用既有稳定 reference list，不读取 Prompt Detail 拼候选。
- Overview 和 Generation 各自持有 RHF+Zod 草稿，但共享 Detail 的当前 Platform revision。Overview PATCH 保留当前 Prompt；Generation PATCH 保留当前身份字段；任一保存只发送一个完整 `PlatformProfileUpdate`，不得拆成多个 PATCH。
- `REVISION_CONFLICT` 保留未提交字段、Logo 或 Prompt 选择，不自动重放；只有用户显式 reload 才放弃草稿并采用服务端新 baseline。
- Logo 上传复用通用文件 transfer 与现有 `PLATFORM_LOGO` 生命周期。SVG 在浏览器边界明确拒绝；官网候选必须显式请求、预览和再次确认，保存 Platform PATCH 前不得进入平台投影。
- Platform mutation 精确失效 Platform List、当前 Detail，以及受状态/身份/Prompt 影响的 Content creation/reference/generation options 和 Publication ready/workspace 消费者；删除后移除已删除平台的 Detail/Accounts cache。不得清空整个 QueryClient。

## 24. Platform Workspace 发布账号动作与并发边界

- Accounts Tab 按 `platform_profile_id` 延迟读取既有 `PlatformAccountList`，不重复平台列。集合级创建是页面动作，不新增 `CREATE` row token；当前 ADMIN/ENGINEER 均可尝试创建，停用平台仍由 POST 锁内返回 `PLATFORM_DISABLED`。
- 行级 Primary/overflow 只穷尽映射 `primary_task/available_actions/deletion/revision`。ADMIN 与 ENGINEER 均获得 UPDATE 和启停动作，仅 ADMIN 获得 deletion/DELETE；平台停用投影 `HANDLE_PLATFORM`，但既有账号编辑与启停仍由服务端动作决定。
- UPDATE、ENABLE、DISABLE 和 DELETE 都提交当前账号 revision。DELETE 使用 required `expected_revision` query；服务端按 Platform → Account 固定顺序锁定后先拒绝 stale revision，再实时复核非终态 PublicationWork。409 保留 Dialog/表单上下文，只有显式 reload 才采用新 baseline，禁止自动重放。
- 同平台账号标识以数据库 `lower(btrim(account_identifier))` 唯一约束为权威。预检与约束竞态统一返回 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`，并用 `details.errors[].loc=["body","account_identifier"]` 定位字段；浏览器不解析错误 message 判断冲突。
- Account mutation 只失效 Platform lists/current detail/current accounts，以及 Publication ready items/work lists/workspace contexts 中的实际消费者；不失效冻结的 PublishedArticle snapshot，也不触碰 Content queries。

## 25. Platform Type Settings 合同

- `/settings/platforms/types` 只在既有 ADMIN route boundary 下读取 `GET /api/v1/platform-types`；服务端四个 CRUD endpoint 均继续以 ADMIN 为最终权限权威，不提供 ENGINEER 只读模式。Platform List/Workspace 仅向管理员显示 subsettings 入口，Platform Type 不占 Sidebar、不创建 Detail route。
- 列表固定展示 Name、Slug、`platform_count`、overflow。`platform_count` 是全部 Enabled/Disabled PlatformProfile 的直接引用总数，由服务端与 deletion blocker 同一 grouped query 投影；列表按 `lower(name), id` 稳定排序，客户端不得另取 Platform List 计数或排序。
- `primary_task=EDIT_CATEGORY` 是服务端任务语义，不产生独立 Primary button。UPDATE、DELETE 与查看非空 blocker 全部进入 overflow；未知 action/primary/blocker 必须显式失败。只有包含 DELETE 且 blocker 为空时才进入确认删除。
- create/update Dialog 只提交 Name 与 Slug；name 由服务端 trim 且不唯一，slug 不自动规范化、数据库唯一并可修改。PATCH body 与 DELETE query 都提交 canonical revision；服务端锁行后先校验 revision，DELETE 再复核 PlatformProfile 引用，分别返回 `REVISION_CONFLICT` 与 `PLATFORM_TYPE_IN_USE`。
- 409 保留表单或删除上下文，不自动 GET/replay；显式 reload 才采用服务端 baseline。成功 mutation 精确失效 Type settings、全部 Platform lists 与全部 Platform details，覆盖 options 和名称消费者，不触碰 Account/Prompt/Content/Publication cache。

## 26. Platform Prompt Preview Options 与真实首稿命令

- `GET /api/v1/platform-prompts/{platform_prompt_id}/preview-options` 是 ADMIN-only 窄 read model，返回 `platform_prompt + contexts + models`。contexts 只来自当前绑定目标 Prompt 的 OPEN、未归档、无 current content 候选，并最终复用 ContentTask `CREATE_GENERATION_JOB` action；预筛不是授权，existing POST 仍在任务锁内重验全部事实。
- contexts 只含 Task identifier、Product、Platform 与 Fact version identity，按任务 `updated_at DESC, id DESC` 稳定排序；models 与既有 generation-options 共用启用渠道、启用模型、`test_status=PASSED` 的唯一 query owner。sparse/dense 都保持固定查询次数，不返回 Markdown、snapshot、credential 或业务历史。
- 浏览器仅在已保存、clean、Detail/options Prompt ID 与 revision 一致时允许确认；context/model 无默认。命令继续调用 `POST /content-tasks/{id}/generation-jobs`，payload 只含 options 返回的 Prompt ID/revision 和显式模型。同一未创建成功的 command signature 重试复用 key，payload 改变、成功或 `IDEMPOTENCY_CONFLICT` 后废弃旧 key；同步 pending 锁防止双击。
- 页面只跟踪 create response 的 Job ID，并只在该 Job `PENDING/RUNNING` 时轮询 exact task Job list。`FAILED` 只显示公开 code/summary；`SUCCEEDED` 按 `content_version_id` 读取既有不可变 ContentVersion，不读取 GenerationJob detail/snapshot 拼结果，也不自动 retry 或伪造成功。
- create 与 terminal 精确失效 Preview Options、Content Task list/detail/editor contexts；create 另刷新 exact task Job list。Prompt update/delete 与 Platform bind/unbind 失效 Preview Options root。历史 Job/Version 不因当前 Prompt 或绑定变化而失效、重写或改标。
