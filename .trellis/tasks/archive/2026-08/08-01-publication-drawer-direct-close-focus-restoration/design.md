# 发布抽屉直接关闭焦点恢复设计

## 1. 设计目标

让 URL 控制的发布 Drawer 完成真实关闭生命周期后再恢复原触发器，同时保留现有按业务对象和初始动作重置临时表单状态的行为。修复只调整 React 身份边界，不增加状态来源或焦点实现。

## 2. 不变量

1. `candidate` / `record` 查询参数继续决定 Drawer 的 `open` 和当前对象。
2. `PublicationWorkspace.closeDrawer` 继续立即清除查询参数和 `selectedCommand`。
3. Ant Design 继续负责 Drawer 动画、焦点圈定、关闭按钮、遮罩和 Escape。
4. `useFocusReturn` 继续保存并恢复真实触发元素；没有 fallback。
5. 不同候选、发布记录和初始动作的表单/附件/dirty 状态必须相互隔离。

## 3. 当前链路与根因

```text
原触发按钮
  → drawerFocus.rememberFocusTarget(event.currentTarget)
  → URL 写入 candidate / record
  → 外层 PublicationDrawer key = <对象 ID>:<动作>
  → 用户直接关闭，closeDrawer 清除 URL
  → 外层 key 立即变成 closed:view，旧 Drawer 实例被替换
  → 旧实例未收到 afterOpenChange(false)
  → drawerFocus.restoreFocus 未执行，焦点落到 BODY
```

锁定的 Ant Design 6.5.0 把 `afterOpenChange` 传给 `@rc-component/drawer` 的可见性完成回调。React 实例提前卸载后，该关闭完成回调没有存活的接收者。问题属于 Drawer 生命周期所有权，不属于共享 Hook。

## 4. 方案

### 4.1 稳定外层生命周期所有者

移除 `PublicationWorkspace` 中 `<PublicationDrawer>` 元素的动态 `key`。同一个组件实例从 `open=true` 接收 URL 清空后的 `open=false`，因而可以完成 Ant Drawer 关闭过渡，并在 `afterOpenChange(false)` 调用既有 `onAfterClose`。

### 4.2 把重置边界放到内容层

`PublicationDrawer` 根据候选 ID、发布记录 ID 和 `initialAction` 派生一个内容身份：

- 候选：`candidate:<content_version_id>`；
- 发布记录：`publication:<publication_id>:<initial_action | view>`；
- 关闭：无业务内容。

该身份只用于给 `CandidateRegistration` / `PublicationRegistration` 内容实例设置 key，并在身份变化时把外层 `dirty` 恢复为 `false`。这样保留原动态 key 对临时状态的重置职责，但不再替换承载关闭回调的 Drawer。

不创建 `isOpen` / `isClosing` 状态；打开状态仍只由 URL 派生。

## 5. 修复后链路

```text
原触发按钮已登记
  → URL 打开 Drawer，内容按业务身份挂载
  → 用户关闭，URL 立即清除
  → 同一个外层 Drawer 接收 open=false
  → 内容卸载并清除临时 dirty
  → Ant 关闭过渡完成
  → afterOpenChange(false)
  → drawerFocus.restoreFocus()
  → 原触发器仍连接时 preventScroll 聚焦
```

## 6. 测试设计

1. 新增候选无 dirty 直接关闭测试：显式聚焦 Drawer 关闭按钮，再点击关闭；等待 URL 清除和原触发器重新获得焦点。该测试在旧实现下应失败，避免触发按钮从未失焦的假通过。
2. 强化既有发布记录菜单入口关闭测试：关闭前显式把焦点置于 Drawer 内，继续断言原“更多操作”恢复。
3. 保留 dirty→继续编辑 / 放弃并关闭测试，证明确认链没有回归。
4. 真实浏览器分别验证候选关闭按钮和发布记录 Escape（或反向组合），并直接读取 `document.activeElement` 与原触发器是否为同一元素。

## 7. 预计修改边界

- `frontend/src/features/publications/PublicationWorkspace.tsx`
- `frontend/src/features/publications/PublicationDrawer.tsx`
- `frontend/src/features/publications/PublicationsPage.test.tsx`
- `.trellis/spec/frontend/hook-guidelines.md`
- 当前 Trellis 任务文档与研究记录

不修改后端、合同、生成类型、CSS、依赖、E2E fixture 或视觉基线。

## 8. 放弃的方案

- **在 `closeDrawer` 中同步聚焦**：Drawer 仍处于焦点圈定和关闭动画中，恢复时机错误，属于症状补丁。
- **增加 `isClosing` 或复制 URL 选择状态**：制造第二份打开状态和同步问题，现有 Ant 生命周期已经能表达关闭完成。
- **延时、`requestAnimationFrame`、选择器或 `BODY` fallback**：缺少时序保证并违反现有焦点规范。
- **修改 `useFocusReturn`**：共享 Hook 已在审计和确认链通过，无法修复调用方在回调前卸载的问题。

## 9. 兼容与回滚

- 不改变外部 props、API、URL、样式、依赖或数据。
- 回滚只涉及 React key 边界、对应测试和一条规范；没有迁移或部署操作。
