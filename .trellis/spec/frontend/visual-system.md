# PartSignal 前端视觉系统

> 本文是 canonical `frontend/` 的人类可读视觉与交互规范。新页面、页面改造和 UI/UX 审计在实施前必须完整读取本文。

## 1. 适用范围与权威来源

本规范适用于登录后工作台、认证、设置、数据列表、编辑审核、分析洞察及共享组件。它约束视觉角色、页面构图、组件选择、交互反馈、响应式和可访问性，不改变 API、数据口径、权限或业务状态。

权威顺序如下：

1. 本文定义设计意图、组件边界和验收规则。
2. `frontend/src/styles/global.css` 是运行时颜色、表面、文字、边界、状态、交互、字体、圆角、焦点与基础表格样式的唯一值来源，并通过 Tailwind `@theme inline` 暴露语义角色。
3. `frontend/src/design-system/primitives/` 持有 shadcn/ui 结构与 Base UI primitives；data-table、forms、editor、workspace 子目录持有多消费者组合 pattern。
4. `frontend/src/app/layout/app-shell.tsx` 持有唯一应用壳层、导航、顶栏、主内容和 pathname 焦点恢复。
5. Domain 页面只能消费上述契约；局部 Tailwind class 不得成为第二套配色、字体、Token、状态、焦点或卡片体系。

旧 V1 的 Ant Design、`theme.ts`、`workspace.css`、theme-init、视觉快照和批准截图是历史证据，不是 canonical 实现或当前自动基线。不得为复用历史资产恢复 V1 runtime、Ant Design、第二套 CSS 或视觉测试流水线。

## 2. 核心视觉方向

PartSignal 是高密度、克制、可扫描的企业运营工作台：

- 界面以内容、数据和操作效率为中心，保持浅色、精细、稳定和专业。
- 信息层级由间距、分栏、文字层级、细边框和轻阴影建立，不依赖大面积高饱和色块。
- `interaction-primary` 承担主要交互；success、warning、danger、info 只表达对应语义。
- 登录后的业务页面不得使用官网式 Hero、聊天窗口结构、霓虹科技风或展示型数据大屏结构。
- 所有页面只显示真实数据、真实状态和现有功能；未知产品事实、虚构指标和未获合同支持的操作必须失败或不渲染，不得猜测、补零或伪造成功。

## 3. Token 与样式所有权

### 3.1 语义角色

业务代码优先使用 Tailwind 语义 class，必要的共享 CSS 只消费 `global.css` 中的变量：

| 类别 | 变量 / Tailwind 角色 |
| --- | --- |
| 表面 | `surface-app`、`surface-panel`、`surface-raised`、`surface-overlay`、`surface-selected` |
| 文字 | `text-primary`、`text-secondary`、`text-muted`、`text-disabled`、`text-danger` |
| 边界 | `border-subtle`、`border-default`、`border-strong`、`border-focus` |
| 状态 | `success`、`warning`、`danger`、`info` |
| 交互 | `interaction-primary`、hover、active、foreground |
| 圆角与焦点 | `radius-control`、`radius-panel`、`radius-overlay`、`focus-ring-*` |
| 字体与字号 | `font-family-*`、`type-display/page-title/section-title/body/body-sm/label/mono` |

- Domain TSX/CSS 不得写入原始 hex/RGB/OKLCH 颜色或独立浅深色值。
- 只有相同语义在多个真实消费者中重复出现且现有角色无法表达时，才能在 `global.css` 的 owner 增加 Token；不得为单一页面创建变量。
- 当前 canonical 前端明确为 light-only，`color-scheme: light` 是现行合同；不得声称已经实现深色或 system theme，也不得为目录切换顺带新增主题系统。
- 系统字体和 mono 字体由 `global.css` 持有，不加载 Web Font。

### 3.2 CSS 与 Tailwind 边界

- `src/main.tsx` 只导入 `src/styles/global.css`；不得再创建全局 workspace/theme 样式入口。
- 通用可复用样式和语义 Token 放在 `global.css`；Domain 布局优先使用 Tailwind class，只有复杂打印、图表或重复 selector 才增加有明确 owner 的 CSS。
- `components.json` 的 aliases 固定指向 `@/design-system`、`@/design-system/primitives` 与 `@/shared/lib`；不得让 registry 生成第二套 UI 根目录。
- `prefers-reduced-motion: reduce` 必须继续关闭非必要动画、平滑滚动和长过渡。

## 4. 应用壳层与页面结构

### 4.1 AppShell

- `AppShell` 是唯一应用导航和主内容 owner：桌面侧栏 13rem，顶栏 4rem，主内容最大宽度 95rem，内容 padding 按 12/16/20px 响应式变化。
- 移动导航使用 Base UI `Sheet`；业务页面不得创建第二个全局导航。
- pathname 变化时由 `AppShell` 将焦点移到 `#main-content`；search 参数变化不得抢焦点。
- 跳到主内容链接、面包屑、导航 `aria-current` 和账号菜单必须保留原生语义。

### 4.2 数据列表

1. 页面标题、说明和唯一主操作位于内容顶部。
2. 只有服务端提供真实聚合口径时才显示紧凑指标；无真实指标直接省略。
3. 筛选、排序和分页等可恢复状态写入 URL。
4. 数据表使用 `TableShell` 的命名、可聚焦局部滚动 region；不得制造页面级横向滚动。
5. 行最多直出一个 Primary，其余动作使用 `RowActions`；详情 Sheet 只在存在真实选中对象时渲染。

### 4.3 编辑审核 Workspace

- 对象/章节导航、主工作区和辅助证据按真实任务组合；不得为视觉统一强制所有页面使用同一三栏结构。
- 主 artifact 必须始终可用；窄屏侧栏转换为 Tabs/Sheet，Sticky Action Bar 不遮挡正文。
- 保存状态区分未修改、未保存、保存中、已保存和失败；审核决策保留确认、意见、revision 和服务端校验。
- 不可变快照使用 readonly Detail，不提供原地编辑入口。

### 4.4 分析与打印

- 图表、矩阵和结论必须能追溯到 API 数据、时间范围和统计口径；数据不足明确显示真实状态，不外推或补零。
- 图表提供图例、数值和等价表格/文本读取，不只靠颜色区分序列。
- Print route 复用 `AppShell` 的 print layout 以及专用、可验证的打印 class，不把打印覆盖扩散到普通页面。

## 5. 组件与交互

### 5.1 primitives 与 pattern

- Button、Dialog、DropdownMenu、Sheet、Tabs、Tooltip、Input、Select 等交互使用 `design-system/primitives`，不得直接在 Domain 复制 Base UI 组合。
- `Dialog`/`Sheet` 必须保留焦点圈定、Escape 关闭和 `finalFocus` 恢复；不要通过变化中的 React `key` 在关闭前替换 Root。
- Icon 使用既有 `lucide-react`；图标按钮必须有可访问名称，语义不明确时提供 Tooltip。不得新增第二套图标库或 Emoji 业务图标。
- 同一平面不得层层嵌套 Card；优先使用标题、边界和间距表达层级。

### 5.2 表格与操作

- `.ps-table-region` 持有宽表局部滚动、可见焦点、边界和表格表面；`.ps-table` 持有表头、行高与 hover/focus-within。
- 状态、数量、时间和操作使用紧凑列；名称、标题保留可收缩弹性列。长文本容器必须 `min-width: 0` 并提供读取完整值的 Tooltip 或详情入口。
- 不把整行变成第二个交互入口，不给 `tr` 添加 `tabIndex`；行焦点使用 `:focus-within`。
- 危险操作必须先显示影响与确认，不得从 overflow 单击后立即执行。

### 5.3 表单与 Markdown

- 表单使用 React Hook Form、Zod、Form Kit 和服务端校验合同；错误与字段建立 `aria-describedby`/`aria-invalid` 关系，未知错误保留在 summary。
- Markdown 是内容唯一可编辑正文源；不得保存可独立编辑的 HTML 或 editor JSON。
- Markdown Preview 固定使用 `react-markdown`、`rehype-sanitize`、`skipHtml` 和已登记的元素边界；不得使用 `dangerouslySetInnerHTML`、DOM HTML sink 或运行时固定成功 fallback。
- CodeMirror 的受控值由 React state/props 拥有；测试不得把增量内部 DOM 当 canonical Markdown。

### 5.4 状态与反馈

- 服务端 `workflow_stage`、`primary_task`、`available_actions` 和错误合同是业务权威；视觉状态不得重新推导资格。
- 成功、警告、危险不能只靠颜色表达，必须同时使用文字、图标、边界或位置。
- 加载、空态和错误复用现有 patterns；可恢复失败提供真实重试，不遮蔽页面身份、返回入口或兄弟区块。

## 6. 响应式与可访问性

- 代表宽度为 375、768、1024、1440px；关键页面还需验证实际 200% 缩放。
- 320/375px 下不得出现页面级横向滚动、文字遮挡、焦点不可见或关键操作丢失；宽表只能在 `TableShell` 内滚动。
- 所有操作可由键盘完成，焦点顺序符合阅读顺序；必要操作不得仅在 hover 时可见。
- 普通文字对比度至少 4.5:1，大号文字和必要非文字界面元素至少 3:1。
- 移动端关键目标至少 44×44 CSS px；桌面紧凑控件不得牺牲键盘可达性。
- 响应式或媒体状态切换后，浏览器测试必须重新查询已连接节点，不用 sleep、旧 element handle 或重试掩盖重挂载。

## 7. 禁止模式

- 恢复 V1、Ant Design、theme-init、旧视觉快照流水线或第二个前端样式根。
- 页面硬编码颜色、字体、Token、状态色或独立主题。
- 营销 Hero、聊天机器人、霓虹科技风、3D/发光图表、巨大 KPI、无法解释的综合评分。
- 虚构数据、补零、未知事实猜测、未支持功能或固定成功路径。
- 万能 DataTable/PageShell、卡片工厂、页面配置系统或只转发字段的视觉 wrapper。

## 8. 验收清单

- [ ] 复用 `global.css` 语义 Token、AppShell、primitives 与适用 pattern，未建立第二来源。
- [ ] 页面只显示真实字段、状态、指标和现有功能，未改变业务合同。
- [ ] 表格、表单、Markdown、按钮、状态、图表和动效符合对应边界。
- [ ] 375/768/1024/1440 与 200% 缩放无非预期页面横向滚动。
- [ ] 键盘、焦点恢复、reduced-motion 和对比度满足本文边界。
- [ ] 未创建第二份视觉规范、主题、组件库、图标库或自动视觉基线。
