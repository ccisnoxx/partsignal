# Research: AI 渠道原型高保真源码审计

- Query: 以用户提供的唯一视觉原型和当前验收图为依据，审计字体、外壳、三栏、表格、详情面板、上一轮视觉样式、最小返工范围及 Browser computed-style 量测项。
- Scope: internal
- Date: 2026-07-22

## Findings

### 1. 基准与结论

- 唯一原型文件 `/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T/codex-clipboard-f226320a-d2c1-45e2-8d54-cbb453738e3f.png` 实际是 **1570×1001、带 sRGB ICC profile**；当前验收图 `artifacts/ai-channels-1572x999.png` 实际是 **1572×999、无嵌入 profile**。两张图不能直接做逐像素差分，Browser 量测前必须先决定以原型原始尺寸为准，或以同一规则裁切/缩放到共同尺寸。
- 当前外壳与主要结构尺寸已接近原型：配置侧栏 220px 加 8px 外壳边距得到约 228px 边界（`frontend/src/app/AppLayout.tsx:139-145`、`frontend/src/styles/global.css:711-715`）；顶栏 64px（`frontend/src/styles/global.css:724-729`）；内容区左上内距 10px/12px（`frontend/src/styles/global.css:729`）；主卡头 72px、三栏 `188px / 1fr / 368px`、工具栏 70px、表头 52px、数据行 92px、分页 54px（`frontend/src/styles/global.css:730-759`、`:789`）。这组尺寸也与实施返工记录一致（`.trellis/tasks/07-22-ai-channel-model-management/implement.md:151-155`）。
- 主要失真不是“没有三栏”，而是字号/字重/行高、控件内距、Tabs 高度及多层渐变/阴影的视觉语言。最小返工应保留 React 结构、路由、真实数据和上述主体几何，只重写配置中心专属 CSS 段的排印与涂装。

### 2. 当前字体栈、实际可能字体与失真原因

#### 声明与加载链

- 根字体和 `--ps-font-sans` 都声明为 `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif`；同时设置 `font-synthesis: none`（`frontend/src/styles/global.css:2-6`）。
- Ant Design Token 重复声明同一字体栈，代码字体为 `ui-monospace, "SFMono-Regular", "Cascadia Mono", Menlo, Consolas, monospace`（`frontend/src/app/theme.ts:139-174`）。`ThemeProvider` 把该 Token 注入全部 Ant 组件（`frontend/src/app/ThemeProvider.tsx:102-108`）。
- 入口只加载 `global.css`，`index.html` 没有 `<link>` 字体资源，仓库前端也没有 `@font-face`（`frontend/src/main.tsx:1-5`、`frontend/index.html:3-35`）。`frontend/package.json:19-29` 也没有字体依赖。
- 因为 `-apple-system` 排第一，macOS Chromium 中拉丁、数字和常用标点通常会落到系统 SF 字体；中文需由系统 CJK 字体覆盖，当前机器明确安装 PingFang SC，因此中文很可能落到苹方。`'SF Pro Text'` 写在系统别名之后，并不能锁定它；Windows/Linux 则会走完全不同的后备链。CSS 只能证明声明栈，不能证明某个具体字形的实际字体。
- 当前机器没有可直接匹配的 Inter 或 Microsoft YaHei；系统存在 SFNS、PingFang SC、Hiragino Sans GB。Fontconfig 对 macOS 的 `-apple-system`/`BlinkMacSystemFont` 私有别名解析不可靠，实际字形必须由 Chrome 的 Rendered Fonts/CDP 结果确认。

#### 主要失真来源

1. **原型字体无法从扁平 PNG 确证。** 视觉上原型是较轻、较开阔的现代无衬线，但仅凭像素不能断言是 Inter、SF Pro 或其他字体。当前代码也没有任何能够复现某个指定原型字体的字体资产或加载入口。
2. **字号缩得过小，比字体家族差异更显著。** 列表主体为 11px，表头 10px，副文案/URL 9px，测试时间 8px（`frontend/src/styles/global.css:755-783`）；详情标题 14px、副文案/状态 9px、Tabs 10px、描述内容 10px、详情 URL 9px（`frontend/src/styles/global.css:795-815`）；详情子表 9px、统计标题 9px（`frontend/src/styles/global.css:825-830`）。原型在同一物理尺寸下的主体、表头和详情文字明显更舒展。
3. **同屏混用 sans 与 mono 放大了字形割裂。** 数量使用 mono（`frontend/src/styles/global.css:745`），URL 和协议字段使用 mono（`frontend/src/styles/global.css:779`、`:815`，以及 `frontend/src/styles/global.css:81` 的 `.data-code` 全局规则）；原型的数字和地址视觉更统一。协议值保留 mono 有语义依据，但分类数量、普通 URL 是否必须 mono 应由原型量测后决定。
4. **字重与控件截断互相放大。** 标题/分类大量使用 600/700（`frontend/src/styles/global.css:718`、`:740-745`、`:766`），而右侧三个筛选器固定为 90/90/98px（`frontend/src/styles/global.css:747-750`）；当前图已经出现“全部...”截断，原型同位置完整显示。应先量测 `.ant-select-selection-item` 的实际 font/padding/line-height，再决定减少内距还是调整列宽，不能盲目换字体。
5. **截图栅格条件不同。** 原型有 sRGB profile、当前图没有；若 Browser 的缩放、DPR、字体平滑和截图 profile 不统一，即使 CSS 相同也会产生字重和颜色差异。

### 3. 外壳、三栏、表格、详情面板的组件与 CSS 归属

| 范围 | 结构/行为所有者 | CSS/Token 所有者 |
| --- | --- | --- |
| 应用外壳与配置模式 | `AppLayout` 根据路由设置 `.app-shell-configuration`，配置侧栏宽 220px，渲染品牌、导航、顶栏搜索、主题和用户区（`frontend/src/app/AppLayout.tsx:105-145`、`:151-199`） | 通用外壳 `frontend/src/styles/global.css:25-49`；配置专属外壳 `:711-729`；颜色 Token `frontend/src/app/theme.ts:83-114`、Ant 组件 Token `:139-201` |
| 路由/权限 | `/configuration/ai` 挂载集合工作区，`:channelId` 作为嵌套详情 Outlet（`frontend/src/app/App.tsx:61-70`）；管理员边界由 `ConfigurationLayout` 持有（`frontend/src/features/configuration/ConfigurationLayout.tsx:1-8`） | 无专属视觉职责 |
| 页面头与三栏 | `AIChannelsPage` 渲染页面头、状态分类、中间列表、右侧详情 Outlet（`frontend/src/features/configuration/AIChannelsPage.tsx:315-415`） | 页面玻璃卡和头 `frontend/src/styles/global.css:730-736`；三栏网格和各栏 `:737-746` |
| 列表工具栏 | 搜索和三个 Select 由 `AIChannelsPage` 持有，全部写回 URL（`frontend/src/features/configuration/AIChannelsPage.tsx:344-378`） | `frontend/src/styles/global.css:747-752` |
| 渠道表格 | 列定义、列宽、真实状态和行操作在 `frontend/src/features/configuration/AIChannelsPage.tsx:267-311`；Table/选中行/局部横滚在 `:380-393`；分页在 `:396-410` | 表格容器和行样式 `frontend/src/styles/global.css:753-790`；共享可聚焦横滚边界 `frontend/src/shared/components/TableRegion.tsx:1-6` 及 `frontend/src/styles/global.css:630-633`；Ant Table 基础 Token `frontend/src/app/theme.ts:188-192` |
| 品牌标记 | `AIProviderMark` 的受控品牌图标映射在 `frontend/src/features/configuration/AIChannelFormModal.tsx:24-49`，列表和详情共同复用 | `frontend/src/styles/global.css:768-774` |
| 详情面板 | 右栏 Outlet 容器在 `frontend/src/features/configuration/AIChannelsPage.tsx:412-414`；详情头、Tabs、滚动内容和所有真实管理能力在 `frontend/src/features/configuration/AIChannelDetailPage.tsx:366-511` | 详情栏底色、头、Tabs、滚动区、基础信息卡、快捷操作、子表和统计 `frontend/src/styles/global.css:791-830` |
| 响应式降级 | React 结构不分叉 | 1199px 以下转纵向 `frontend/src/styles/global.css:868-881`；767px 以下头、工具栏和表单降级 `:924-935` |

现有 `PageHeader` 并未用于这张 AI 页面；AI 页使用自己在 `AIChannelsPage.tsx:318-328` 的紧凑头部。设计文档中“页面用现有 PageHeader”的陈述（`.trellis/tasks/07-22-ai-channel-model-management/design.md:240`）与当前实现不一致，但为视觉返工把它换回 `PageHeader` 会扩大范围并破坏已对齐的 72px 页头，不建议在本轮处理。

### 4. 可删除或原位覆盖的上一轮“审美改造”样式

配置中心视觉集中在 `frontend/src/styles/global.css:710-838`，可以在这一原有归属内原位改写，不要在文件末尾继续堆同权重覆盖。

#### 可删除/简化的涂装声明

- `.app-shell-configuration` 的三层 radial-gradient 与带色 canvas 混合（`:711`）。原型确有很弱的冷色环境光，但当前实现的蓝/紫/粉分区过于显式；保留 `height/overflow/padding`，简化背景层数和不透明度。
- 配置侧栏的两层 radial-gradient + linear-gradient（`:713`）、Logo drop-shadow（`:716`）、选中菜单渐变（`:722`）、顶栏渐变和阴影（`:724`）、搜索框 inset 高光（`:727`）。保留尺寸、边界和透明材质，削弱装饰层。
- 主卡的双色渐变、双阴影和强 `blur(24px) saturate(145%)`（`:730`），主按钮蓝紫渐变/发光（`:736`），状态栏渐变（`:739`），列表半透明底（`:746`），右详情三段渐变（`:791`）。这些共同造成当前图“硬边 + 彩色分栏”，可改为更接近原型的单一冷白/轻玻璃表面。
- 选中行双色渐变（`:761`）和基础信息/快捷操作卡的双阴影（`:810`、`:816`）。保留选中语义和卡片层级，但改为单色轻填充、细边框和更弱阴影。

#### 应覆盖调整、不能删除的排印/几何声明

- 工具栏控件字体、内距和固定列宽（`:747-752`）；先保证三个筛选标签不截断。
- 表格字号/表头/行高（`:755-759`）及名称、状态、URL、测试文本（`:763-783`）。主体几何 52/92 已接近原型，优先增大字号和行高，不先改行高。
- 详情头、Tabs 和正文（`:795-830`）。原型 Tabs 视觉高度比当前 52px 更紧，且当前 9–10px 文本过小；应由 Browser 实测后一起标定。

#### 必须保留

- `.app-shell-configuration` 的 8px 外边距、侧栏 220px 所形成的外壳坐标，以及主卡 `188px / 1fr / 368px` 三栏（`:711-715`、`:724-737`）。
- `min-width/min-height/overflow`、表格局部横滚、固定操作列、选中/hover/focus 语义（`:738`、`:753-762`、`:789-806`）。
- 无 backdrop-filter 回退（`:856-859`）与响应式规则（`:868-881`、`:924-935`）。
- 真实字段、权限、URL 状态、详情 Tabs 和危险操作确认；前端规范明确交互密度变化不得丢字段或入口（`.trellis/spec/frontend/quality-guidelines.md:35-38`），表格横滚和焦点规则也必须保留（`.trellis/spec/frontend/component-guidelines.md:35-41`、`:62-76`）。

### 5. 不新增依赖的最小高保真改动范围

1. **首选只改一个产品文件：** `frontend/src/styles/global.css` 的配置中心专属段 `:710-838`，原位调整排印、控件内距、Tabs、背景、边框和阴影。现有 TSX 已有原型需要的外壳、三栏、表格、详情和操作，不需要新增组件或依赖。
2. **不改 `theme.ts` 的全局 Token 值。** 这会影响全站；配置页目前已能通过既有语义变量和 `color-mix()` 达到所需冷白/蓝紫关系。规范也要求业务样式只消费主题语义变量（`.trellis/spec/frontend/component-guidelines.md:58-64`）。
3. **不先引入字体。** 原型 PNG 无法证明字体名称；当前系统栈能稳定覆盖 macOS 的 SF/PingFang。先通过字号、字重、行高和内距标定解决主要差异。只有用户提供原型字体名称及可分发的本地 WOFF2/许可后，才应讨论 `@font-face`；这不是当前最小方案。
4. **不为原型补假控件。** 原型右上角的应用网格、通知、帮助等在当前产品契约中不存在；当前真实顶栏只有搜索、主题与用户菜单（`frontend/src/app/AppLayout.tsx:152-193`）。视觉返工不能增加无业务行为的按钮。
5. **不删真实新增字段。** 当前详情比原型多协议类型、供应商品牌和“仅手动重试”等已批准事实（`frontend/src/features/configuration/AIChannelDetailPage.tsx:370-384`）；它们由 PRD 要求，不能为了截图删掉。
6. **截图状态先归一。** 清空 `q`，保持浅色、100% 浏览器缩放、相同 DPR，使用真实但稳定的数据；当前截图搜索框中的具体查询文本和本地 `127.0.0.1` 地址属于验收状态差异，不应通过静态数据或 UI 假值修饰。

### 6. 主线程 Browser computed-style 量测清单

每个节点同时记录 `getBoundingClientRect()` 与以下 computed style：`fontFamily`、`fontSize`、`fontWeight`、`lineHeight`、`letterSpacing`、`color`、`backgroundColor`、`backgroundImage`、`border*`、`borderRadius`、`boxShadow`、`backdropFilter`、`padding*`、`margin*`、`height/width/minHeight/minWidth`、`overflow*`。先记录 `window.innerWidth/innerHeight`、`devicePixelRatio`、`visualViewport.scale` 和 `document.documentElement.dataset.theme`。

#### 字体与根环境

- `html`、`body`、`.ant-app`：字体声明及根字号/行高；运行 `document.fonts.status` 和 `document.fonts.check('12px "PingFang SC"')`。
- `.brand-mark strong`、`.header-context .ant-typography`、`.global-navigation-search input`、`.app-sider .ant-menu-title-content`。
- Chrome 若可走 CDP，对上述节点调用 `CSS.getPlatformFontsForNode`；普通 `getComputedStyle().fontFamily` 只返回声明栈，不等于实际渲染字体。

#### 外壳与坐标

- `.app-shell-configuration`、`.app-sider`、`.app-header`、`.app-content`、`.ai-config-page`、`.ai-config-page-header`、`.ai-workspace`。
- 三个直接子栏 `.ai-status-rail`、`.ai-channel-list-pane`、`.ai-detail-pane` 的 rect，核对列宽、边界和总和。
- 配置侧栏普通项、子菜单项、选中项各一项：rect、font、padding、margin、背景和圆角。

#### 工具栏

- `.ai-list-toolbar`、`.ai-list-toolbar .ant-input-search`、搜索框内部 `input`。
- 三个 `.ai-list-toolbar .ant-select`、各自 `.ant-select-selector`、`.ant-select-selection-item`、`.ant-select-arrow`：特别记录可用内容宽、左右 padding、`textOverflow`，定位“全部...”截断的真实原因。

#### 表格

- `.ai-list-table-wrap`、`.table-region`、`.ai-channel-table .ant-table-container`。
- 第一列表头、普通数字表头、固定操作列表头；第一条普通行、选中行、固定操作单元格。
- `.ai-channel-name-cell strong/small`、`.ai-enabled-state`、`.ai-url-cell`、`.ai-configured`、`.ai-test-status` 及其 `small`。
- 分别在默认、hover、focus-within、selected 状态记录背景和边界，确保视觉调整不清除交互反馈。

#### 详情

- `.ai-detail-header`、头部 `.ai-provider-mark`、`h5`、副文案、`.ai-enabled-pill`。
- `.ai-detail-tabs .ant-tabs-nav`、单个 `.ant-tabs-tab`、`.ant-tabs-ink-bar`、`.ai-detail-scroll`。
- `.ai-basic-card`、`.ai-section-heading`、`.ai-basic-descriptions` 的 label/content、`.data-code`、`.ai-detail-url`。
- `.ai-quick-actions` 与四个按钮；记录按钮内容宽，避免字体放大后溢出。

#### 建议验收顺序

1. 先核对 viewport/DPR/缩放和外壳 rect；
2. 再核对字体实际落点与字号/行高；
3. 再处理工具栏截断和表格/详情排印；
4. 最后比较背景、边框、阴影、hover/selected/focus；
5. 用相同截图尺寸重拍后再并排比较，不能拿 1570×1001 与 1572×999 直接判断 1–2px 偏差。

### 7. Files found

- `frontend/src/app/AppLayout.tsx`：配置模式外壳、导航、顶栏搜索、主题和用户区。
- `frontend/src/app/App.tsx`：配置工作区与详情 Outlet 的真实路由组合。
- `frontend/src/features/configuration/AIChannelsPage.tsx`：页面头、状态栏、工具栏、渠道表格、分页和右栏 Outlet。
- `frontend/src/features/configuration/AIChannelDetailPage.tsx`：详情头、Tabs、基础信息、请求、模型、统计、日志和快捷操作。
- `frontend/src/features/configuration/AIChannelFormModal.tsx`：共享品牌标记与渠道表单。
- `frontend/src/styles/global.css`：全部配置中心专属布局与视觉规则集中在 710–838 行。
- `frontend/src/app/theme.ts`、`frontend/src/app/ThemeProvider.tsx`：语义颜色、Ant Token 和运行时主题注入。
- `frontend/src/main.tsx`、`frontend/index.html`：样式入口；没有字体资源加载。
- `frontend/src/shared/components/TableRegion.tsx`：表格可聚焦局部横滚边界。
- `.trellis/tasks/07-22-ai-channel-model-management/artifacts/ai-channels-1572x999.png`：当前验收图。
- `/var/folders/m5/j06tv2sn1hn93d6f33j559jm0000gn/T/codex-clipboard-f226320a-d2c1-45e2-8d54-cbb453738e3f.png`：唯一视觉原型。

### 8. External references / versions

- 未使用外部网页资料；本题结论来自本地源码、任务文档、系统字体清单和两张 PNG。
- 当前前端版本：Ant Design `^6.2.0`、React `^19.2.0`、Vite `^7.3.1`（`frontend/package.json:19-29`、`:31-50`）。

### 9. Related specs

- `.trellis/spec/frontend/component-guidelines.md:19-20`：沿用 React/Ant，不建立第二套基础组件。
- `.trellis/spec/frontend/component-guidelines.md:35-41`：表格必须位于 `TableRegion`，列宽按内容职责分配。
- `.trellis/spec/frontend/component-guidelines.md:62-76`：只消费语义变量，保留焦点和 Ant 交互语义。
- `.trellis/spec/frontend/quality-guidelines.md:35-47`：密度变化不得丢字段/入口，浏览器需覆盖主题和响应式。
- `.trellis/spec/frontend/state-management.md:19-30`、`:56-58`：集合视图和 Tabs 继续由 URL 持有，不能为视觉返工复制状态。
- `.trellis/tasks/07-22-ai-channel-model-management/prd.md:87-91`、`:98-110`：高保真与真实功能验收边界。
- `.trellis/tasks/07-22-ai-channel-model-management/design.md:248-254`：视觉只消费现有语义变量和 Ant Token。

## Caveats / Not Found

- 研究角色按 Trellis 隔离要求不得读取 `implement.jsonl` 或 `check.jsonl`；本次已读取 `task.json`、`prd.md`、`design.md`、`implement.md`、相关 spec 和目标源码。
- 扁平 PNG 不包含可验证的字体名称；没有设计源文件、CSS、Figma 量测或字体资产，因此“原型字体”只能标为未知，不能把视觉猜测写成实现事实。
- `design.md:190-199` 仍写三栏 `168px / minmax(560px, 1fr) / 360px`，但原型像素、当前 CSS `188px / 1fr / 368px` 和实施返工记录一致。视觉返工不应按这条旧数字回退；主线程如需维护文档，应另行更新权威设计。
- 本研究未启动应用、未读取 Browser computed style，也未修改产品代码。上述实际字体落点、Ant 内部 padding、Tabs 精确高度和 hover/focus 状态必须由主线程在真实 Browser 会话中确认。
