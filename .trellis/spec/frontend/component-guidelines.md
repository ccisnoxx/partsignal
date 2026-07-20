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

前端沿用 React 与 Ant Design 组件，不建立第二套基础组件或通知系统。共享组件只承载稳定的展示边界，例如 `TableRegion`、`QueryFailure`、`NoData` 和 `MetricTile`；业务权限、恢复路径和状态转换仍由 feature 页面决定。

---

## Component Structure

<!-- Standard structure of a component file -->

(To be filled by the team)

---

## Props Conventions

<!-- How props should be defined and typed -->

- 可恢复错误使用 `QueryFailure({ error, onRetry?, actions? })`。`actions` 只传入页面已经存在且上下文明确的返回或配置入口，共享组件不得识别业务错误码。
- 空结果使用 `NoData({ description?: ReactNode, action?: ReactNode })`。同屏已有等价主操作时不重复传 `action`。
- 表格宽列必须位于 `TableRegion` 内，通过 Table 自身 `scroll.x` 局部滚动，不允许制造页面级横向滚动。

### 表格列宽约定

按字段内容角色分配宽度：状态、版本、数量和操作等有明确上限的字段使用紧凑 `width`，名称、标题或其他长文本至少保留一列不设置 `width`，由它吸收桌面剩余空间。只有列的最小可用宽度超过容器时才设置 `scroll.x`；横向滚动的关键宽表将操作列设为 `fixed: 'right'`，保证移动端仍可直接操作。

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

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

- 组件状态只消费 `src/app/theme.ts` 和 `global.css` 已定义的语义变量，不在业务 TSX/CSS 中硬编码浅色或深色颜色。
- 长集合表使用 Ant Table `sticky={{ offsetHeader: 72 }}`；短子表不为统一外观强制 sticky。
- 行焦点使用 `tr:focus-within` 表达，不给 `tr` 增加 `tabIndex`，避免整行成为第二个交互入口。

---

## Accessibility

<!-- A11y requirements and patterns -->

- 高密度行只保留一个高频主入口；低频和危险操作放入 Ant `Dropdown`，触发器名称使用 `更多操作：<业务标识>`。危险菜单项必须进入原有确认流程，不得直接执行删除或停用。
- 长页面章节导航使用原生锚点；当前章节设置 `aria-current="location"`。条件章节的链接与区块必须使用同一个渲染条件。
- 路由 pathname 变化后由 `AppLayout` 将焦点移到 `Layout.Content`，并调用 `focus({ preventScroll: true })`；查询参数变化不得抢焦点。
- 弹窗、下拉菜单和表格滚动区继续使用 Ant Design 与 `TableRegion` 的键盘和可访问语义，不手写第二套焦点圈定。
- 工作台侧栏只在 URL 中存在真实选中对象时渲染 Ant Drawer；移动端使用全宽 Drawer。关闭后清理对象查询参数并由 Ant 恢复触发器焦点，不保留无对象的永久占位面板。

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- 不要同时保留直出危险按钮和更多菜单，两套入口会破坏行操作层级。
- 不要用整行点击替代明确链接或按钮。
- 不要用内部滚动容器、滚动轮询或定时器实现章节当前态。
