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

前端沿用 React 与 Ant Design 组件，不建立第二套基础组件或通知系统。共享组件只承载稳定的展示边界，例如 `TableRegion`、`QueryFailure`、`NoData` 和 `MetricTile`；业务权限、恢复路径和状态转换由对应路由或 feature 所有者决定。

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

### 内容生产表单边界

- 产品事实页只编辑 `body_markdown` 与 `classification`；不得恢复参考型号、证据、参数表或编辑器 JSON。
- 新建内容任务只选择产品、该产品的批准事实版本和具体平台。受众、内容角度、转化目标、格式与长度由平台 Prompt 约束，不在任务表单重复维护。
- 任务详情只在 `NO_DRAFT` 并列展示“系统 AI 生成”和“手动录入”；存在当前内容时显示当前工作入口，终态任务单独显示“基于当前上下文新建任务”，不得把续建入口混入 AI 卡片或创建后自动打开 AI。
- 续建任务复用创建表单：预填原产品和仍有效的平台，事实版本默认该产品最新 `APPROVED` 并允许创建前调整；来源版本不同须显示变化。AI 记录成功返回空列表时隐藏整区，加载与失败仍显示。
- 内容编辑器只按服务端动作切换模式：`SAVE` 保存当前人工未审核草稿且不创建版本，`CREATE_REVISION` 创建新版本，`DELETE` 经危险确认彻底删除草稿。不得从状态或来源在前端自行补动作；AI 草稿仍不显示删除。
- Prompt 管理维护可复用模板库，平台配置只选择零或一份当前 Prompt；平台规则版本页面、旧平台所属 Prompt 路由、查询键与兼容提示均不得恢复。绑定中的 Prompt 仍显示服务端 `DELETE`，确认框必须列出受影响平台并说明自动解绑后新生成暂不可用；提交竞态由服务端 revision 与锁兜底。

### GEO 更正表单边界

- GEO 更正表单以待更正详情响应作为全部业务字段和逐篇事实的唯一初值来源，不得再用当前文章候选列表重建或覆盖原结论。
- 补采前 `discovered/mentioned = null` 表示历史未采集，必须保留未知并要求用户显式选择，不能用未勾选或 `false` 代替。
- 历史证据只做聚合展示；更正请求只提交本次新增证据。当前文章集合与链尾仍由服务端事务校验，前端不补造缺失事实。

```tsx
const articleRows = correctionRecord
  ? correctionRecord.article_results
  : publications.data?.items ?? [];
```

回归测试至少断言：详情值正确预填；只改一个逐篇字段时其余载荷保持原值；`null` 未确认时不发请求；POST 携带原记录 `supersedes_id` 且不复制历史附件。服务端返回 `GEO_PUBLICATIONS_CHANGED` 或非链尾冲突时直接展示错误，不从候选列表补造默认结论。

---

## Props Conventions

<!-- How props should be defined and typed -->

- 可恢复错误使用 `QueryFailure({ error, onRetry?, actions? })`。`actions` 只传入页面已经存在且上下文明确的返回或配置入口，共享组件不得识别业务错误码。
- 空结果使用 `NoData({ description?: ReactNode, action?: ReactNode })`。同屏已有等价主操作时不重复传 `action`。
- 表格宽列必须位于 `TableRegion` 内，通过 Table 自身 `scroll.x` 局部滚动，不允许制造页面级横向滚动。

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

只从 `frontend/src/shared/api/schema.d.ts` 导入字段类型，不手写字符串并集或通用 action 类型。

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

按字段内容角色分配宽度：状态、版本、数量和操作等有明确上限的字段使用紧凑 `width`；名称、标题等长文本列可以作为弹性列，也可以在宽表中声明与 `scroll.x` 一致的有界宽度。横向滚动的关键宽表将操作列设为 `fixed: 'right'`，保证移动端仍可直接操作。

全站表格的可变长文本列都必须登记并遵守同一合同：普通文本使用 `TableCellText` 保持单行省略，并通过悬停或键盘聚焦查看完整值；链接、按钮和复合身份中的交互文本叶子复用现有 Tooltip，并统一添加 `.table-cell-ellipsis`，使长文本压力探针能够覆盖。固定短枚举、状态、数字、时间、布尔值和操作列不纳入长文本合同。“名称 + 次要标识”最多保持固定两行，每一行独立省略。承载文本的 `a`、`strong`、`span` 和双行容器必须允许 `min-width: 0`，不得依赖 `<td>` 自身的 `ellipsis` 掩盖子元素溢出。带图标、头像或两行身份的复合单元格必须让外层容器和文本槽同时具备 `width: 100%; min-width: 0`，固定图形使用 `flex: none`；当完整值属于整个复合身份时，Tooltip 和键盘焦点必须由根容器持有，叶子文本只保留 `.table-cell-ellipsis`，不能把可触发区域缩成文字自身。不得用默认不可收缩的 `Space` 包裹长文本。`TableRegion` 只负责语义焦点和外层宽度边界，横向滚动继续由 Ant Table 持有。

```tsx
<Table
  scroll={{ x: 760 }}
  columns={[
    { title: '型号', dataIndex: 'part_number' },
    { title: '状态', dataIndex: 'status', width: 110 },
    { title: '操作', key: 'actions', width: 110, fixed: 'right' },
  ]}
/>
```

不要给所有列分配相同或近似固定宽度；Ant Table 会把桌面剩余空间机械摊到这些列，造成短字段和操作列异常放大。表格内的 Select 等控件必须受单元格宽度约束，使用明确宽度配合 `maxWidth: '100%'`，不得用大于单元格的 `minWidth` 撑破页面。表格操作区若要统一图标按钮尺寸，选择器必须限定 `.ant-btn-icon-only`；不得把 `.ant-btn` 整体固定为方形，否则文字主操作会被裁切或失去可读宽度。

> **Ant Design 6 固定列注意事项**：右侧固定列使用逻辑类 `.ant-table-cell-fix-end`，阴影使用 `.ant-table-cell-fix-end-shadow::after`。修改局部覆盖前必须核对锁定版本的真实 DOM；不得沿用旧版 `.ant-table-cell-fix-right`，也不得用提高层级、遮罩或隐藏相邻字段掩盖列宽错误。

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

- 组件状态只消费 `src/app/theme.ts` 和 `global.css` 已定义的语义变量，不在业务 TSX/CSS 中硬编码浅色或深色颜色。
- 映射 Ant Design 的组合语义 Token 时，前景与背景必须成对覆盖；例如自定义 Tooltip 的 `colorBgSpotlight` 时必须同时指定兼容的 `colorTextLightSolid`，不得让组件库默认前景色与项目表面色混用。

```tsx
token: {
  colorBgSpotlight: tokens.bgRaised,
  colorTextLightSolid: tokens.textPrimary,
}
```

- 长集合表使用 Ant Table `sticky={{ offsetHeader: 72 }}`；短子表不为统一外观强制 sticky。
- 行焦点使用 `tr:focus-within` 表达，不给 `tr` 增加 `tabIndex`，避免整行成为第二个交互入口。
- `MetricTile` 的图标槽由共享样式持有；任何后置移动断点若重写卡片 body padding，必须同时保留 `.metric-with-icon` 的图标净空，并在 320px、375px 真实浏览器中断言图标不与标题或数值相交。

---

## Accessibility

<!-- A11y requirements and patterns -->

- 高密度行只保留一个高频主入口；低频和危险操作放入 Ant `Dropdown`，触发器名称使用 `更多操作：<业务标识>`。危险菜单项必须进入原有确认流程，不得直接执行删除或停用。
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
- `/users`、`/audit` 和 `/configuration/*` 必须共用 `AdminRoute`，在受限页面挂载前判断管理员权限。未获权访问保留原 URL，展示带恢复操作的 403，并在 `AppLayout` 路由焦点完成后把焦点移入提示区域；页面内部不得再维护查询开关或重定向。
- 弹窗、下拉菜单和表格滚动区继续使用 Ant Design 与 `TableRegion` 的键盘和可访问语义，不手写第二套焦点圈定。
- 工作台侧栏只在 URL 中存在真实选中对象时渲染 Ant Drawer；移动端使用全宽 Drawer。关闭后清理对象查询参数并恢复原触发器焦点，不保留无对象的永久占位面板。

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- 不要同时保留直出危险按钮和更多菜单，两套入口会破坏行操作层级。
- 不要把服务端命令名或存储实现直接当作用户文案；技术合同与界面词汇的职责不同。
- 不要用整行点击替代明确链接或按钮。
- 不要用内部滚动容器、滚动轮询或定时器实现章节当前态。
- 不要在前端为已删除任务字段保留隐藏表单、默认值或兼容 payload；生成要求只有平台 Prompt 一个来源。
