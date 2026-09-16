# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

canonical 前端使用 React、Tailwind CSS 4、shadcn/ui 结构与 Base UI primitives，不建立第二套基础组件或通知系统。共享组件只承载稳定展示与交互边界，例如 `TableShell`、`RowActions`、`QueryFailure`、`NoData` 和 Workspace Kit；业务权限、恢复路径和状态转换由对应 route 或 domain owner 决定。

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

### 内容生产表单边界

- 产品事实页只编辑 `body_markdown` 与 `classification`；不得恢复参考型号、证据、参数表或编辑器 JSON。
- 新建内容任务只选择产品、该产品的批准事实版本和具体平台。受众、内容角度、转化目标、格式与长度由平台 Prompt 约束，不在任务表单重复维护。
- 任务详情只在 `NO_DRAFT` 并列展示“系统 AI 生成”和“手动录入”；存在当前内容时显示当前工作入口，终态任务单独显示“基于当前上下文新建任务”，不得把续建入口混入 AI 卡片或创建后自动打开 AI。
- 续建任务复用创建表单：预填原产品和仍有效的平台，事实版本默认该产品最新 `APPROVED` 并允许创建前调整；来源版本不同须显示变化。AI 记录成功返回空列表时隐藏整区，加载与失败仍显示。
- 内容编辑器只按服务端动作切换模式：`SAVE` 保存当前人工未审核草稿且不创建版本，`CREATE_REVISION` 创建新版本，`SUBMIT_REVIEW` 只提交已保存基线，`DELETE` 经危险确认彻底删除草稿，`ABANDON` 只改变生命周期。不得从状态或来源在前端自行补动作；AI 草稿仍不显示删除，APPROVE/REQUEST_CHANGES 不进入 Editor surface。
- Prompt 管理维护可复用模板库，平台配置只选择零或一份当前 Prompt；平台规则版本页面、旧平台所属 Prompt 路由、查询键与兼容提示均不得恢复。绑定中的 Prompt 仍显示服务端 `DELETE`，确认框必须列出受影响平台并说明自动解绑后新生成暂不可用；提交竞态由服务端 revision 与锁兜底。

### GEO 更正表单边界

#### 1. Scope / Trigger

- 修改 `/geo/observations/$observationId/correct`、correction context、append-only payload、冲突刷新或 GEO 更正证据上传时适用。
- 不适用于 New Observation、Legacy 更正、Topics/Insights/Print 或通用 Form/Workspace 抽象。

#### 2. Signatures

```text
URL:  /geo/observations/$observationId/correct
GET:  /api/v1/geo-observations/{observation_id}/correction-context
POST: /api/v1/geo-observations
GET response: GeoObservationCorrectionContext
POST body: GeoObservationCreate
query key: ["geo", "observations", "correction-context", observationId]
```

#### 3. Contracts

- GET 在一个 `REPEATABLE READ` 请求中组合既有 `ManualGeoObservationDetail`、服务端当前 Published Article 候选及尾节点初始事实、历史空 Query Topic 的可选项。浏览器不得并发 Detail、候选和 Topics 自行 join。
- route loader 只使用 `detail.chain_tail_id` canonical replace；冲突后的内部 replace 必须设置 `ignoreBlocker: true`，否则 DirtyGuard 会阻断服务端新尾更新。表单以 `chain_root_id` 为编辑身份，同链 canonical 更新保留草稿，跨链时重建。
- Product、Search Platform、Search Query 和非空 Query Topic 从上下文冻结且不进入表单。表单只持有 `query_topic_id` 空值例外、本次 `tested_at`、完整当前 `article_results`、本次 `attachment_file_ids` 和新 Notes。
- 候选仍在尾结果中时继承事实；新候选及历史 `null` 保持 `null` 并要求显式选择；退出候选只在历史显示。历史 Evidence 只读，POST 只携带本次完成上传的 ID。
- `supersedes_id` 只取最近一次成功加载的 `detail.chain_tail_id`。当前 POST 没有 `Idempotency-Key`；同步提交锁与 mutation pending 只防止同页面并发。
- 成功先清 dirty，失效 GEO lists/details/correction contexts、新 Detail、Insights、Query Topic list-items 与 Product Detail，再按 POST response ID 进入 canonical Detail。
- `GEO_OBSERVATION_HAS_SUCCESSOR` 与现有 stale code 使用相同的保留草稿、Evidence、request ID、显式 reload 和 no-replay 行为；该页面分支归 T6，T5-I5 不修改 frontend production/tests，server mapper 与 T6 必须原子发布。

#### 4. Validation & Error Matrix

| 条件 | 页面处理 |
| --- | --- |
| Legacy、无权限、缺失或坏链 | 409/403/404 明确整页错误，不回退 New/旧 GET |
| 历史 Topic 为空且未选择/无选项 | 阻止提交，保留真实空值 |
| 任一候选 discovered/mentioned 为 `null` | 字段与 ErrorSummary 报错，不发 POST |
| `422` 可编辑字段错误 | 映射对应字段；冻结/未知位置留在 form summary |
| `GEO_PUBLICATIONS_CHANGED` / `REVISION_CONFLICT` / `GEO_OBSERVATION_HAS_SUCCESSOR` | 禁用旧上下文，不 replay；保留草稿、Evidence 与 request ID，不猜 successor winner |
| 显式刷新 | 按文章 ID 保留仍有效事实，新增保持 `null`，移除退出候选，并采用服务端新尾 |
| upload complete 失败 | 保留 intent，只重试 complete |

#### 5. Good / Base / Bad Cases

- Good：单一 context 绘制只读历史和当前候选；用户完成未知事实后，用服务端尾单次 append POST，并按响应 ID 进入新 Detail。
- Base：提交期间候选或尾变化，页面不重放；显式刷新保留仍有效事实、Notes、时间和新 Evidence 后要求人工再次提交。
- Bad：用历史文章结果充当当前候选；从 URL/`is_current` 猜尾；复制历史附件；默认 `false`；409 后自动改 body 重放；用普通 navigate 让 DirtyGuard 阻断内部 canonical replace。

#### 6. Tests Required

- Contract/backend：generated context、历史 ID→尾、权限/Legacy、候选新增退出、空 Topic、固定查询数、append-only、冻结字段、证据不可复用、原链不变和失败无半成品。
- API/model/component：严格 context assertion、初值/payload、只提交新 Evidence、pending 单 POST、DirtyGuard、三类 canonical-context stale 冲突不 replay、显式刷新合并、内部 canonical replace 与缓存失效。
- Production fixture：未声明 API 失败；覆盖 Detail 入口/direct/refresh、404/403/Legacy、上传重试、权限变化、响应 ID handoff、键盘和 375/768/1024/1440。

#### 7. Wrong vs Correct

```tsx
// Wrong：历史结果不是当前资格集合，URL 也不是权威尾。
const articleRows = detail.correction_history.at(-1)?.observation.article_results ?? [];
await createGeoObservation({ ...values, article_results: articleRows, supersedes_id: observationId });

// Correct：服务端 context 同时拥有当前候选和权威尾。
const context = useQuery(geoObservationCorrectionContextQueryOptions(observationId));
await createGeoObservation(toGeoObservationCorrectionCreate(context.data!, values), csrfToken);
```

---

## Props Conventions

<!-- How props should be defined and typed -->

- 可恢复错误使用 `QueryFailure({ error, onRetry?, actions? })`。`actions` 只传入页面已经存在且上下文明确的返回或配置入口，共享组件不得识别业务错误码。
- 空结果使用 `NoData({ description?: ReactNode, action?: ReactNode })`。同屏已有等价主操作时不重复传 `action`。
- 表格宽列必须位于带命名 region 的 `TableShell` 内，通过 `.ps-table-region` 局部滚动，不允许制造页面级横向滚动。

### 业务表格主操作边界

#### 1. 适用范围 / 触发条件

当表格行表示可推进业务流程的资源，且 OpenAPI 返回 typed `primary_task` 时，行内必须使用该 token 决定唯一高频主入口。逐篇观测结果等父表单输入矩阵不是独立资源，不增加行操作列。

#### 2. 签名

```tsx
type ContentTask = components['schemas']['ContentTask'];

function renderPrimaryTask(task: ContentTask): ReactNode {
  const token: ContentTask['primary_task'] = task.primary_task;
  // 当前 feature 内以 switch 穷尽映射所有 token。
}

type DeletionBlocker = components['schemas']['DeletionBlocker'];
type DeletionLinkResolver = (blocker: DeletionBlocker) =>
  | { href: string; label: '查看引用' | '查看历史' }
  | undefined;
```

只从 `frontend/src/shared/api/generated/schema.d.ts` 导入字段类型，不手写字符串并集或通用 action 类型。

#### 3. 合同

- `primary_task` 只控制行的高频主入口；`available_actions` 控制更多菜单、危险确认和具体写命令。
- token 到中文文案、导航、Drawer 或确认流程的映射归当前 feature 所有；不建立跨领域 registry 或只做转发的通用组件。
- 同一主操作在桌面、移动和 200% 缩放下必须可达；不得通过隐藏按钮改变业务能力。
- mutation 成功后使用返回资源或失效既有 query；竞态被服务端拒绝时显示真实错误并刷新，不用本地兼容分支补回入口。
- 受约束物理删除对象存在非空 `deletion.blockers` 时，更多菜单显示“查看删除条件”，不得悄悄隐藏全部删除相关入口。共享组件只显示当前阻断类型、数量和新标签页链接；精确筛选 URL 与文案由当前 feature 提供。
- 平台账号数量和 Prompt 绑定数量属于确认影响，不是阻断。平台确认必须明确账号随平台清理、任务不级联；Prompt 确认必须列出自动解绑平台。前端不得自行级联、轮询猜测或本地补回动作。
- 内容任务默认只请求 `archive_status=ACTIVE`。`ARCHIVE`、`RESTORE` 和 `PERMANENT_DELETE` 只消费服务端动作；永久删除先读取预览，展示分项数量、外部 URL 与不可恢复提示，并要求输入固定文本 `永久删除` 后才提交。
- 发布成果同样只消费服务端 `deletion` 与 `PERMANENT_DELETE`：无 GEO 阻断时读取实时预览并确认，存在阻断时复用“查看删除条件”；前端不得按问题状态或页面列表推断资格。

#### 4. 校验与错误矩阵

| 条件 | 处理 |
| --- | --- |
| `primary_task` 有已知 token | 渲染唯一对应主入口 |
| 生成类型出现未处理 token | TypeScript 穷尽检查失败；不渲染“查看”默认入口 |
| 过期投影提交后返回 `409`/领域错误 | 保留错误反馈并刷新资源；不改用 `status` 推断 |
| 主任务需要付费、删除或外部调用 | 先打开详情或确认流程；不在列表单击立即执行 |
| `deletion=null` | 当前响应没有删除管理上下文，不显示删除或查看条件入口 |
| `deletion.blockers=[]` 且包含 `DELETE` | 显示既有删除确认流程 |
| `deletion.blockers` 非空 | 显示“查看删除条件”，列出类型、数量和 feature 提供的精确下钻 |
| 平台仅有终态历史 | 不显示历史阻断；停用后可删除，页面明确任务保留且配置链接会失效 |
| 已归档任务且有 `PERMANENT_DELETE` | 打开实时预览；确认文本不匹配时不发请求 |

#### 5. Good / Base / Bad

- Good：`HANDLE_FAILURE` 打开真实失败详情，只在 `available_actions` 包含 `RETRY` 时提供经确认的重试。
- Base：`VIEW_VERSION_HISTORY` 只打开冻结版本，不因历史 `status` 为 `APPROVED` 补发布入口。
- Bad：以 `row.status === 'APPROVED' && !work` 在页面重新推导“开始发布”。
- Good：发布账号被四个发布工作引用时显示“发布工作：4”和 `/publications?platform_account_id=<id>` 的“查看历史”。
- Base：阻断对象被处理后，用户点击“重新检查”，页面重新消费服务端投影。
- Bad：引用存在时只隐藏“删除”，或让共享组件硬编码各 feature 路由。

#### 6. 必需测试

- 使用相同表面状态、不同 `primary_task` 的 fixture，断言主入口只随 token 变化。
- 对会执行写入或外部调用的主入口，断言列表点击先进入详情/确认，用户确认后才发请求。
- 运行前端 typecheck 和对应 feature Vitest；业务 E2E 覆盖桌面、移动及关键焦点返回。
- 受约束删除测试至少断言：空阻断显示确认流程；非空阻断显示数量和精确 URL；平台/Prompt 展示级联影响；任务归档、恢复和永久删除成功后刷新对应 query。

#### 7. Wrong vs Correct

```tsx
// Wrong：在前端重建业务流程。
const label = row.status === 'APPROVED' ? '开始发布' : '查看';

// Correct：只消费服务端 typed token。
const label = primaryTaskLabels[row.primary_task];
```

```tsx
// Wrong：被引用时静默消失。
const items = row.available_actions.includes('DELETE') ? [deleteItem] : [];

// Correct：删除资格和阻断引导都直接消费服务端投影。
const items = row.deletion?.blockers.length
  ? [viewDeletionConditionsItem]
  : row.available_actions.includes('DELETE') ? [deleteItem] : [];
```

### 表格列宽约定

按字段内容角色分配宽度：状态、版本、数量和操作等有明确上限的字段使用紧凑列；名称、标题等长文本列保留弹性宽度。`TableShell` 提供命名、可聚焦的局部滚动 region，原生 `<table>` 或 TanStack Table 只负责表格语义和状态，不得制造页面级横向滚动。

可变长文本的容器与文本槽必须允许 `min-width: 0`，使用 `.table-cell-ellipsis` 或等价的单一行截断，并通过可聚焦 Tooltip 或明确详情入口读取完整值。固定短枚举、状态、数字、时间、布尔值和操作列不纳入长文本合同。“名称 + 次要标识”最多固定两行，每行独立省略。带图标或两行身份的复合单元格必须让外层容器和文本槽同时可收缩，固定图形使用 `flex: none`。

操作列使用 `RowActions`：最多直出一个 Primary，其余动作进入 Base UI `DropdownMenu`；移动端必须仍可到达，不通过 sticky/fixed 技巧遮挡其他字段。不得给所有列分配相同固定宽度，也不得用控件 `min-width` 撑破单元格。

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

- 组件状态只消费 `src/styles/global.css` 定义的语义变量及其 Tailwind 角色，不在业务 TSX/CSS 中硬编码浅色或深色颜色。
- shadcn/Base UI primitive 只包装可复用的交互语义；业务 Domain 不复制 primitive，也不得绕开 Token 自建第二套表面、焦点或状态颜色。
- 长集合表只有在真实浏览器证明确有需要时才实现 sticky；短子表不为统一外观强制 sticky。
- 行焦点使用 `tr:focus-within` 表达，不给 `tr` 增加 `tabIndex`，避免整行成为第二个交互入口。
- 指标图形与文字净空由共享 pattern 持有；移动断点修改 padding 时必须在 320px、375px 真实浏览器中断言图标不与标题或数值相交。

---

## Accessibility

<!-- A11y requirements and patterns -->

- 高密度行只保留一个高频主入口；低频和危险操作放入 `RowActions` 的 Base UI `DropdownMenu`，触发器名称使用 `更多操作：<业务标识>`。危险菜单项必须进入原有确认流程，不得直接执行删除或停用。
- 危险操作使用用户能理解的业务语言命名，不把“物理删除”等存储实现术语写进菜单、按钮或弹窗标题。服务端动作键仍保持原合同；例如 `DELETE` 在内容任务页显示为“删除任务”，确认按钮显示“确认删除”，关联清理范围与不可恢复后果写在确认正文。

```tsx
{
  key: 'DELETE',
  label: '删除任务',
  onClick: confirmDelete,
}
```

- 长页面章节导航使用原生锚点；当前章节设置 `aria-current="location"`。条件章节的链接与区块必须使用同一个渲染条件。
- 路由 pathname 变化后由 `AppLayout` 将焦点移到 `Layout.Content`，并调用 `focus({ preventScroll: true })`；查询参数变化不得抢焦点。
- `/system/users`、`/system/audit` 和受限配置路由必须在 route 边界判断管理员权限。未获权访问保留原 URL，展示带恢复操作的 403，并在 `AppShell` 路由焦点完成后把焦点移入提示区域；页面内部不得再维护平行权限开关或重定向。
- 弹窗、下拉菜单、Sheet 和表格滚动区继续使用 Base UI primitives 与 `TableShell` 的键盘和可访问语义，不手写第二套焦点圈定。
- 工作台侧栏只在 URL 中存在真实选中对象时渲染 `Sheet`；移动端使用适合视口的宽度。关闭后清理对象查询参数并恢复原触发器焦点，不保留无对象的永久占位面板。

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- 不要同时保留直出危险按钮和更多菜单，两套入口会破坏行操作层级。
- 不要把服务端命令名或存储实现直接当作用户文案；技术合同与界面词汇的职责不同。
- 不要用整行点击替代明确链接或按钮。
- 不要用内部滚动容器、滚动轮询或定时器实现章节当前态。
- 不要在前端为已删除任务字段保留隐藏表单、默认值或兼容 payload；生成要求只有平台 Prompt 一个来源。
- 受控 Base UI Dialog 需要用 `finalFocus` 返回真实触发元素；不要按当前目标 ID 给整个 Dialog Root 设置会在关闭时变化的 React `key`，否则 Root 会在执行焦点恢复前被替换。需要清空本地输入时使用 `onOpenChangeComplete(false)`。
