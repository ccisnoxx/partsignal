# 发布确认取消回焦修复：执行设计

## 1. 设计结论

复用现有两级焦点所有权，不新增焦点机制：外部表格菜单仍由 `PublicationWorkspace.drawerFocus` 持有；Drawer 内命令按钮由 `PublicationRegistration` 新增一个 `useFocusReturn()` 实例持有。取消时根据现有 `initialAction` 选择唯一有效路径。

## 2. 当前根因

```text
表格“更多操作”或 Drawer 内命令按钮
  -> action 有值，动作表单渲染
  -> 用户点击“取消”
  -> setAction(undefined)
  -> 当前取消按钮随条件动作区卸载
  -> 没有任何恢复调用
  -> document.activeElement = BODY
```

问题位于 `PublicationRegistration` 的条件区域卸载边界，不是共享 Hook 或 Drawer 关闭生命周期失效。前两轮修复已经证明外层 Drawer 在正常与快速关闭时都能恢复表格触发器，当前任务不得重新包装或延迟该回调。

## 3. 两条取消链

### 3.1 外部菜单进入

```text
表格更多按钮
  -> drawerFocus 记录外部按钮
  -> 菜单项设置 selectedCommand / initialAction
  -> Drawer 打开并直接显示动作区
  -> 取消：清空动作临时状态并调用现有 onClose
  -> URL 与 selectedCommand 清除，Drawer 完成关闭
  -> 现有 onAfterClose
  -> drawerFocus.restoreFocus()
  -> 原表格更多按钮
```

外部目标位于 Drawer 之外。在焦点圈定仍启用时不能只隐藏动作区后直接聚焦外部按钮，因此此路径必须关闭 Drawer，再使用既有关闭后回焦链。

### 3.2 Drawer 内按钮进入

```text
已打开 Drawer 的命令按钮
  -> actionFocus 记录该按钮
  -> 动作区渲染
  -> 取消：清空动作临时状态并隐藏动作区
  -> actionFocus.restoreFocus()
  -> 同一个 Drawer 内命令按钮
```

命令按钮始终位于动作区之外且仍连接，可以同步恢复，不需要延时或 DOM 查询。Drawer、URL 与外层 `drawerFocus` 均不消费。

## 4. 组件边界

### 4.1 `PublicationDrawer`

- 把现有外层 `onClose` 传给 `PublicationRegistration`，只用于外部 `initialAction` 的显式取消。
- 不修改 `requestClose`、`openCompletedRef`、`focusable` 或 `afterOpenChange`。

### 4.2 `PublicationRegistration`

- 在所有渲染分支之前调用现有 `useFocusReturn()`。
- 给服务端投影出的非删除命令按钮复用 `focusReturnTargetProps`；删除继续走独立确认链。
- 收敛一个取消处理函数：先清空附件、dirty 和 mutation 状态；若有 `initialAction`，调用外层关闭；否则清空 `action` 并恢复 Drawer 内触发器。
- 不增加动作名判断。`initialAction` 只表达来源，不形成第二份打开状态。

## 5. 测试设计

1. 组件回归：从真实 Dropdown 菜单点击“标记已移除”，确认菜单项获得焦点；点击动作区取消后断言 Drawer 消失、URL 无 `record`、原更多按钮聚焦且没有 POST。
2. 组件回归：从直接打开的 Drawer 点击“标记已移除”，再取消；断言 Drawer 与 `record` 保留、动作区消失、原命令按钮聚焦且没有 POST。
3. 保留现有菜单动作直接关闭、候选关闭与 dirty 放弃测试，证明 Drawer 生命周期未回归。
4. MVP E2E：在现有真实记录上先执行菜单动作取消链并断言外部触发器，再重新打开同一动作并直接关闭，保留两条浏览器证据。

## 6. 规范同步

在 `hook-guidelines.md` 增补一个简短稳定规则：条件区域卸载后应恢复到打开该区域且仍连接的触发器；当触发器位于仍开启的焦点圈定浮层之外时，应先关闭该浮层并复用其既有回焦所有者。不得重复已有 Drawer 生命周期说明。

## 7. 修改边界

预计修改：

- `frontend/src/features/publications/PublicationDrawer.tsx`
- `frontend/src/features/publications/PublicationsPage.test.tsx`
- `frontend/tests/e2e/mvp-flow.spec.ts`
- `.trellis/spec/frontend/hook-guidelines.md`
- 当前 Trellis 任务目录

只读核对：

- `frontend/src/features/publications/PublicationWorkspace.tsx`
- `frontend/src/shared/hooks/useFocusReturn.ts`

## 8. 回滚

回滚只移除 `PublicationRegistration` 的取消分流、组件/E2E 回归和新增规范段落。没有 API、数据、配置、依赖或迁移回滚。
