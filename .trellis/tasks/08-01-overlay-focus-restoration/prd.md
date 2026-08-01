# 浮层焦点恢复

## 目标

修复第二轮全项目回归中的 `PS-QA-201` 与 `PS-QA2-UI-002`：键盘用户从业务表格打开确认框、发布记录 Drawer 或审计详情后，关闭浮层时应回到原列表触发按钮并继续当前位置操作。

## 背景与已确认事实

- 权威来源：
  - `.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/report.md`
  - `.trellis/tasks/archive/2026-08/07-31-sitewide-functional-regression-testing-round-2/research/findings.md`
- `PS-QA-201` 已在待发布候选、产品和 AI Header 三条真实浏览器链复现：普通 Dropdown 独立关闭时能够恢复焦点，但从菜单继续打开 `modal.confirm` 后取消，`document.activeElement` 落到 `BODY`。
- 同一调用模式覆盖内容任务、产品、事实版本、发布候选/记录、GEO 观测、AI 渠道/Header/模型、平台、平台类型、发布账号和用户列表。
- `PS-QA2-UI-002` 已在发布记录 Drawer 和桌面审计详情侧栏复现；移动审计 Drawer 与桌面侧栏共用同一选中状态，属于同一恢复边界。
- 根因是浮层状态所有者没有保存列表触发元素，或确认框打开时 Ant Design 记录到的是随后卸载的菜单项；关闭后没有仍连接的触发器可供默认机制恢复。
- `frontend/src/features/configuration/PlatformsPage.tsx` 已有详情触发器记录及 Drawer `afterOpenChange` 恢复模式，可作为项目内权威参考。

## 范围内

1. 提供一个无业务判断的共享焦点返回 Hook，统一记录触发元素，并仅在该元素仍连接到当前文档时恢复焦点。
2. 将所有已确认的表格 Dropdown → `modal.confirm` 调用链接入同一机制，覆盖：
   - 内容任务列表；
   - 产品列表与事实版本列表；
   - 待发布候选与发布记录；
   - GEO 观测记录；
   - AI 渠道、Header 与模型；
   - 平台、平台类型、发布账号与用户列表。
3. 由发布工作台的 Drawer 状态所有者保存发布记录入口，并在 Drawer 完全关闭后恢复焦点；同时覆盖从发布记录“更多操作”进入 Drawer 的路径。
4. 由审计页的详情状态所有者保存“查看日志详情”入口：桌面侧栏卸载后恢复，移动 Drawer 完全关闭后恢复。
5. 增加共享 Hook、代表性页面和真实浏览器回归断言，证明取消确认、关闭发布 Drawer、关闭桌面/移动审计详情后焦点返回原按钮。
6. 保持现有键盘打开、焦点圈定、Escape 关闭、URL 查询参数和业务请求行为不变。

## 范围外

- 不处理 `PS-QA-202`、`PS-QA-203` 的危险删除文案。
- 不处理 `PS-QA2-UI-001`、`PS-QA2-UI-003`、`PS-QA2-TEST-001` 或 `PS-QA2-DEC-001`。
- 不修改后端、OpenAPI、数据库合同、权限、`available_actions`、删除副作用或缓存策略。
- 不重做 Ant Design 的焦点圈定、Escape 行为或视觉样式，不引入新的 UI/焦点管理依赖。
- 删除成功后若原表格行已经移除，不猜测下一个业务焦点目标；仅对仍连接的原触发元素执行恢复。
- 不扩展到本轮报告未登记的普通 Modal、Drawer 或直接按钮确认流程。

## 需求

1. 触发器记录必须同时覆盖键盘聚焦和指针按下，不能依赖菜单项或 DOM 查询猜测原按钮。
2. 焦点恢复必须发生在确认框或 Drawer/侧栏关闭完成后，并使用 `focus({ preventScroll: true })` 保持当前表格位置。
3. 共享 Hook 只持有浏览器元素引用，不拥有业务状态、路由、权限、确认文案或请求逻辑。
4. 每个页面仍由现有状态所有者决定何时打开和关闭浮层；不得增加全局 Store、事件总线或第二套浮层包装组件。
5. 恢复前必须验证触发元素仍连接；失效元素不得触发异常或隐式 fallback。
6. 既有 Dropdown 单独关闭的焦点行为、平台详情焦点恢复、内容任务取消 Modal 焦点恢复不得回归。

## 验收标准

- [ ] AC1：从所有登记的表格“更多操作”按钮进入静态确认框后，点击取消或按 Escape 关闭时，焦点回到打开该菜单的原按钮。
- [ ] AC2：确认流程关闭时不会滚动到页面顶部；若原触发元素已从 DOM 移除，则安全跳过恢复且不报错。
- [ ] AC3：从发布记录列表打开“发布结果登记” Drawer 后，以关闭按钮或 Escape 关闭，焦点回到原“查看记录”或“更多操作”按钮。
- [ ] AC4：桌面审计详情侧栏关闭后，焦点回到原“查看日志详情”按钮。
- [ ] AC5：移动审计 Drawer 完全关闭后，焦点回到原“查看日志详情”按钮。
- [ ] AC6：确认文案、动作可见性、URL 查询参数、请求载荷、成功/失败反馈及服务端最终校验均保持不变。
- [ ] AC7：共享 Hook 有最小单元测试；发布、审计和代表性 Dropdown→确认链有组件或 Playwright 回归断言。
- [ ] AC8：前端类型检查、Lint、针对性 Vitest 和针对性真实浏览器验证通过。

## 权威实现位置

- 共享浏览器机制：`frontend/src/shared/hooks/`。
- Dropdown 与确认入口：各业务列表页现有 `Dropdown`、`modal.confirm` 调用点。
- 发布 Drawer 状态：`frontend/src/features/publications/PublicationWorkspace.tsx` 与 `PublicationDrawer.tsx`。
- 审计详情状态：`frontend/src/features/configuration/AuditLogPage.tsx`。
- 项目内参考：`frontend/src/features/configuration/PlatformsPage.tsx` 的详情触发器与关闭后恢复流程。

## 阻塞问题

无。预期行为、兼容边界和范围均由权威回归报告、现有规范与代码实现确定。
