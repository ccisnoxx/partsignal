# 发布 Drawer 菜单动作关闭焦点回归

## 目标

修复发布记录从“更多操作”菜单执行“标记已移除”打开“发布结果登记” Drawer 后，点击关闭按钮未把焦点恢复到原“更多操作”触发器的问题，使键盘用户回到原表格位置继续操作。

## 背景与已确认事实

- 失败由 `frontend/tests/e2e/mvp-flow.spec.ts:781-794` 的真实 Chromium 链稳定暴露：原触发器仍连接且可定位，但关闭后持续为未聚焦。
- 已归档任务 `08-01-publication-drawer-direct-close-focus-restoration` 已修复外层 Drawer 动态 key 提前替换问题；候选直接入口、发布记录直接入口、dirty 确认链和共享 `useFocusReturn` 已通过，不得重复改动。
- `PublicationWorkspace` 已登记真实菜单触发器，并把 `drawerFocus.restoreFocus` 交给 `PublicationDrawer`；共享 Hook 本身工作正常。
- 实施期真实 Chromium 诊断确认，菜单动作 Drawer 会在入场动画完成前被关闭：`@rc-component/drawer` 此时直接卸载 Portal，不触发 `afterOpenChange(false)`，所以业务回焦根本没有执行。入场已完成的普通关闭仍存在业务回调后被内建回焦覆盖的风险，因此两个生命周期分支都必须收敛到同一个业务回焦所有者。
- 现有组件测试使用 `fireEvent`，没有还原真实菜单项获得焦点的顺序，因而未阻止该回归。

## 范围内

1. 让 `PublicationDrawer` 在已由 `useFocusReturn` 管理关闭焦点的前提下，不再执行 Ant Drawer 的第二次触发器回焦。
2. 在 Drawer 入场动画尚未完成、`afterOpenChange(false)` 不会触发时，随 `open` 转为 `false` 调用同一个业务回焦实现。
3. 保留 Ant Drawer 的自动入焦、焦点圈定、Escape、遮罩和关闭动画。
4. 强化发布记录菜单动作组件回归，使用真实用户事件顺序使菜单项先获得焦点，再关闭 Drawer 并断言原触发器恢复。
5. 复跑现有 MVP E2E 的 `frontend/tests/e2e/mvp-flow.spec.ts:781-794` 链，证明真实浏览器中快速关闭也能回焦。
6. 将“业务显式接管 Drawer 回焦时必须关闭重复内建回焦，并覆盖入场未完成的关闭分支”的稳定约束同步到前端 Hook 规范。

## 范围外

- 不修改 `useFocusReturn`、Dropdown、Ant Design 依赖或其他页面浮层。
- 不改变 Drawer 打开/关闭状态、URL 查询参数、dirty 确认、焦点圈定或自动入焦。
- 不修改发布 API、`available_actions`、权限、状态动作、数据库、对象存储或 E2E 数据准备。
- 不降低、删除、跳过或延长现有焦点断言；不增加延时、轮询、DOM 查询或 fallback 焦点。
- 不处理 Dashboard 视觉基线、Alert 兼容提示及其他回归事项。

## 需求

1. “更多操作”菜单项打开 Drawer 时，关闭完成后的唯一回焦所有者必须是现有 `drawerFocus.restoreFocus`。
2. 原触发器仍连接时必须使用现有 `focus({ preventScroll: true })` 返回同一按钮；失效元素继续按共享 Hook 合同安全结束。
3. 关闭重复回焦不得关闭 Drawer 的焦点圈定或打开后自动聚焦；允许记录“入场动画是否完成”的单一生命周期 ref，但不得复制焦点目标。
4. 组件回归必须使用会真实移动焦点的用户事件，覆盖“触发器 → 菜单项 → Drawer 关闭按钮 → 原触发器”的顺序。
5. 直接按钮入口、菜单动作入口、dirty→继续编辑/放弃关闭和 URL 清理行为必须保持不变。

## 验收标准

- [x] AC1：从发布记录“更多操作”选择“标记已移除”后，Drawer 正常打开并保持既有初始动作。
- [x] AC2：点击 Drawer 关闭按钮后，Drawer 完全关闭、`record` 查询参数清除，焦点回到打开本次菜单的同一个“更多操作”按钮。
- [x] AC3：组件测试使用真实用户事件证明菜单项确实获得过焦点，旧实现下可失败，修复后通过。
- [x] AC4：候选/发布记录直接入口、Escape/遮罩、dirty→继续编辑/放弃关闭、焦点圈定和自动入焦没有回归。
- [x] AC5：`mvp-flow.spec.ts:781-794` 的真实 Chromium 链通过，且未修改或削弱现有焦点断言；随后范围外失败单独归因记录。
- [x] AC6：发布页针对性 Vitest、前端 typecheck、lint、`git diff --check` 和 `trellis-check` 通过。
- [x] AC7：没有后端、合同、CSS、依赖、测试基础设施、Dashboard 基线或无关重构变更；Playwright 诊断产物保持未跟踪且不纳入提交。

## 权威位置

- Drawer 焦点配置与关闭生命周期：`frontend/src/features/publications/PublicationDrawer.tsx`。
- 菜单入口与触发器登记：`frontend/src/features/publications/PublicationWorkspace.tsx`；只核对，不预计修改。
- 组件回归：`frontend/src/features/publications/PublicationsPage.test.tsx`。
- 真实浏览器回归：`frontend/tests/e2e/mvp-flow.spec.ts:781-794`；预计复用现有断言，不修改文件。
- 稳定焦点合同：`.trellis/spec/frontend/hook-guidelines.md`。
- 失败证据：`frontend/test-results/mvp-flow-批准事实到人工发布和-GEO-观测保持完整追溯-e2e/error-context.md` 与对应 `trace.zip`；诊断产物不提交。

## 阻塞问题

无。预期行为、根因、实现边界和验收证据均已由当前代码、锁定依赖与失败 trace 确定。
