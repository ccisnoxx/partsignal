# 前端唯一视觉规范固化

## Goal

把用户确认的 PartSignal 原型视觉总结固化为前端唯一、可执行、可检索的视觉开发规范，确保后续页面建设和 UI/UX 审计都复用现有主题、Ant Design 与共享组件，不再由业务页面或设计 Skill 自行生成配色、字体、卡片体系或第二套设计系统。

本任务只新增 `.trellis/spec/frontend/visual-system.md` 并更新 `.trellis/spec/frontend/index.md`，不修改任何前端代码、主题值、样式、依赖或业务行为。

## Confirmed Facts

- 用户确认 PartSignal 的目标风格为“macOS 原生应用秩序感 × 轻量磨砂玻璃 × 高密度企业 SaaS 工作台 × 克制的数据可视化”。
- `.trellis/spec/` 是项目稳定开发约束的权威位置；不得再运行 `ui-ux-pro-max --persist` 生成 `design-system/MASTER.md`，避免形成第二份视觉规范。
- `frontend/src/app/theme.ts` 已是颜色、状态色、图表色、玻璃材质、阴影与 Ant Design 主题映射的唯一运行时来源。
- `frontend/src/styles/global.css` 已拥有系统字体、圆角、动效和整体壳层，并通过 `--ps-*` 语义变量消费主题。
- 项目已使用 React、Ant Design、`@ant-design/icons` 和系统字体栈，不需要新增 Lucide、Phosphor、Tailwind、shadcn、Inter 或 Google Fonts。
- `PageHeader`、`MetricTile`、`TableRegion`、`StatusTag` 等共享组件已经存在，视觉规范应要求优先复用，但不得为视觉统一新增通用 `PageShell`、卡片工厂或页面配置系统。
- `ui-ux-pro-max` 的自动设计系统结果可能偏离现有原型；它只能补充 UX、可访问性和组件检查，不能覆盖 PartSignal 已确认的视觉方向。
- 当前代码与新规范之间可能仍有历史偏差；本任务只记录可执行约束，不顺带修复页面或宣称全站已经符合规范。

## Requirements

### R1：唯一规范与所有权

- 新增 `.trellis/spec/frontend/visual-system.md`，作为 PartSignal 前端视觉与交互实现的唯一人类可读规范。
- 更新 `.trellis/spec/frontend/index.md`，将新规范列入有效指南并说明适用范围。
- 文档必须明确以下所有权：
  - `.trellis/spec/frontend/visual-system.md` 定义设计与实现约束。
  - `frontend/src/app/theme.ts` 拥有运行时语义颜色、玻璃材质、状态色、图表色和阴影值。
  - `frontend/src/styles/global.css` 实现全局字体、尺度、动效、壳层和 Token 消费。
  - 业务页面只能消费上述契约，不得建立第二套 Token、主题或卡片体系。
- 不创建 `design-system/MASTER.md`、页面 override 文档或其他平行视觉规范。

### R2：规则表达

- 规范默认使用中文，采用“必须 / 应当 / 不得 / 仅当”的可验证表述，不保留“建议、可以考虑、尽量”等模糊措辞。
- 数值规则应明确适用组件和边界；语义颜色使用现有 Token 名称与角色，不在业务组件复制十六进制值。
- 规范必须区分全局硬约束、页面类型约束和允许的局部例外。
- 局部例外仅能服务于真实业务布局或数据表达，不得演变为页面级新视觉体系。

### R3：基础视觉系统

规范必须覆盖并约束：

- 颜色角色：画布、表面、玻璃表面、文字、边框、主交互、链接、选中、成功、警告、危险、中性与图表序列。
- 字体系统：现有系统字体栈、字号、行高、字重、数字等宽与正文可读性。
- 布局尺度：桌面基准、侧栏、顶栏、页面内边距、内容间距与详情面板宽度。
- 间距、圆角、阴影与玻璃边界：优先复用既有 Token；只有同一语义重复出现并经独立任务确认后才能增加 Token，不为单次局部值制造变量。
- 玻璃效果只能用于导航、顶栏、轻量指标、筛选、抽屉和浮层；表格、正文、Markdown 编辑器和复杂表单必须使用高不透明度表面保证可读性。

### R4：页面结构

规范必须定义三类主要页面：

- 数据列表工作台：页头、紧凑指标、筛选、高密度表格与可选详情面板。
- 编辑审核工作区：对象导航、主要编辑/正文区与审核、证据或版本区；不强制抽象成通用三栏组件。
- 分析洞察工作台：筛选、少量趋势指标、平台对比、问题矩阵与真实数据支持的建议。

总览、认证和设置等特殊页面应说明适用边界，不得套用不匹配的通用结构。

### R5：组件与交互规范

规范必须覆盖：

- 卡片、表格、表单与 Markdown 编辑器。
- 主按钮、次按钮、成功操作、危险操作与每页唯一主操作。
- 状态标签、空态、加载、错误与操作反馈。
- 图表类型、颜色顺序、图例、坐标、网格线与禁止的装饰性数据表达。
- 图标来源、尺寸、线性风格和 tooltip 要求。
- 动效时长、缓动、允许属性及 `prefers-reduced-motion`。

### R6：主题、可访问性与反模式

- 浅色和深色模式必须使用同一组语义 Token；深色模式不得变成黑紫霓虹主题。
- 正文、图标、边框、焦点、状态和数据图形必须满足明确的对比度与非颜色单一表达要求。
- 所有操作必须支持键盘、可见焦点、语义标签和合理焦点顺序；页面缩放与窄屏下不得丢失关键操作。
- 规范必须列出禁止的风格偏差，包括营销官网、聊天机器人、赛博朋克、廉价 AI 渐变、全容器高透明玻璃、巨大 KPI、过度圆角、沉重阴影、3D 图表、虚构数据与未支持功能。

### R7：现有实现骨架

- 明确继续使用 Ant Design、`@ant-design/icons`、现有系统字体栈与共享组件。
- 不新增 Lucide、Phosphor、Tailwind、shadcn、Web Font 或第二套组件库。
- 不因原型总结中的示例色值直接替换当前主题色；只有原型实测与可访问性证据确认不一致时，才能在独立任务中调整 `theme.ts`。
- 只对真实重复的圆角、阴影和间距建立 Token，不引入通用 `PageShell`、卡片工厂、页面配置系统或其他推测性抽象。

## Acceptance Criteria

- [x] **AC1**：`.trellis/spec/frontend/visual-system.md` 存在，并以可执行措辞完整覆盖颜色、字体、布局、间距、圆角、阴影、玻璃、页面结构、组件、主题、可访问性和反模式。
- [x] **AC2**：`.trellis/spec/frontend/index.md` 链接并说明新规范，索引不再保留“待填写”状态作为视觉规范入口。
- [x] **AC3**：规范明确 `.trellis/spec/frontend/visual-system.md`、`theme.ts`、`global.css` 和业务页面的所有权顺序，禁止页面级新配色、字体、Token、主题与卡片体系。
- [x] **AC4**：规范明确保留 Ant Design、`@ant-design/icons`、系统字体和现有共享组件，不要求新增依赖、Web Font、通用页面壳或卡片工厂。
- [x] **AC5**：规范定义数据列表、编辑审核和分析洞察三类页面结构，并说明总览、认证和设置等特殊页面不得被错误套型。
- [x] **AC6**：规范明确浅色、深色、键盘、焦点、对比度、非颜色单一表达、窄屏、200% 缩放和 reduced-motion 的验收边界。
- [x] **AC7**：本任务实际变更只包含任务规划文件、`.trellis/spec/frontend/visual-system.md` 与 `.trellis/spec/frontend/index.md`；未修改共享工作区中已有的 `frontend/`、契约、部署或其他文件，也未创建 `design-system/MASTER.md`。
- [x] **AC8**：差异检查未发现模糊建议、重复视觉权威、推测性抽象、隐藏兼容规则或与当前实现骨架冲突的要求。

## Out of Scope

- 修改 `frontend/src/app/theme.ts`、`frontend/src/styles/global.css` 或任何 React、TypeScript、CSS、测试和依赖文件。
- 调整当前品牌色、暗色主题值、字体、圆角、阴影、布局或页面视觉。
- 审计或修复各业务页面与新规范的现有偏差。
- 新建组件、页面壳、设计 Token、图标库、字体资源、截图基线或视觉回归框架。
- 运行 `ui-ux-pro-max --persist`，创建 `design-system/MASTER.md` 或页面 override 目录。
- 修改 API、数据库、权限、路由、业务字段、状态转换或产品功能。
