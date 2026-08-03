# 发布确认取消回焦修复

## 1. 目标

修复发布记录从“更多操作”进入状态动作后，点击动作表单“取消”导致焦点落到 `BODY` 的问题，并让 Drawer 内直接选择动作后的取消回到对应动作按钮。键盘用户取消操作后必须回到仍然有效的原触发器，不丢失表格或 Drawer 内上下文。

本任务只修复发布动作确认区的取消焦点所有权，不改变发布状态机、服务端 `available_actions`、API、URL 合同、Drawer 的可访问性能力或动作提交行为。

## 2. 已确认事实

- 首次发布候选验收在提交 `56ae5ac5b660438c2f8a6adfef6c82005e6136b2` 的真实 Chromium smoke 中稳定复现：“更多操作 → 标记已移除 → 取消”后 `document.activeElement` 为 `BODY`，因此最终 `NO-GO`。
- 当前 `19860b2` 相对该提交没有 `frontend/src/` 产品差异；该阻断仍存在，且会使“上线前最终发布候选验收（复验）”可预见地失败。
- `PublicationWorkspace` 已使用外层 `drawerFocus` 保存表格入口，并把 `restoreFocus` 交给 `PublicationDrawer.onAfterClose`；外部菜单打开 Drawer 后直接关闭已经通过组件与 E2E 回归。
- `PublicationDrawer` 已正确处理普通关闭与入场未完成的快速关闭，并关闭 Ant Drawer 的重复触发器回焦；不得重复修改这一生命周期所有权。
- `PublicationRegistration` 的动作区由 `action` 条件渲染。当前取消按钮只清空 `action`、附件、dirty 和 mutation 状态；按钮自身随动作区卸载后没有焦点接收者，浏览器因此落到 `BODY`。
- `initialAction` 是现有、权威的动作来源标记：有值表示从表格“更多操作”进入 Drawer；无值时动作由 Drawer 内仍连接的命令按钮触发。
- 项目已有 `useFocusReturn()`，其合同禁止 DOM 查询、相邻元素猜测、延时、轮询和 `BODY` fallback。

## 3. 范围内要求

### R1. 外部菜单动作取消

- 当 `initialAction` 有效时，动作取消必须显式放弃未提交动作字段并关闭整个 Drawer。
- Drawer 关闭继续复用现有 `onClose` 与 `onAfterClose` 链；关闭完成后由 `PublicationWorkspace.drawerFocus` 把焦点恢复到打开本次动作的同一个“更多操作：…”按钮。
- 取消后清除 `record` 查询参数和 `selectedCommand`，不发起发布状态 API 请求。

### R2. Drawer 内动作取消

- 当用户从已打开 Drawer 内点击命令按钮进入动作区时，使用现有 `useFocusReturn()` 登记该具体按钮。
- 点击取消只关闭动作区，Drawer 与 `record` 查询参数保持不变；焦点恢复到刚才点击的同一个 Drawer 内命令按钮。
- 多个动作共用同一处理边界，不为“标记已移除”或“标记验证失败”建立页面名特判、第二份元素 ref 或 fallback。

### R3. 状态与兼容边界

- 两种取消路径都清空附件、dirty 和 mutation 错误状态；不得发送命令请求或改变服务端记录。
- 保持动作成功提交、删除确认、Drawer 直接关闭、dirty 放弃确认、Escape、遮罩、自动入焦、焦点圈定和关闭动画不变。
- 不增加定时器、`requestAnimationFrame`、DOM 选择器、轮询、全局状态、依赖或兼容分支。

### R4. 回归证据

- 组件测试使用 `userEvent` 真实移动焦点，分别覆盖外部菜单取消和 Drawer 内动作取消；旧实现下断言应失败，修复后通过。
- 现有 MVP 真实浏览器流程补充“更多操作 → 标记已移除 → 取消”断言：Drawer 关闭、URL 清理、焦点回到原表格按钮；保留再次打开并直接关闭的既有回焦断言。
- 更新 `.trellis/spec/frontend/hook-guidelines.md`，沉淀条件动作区与外层 Drawer 两级焦点所有权，不复制已有 Drawer 生命周期规则。

## 4. 范围外

- 不修改 `useFocusReturn`、`PublicationWorkspace` 的触发器登记、Ant Design 依赖或其他页面浮层。
- 不改变发布 API、命令键、权限、状态转换、确认文案、数据库、对象存储或 E2E 数据准备。
- 不处理视觉基线、共享 Redis broker 隔离、部署或其他发布候选问题。
- 不扩大、跳过或延长现有测试断言；不把延时或重试当作焦点修复。

## 5. 验收标准

- [x] AC1：表格“更多操作 → 标记已移除 → 取消”后 Drawer 完全关闭、`record` 查询参数清除，焦点回到同一个“更多操作：…”按钮。
- [x] AC2：已打开 Drawer 内点击动作按钮再取消后，Drawer 保持打开、动作区消失，焦点回到同一个 Drawer 内动作按钮。
- [x] AC3：两种取消都不发送发布命令请求，并清空附件、dirty 与 mutation 错误状态。
- [x] AC4：直接关闭、快速关闭、dirty 确认、动作提交、删除确认、Escape、遮罩、自动入焦和焦点圈定没有回归。
- [x] AC5：针对性组件测试在真实用户事件顺序下通过；MVP 隔离 E2E 的取消与直接关闭两条真实浏览器链均通过。
- [x] AC6：前端 lint、typecheck、`git diff --check` 与 `trellis-check` 通过；本轮 E2E 数据库和临时对象存储精确清理，开发 worker/scheduler 恢复。
- [x] AC7：差异仅包含当前任务资料、`PublicationDrawer.tsx`、发布组件测试、MVP E2E 断言及 Hook 规范；没有后端、合同、CSS、依赖、视觉资产或无关重构。

## 6. 后续依赖

当前任务通过并提交后，恢复规划中的 `08-03-pre-release-final-candidate-acceptance-rerun`，在新的冻结提交上执行七项门禁和关键页面 smoke。本修复任务本身不输出发布 `GO`。

## 7. 阻塞问题

无。预期焦点目标、两种动作来源、关闭行为、验证边界和后续依赖均由现有代码、首次验收报告与用户批准确定。
