# 第三批：编辑与规则工作区视觉统一设计

## 权威来源

1. `.trellis/spec/frontend/visual-system.md`
2. `frontend/src/app/theme.ts`
3. `frontend/src/styles/global.css`
4. 现有共享组件和目标页面实际实现

`ui-ux-pro-max` 只用于表单可用性、错误反馈、只读与禁用、未保存、操作层级、响应式、键盘和可访问性审查。项目继续使用 Ant Design、`@ant-design/icons` 和系统字体。

## 共享边界

- `PageHeader.tsx`、`StatusTag.tsx`、`AsyncState.tsx`、`TableRegion.tsx` 和 `AppLayout.tsx` 不修改；现有接口足以表达本批需求。
- `theme.ts` 只允许修正已实测不满足 3:1 的共享控件边界：Ant Design `colorBorder` 改为消费既有 `borderStrong`，深色 `borderStrong` 只提高到达标值。不得新增 Token、页面色板或调整其他主题角色。
- 不新增共享页面壳层、表单工厂或未保存状态 Hook。各工作区只增加其自身所需的最小状态与确认逻辑。
- `global.css` 仅修改或新增 `.products-page`、`.product-facts-page`、`.content-review-*`、`.review-*`、`.revision-*`、`.platform-rule-*`、`.platform-rules-*`、`.prompt-*` 下的规则。

## 页面设计

### 产品事实

- 产品入口增加页面根类，保留 PageHeader、搜索、TableRegion 和新增弹窗；表格只在自身区域横向滚动。
- 新增弹窗使用现有 Form，补首错聚焦、提交错误 `role="alert"`、pending 禁用和有输入时的取消确认。
- 事实详情增加页面根类；保留章节导航和五类动态表单，只统一章节卡片、动态对象、保存栏和版本只读区域。
- `FactsForm` 继续持有 dirty/error section、保存状态和 `expected_revision`；补离开保护和切换版本确认。保存失败保留字段，保存成功更新 baseline。

### 内容编辑

- 保留三列业务结构和现有断点，只降低大面积高饱和渐变与玻璃装饰，让正文成为主视觉层。
- PageHeader 继续位于正文工作区，版本队列和审核决策为辅助表面。
- `RevisionForm` 继续编辑标题、标签、摘要、Markdown 和变更说明；向页面上报 dirty，用于返回和版本链接确认。
- 客户端错误使用 `scrollToFirstError` 的 focus 能力；服务端错误保留当前草稿并聚焦错误 Alert。
- 提交成功仍导航到新不可变版本，不修改当前版本。

### 平台规则

- 保留桌面平台、版本、详情、元数据四区；继续使用服务端 URL 选择和 `available_actions`。
- 窄屏继续按平台→版本→详情分阶段显示；不把隐藏面板纵向拼接。元数据继续使用 Drawer。
- 创建和编辑共享现有 `RuleEditor`，增加本地 dirty、首错聚焦、pending 禁用及取消确认。
- 查看差异为次操作；激活/退役遵循现有命令确认；删除留在危险操作区。

### Prompt

- 平台模式保留三列，自然化模式保留两列；不替换专用 Markdown textarea。
- 保留现有 baseline/dirty、tab/平台/链接/`beforeunload` 保护和 409 恢复。
- Markdown 编辑器统一工具栏、状态、错误、只读/禁用和主次操作；真实输出预览及安全边界不改数据流。
- 768px 以下平台列表位于编辑器前，但限制为约 `42dvh` 并内部滚动，使编辑器无需滚过整页列表。

## 表单、反馈和可访问性

- 页面和弹窗每个编辑表面仅一个 primary 按钮；危险按钮使用 `danger` 和确认。
- 保存状态用 `role="status"`/`aria-live="polite"`；错误和冲突用 `role="alert"`。
- 客户端校验失败聚焦首个字段；服务端错误聚焦 Alert，不增加未经契约支持的字段映射。
- 只读与禁用使用原生/Ant Design 语义；样式同时调整表面、边界和文字，不只降低透明度。
- 列表项、Tab、按钮、返回控制保持原生键盘语义；窄屏触控目标不小于 44px。
- `prefers-reduced-motion: reduce` 关闭本批页面的非必要 transition/animation，状态理解不依赖动画。

## 数据与契约

- 产品入口继续使用 `GET/POST /products` 和管理员删除；产品详情继续使用事实 PUT、快照和审核命令。
- 内容编辑继续读取 review-context，通过 revisions 创建新版本，并调用提交、批准、退回命令。
- 平台规则继续创建/PATCH 草稿并调用激活、退役和删除命令。
- Prompt 继续 PUT/DELETE 配置，预览继续创建真实生成或自然化作业。
- 不修改请求、缓存键、OpenAPI 类型、权限判断、状态机、历史记录或错误码。

## 响应式与主题

- 1440px：内容三列、规则四区、平台 Prompt 三列、自然化 Prompt 两列。
- 1024px：压缩辅助区；规则元数据可进入 Drawer，主编辑区保持可用。
- 768px 以下：内容按正文优先堆叠；事实表单单列且章节导航可滚动；规则分阶段；Prompt 单列且列表内部滚动。
- 产品表格和宽内容只允许局部横向滚动，文档本身不得溢出。
- 浅色、深色和跟随系统全部消费现有 Token；共享控件边界统一使用 `borderStrong`，不增加页面独立色板或主题覆盖。

## 回滚边界

- 变更按产品事实、内容编辑、平台规则、Prompt、作用域 CSS 和目标测试分组，可独立回退。
- 除已批准的 `colorBorder` 映射和深色 `borderStrong` 值外，如发现必须改变共享公共接口、其他主题 Token、API、权限或业务流程，停止实施并返回规划，不在本任务内扩张。
