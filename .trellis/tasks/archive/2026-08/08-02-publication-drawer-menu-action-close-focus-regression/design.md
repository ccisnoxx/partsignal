# 发布 Drawer 菜单动作关闭焦点回归设计

## 1. 设计结论

`PublicationDrawer` 继续由 `useFocusReturn` 保存并恢复真实业务触发器，同时覆盖 rc Drawer 的两种关闭路径：入场已完成时在 `afterOpenChange(false)` 回焦；入场未完成时，Portal 会直接卸载，改由 `open` 转为 `false` 的 effect 回焦。Ant Design 的重复“打开前活动元素”回焦保持关闭。

## 2. 当前链路与根因

```text
“更多操作”按钮登记到 drawerFocus
  → Dropdown 菜单项获得焦点
  → 菜单项打开 PublicationDrawer
  → E2E 在入场动画完成前点击关闭
  → rc Drawer 因 animatedVisible 仍为 false 而直接卸载 Portal
  → afterOpenChange(false) 不触发
  → drawerFocus.restoreFocus() 未执行
  → 页面没有焦点目标
```

锁定的 `@rc-component/drawer` 1.4.2 只有在入场完成、`animatedVisible` 已设为 `true` 后才保留关闭 Portal 并完成离场回调。实施期 trace 中菜单动作链没有 `afterOpenChange(true)`，关闭请求后也没有 `afterOpenChange(false)` 或 `restoreFocus`，直接证明快速关闭分支遗漏。对于入场已完成的普通关闭，`internalAfterOpenChange(false)` 仍会在业务回调后聚焦 `lastActiveRef`，因此必须同时关闭内建回焦，避免 Dropdown 临时活动元素覆盖正确目标。

## 3. 最小实现

在 `PublicationDrawer` 的 Ant `Drawer` 上配置：

```tsx
focusable={{ focusTriggerAfterClose: false }}
```

Ant Design 6.5.0 会把该配置与默认 `trap: true` 合并，所以只关闭内建关闭回焦：

- `autoFocus` 保持默认开启；
- `trap` 保持默认开启；
- 入场已完成时，`afterOpenChange(false)` 继续执行；
- `drawerFocus.restoreFocus` 继续是唯一业务回焦实现。

组件用 `openCompletedRef` 只记录入场动画是否完成：`afterOpenChange(true)` 将其置为完成；`open` 转为 `false` 且入场尚未完成时，effect 直接清理 dirty 状态并回焦；入场已完成时仍等待 `afterOpenChange(false)`。该 ref 不保存元素，不形成第二份焦点状态，也不引入延时或 DOM 查询。

## 4. 测试设计

1. 将 `PublicationsPage.test.tsx` 中发布记录更多菜单回归改用 `@testing-library/user-event` 完成触发器、菜单项和关闭按钮点击，使 jsdom 中菜单项也真实获得焦点。
2. 在 Drawer 打开前或打开链中断言菜单项交互成立；关闭后继续精确断言原 `moreTrigger` 获得焦点。
3. 保留现有候选直接关闭、dirty 确认和发布记录内容/动作断言。
4. 复跑现有 MVP E2E，不修改 `toBeFocused()` 断言；它是实际浏览器顺序的最终证明。

## 5. 不变量

- `candidate` / `record` 查询参数继续是 Drawer 打开状态的唯一来源。
- `PublicationWorkspace` 的触发器登记、动作选择和 `drawerFocus.restoreFocus` 不变。
- 共享 Hook 的 `isConnected`、`preventScroll` 和无 fallback 合同不变。
- Ant Drawer 的焦点圈定、自动入焦、Escape、遮罩、动画和内容销毁行为不变。
- 仅增加一个 Drawer 入场完成 ref；不增加焦点目标 ref、状态、定时器、DOM 查询、依赖或兼容 fallback。

## 6. 预计修改边界

- `frontend/src/features/publications/PublicationDrawer.tsx`
- `frontend/src/features/publications/PublicationsPage.test.tsx`
- `.trellis/spec/frontend/hook-guidelines.md`
- 当前 Trellis 任务目录

只读核对但不预计修改：

- `frontend/src/features/publications/PublicationWorkspace.tsx`
- `frontend/tests/e2e/mvp-flow.spec.ts`

## 7. 放弃方案

- 修改 `useFocusReturn`：共享 Hook 合同正确，遗漏的是 Drawer 快速关闭生命周期；普通关闭的覆盖也应在 Drawer 配置层消除。
- 延迟或重复调用 `restoreFocus`：时序脆弱，并引入定时器或轮询。
- 保存 Dropdown 菜单项、查询 DOM 或选择邻近按钮作为 fallback：目标不稳定且违反既有合同。
- 关闭 Drawer 的 `autoFocus` 或焦点圈定：会削弱对话框可访问性，且不是根因。
- 重构菜单触发器传递或增加第二份焦点目标 ref：现有业务触发器登记已经正确，不需要复制状态。

## 8. 兼容与回滚

不改变外部 API、URL、数据、样式或依赖。回滚仅移除 Drawer 焦点配置、入场完成 ref/effect、对应测试调整和规范说明；没有迁移或部署操作。
