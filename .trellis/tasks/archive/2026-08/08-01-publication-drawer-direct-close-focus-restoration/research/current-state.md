# 当前实现与根因核对

## 1. 权威证据

- `.trellis/tasks/archive/2026-08/08-01-round-2-seven-group-centralized-regression/report.md`：14 项中 13 项通过；`PS-QA2-UI-002` 的候选 Drawer 无 dirty 直接关闭仍落到 `BODY`。
- 同任务 `research/regression-matrix.md`：审计桌面/移动详情与发布 dirty→确认放弃已通过；失败只在发布 Drawer 直接关闭路径。
- `.trellis/tasks/archive/2026-08/08-01-overlay-focus-restoration/`：原任务的批准合同是由状态所有者登记触发器，并在 Drawer `afterOpenChange(false)` 恢复；不允许选择器、延时、轮询或 fallback。

## 2. 当前调用链

- `PublicationWorkspace.tsx:212-229`：候选、发布记录和记录动作入口把 `event.currentTarget` 交给 `drawerFocus`；`closeDrawer` 清除 `selectedCommand`、`record` 和 `candidate`。
- `PublicationWorkspace.tsx:411-420`：`PublicationDrawer` 的 key 派生自选中 ID 与动作，`onAfterClose` 指向 `drawerFocus.restoreFocus`。
- `PublicationDrawer.tsx:56-74`：dirty=false 时直接调用 `onClose`；dirty=true 时由确认框决定继续编辑或先清除 dirty 再关闭。
- `PublicationDrawer.tsx:75-99`：Drawer 的 `open` 由 `candidate` / `publicationId` 派生，只有 `afterOpenChange(false)` 才调用 `onAfterClose`。
- 全仓搜索确认 `PublicationDrawer` 只有 `PublicationWorkspace` 一个产品调用方，`closeDrawer` 也只有同文件的 UI 关闭和删除成功路径使用。

## 3. 根因

关闭时 URL 清除使外层 key 从 `<对象 ID>:<动作>` 变为 `closed:view`。React 因 key 改变卸载旧 `PublicationDrawer`，而锁定版 Ant Design 6.5.0 的 `afterOpenChange` 是传给 `@rc-component/drawer` 的可见性完成回调；旧实例已经不存在，无法在关闭完成后调用 `restoreFocus`。

共享 `useFocusReturn` 已在 Dropdown 确认、审计桌面侧栏和移动 Drawer 通过，修改它不能补回一个从未发生的调用。

## 4. 测试缺口

`PublicationsPage.test.tsx:240-256` 只覆盖 dirty→确认框→放弃关闭。候选无 dirty 直接关闭没有用例。既有发布记录用例虽然断言原触发器获得焦点，但 `fireEvent.click` 不会像真实浏览器点击一样先移动焦点；若触发器从未失焦，断言可能假通过。新回归必须先显式聚焦 Drawer 内的关闭按钮。

## 5. 最小方案判断

推荐保持 URL 清除时序和共享 Hook 不变：外层 Drawer 不再使用动态 key，按对象/动作重置的 key 下移到候选/发布记录内容边界，并在内容身份变化时清除外层 dirty。该方案复用现有 Ant 生命周期和焦点 Hook，不增加第二份打开状态、依赖或异步时序技巧。

同步聚焦、`requestAnimationFrame`、定时器、DOM 选择器、`BODY` fallback 和复制 `isOpen` 状态均被排除。
