# 技术设计

## 1. 设计结论

本任务在现有 React、Ant Design 与 macOS 双主题体系内补齐交互状态，不建立新的组件系统。最小实现继续以现有页面和共享边界为主：表格使用 Ant Design `sticky`、`Dropdown`、`TableRegion`，长表单复用 Ant Form 和现有章节导航，异步状态扩展 `AsyncState`，成功反馈使用 ThemeProvider 已提供的 Ant Design `App` message，主题只消费现有语义 token。

本任务不拆父子任务。P0、P1、P2 共同修改表格、表单状态、全局样式和同一组浏览器验收矩阵；拆分会重复触及相同文件并产生无法独立验收的中间状态。实施顺序严格按 P0 → P1 → P2，P2 不得阻塞 P0/P1 交付。

## 2. 已验证现状与根因

- `ProductsPage` 的搜索与分页不是 URL 状态，行内同时出现维护与红色删除，见 `frontend/src/features/product-facts/ProductsPage.tsx:19-40`。
- `AIChannelsPage` 已是高密度 Table，但操作列同时展示详情、启停和删除，见 `frontend/src/features/configuration/AIChannelsPage.tsx:97-105`。
- `ProductFactsPage` 已具备 `scrollToFirstError`、原生章节链接和 sticky 保存条，说明无需新的表单框架；缺口是状态表达，见 `frontend/src/features/product-facts/ProductFactsPage.tsx:116-125`。
- `ContentEditorPage` 与内容任务、AI 渠道详情已经复用 `.form-section-nav`，但 CSS 只有普通与 hover 状态，没有当前项，见 `frontend/src/styles/global.css:95-103`。
- `AsyncState` 已拥有错误、加载、无权和空态的共享职责，见 `frontend/src/shared/components/AsyncState.tsx:1-20`。扩展现有组件比新增状态页面体系更小。
- `ContentTasksPage` 把 `options` 等次级查询并入整页失败门禁，导致独立配置错误遮蔽已加载的任务详情，见 `frontend/src/features/content-tasks/ContentTasksPage.tsx:56-70`。
- `AppLayout` 已通过 `useLocation()` 驱动导航状态，主内容边界在 `Layout.Content`，可在同一位置完成路由焦点管理，见 `frontend/src/app/AppLayout.tsx:60-70,146-150`。
- ThemeProvider 已包含 Ant Design `App`，页面可通过 `App.useApp()` 使用主题一致的 message，无需新增 Provider，见 `frontend/src/app/ThemeProvider.tsx:103-108`。
- 工作台已有 `tone` 能力和真实字段，P2 只需调整 tone 映射，见 `frontend/src/features/dashboard/DashboardPage.tsx:34-45`。

## 3. 总体边界与数据流

### 3.1 集合视图状态

```text
URLSearchParams（唯一可恢复视图状态）
        ↓ 解析与默认值校验
现有搜索 / Tab / Table pagination props
        ↓
现有 query options 与页面渲染
```

- 使用各页面现有 React Router，不创建全局筛选 Store 或 URL 状态 Hook。
- 产品页使用 `q`、`page`；任务和 GEO 观测使用 `page`；人工发布使用 `tab` 与每个列表当前页；用户页使用 `inactive` 与 `page`。
- 查询参数只表达视图，不保存表单草稿、权限或业务状态。
- 无效页码、Tab 和布尔值回到既有默认值，并用替换导航修正，避免历史栈污染。

### 3.2 长表单状态

```text
Ant Form values / validation
        ├── onValuesChange → dirty sections → 章节导航 / 保存条
        ├── onFinishFailed → error sections → 错误摘要 / 首错定位
        └── onFinish → 现有 mutation → 成功后清理 dirty / 显示成功反馈
```

- 状态仅存在于当前编辑页，不进入 Context、Query Cache 或 localStorage。
- 不复制服务端修订状态；`expected_revision` 仍来自现有 draft，服务端仍是并发校验权威。
- 不增加自动保存、定时器或离开拦截。

### 3.3 异步状态

```text
页面身份查询失败 ──→ 页面上下文 + 全页 QueryFailure + 返回/恢复
次级区块查询失败 ──→ 所属 Card 内 QueryFailure，其他成功区块继续可用
mutation 失败      ──→ 原字段/区块附近 Alert
mutation 成功      ──→ 现有刷新/关闭行为 + 必要的短 message
```

- 不吞掉错误，不提供假数据或兼容默认值。
- `ApiError.code` 与 `requestId` 继续直接显示；是否提供重试由调用页面决定。

## 4. P0 设计

### 4.1 表格操作与扫读

目标页面优先覆盖产品、内容任务、人工发布、GEO 观测、用户、AI 渠道、平台类型、平台账号和事实版本列表。

- 保持详情、维护、审核或编辑为可见主入口；不增加整行点击。
- 删除、停用等低频操作使用现有 Ant Design `Dropdown`/Menu，触发器使用中文可访问名称，例如“更多操作：DEMO-123”。危险项继续通过页面现有确认语义执行；不得从菜单直接删除。
- 不创建 `DenseTable`、列工厂或通用 RowActions。各页面直接调整既有 `columns`，共享部分仅限 CSS。
- 数据量较大的集合 Table 使用 Ant `sticky`，顶部偏移与 72px 全局工具栏一致。短配置子表不强制 sticky。
- `.ant-table-row:focus-within` 复用现有 hover token，链接、按钮、更多菜单各自保持可见焦点；不让 `tr` 进入额外 Tab 顺序。
- 长 URL、ID、时间和模型名称继续使用现有换行或 `title`；只在内容确实溢出时截断，不隐藏唯一识别信息。

### 4.2 章节导航

- 增加一个最小 `useActiveSection(sectionIds)` Hook，使用浏览器原生 `IntersectionObserver` 观察现有 section ID；产品事实、内容任务、内容审核和 AI 渠道详情复用它。
- Hook 只返回当前 ID，不拥有路由、滚动、表单或布局状态。浏览器不支持观察器时，当前项保持第一个章节，不增加轮询 fallback。
- 当前链接增加 `aria-current="location"` 和现有 token 驱动的选中样式；点击仍使用原生锚点与现有 `scroll-margin-top`。
- 条件区块仍由页面决定是否同时渲染链接与目标，Hook 不生成章节。

### 4.3 产品事实表单

- `FactsForm` 使用 Ant Form 实例和页面内状态记录 dirty/error section ID；字段名第一段通过一个局部常量表映射到既有章节 ID。
- 导航状态优先级为“错误 > 已修改 > 当前 > 普通”，并同时提供短文本/图标和 `aria-label`，不只改变颜色。
- `onFinishFailed` 复用 Ant 的 `errorFields`，在保存条上方显示错误数量与“定位首个错误”；继续使用 `scrollToFirstError`，不另写校验规则。
- 保存条展示未修改、未保存、保存中、已保存、保存失败。保存成功后清理 dirty/error 展示并保留现有 query invalidation；用户再次编辑时重置成功状态。
- 动态对象增加静态序号标题，例如“证据 1”“参数 2”，删除按钮移动到标题行。标题不依赖额外数据推断，不折叠字段。

## 5. P1 设计

### 5.1 共享状态组件

- `QueryFailure` 保留 `error` 与 `onRetry`，增加可选 `actions` 插槽；调用页可提供返回列表、打开相关配置等已存在路由入口。
- `NoData` 将 `description` 放宽为 `ReactNode`，增加可选 `action`；只有当前容器没有可见等价 CTA 时才传入。
- `QueryLoading` 保持简单；表格继续优先使用 Ant Table 的 `loading`，复合详情使用区块级 `QueryLoading`，不建设 Skeleton 模板系统。
- 共享组件不识别业务错误码，不猜测恢复路径，业务页面仍拥有恢复决策。

### 5.2 复合详情局部失败

- 内容任务以 `task` 为页面身份；`versions`、`jobs`、`options` 分别在内容版本、作业状态、生成输入区块处理 loading/error。某一区块失败不遮蔽其他已加载数据。
- 产品事实以 `product + draft` 为工作区身份；`versions` 只影响版本 Tab，审核上下文继续只影响审核 Modal。
- 单查询详情页继续使用全页失败，但在错误态保留返回入口和页面标题上下文。
- 不改变 TanStack Query key、retry 策略、刷新频率、mutation 或服务端契约。

### 5.3 成功反馈

- 通过现有 `App.useApp().message` 提示长期保存、删除、启停和显式状态操作成功；已有明确导航结果或 Modal 关闭且新数据立即可见的简单创建操作默认不重复提示。
- message 使用短中文文本、默认时长和 `aria-live` 能力，不抢焦点，不新增全局事件总线。

### 5.4 路由焦点与主题

- `AppLayout` 给现有主内容增加 ref 与 `tabIndex={-1}`；`location.pathname` 变化后使用 `focus({ preventScroll: true })`。查询参数变化不触发主内容焦点，避免分页/筛选时抢焦点。
- Dropdown 关闭后由 Ant Design 返回触发器焦点；Modal 继续使用 Ant 内置焦点圈定和关闭恢复。
- 先对现有浅/深 token 做实际对比度测量；仅在失败时修改 `theme.ts` 中的 `navTextMuted`、`textTertiary`、边框或相关语义 token。禁止在页面 CSS 硬编码浅/深颜色。
- 真实浏览器验收发现从显式深色切回 `system` 时可能沿用旧解析值；`ThemeProvider.setMode('system')` 必须立即重新读取当前 `matchMedia` 结果。该修复不增加 Provider、不改变主题模式枚举或存储键，并补充回归测试。

## 6. P2 设计

- 工作台保留现有 5 个待办指标和 4 个 GEO 指标。
- `pending_fact_reviews`、`pending_content_reviews`、`pending_publications` 非零时使用既有 warning/data 语义；`publication_attention` 与 `recent_accuracy_errors` 非零时继续使用 danger；零值使用 default。
- 不根据单次快照推断趋势，不新增箭头、百分比变化、Sparkline 或图表依赖。

## 7. 文件边界

| 文件/目录 | 计划变更 |
|---|---|
| `frontend/src/shared/components/AsyncState.tsx` 及测试 | 可选恢复/空态操作与语义测试 |
| `frontend/src/shared/hooks/useActiveSection.ts` 及最小测试 | 原生章节观察，只返回当前 section ID |
| `frontend/src/styles/global.css` | 表格 focus-within、章节当前/错误/修改状态、动态对象标题、保存与状态布局 |
| `frontend/src/app/AppLayout.tsx` 及测试 | 路由切换主内容焦点 |
| `frontend/src/app/ThemeProvider.tsx` 及测试 | 切回 `system` 时立即重新解析当前系统配色 |
| `frontend/src/features/product-facts/{ProductsPage,ProductFactsPage}.tsx` | URL 状态、行操作、长表单状态和局部版本错误 |
| `frontend/src/features/content-tasks/ContentTasksPage.tsx` | URL 页码、章节当前态、次级查询局部错误、成功反馈 |
| `frontend/src/features/content-editor/ContentEditorPage.tsx` | 章节当前态与操作反馈，不重排审核工作区 |
| `frontend/src/features/configuration/**` | 代表性表格操作降噪、章节当前态、空态与成功反馈 |
| `frontend/src/features/{publications,geo-observations,users,settings}/**` | URL 视图状态、代表性行操作和恢复反馈 |
| `frontend/src/features/dashboard/DashboardPage.tsx` | 现有指标 tone 映射 |
| 相关 `*.test.tsx`、`frontend/tests/e2e/*.spec.ts` | 行为、URL、焦点、局部错误和业务边界回归 |
| `frontend/README.md` | 记录交互状态与高密度组件规则 |

默认不改后端、契约、数据库、部署、依赖、路由表、主题 Provider 架构、查询 key 或生成类型。真实浏览器发现的 `system` 解析缺陷只在现有 Provider 内修复，不新增 Provider 或模式；其他边界若必须修改，返回规划阶段重新评审。

## 8. 取舍与回滚

- 不新增表格/表单抽象层：现有 Ant 组件足够，页面差异仍由各 feature 拥有。
- 不用 CSS `:target` 代替滚动状态：它只能反映最后点击的锚点，不能反映用户滚动；原生 `IntersectionObserver` 是满足需求的最小机制。
- 不自动保存：服务端修订号和不可变快照要求显式提交，自动保存会改变业务语义和并发行为。
- 不把全部 mutation 包装成统一 Hook：成功文案和刷新行为属于各业务页面，统一包装会隐藏真实所有权。
- 不调整 Liquid Glass、字体或全局配色：审计问题不在视觉方向，动态模糊还会增加性能和对比度风险。
- 回滚按 P0 表格、P0 长表单、P1 状态、P2 工作台四组精确 diff 反向应用；不得恢复双实现、兼容分支或使用破坏性 Git 命令。

## 9. 验证策略

- 单元测试验证：更多菜单仍触发原确认流程；URL 参数解析与浏览器前进/后退；章节 `aria-current`；dirty/error/save 状态；局部查询失败；路由焦点；工作台 tone。
- 不在 jsdom 断言像素、sticky 坐标或颜色对比度。
- E2E 复用现有数据准备，覆盖产品列表状态恢复、产品事实保存、内容任务局部错误、内容审核章节、AI 配置操作和危险确认。
- 真实浏览器覆盖 375/768/1024/1440、浅/深主题、200% 缩放、键盘操作和至少一个无数据/错误状态。
- 对比度使用实际计算样式测量，不从截图推断合规。
