# 浮层焦点恢复设计

## 1. 设计目标

建立一个最小、统一的“浮层关闭后返回原触发器”机制，修复 Dropdown → 静态确认与详情 Drawer/侧栏两类同源问题；不改变业务动作、路由合同或 Ant Design 浮层本身。

## 2. 不变量

1. 业务页面和服务端继续决定动作是否存在、确认内容及请求结果。
2. Ant Design 继续负责菜单、Modal、Drawer 的焦点圈定和 Escape 行为。
3. 页面状态所有者负责记录打开浮层的真实 HTMLElement，并在对应关闭生命周期结束后请求恢复。
4. 只恢复仍连接的原元素；不通过选择器、行号或相邻按钮猜测替代目标。

## 3. 共享机制

在 `frontend/src/shared/hooks/useFocusReturn.ts` 提供单一 Hook：

- 保存最近一次明确登记的 `HTMLElement`；
- 提供适用于按钮 `onFocus` / `onPointerDown` 的触发器属性，覆盖键盘和指针入口；
- 提供显式的目标记录函数，供详情按钮的 `onClick(event.currentTarget)` 使用；
- 提供恢复函数：消费当前目标，检查 `isConnected` 后调用 `focus({ preventScroll: true })`；无目标或目标失效时直接结束。

Hook 不读取业务状态、不查询 DOM、不创建定时器、不包装 Modal/Drawer，也不提供 fallback。多个页面共享同一浏览器机制，符合现有 Hook 规范；页面仍保留自己的打开/关闭函数。

## 4. Dropdown → 确认数据流

```text
更多操作按钮获得焦点或发生 pointerdown
  → Hook 保存该行按钮 HTMLElement
  → Dropdown 菜单项调用现有 modal.confirm
  → 确认框按既有逻辑取消、Escape 或完成
  → modal.confirm.afterClose 调用 Hook 恢复函数
  → 原按钮仍连接：preventScroll 聚焦；否则安全结束
```

各页面只增加触发器登记与 `afterClose`。若同一确认函数同时供详情面板直接调用（当前为平台页），仅表格菜单入口绑定焦点返回，避免把详情确认错误恢复到旧表格按钮。

## 5. 发布记录 Drawer

- `PublicationWorkspace` 继续持有 `record` / `candidate` 查询参数和关闭动作。
- 发布记录的直接查看按钮将 `event.currentTarget` 交给 Workspace；从记录 Dropdown 打开动作 Drawer 时复用该 Dropdown 已登记的触发器。
- `PublicationDrawer` 只新增关闭完成通知，使用 Ant Design `afterOpenChange(false)`；不改变脏表单确认或 Drawer 内容。
- Workspace 在关闭完成通知中恢复焦点。候选登记流程可沿用同一机制，但本任务验收重点是发布记录入口。

## 6. 审计详情侧栏与 Drawer

- `AuditLogPage` 在“查看日志详情”按钮点击时记录按钮，再设置 `selectedId`。
- 桌面详情侧栏属于条件渲染；清除 `selectedId` 后在下一帧恢复，确保侧栏已经卸载。
- 移动端使用 Drawer；关闭动作只清除 `selectedId`，在 `afterOpenChange(false)` 后恢复，避免 Drawer 的关闭生命周期覆盖焦点。
- 桌面与移动仍共用现有详情数据和 `selectedId`，不增加第二份选择状态。

## 7. 预计修改边界

### 共享机制与测试

- `frontend/src/shared/hooks/useFocusReturn.ts`
- `frontend/src/shared/hooks/useFocusReturn.test.tsx`

### Dropdown → 确认调用点

- `frontend/src/features/content-tasks/ContentTasksPage.tsx`
- `frontend/src/features/product-facts/ProductsPage.tsx`
- `frontend/src/features/product-facts/ProductFactsPage.tsx`
- `frontend/src/features/publications/PublicationWorkspace.tsx`
- `frontend/src/features/geo-observations/GeoObservationsPage.tsx`
- `frontend/src/features/settings/SettingsPage.tsx`
- `frontend/src/features/users/UserManagementPage.tsx`
- `frontend/src/features/configuration/AIChannelsPage.tsx`
- `frontend/src/features/configuration/AIChannelDetailPage.tsx`
- `frontend/src/features/configuration/PlatformsPage.tsx`
- `frontend/src/features/configuration/PlatformTypesPage.tsx`

### 详情浮层与回归测试

- `frontend/src/features/publications/PublicationDrawer.tsx`
- `frontend/src/features/configuration/AuditLogPage.tsx`
- `frontend/src/features/publications/PublicationsPage.test.tsx`
- `frontend/src/features/configuration/AuditLogPage.test.tsx`
- `frontend/tests/e2e/mvp-flow.spec.ts`

最终以实现前完整调用点复核为准；不得顺带修改未登记页面或删除文案。

## 8. 兼容性与回滚

- 不变更 API、生成类型、URL 参数、CSS、依赖或构建配置。
- 不关闭 Ant Design 自带的 `focusTriggerAfterClose`；共享机制只补足 Dropdown 菜单项已卸载时的触发器引用。
- 回滚时可以整体撤销 Hook、调用点属性、关闭回调与对应测试，不涉及数据迁移或服务端状态。

## 9. 取舍

- 不逐页复制 ref/恢复逻辑：该浏览器机制已跨 10 个以上页面重复，抽取 Hook 比页面补丁更小且一致。
- 不建立通用 ActionMenu 或 Modal 包装组件：现有页面菜单、权限和确认配置差异很大，包装会扩大组件合同。
- 不为已删除行设计相邻行或表格级 fallback：缺少产品合同，猜测焦点目标会制造新的行为。
