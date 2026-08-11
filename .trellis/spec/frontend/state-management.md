# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

服务端状态由 TanStack Query 持有；可分享、可恢复的集合视图状态由 React Router 查询参数持有；表单编辑、弹窗开关和短暂输入草稿保留在页面内。不得新增全局 Store 来保存这些状态。

---

## State Categories

<!-- Local state, global state, server state, URL state -->

- **服务端状态**：使用既有 query key、stale time 和显式失效规则。
- **URL 视图状态**：搜索、Tab、分页和“显示停用账号”等可恢复视图写入查询参数。当前参数包括产品 `q/page`、任务与观测 `page`、平台管理 `q/platform_type_id/status/configuration_status/page/page_size/platform`、Prompt 管理 `tab/platform_prompt_id/new`、平台关联页 `platform_profile_id`、发布工作台 `tab/page/status/selected`、用户 `q/account_type/status/page/page_size`。用户页默认只查启用账号并从 URL 省略该默认值；`status=DISABLED` 只查停用账号，`status=ALL` 查询全部，状态选择器和“显示停用账号”开关只能投影这一份状态。平台管理筛选与分页读取服务端平台集合契约；Prompt 模板列表读取独立模板端点，短暂名称搜索只过滤已加载模板，不推断平台绑定；发布工作台的 `tab=works|articles|issues` 决定资源类型，`status` 只筛选当前 Tab 的服务端状态，`selected` 只保存当前详情身份，切换 Tab 或分页时必须清理不再适用的筛选与详情身份。
- **页面本地状态**：Modal、Dropdown 目标、Ant Form 实例、dirty/error section 和尚未提交的输入。Prompt 名称与 Markdown 草稿以“标签 + 模板或新建态”身份隔离，保存或显式重新加载才更新基线；任务、源版本、模型选择、AI 生成弹窗模型和当前预览 Job 留在页面本地，不进入 URL 或全局 Store。
- **主题状态**：只由 `ThemeProvider` 维护，禁止页面复制主题状态。从显式主题切回 `system` 时立即重新读取当前 `matchMedia` 结果，不沿用离开系统模式前的解析值。

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

只有跨路由且无法由 URL、TanStack Query 或现有 Provider 明确拥有的状态才考虑全局状态。新增全局 Store、事件总线或通知框架需要独立设计批准；普通集合筛选、分页和表单状态不满足该条件。

---

## Server State

<!-- How server data is cached and synchronized -->

- 复合详情先确定身份查询。身份查询失败可以阻断整页；次级查询必须在所属区块处理 loading/error/retry，不得用空数组或默认对象伪造成功。
- 产品事实以 `product + draft` 为身份，`versions` 只影响版本 Tab；内容任务以 `task` 为身份，`options/jobs/versions` 分别属于生成输入、生成作业和内容版本区块。
- 长期保存成功后使用 mutation 返回值更新 Ant Form 的 `expected_revision`，再失效原 query key；不得继续提交旧修订号，也不得新增兼容 fallback。
- Prompt 保存成功后用 mutation 返回值替换名称、正文基线和 revision；`REVISION_CONFLICT` 必须保留本地草稿并提供显式重载。脏草稿在切换 Prompt 标签、模板、站内路由或刷新/关闭前提示，不能通过查询失效静默覆盖。
- Prompt 输出预览按创建响应中的 Job ID 从任务级作业列表轮询，成功后读取不可变内容版本；已有结果属于原快照，Prompt 后续保存不得把该结果改标为当前配置预览。

### 删除 URL 当前对象

删除由路径或查询参数选中的当前对象成功后，先从集合缓存投影中过滤已删除 ID，再清理 URL 身份；详情 query 使用 `refetchType: 'none'` 标记失效，不能在旧身份仍有活动 observer 时调用 `removeQueries`，否则会重新 GET 已删除资源。随后正常失效集合查询，让服务端列表校准缓存；删除失败不得修改集合、URL 或详情。

```tsx
queryClient.setQueryData(listKey, (current) => current
  ? { ...current, items: current.items.filter((item) => item.id !== deletedId) }
  : current);
setSearchParams(nextWithoutDeletedId, { replace: true });
await Promise.all([
  queryClient.invalidateQueries({ queryKey: detailKey, refetchType: 'none' }),
  queryClient.invalidateQueries({ queryKey: listKey }),
]);
```

回归测试必须同时断言：成功删除后不再请求该详情；列表刷新不会重新选中该 ID；失败时原详情和错误保留；普通直接访问不存在 ID 仍展示明确 `NOT_FOUND`。

### 跨标签页刷新删除投影

“查看引用”在新标签页打开时，各标签页拥有独立的 QueryClient。新标签页删除引用对象后，原标签页不会收到 mutation 的缓存失效通知，因此承载删除投影的集合查询必须在窗口重新获得焦点时重新读取服务端状态：

```tsx
const resources = useQuery({
  ...resourceQueryOptions(query),
  refetchOnWindowFocus: 'always',
});

const currentTarget = target
  ? resources.data?.items.find((item) => item.id === target.id)
  : undefined;
```

- 删除条件弹窗的本地目标只用于提供 ID；当前阻断条件必须按该 ID 从最新 query data 派生，不能继续用点击时的完整行快照渲染。
- 引用清除后，原页应关闭已失效的条件弹窗，并根据新的 `available_actions/deletion` 展示删除动作。
- 不要为此新增轮询、全局 store 或 `BroadcastChannel`；窗口焦点刷新已经覆盖当前人工跨标签页操作流程。
- 回归测试应模拟失焦、服务端投影变化、重新聚焦，并断言发生重新请求、条件弹窗关闭且删除动作出现。

## 可编辑 Workspace 的服务端状态与本地草稿合同

### 1. 适用范围 / 触发条件

当页面同时持有服务端 read model、可编辑本地草稿、`revision` 和服务端动作 token 时适用。本合同以产品事实工作台为已实现基线，防止后台刷新、参数切换或过期请求覆盖尚未保存的 Markdown。

### 2. 签名

```text
GET  /api/v1/products/{product_id}/facts
PUT  /api/v1/products/{product_id}/facts
POST /api/v1/products/{product_id}/fact-review-submissions

query key: ["products", "facts", productId]
PUT body:  ProductFactsDraftUpdate
POST body: FactReviewSubmissionRequest
```

路由参数变化必须形成新的编辑身份；复用同一页面组件时以 `productId` 作为 `key` 或在身份边界显式重建表单，不能只比较 revision。

### 3. 合同

- GET 一次返回 `product`、`body_markdown`、`classification`、`approved_fact`、`pending_fact`、`available_actions` 和 `revision`；浏览器不得再请求 Product Detail 或事实版本列表自行拼接。
- `body_markdown` 与 `classification` 是页面本地表单；Product Context、版本摘要和动作仍属于 TanStack Query server state。
- `SAVE`、`SUBMIT_REVIEW` 的存在只由 `available_actions` 决定；dirty、非空校验和 mutation pending 只控制已返回动作的 enabled 状态。
- PUT/POST 都携带当前基线 `expected_revision`。PUT 成功必须以 canonical `ProductFactsDraft` 更新 query cache、表单和 revision；POST 成功后重新读取 workspace actions，且不跳转未实现的审核页面。
- mutation 前取消同 key 的在途 GET，防止旧响应覆盖 canonical cache。后台 refetch 失败但已有 data 时保留编辑器和 DirtyGuard，并单独展示可重试错误；只有初始请求无 data 时才替换为整页错误态。
- dirty 表单不接受后台 query reset；`REVISION_CONFLICT` 保留本地值，只有用户显式 reload 才采用服务端值。

### 4. 校验与错误矩阵

| 条件 | 服务端结果 | 前端处理 |
| --- | --- | --- |
| `body_markdown` 仅空白 | `422 VALIDATION_ERROR` | 字段 / ErrorSummary 显示，不伪造保存成功 |
| `change_summary` 仅空白 | 请求边界 `422` | Dialog 字段错误并保持打开 |
| `expected_revision` 过期 | `409 REVISION_CONFLICT` | 保留草稿、显示 request ID 和显式 reload |
| 已有 `PENDING_REVIEW` | `409 FACT_REVIEW_PENDING` | 刷新服务端动作，不本地推导状态 |
| 产品为 `RETIRED` | `409 INVALID_STATE_TRANSITION` | read model 无写动作；绕过 UI 仍失败 |
| 背景 GET 失败且 cache 有 data | query error + stale data | 保留表单/DirtyGuard，显示“刷新失败”与重试 |
| 初始 GET 为 403/404 | ErrorEnvelope | 专用整页状态并保留 request ID |

### 5. Good / Base / Bad

- Good：保存成功后立即采用 PUT canonical response，revision 前进，dirty 清除；随后只失效相关列表/详情投影。
- Base：窗口聚焦刷新失败时继续显示当前服务端快照和本地 dirty Markdown，用户可保存或重试刷新。
- Bad：`if (query.error) return <Failure />` 无条件卸载已有 data 的编辑器，或用 `status === "ACTIVE"` 在页面补出提交动作。

### 6. 必需测试

- Contract：GET/PUT/POST 响应码和 `ProductFactsDraft` required 字段；运行 `make contract-check` 并比较 generated clients。
- Backend unit/integration：固定查询数、action/guard 对称、stale SAVE/SUBMIT、RETIRED、pending 唯一性，以及保存后既有 snapshot 正文不变。
- Frontend component：canonical save、dirty background-refetch failure、同 revision 跨产品切换、409 本地保留/显式 reload、403/404 request ID。
- Playwright：单 GET、Ctrl/Cmd+S、DirtyGuard、提交后停留、SAVE/POST conflict、loading/empty/error，以及 375/768/1024/1440 无页面级横向溢出。

### 7. Wrong vs Correct

#### Wrong

```tsx
if (facts.error) return <FactWorkspaceFailure />;
const canSubmit = workspace.product.status === 'ACTIVE';
```

这会在背景刷新失败时卸载 dirty 草稿，并在客户端复制服务端资格规则。

#### Correct

```tsx
if (!facts.data && facts.error) return <FactWorkspaceFailure />;
const actions = resolveFactWorkspaceActions(workspace, actionOptions);
return <FactWorkspacePage key={productId} />;
```

有缓存数据时继续呈现编辑器并单独显示刷新错误；业务动作来自服务端 token，路由身份变化重建本地表单。

---

## Content Editor 的 Context、表单与 mutation 边界

- query key 为 `contentKeys.editorContext(taskId)`，首屏只读取一个 Editor Context；task detail/list、version 与 job keys 继续由 Content API owner 统一登记，页面不得临时拼 key。
- TanStack Query 持有 task/product/platform/fact/current/diff/lineage/source snapshot；RHF 持有 title/summary/body/tags/change summary；tab、编辑模式和 Dialog 留在 React local state，不进入 URL 或全局 Store。
- Manual/revision 成功后重读 context/detail/list；SAVE 成功采用 canonical ContentVersion 重设表单和 revision，再重读受影响 projection；SUBMIT/DELETE/ABANDON 后只由服务端 context 确定新主线和动作。
- dirty 时禁止隐式保存后提交。`REVISION_CONFLICT` 保留本地输入和 request ID，只有显式 reload 才采用最新 context；Preview/Split/Diff 切换不得改变 form value、dirty baseline 或触发离开确认。
- 当前指针切换后旧 ContentVersion cache 仍是历史只读；不得用最大 version、created_at、列表末项或 mutation 响应写入错误的 context shape。

---

## 只读 Product Fact History 的 URL 与 Read Model 合同

### 1. 适用范围 / 触发条件

当 Product Fact History 需要产品标题、不可变版本扫描和可恢复分页时适用。它是 Product domain 的专用列表边界，不得推广为 Content History 或通用 History framework。

### 2. 签名

```text
URL: /products/$productId/facts/versions?page=1&pageSize=20
GET: /api/v1/products/{product_id}/fact-history?page=1&page_size=20
operationId: listProductFactHistory
query key: ["products", "fact-history", productId, { page, page_size }]
```

### 3. 合同

- `page >= 1`；`pageSize/page_size` 只接受 `10 | 20 | 50`，默认 20，两个 URL 参数始终显式保留。
- `ProductFactHistoryList` 返回 `product`、窄 `items`、`page`、`page_size`、`total`；item 只含 `id/product_id/version/status/classification/change_summary/created_by/created_at`。
- 服务端在 `REPEATABLE READ` 中按 `version DESC` 排序。浏览器不得重新排序、请求 Product Detail 拼标题，或消费旧详情型 `FactVersionList` 做客户端分页。
- 响应 `product.id` 和每个 `item.product_id` 必须与 URL `productId` 大小写不敏感地一致；任一不一致都阻断整张表。
- 页面只读且没有操作列，不从 status 推导 `APPROVE/REQUEST_CHANGES/RETIRE/DELETE`。

### 4. 校验与错误矩阵

| 条件 | API / Router 结果 | 页面处理 |
| --- | --- | --- |
| 非法 `page/pageSize` 或额外 search | Router `replace` 到 `page=1&pageSize=20` | 只请求规范化后的 API 参数 |
| 产品不存在 | `404 ErrorEnvelope` | 明确 not-found，无 retry |
| 会话受限 | `403 ErrorEnvelope` | 明确 forbidden，无 retry |
| 初始普通失败 | ErrorEnvelope / HTTP error | 表内错误与 retry |
| 背景刷新失败且已有 data | query error + stale data | 保留只读列表并显示 retry |
| Product/item 边界不匹配 | 200 但身份矛盾 | 阻断全部历史数据 |

### 5. Good / Base / Bad

- Good：从 `VIEW_FACT_HISTORY` 进入 canonical URL，一次 GET 绘制产品标题、六列和分页，点击版本进入 readonly Detail。
- Base：空 `items` 且 `total=0` 显示 empty；当前页完全保持服务端返回顺序。
- Bad：先 GET Product Detail，再 GET 无分页的 `fact-versions`，客户端截取、排序并从 `available_actions` 生成操作列。

### 6. 必需测试

- Contract/backend：OpenAPI 生成一致；10/20/50 分页、`version DESC`、窄字段、Product context、404 与 repeatable-read。
- Component：严格六列、状态/分级、无操作列、版本链接、empty/error/retry、URL Product 边界。
- Fixture Playwright：canonical direct/refresh/Back/Forward、分页 URL、服务端顺序、四档宽度、键盘/焦点、未声明 API 失败。
- Real stack：复用既有 Product Facts Flow B，展示 v2、v1 并从列表进入 v2 readonly Detail；不得新增第二条 flow。

### 7. Wrong vs Correct

#### Wrong

```tsx
const [product, versions] = await Promise.all([getProductDetail(id), listFactVersions(id)]);
const rows = versions.sort((left, right) => right.version - left.version);
```

这会产生浏览器 join、无界详情载荷和第二套业务顺序。

#### Correct

```tsx
const history = useQuery(productFactHistoryQueryOptions(productId, search));
return <FactHistoryPage productId={productId} search={search} />;
```

一次专用 read model 同时提供 Product identity、服务端顺序和 URL 可恢复分页。

---

## New Content Task 的 URL、Options 与幂等合同

### 1. 适用范围 / 触发条件

实现或修改 `/content/tasks/new`、普通 `ContentTask` 创建、Product Facts 的 `CREATE_CONTENT_TASK` handoff 或创建成功进入 Detail 时适用。该合同只覆盖任务上下文选择，不包含编辑、生成、人工首稿、审核或发布。

### 2. 签名

```text
URL:  /content/tasks/new?productId=<uuid>
GET:  /api/v1/content-tasks/creation-options?requested_product_id=<uuid>
POST: /api/v1/content-tasks
body: ContentTaskCreate(product_id, fact_version_id, platform_profile_id)
query key: ["content", "tasks", "creation-options", requestedProductId | null]
header: Idempotency-Key = crypto.randomUUID()
```

### 3. 合同

- `productId` 是唯一 URL 表单状态。合法 UUID trim 后转小写并请求服务端资格；纯空或非法值保留为明确页面状态，不发送非法 `requested_product_id`。用户显式更换 Product 写入新的历史项，refresh 与 Back/Forward 恢复 Product。
- options 一次返回活动 Product、每个 Product 的非空 `APPROVED` FactVersion 和活动 PlatformProfile；`requested_product.eligibility` 只接受 `ELIGIBLE | NOT_FOUND | PRODUCT_INACTIVE | NO_APPROVED_FACTS`。浏览器不得请求 Product list 后逐产品加载 facts，也不得按 raw status 推导最终资格。
- Product 改变时只清除 `fact_version_id`，保留独立的 Platform 选择；Fact 下拉只能消费当前 Product 的 `approved_fact_versions`。URL handoff 切换必须先确认 options 的 `requested_product.product_id` 与 URL 匹配，避免 placeholder cache 覆盖当前表单。
- payload 严格来自 generated `ContentTaskCreate` 三字段。Topic/GEO Source、Content Intent、audience、angle、conversion goal、format、length、generation/manual mode、notes、Prompt 和 AI model 都不得进入表单、DTO 或请求。
- 页面以 `useRef` 保存 `{payloadSignature, key}`。同一 payload 的失败重试复用 key；rerender 不换 key；payload 明确变化或收到 `IDEMPOTENCY_CONFLICT` 后生成新 key；成功后废弃旧 key。pending ref 与按钮禁用共同阻止双击重复请求。
- options 只负责显示范围，POST 仍由服务端在事务锁内重新校验产品、事实和平台。平台缺 Prompt 不阻止任务或后续人工首稿，只能由未来系统 AI generation job 拒绝。
- 成功后先清除 dirty 与旧 key，失效 `contentKeys.lists()`，并采用 POST 响应的 canonical `ContentTask.id` 进入 `/content/tasks/$taskId`；不得通过列表搜索新任务 ID，也不得创建一次性占位成功页。

### 4. 校验与错误矩阵

| 条件 | 页面处理 |
| --- | --- |
| `productId` 为空或非法 | 明确提示，不请求非法 UUID，不自动选择 Product |
| handoff 为 `NOT_FOUND / PRODUCT_INACTIVE / NO_APPROVED_FACTS` | 展示精确状态；用户可显式选择其他合格 Product |
| 无合格 Product / 无活动 Platform | 展示 Product Facts / 平台配置引导，不伪造空选项或选择停用资源 |
| options 初始失败 | 保留独立 error + retry；不渲染可提交的猜测选项 |
| 客户端缺少三字段 | FormField 与 ErrorSummary 同时定位；不发 POST |
| 服务端字段 validation | 只把三个已知 body 字段映射回字段；未知 issue 留在 form summary |
| `FACT_NOT_APPROVED`、平台停用、403、404、409 | 保留选择，展示服务端 message 与 request ID |
| `IDEMPOTENCY_CONFLICT` | 保留选择并废弃冲突 key；下一次提交生成新 key |
| 成功 | 列表 query 失效、dirty/key 清除、进入 canonical Detail |

### 5. Good / Base / Bad

- Good：从 Product Detail handoff 进入，服务端确认 `ELIGIBLE` 后预选 Product；用户选 Fact 和 Platform，用一个 UUID key 创建并进入响应 ID 对应的 Detail。
- Base：handoff Product 已停用，页面明确提示且不自动改选；用户手动选择其他 Product 后只重选 Fact，原 Platform 保留。
- Bad：`GET /products -> N × GET /fact-versions -> GET /platform-profiles`，或按 `status` 在浏览器拼资格；这会产生 waterfall、不同快照和第二套业务规则。

### 6. 必需测试

- Contract/backend：冻结三字段 body、options schema/权限/空态/稳定排序/固定查询数，以及 POST 资格、幂等冲突、并发唯一和 options 过期复核。
- Component：URL normalization、handoff、dependent Fact、Platform 保留、三字段 payload、key 生命周期、loading/empty/error、DirtyGuard、pending、字段/form error 与 canonical Detail 导航。
- Fixture Playwright：列表与 Product Detail 入口、direct/refresh/Back/Forward、非法/失效 handoff、精确 body/header、错误/request ID、四档宽度、键盘/焦点及未声明 API 失败。
- Real stack：复用 Product Facts Flow A，批准事实后经真实 handoff 创建 ContentTask 并进入单一 read model Detail；断言 Product、Fact、Platform 与 `CREATE_FIRST_DRAFT`，不得新增第二套 orchestration 或进入 Editor。

### 7. Wrong vs Correct

#### Wrong

```tsx
const products = await listProducts();
const facts = await Promise.all(products.map((product) => listFactVersions(product.id)));
const key = productId;
```

这会在浏览器复制资格、形成 N+1，并把业务 ID 冒充唯一幂等键。

#### Correct

```tsx
const options = useQuery(contentTaskCreationOptionsQueryOptions(productId));
const key = current.signature === signature ? current.key : crypto.randomUUID();
await createContentTask(body, csrfToken, key);
```

选择范围来自单一 read model；同载荷失败重试复用随机 key，POST 仍由服务端最终校验。

---

## Content Task Detail 的单一 Read Model 与 cache 合同

### 1. Scope / Trigger

- 修改 `/content/tasks/$taskId`、Content domain detail query key、生命周期命令缓存或 New Task 成功导航时适用。

### 2. Signatures

```ts
contentKeys.detail(taskId: string)
contentTaskDetailQueryOptions(taskId: string)
GET /api/v1/content-tasks/{content_task_id}/detail
```

### 3. Contracts

- `/content/tasks/$taskId` 只使用 `contentTaskDetailQueryOptions(taskId)` 与 `contentKeys.detail(taskId)` 请求 `GET /api/v1/content-tasks/{content_task_id}/detail`；页面内部不得拼 query key，也不得请求 List、Fact、ContentVersion、GenerationJob、Review、Publication 或 GEO 接口补字段。
- Detail response 与 `ContentTaskListItem` cache 是不同 projection，禁止互相写入或用旧 list row 覆盖 detail。窗口重新聚焦按既有 Detail 约定重新读取，不增加轮询；Generation polling 属于后续 Editor。
- Primary/overflow 只消费响应的 `primary_task/available_actions/deletion/revision`。Content domain 内共享 action registry 与 lifecycle command；command 成功同时失效对应 detail、lists 和必要 preview，404/409 刷新 canonical projection 但不自动重放。
- Activity 保持服务端数组顺序；null section 显示“暂无”。404、403 与 generic retry 分开处理，Dialog 必须恢复 overflow trigger 焦点。

### 4. Validation & Error Matrix

| 条件 | 处理 |
| --- | --- |
| Detail `404` | 显示任务不存在，不请求列表补救 |
| Detail `403` | 显示无权访问，不泄露摘要 |
| generic error | 显示重试入口，只重取 detail key |
| lifecycle `409` | 显示 request ID，失效 detail/list，不自动重放 |
| section 为 `null` | 明确显示“暂无” |
| New Task 成功 | 清 dirty/幂等键、失效列表、按 POST response ID 进入 Detail |

### 5. Good / Base / Bad Cases

- Good：route loader 和页面共用一个 detail key，生命周期后刷新 canonical projection。
- Base：后续 Editor/Review/Publication route 尚未实现时只生成已批准 href，不创建占位页。
- Bad：用旧 List row 写入 Detail cache，或从 `workflow_stage` 推导替代 Primary。

### 6. Tests Required

- Component 覆盖 section mapping、空摘要、typed actions、404/403/retry、409 和焦点返回。
- Fixture Playwright 必须拒绝未声明 API，并断言页面只读取 detail endpoint 与用户明确触发的生命周期命令。
- New Task 测试必须断言直接进入 POST response ID 对应的 canonical Detail。

### 7. Wrong vs Correct

```ts
// Wrong：页面拼 key，并以列表行覆盖详情。
queryClient.setQueryData(['content', taskId], listRow);

// Correct：key 由 Content domain 唯一拥有，命令后失效两种独立 projection。
await queryClient.invalidateQueries({ queryKey: contentKeys.detail(taskId) });
await queryClient.invalidateQueries({ queryKey: contentKeys.lists() });
```

---

## Content Review 的当前主线快照与审核命令合同

### 1. Scope / Trigger

- 修改 `/content/tasks/$taskId/review`、Content Review query key、task-scoped review read model 或内容批准/退回交互时适用。
- 该边界只覆盖当前主线审核，不扩张为 Content History、Version Detail 或跨领域 Review framework。

### 2. Signatures

```text
URL:  /content/tasks/$taskId/review
GET:  /api/v1/content-tasks/{content_task_id}/review-context
POST: /api/v1/content-versions/{content_version_id}/approve
POST: /api/v1/content-versions/{content_version_id}/request-changes

query key: ["content", "tasks", "review-context", taskId]
approve body: CommandRequest(expected_revision, comment)
request changes body: RequestChangesCommand(expected_revision, comment)
```

### 3. Contracts

- `ContentTask.current_content_version_id` 是 route 当前内容主线的唯一权威。GET 必须在一个 PostgreSQL `REPEATABLE READ` 请求中解析该指针，并复用唯一 `ContentReviewContext` 返回 content、task、fact Markdown、canonical diff、quality issues、generation/humanization snapshot、review history 和 `available_actions`。
- 页面首屏只读取 task-scoped Review Context；不得先请求 Task Detail、Editor Context、ContentVersion、FactVersion、GenerationJob 或审核列表后在浏览器 join。
- canonical Markdown、事实版本、生成快照和历史审核记录只读。页面不生成事实一致性或平台适配 verdict，只展示服务端证据供人工判断。
- 审核按钮只消费 Context 顶层 `available_actions` 中的 `APPROVE` / `REQUEST_CHANGES`；不得按 content/task status、账号类型或权限 Hook 补动作。命令端仍重新校验账号、current pointer、状态、事实资格、blocking issues、CSRF 和 `expected_revision`。
- mutation 成功后先采用命令返回的 canonical ContentVersion 防止旧画面继续可操作，再重新读取 task Review Context，并失效 Content list/detail/editor projection。不得用 mutation response 伪造完整 Context。
- `409` 保留退回 Dialog 输入和 `request_id`，禁用旧动作并重新读取 canonical Context；命令不得自动重放。request changes 的 comment trim 后必须非空，客户端校验不替代服务端 `422`。

### 4. Validation & Error Matrix

| 条件 | 页面处理 |
| --- | --- |
| task 不存在 | `404` 专用只读错误态，保留返回任务入口 |
| task 没有 current content / 追溯不完整 | 结构化 `409`，显示 message 与 `request_id`，不请求其他版本 fallback |
| Context 无审核 token | 保持 canonical workspace 只读，不从 status 补按钮 |
| request changes 意见空白 | 字段与 ErrorSummary 同时提示，不发送 POST |
| CSRF / permission / 字段错误 | 显示结构化错误；Dialog 输入保持不变 |
| `expected_revision` 或 current pointer 冲突 | 保留意见与 request ID，刷新 Context，不 replay |
| mutation 成功但 Context refetch 失败 | 保留 canonical command response，标记上下文陈旧并提供重试，不恢复旧动作 |

### 5. Good / Base / Bad Cases

- Good：direct URL 以 `taskId` 一次读取当前版本，用户按服务端 token 批准；页面重新读取后显示 `APPROVED` 且无审核动作。
- Base：`CHANGES_REQUESTED`、`APPROVED` 或 tokenless `REVIEW_PENDING` 返回完整证据但保持只读。
- Bad：先 GET Task Detail 得到版本 ID，再 GET version review context；或用 `status === "PENDING_REVIEW"` 补批准按钮；或在 409 后自动重试原命令。

### 6. Tests Required

- Contract/backend：task route 与唯一 DTO 生成一致；current pointer、`REPEATABLE READ`、404/409、diff/fact/snapshot/history/actions，以及命令 CSRF/revision/意见校验/不可变输入。
- Component：单 query、只读状态、token 动作、成功 canonical refetch、409 输入与 request ID 保留、loading/error/retry 和 Dialog focus return。
- Fixture Playwright：direct/refresh/Back/Forward、375/768/1024/1440、未声明 API/console/pageerror/requestfailed 审计，以及冲突命令只提交一次。
- Real stack：approve 与 request-changes 使用相互独立的数据，通过真实 API、PostgreSQL、CSRF、revision 和最终 Context 验证 append-only history。

### 7. Wrong vs Correct

```tsx
// Wrong：客户端先 join 身份，再按状态重建审核资格。
const task = await getTaskDetail(taskId);
const context = await getContentReviewContext(task.current_content_version_id);
const canApprove = context.content.status === 'PENDING_REVIEW';

// Correct：单一当前主线快照决定展示动作，命令仍由服务端最终守卫。
const context = useQuery(contentReviewContextQueryOptions(taskId));
const canApprove = context.data?.available_actions.includes('APPROVE') ?? false;
```

---

## Publication Workspace 的 Context、hash 与 mutation 合同

### 1. Scope / Trigger

- 修改 `/publishing/work/$workId`、发布工作 Context query、Core action Dialog、Evidence 上传或工作区 hash 导航时适用。

### 2. Signatures

```text
URL: /publishing/work/$workId#summary|preparation|result|verification|content-version|close
GET: /api/v1/publication-works/{work_id}/workspace-context
GET on demand: /api/v1/content-versions/{content_version_id}/publication-package
query key: ["publication", "works", "context", workId]
```

### 3. Contracts

- route loader 与页面共用唯一 Context query；首屏不得请求 work detail、content、account、attachments、verifications 或 events 后在浏览器 join。Package 只在复制按钮点击时读取。
- hash 只接受六个已声明 section；缺失或未知值使用 `replace` 规范化为 `#summary`。刷新、Back/Forward 和 section link 必须恢复同一 Context 内的位置，不把 hash 放入 Query key。
- RHF 持有 Dialog 输入和已完成上传的 `file_id`，TanStack Query 持有 canonical Context。动作只来自服务端 `available_actions`；Core 仅映射 `UPDATE_PREPARATION`、`MARK_PLATFORM_REVIEW`、`REGISTER_RESULT`、`CLOSE`。
- 命令成功采用响应并失效 Context/list/summary；`409` 不 replay，保留表单和已完成上传，显式 reload 才重置为最新 Context。上传传输失败才调用 abort；complete 失败保留 intent 并重试 complete。
- Context 背景刷新失败且已有 data 时保留工作区和 dirty guard；初始失败才显示整页 403/404/409/通用错误。

### 4. Validation & Error Matrix

| 条件 | 页面处理 |
| --- | --- |
| 非法 UUID | 不发 Context 请求，显示明确错误 |
| 缺失/未知 hash | `replace` 到 `#summary`，只发一次 Context 请求 |
| Context 初始 403/404/409 | 专用整页状态并展示 `request_id` |
| Context 背景刷新失败 | 保留 stale data、表单与重试入口 |
| 命令 `409` | 保留输入/文件，显示冲突与显式 reload |
| upload PUT 失败 | abort intent；不提交业务命令 |
| upload complete 失败 | 保留 intent，仅重试 complete |

### 5. Good / Base / Bad Cases

- Good：direct URL 一次加载 Context，复制时才读 Package，登记结果后刷新 canonical Context。
- Base：无结果、附件或核验时各 section 显示明确空态，仍可按 token 执行动作。
- Bad：把六个 section 拆成独立 query，或在 `409` 后自动重放命令并清空本地文件。

### 6. Tests Required

- Unit/component：六个 hash、动作 token 映射、dirty 导航、409 保留/显式 reload、Evidence SHA-256 与 intent/complete 重试。
- Fixture Playwright：单 Context、Package 按需、direct/refresh/Back/Forward、375/768/1024/1280/1440/1920、主题/键盘/焦点及未声明 API 失败。
- Real stack：Flow A 通过真实 CSRF、signed upload、PostgreSQL revision 与最终 Context 完成登记结果。

### 7. Wrong vs Correct

```tsx
// Wrong：首屏并发多个端点，按 status 补动作。
const [work, events, files] = useQueries(/* ... */);
const canRegister = work.data?.status === 'PREPARING';

// Correct：单一快照与服务端 token 决定展示。
const context = useQuery(publicationWorkspaceContextQueryOptions(workId));
const canRegister = context.data?.available_actions.includes('REGISTER_RESULT') ?? false;
```

---

## Common Mistakes

<!-- State management mistakes your team has made -->

- 不要让 Ant Table 内部页码和 URL 页码并存。Table 必须受控于查询参数，前进/后退直接驱动 UI。
- 查询参数只保存视图，不保存权限、业务状态或表单正文；无效正整数和未知 Tab 使用 `replace` 回到既有默认值。
- 不要因一个次级查询失败而隐藏已成功加载的身份、返回入口或兄弟区块。
- 不要在 Prompt 编辑器中用 effect 把后台查询结果无条件写入 draft；身份变化时派生新基线，dirty 状态由名称或正文与各自基线的差异唯一计算。
