# 发布抽屉直接关闭焦点恢复

## 目标

修复集中回归中尚未闭环的 `PS-QA2-UI-002`：用户从发布工作台打开候选或发布记录 Drawer，在没有未提交内容时直接关闭，焦点必须在 Drawer 完全关闭后返回原触发按钮，而不是落到 `BODY`。

## 背景与已确认事实

- 权威回归报告确认 14 项原问题中仅 `PS-QA2-UI-002` 仍有真实产品缺陷；审计详情、Dropdown→确认框和发布 Drawer 的 dirty→确认放弃路径已经通过。
- `PublicationWorkspace` 已使用共享 `useFocusReturn` 保存真实触发元素，并把恢复函数交给 `PublicationDrawer.onAfterClose`；共享 Hook 在其他浮层链路中已经验证通过，不是本次根因。
- 关闭动作会立即清除 URL 中的 `candidate` / `record`，这是现有 URL 单一状态来源的正确行为。
- `PublicationDrawer` 外层实例当前使用由选中 ID 和动作派生的动态 `key`。关闭时该 key 立即变为 `closed:view`，旧实例在 Ant Design 调用 `afterOpenChange(false)` 前被替换，因而没有执行焦点恢复。
- 现有组件测试覆盖 dirty→确认放弃，但没有模拟焦点已进入 Drawer 后的无 dirty 直接关闭，未能阻止该回归。

## 范围内

1. 保证持有 Ant Design `afterOpenChange(false)` 的 `PublicationDrawer` 实例在关闭过渡完成前保持稳定。
2. 将按候选、发布记录和初始动作重置局部表单状态的身份边界保留在 Drawer 内容层，不让状态重置依赖外层生命周期实例被替换。
3. 增加候选 Drawer 无 dirty 直接关闭回归，并强化发布记录直接关闭回归：测试必须先把焦点放入 Drawer，再断言关闭后返回原触发器。
4. 保持 close button、遮罩和 Escape 共用现有 `onClose` 入口；真实浏览器至少验证候选直接关闭和发布记录直接关闭中的代表性路径。
5. 把“关闭回调所有者必须存活到关闭完成”的稳定规则补充到前端焦点规范。

## 范围外

- 不修改 `useFocusReturn`、Ant Design、全局焦点管理、其他页面 Drawer 或确认框。
- 不增加第二份 Drawer 打开状态、全局 Store、DOM 查询、延时、轮询或 fallback 焦点。
- 不修改发布 API、URL 参数合同、`available_actions`、权限、删除/发布命令、缓存或数据库。
- 不处理集中回归分流出的 E2E `available_actions` fixture、自然化期待、Dashboard 视觉基线或 `Alert.message` 兼容清理。
- 不顺带重构 `PublicationWorkspace`、`PublicationDrawer` 或测试夹具。

## 需求

1. `candidate` / `record` 查询参数继续是 Drawer 是否打开和当前业务对象的唯一来源。
2. 关闭请求仍立即清除选择查询参数；不得为了等待动画复制一份组件打开状态。
3. 执行 `onAfterClose` 的 Drawer 生命周期所有者不得因查询参数清除而换 key 或卸载。
4. 候选、发布记录或初始动作改变时，既有 dirty、动作表单和附件选择仍按当前行为重置，不得把上一个对象的临时状态带到下一个对象。
5. 焦点恢复继续由 `drawerFocus.restoreFocus` 执行，只恢复仍连接的原触发器并保持 `preventScroll`；本任务不得复制实现。
6. 组件回归必须让关闭按钮实际获得焦点后再关闭，避免 `fireEvent.click` 未移动焦点造成假通过。

## 验收标准

- [x] AC1：从“准备人工发布”打开候选 Drawer，不修改表单，聚焦并点击关闭按钮后，`candidate` 查询参数消失，Drawer 完全关闭，焦点回到同一个“准备人工发布”按钮。
- [x] AC2：从发布记录主入口或“更多操作”打开 Drawer，直接关闭后，`record` 查询参数消失，焦点回到对应原触发器。
- [x] AC3：Escape / 遮罩仍走现有关闭入口；代表性真实浏览器 Escape 验证也在关闭完成后恢复原触发器。
- [x] AC4：dirty→“继续编辑”保持 Drawer 和输入；dirty→“放弃并关闭”仍恢复原触发器。
- [x] AC5：在不同候选、发布记录或初始动作之间切换时，局部 dirty、动作和附件状态不会跨对象泄漏。
- [x] AC6：URL、请求、动作投影、删除确认、成功/失败反馈和 Ant Design 自带焦点圈定行为不变。
- [x] AC7：发布页针对性 Vitest、前端 typecheck、lint、真实浏览器定向验证和 `trellis-check` 通过。

## 权威实现位置

- Drawer 与 URL 状态所有者：`frontend/src/features/publications/PublicationWorkspace.tsx`。
- Drawer 关闭生命周期与局部表单状态：`frontend/src/features/publications/PublicationDrawer.tsx`。
- 回归测试：`frontend/src/features/publications/PublicationsPage.test.tsx`。
- 稳定焦点合同：`.trellis/spec/frontend/hook-guidelines.md`。
- 根因证据：本任务 `research/current-state.md` 及集中回归归档报告。

## 阻塞问题

无。预期行为、根因、实现所有者和兼容边界均已由现有代码、锁定版 Ant Design 与集中回归证据确定。
