# 发布管理工作台视觉研究

## 输入与约束

- 原型图只提供视觉层级和信息架构参考：流程摘要、状态视图、高密度列表、聚焦登记面板、指引、异常、数据概览和最近动态。
- 页面必须继续使用项目现有 Ant Design、主题 Token、CSS 变量、`PageHeader`、`StatusTag`、`TableRegion`、`AsyncState` 与 `DirectUpload`，不得复制原型中的模拟数据、平台商标或无契约字段。
- 项目已经提供浅色、深色、跟随系统三态主题及系统变化监听，证据见 `frontend/src/app/theme.ts:1-203`、`frontend/src/app/ThemeProvider.tsx:23-102` 和 `frontend/src/shared/components/ThemeModeControl.tsx:8-35`。

## 检索结论

通过 `ui-ux-pro-max` 的设计系统、`style`、`ux` 与 `web` 检索得到以下可用原则：

1. 工作台采用高密度仪表盘节奏，卡片内边距以 8/12/16px 层级组织，表格行保持紧凑但可扫描。
2. 磨砂玻璃只用于有层级意义的摘要、抽屉和浮层；业务表格主体保持可读的不透明或高不透明表面，不能因透明度损失对比度。
3. 宽表格在移动端使用可聚焦横向滚动区或卡片化字段，不允许撑破页面；项目已有 `TableRegion` 提供 `role="region"`、可访问名称和键盘聚焦，见 `frontend/src/shared/components/TableRegion.tsx:1-5`。
4. 表单必须有可见标签、字段级错误、提交中状态和真实错误恢复；加载、失败、无权限和空态复用 `AsyncState`，见 `frontend/src/shared/components/AsyncState.tsx:1-21`。
5. Drawer 必须支持 Escape 关闭、焦点圈闭和关闭后焦点恢复；移动端操作目标至少 44px，图标按钮有可访问名称，状态不能只靠颜色。
6. 动效只表达抽屉、筛选和状态切换的因果关系，时长控制在 150–300ms，并继续尊重项目现有 `prefers-reduced-motion` 规则，见 `frontend/src/styles/global.css:642-645`。

检索推荐的 Newsletter/营销页结构、Calistoga/Inter 字体、独立色板、GSAP 动效和新的图标体系不适用于当前项目，全部舍弃。原因是它们会覆盖 PartSignal 已完成页面的视觉语言，或引入用户明确禁止的第二套设计系统和依赖。

## 页面视觉决策

- 1536×1024：顶部流程摘要横排；主列表占满内容区；仅在用户选择候选或动作时打开右侧 Drawer，不长期保留空面板；底部四模块使用响应式网格。
- 1024px：流程摘要允许两行或紧凑横向滚动；底部模块改为两列；Drawer 宽度不超过视口并保留主页面上下文。
- 375×812：摘要变为可横向浏览的状态卡或纵向紧凑列表；筛选折叠；表格使用可聚焦横向滚动并优先显示标题、平台、状态和操作；Drawer 全屏，底部主操作避开安全区。
- 浅色/深色/跟随系统：只消费 `projectThemes` 映射的语义变量；玻璃透明度、边框、阴影、遮罩和焦点态分别验收，禁止组件内硬编码色值。
- 信息优先级：当前可执行工作 > 当前状态和异常 > 历史记录 > 指引、周期指标和动态。无数据时不保留为还原截图而存在的空分栏。
