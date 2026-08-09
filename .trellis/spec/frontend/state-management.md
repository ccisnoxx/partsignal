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

## Common Mistakes

<!-- State management mistakes your team has made -->

- 不要让 Ant Table 内部页码和 URL 页码并存。Table 必须受控于查询参数，前进/后退直接驱动 UI。
- 查询参数只保存视图，不保存权限、业务状态或表单正文；无效正整数和未知 Tab 使用 `replace` 回到既有默认值。
- 不要因一个次级查询失败而隐藏已成功加载的身份、返回入口或兄弟区块。
- 不要在 Prompt 编辑器中用 effect 把后台查询结果无条件写入 draft；身份变化时派生新基线，dirty 状态由名称或正文与各自基线的差异唯一计算。
