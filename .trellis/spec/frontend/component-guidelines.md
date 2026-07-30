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
- 任务详情并列展示“系统 AI 生成”和“手动录入”入口。人工入口直接提交 Markdown 首稿，不要求 Prompt 或模型，也不得伪造 AI 作业来源。
- Prompt 管理维护可复用模板库，平台配置只选择零或一份当前 Prompt；平台规则版本页面、旧平台所属 Prompt 路由、查询键与兼容提示均不得恢复。被平台绑定的 Prompt 不显示删除入口，提交竞态仍由服务端冲突兜底。

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

不要给所有列分配相同或近似固定宽度；Ant Table 会把桌面剩余空间机械摊到这些列，造成短字段和操作列异常放大。表格内的 Select 等控件必须受单元格宽度约束，使用明确宽度配合 `maxWidth: '100%'`，不得用大于单元格的 `minWidth` 撑破页面。

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
- 长页面章节导航使用原生锚点；当前章节设置 `aria-current="location"`。条件章节的链接与区块必须使用同一个渲染条件。
- 路由 pathname 变化后由 `AppLayout` 将焦点移到 `Layout.Content`，并调用 `focus({ preventScroll: true })`；查询参数变化不得抢焦点。
- `/users`、`/audit` 和 `/configuration/*` 必须共用 `AdminRoute`，在受限页面挂载前判断管理员权限。未获权访问保留原 URL，展示带恢复操作的 403，并在 `AppLayout` 路由焦点完成后把焦点移入提示区域；页面内部不得再维护查询开关或重定向。
- 弹窗、下拉菜单和表格滚动区继续使用 Ant Design 与 `TableRegion` 的键盘和可访问语义，不手写第二套焦点圈定。
- 工作台侧栏只在 URL 中存在真实选中对象时渲染 Ant Drawer；移动端使用全宽 Drawer。关闭后清理对象查询参数并由 Ant 恢复触发器焦点，不保留无对象的永久占位面板。

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- 不要同时保留直出危险按钮和更多菜单，两套入口会破坏行操作层级。
- 不要用整行点击替代明确链接或按钮。
- 不要用内部滚动容器、滚动轮询或定时器实现章节当前态。
- 不要在前端为已删除任务字段保留隐藏表单、默认值或兼容 payload；生成要求只有平台 Prompt 一个来源。
