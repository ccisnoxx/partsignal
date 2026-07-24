# 跨页面视觉系统收口设计

## 设计原则

1. `visual-system.md` 决定视觉结果，当前页面截图和历史原型只用于定位差异。
2. 删除路由级视觉分支，保留路由级业务语义。
3. 复用 `AppLayout`、Ant Design 和现有共享组件，不增加新的通用视觉抽象。
4. 先统一全局壳层和运行时 Token，再处理页面内容表面；不得用页面补丁遮蔽共享根因。
5. `ui-ux-pro-max` 只用于对比度、键盘、反馈、响应式、表格/表单/图表和 anti-pattern 复核。

## 目标结构

### 单一 AppLayout

`AppLayout` 继续拥有：

- 认证后的全局导航；
- 选中路由和分组展开；
- 品牌区、全局搜索、主题、账号与退出；
- pathname 变化后的内容焦点；
- 桌面 Sider、折叠状态和移动 Drawer；
- 页面内容 Outlet。

路由判断只影响面包屑文本、导航选中和真实交互，不再影响壳层 class、侧栏宽度、顶栏高度、背景、圆角、阴影或字体。

实现中删除 `isDashboard`、`isManagementShell`、`isUserManagement`、`isPlatformManagement`、`isPlatformRules`、`isPromptManagement` 和 `compactShell`。保留 `isConfiguration`、`isAuditLog`、`isBusinessSettings`、`isGeo` 仅生成 Header 上下文。桌面折叠按钮统一放在 Sider 底部，移动端 Header 只负责打开 280px Drawer。

统一几何：

| 区域 | 桌面 | 窄屏 |
|---|---:|---:|
| Sider | 220px | 280px Drawer |
| collapsed Sider | 76px | 不适用 |
| Header | 64px | 64px |
| Content padding | 24px | 16px，最窄 12px |
| 品牌区高度 | 64px | Drawer 内沿用 64px |

应用画布只在 `.app-shell` 定义一次；允许使用现有语义 Token 形成低饱和环境光，但不得按路由改变。

### 页面内容边界

- 页面继续按数据列表、编辑审核、分析洞察三种构图组织。
- `PageHeader` 的标题、说明、面包屑和操作层级保持一致；页面可省略无业务意义的字段。
- 页面可保留真实业务需要的多栏、详情面板、编辑器、图表和打印布局。
- 页面 class 只能管理内容 Grid/Flex、真实数据密度、打印和动态图形，不得重写 AppLayout 或创建基础视觉主题。

### Token 运行时所有权

- `theme.ts` 继续持有浅/深颜色、玻璃、状态、图表与阴影。
- 在 `theme.ts` 内增加一个扁平的共享视觉常量对象，持有系统字体、等宽字体、圆角和动效值；同一对象用于 Ant Design 映射和 ThemeProvider 注入的 `--ps-*` 变量。
- `global.css` 只消费变量，不再维护同值字面量。
- 不增加 primitive/semantic/component 三层 Token 框架；现有规模只需要一个共享常量对象。
- `--ps-shadow-sm/md/lg` 继续按浅/深主题持有；业务 elevation 只消费这三个角色。

最终数据流：

1. `theme.ts` 的 `projectThemes` 持有浅/深语义颜色与阴影；
2. 同文件模块私有 `visualConstants` 持有字体、8/12/16px 圆角、150/200/220ms 动效和 easing；
3. `applyProjectTheme` 一次写入两组根 CSS 变量；
4. `createAntTheme` 从同一对象映射 Ant Design；
5. `ThemeProvider` 只解析模式、reduced-motion 并调用上述函数；
6. `global.css` 不再持有重复值，只消费 `--ps-*`。

`index.html` 的浅/深画布值仅用于 React 挂载前防闪烁，是受限启动例外，不构成页面 Token 源。

### 页面级变量处理

- 删除 `--um-*`、`--audit-*` 和 GEO 的基础表面/文字/边界别名，直接使用 `--ps-*`。
- 保留 `geoSeries*` 及图表中的数据驱动 `--geo-accent`，因为它表达真实序列而非页面主题。
- 删除页面级字体覆盖。
- 把 5/6/7/9/10/14px 等任意业务圆角映射到 `--ps-radius-sm/md/lg`；4px 紧凑状态保留。
- 把 elevation 阴影映射到 `--ps-shadow-sm/md/lg`；焦点和选中 inset 不归入 elevation。
- 主按钮回到 Ant Design primary；删除业务页蓝紫渐变和独立彩色阴影。

GEO 趋势和平台系列不再依赖 `.app-shell-geo` 上的别名，`GeoInsightsPage.tsx` 与图例 CSS 直接引用现有 `--ps-geo-series-*`。数据驱动 `--geo-accent`、`--geo-rate-color` 继续保留。

## CSS 处理策略

本任务不进行全量 CSS Modules 迁移，也不新建视觉框架。

1. 删除 `global.css` 中完整的路由壳层块。
2. 把仍有业务价值的页面布局规则留在原 class 下。
3. 合并完全相同的表面、圆角和阴影规则；没有真实重复时不提取新组件。
4. 降低对 `.ant-*` 深层选择器和 `!important` 的依赖；仅在 Ant Design 级联确实需要时保留最小选择器。
5. 保留认证、打印和动态图表的明确例外。

## 静态视觉契约

将现有 `check-theme-colors.mjs` 收敛为一个视觉契约检查脚本，复用标准库递归扫描：

- 原始颜色：hex、rgb/rgba、hsl/hsla、oklch/oklab；
- 禁止的路由壳层 class；
- 禁止的页面基础 Token 前缀；
- 非 `var(--ps-font-*)` 的业务字体；
- 从图表系列色派生非数据基础表面、文字或操作色的 `color-mix()`；
- 视觉依赖和 `@font-face`/外链字体入口。

输入固定为 `frontend/src/**/*.{css,ts,tsx}`、`frontend/index.html` 和 `frontend/package.json`。除上述规则外，还检查未 allowlist 的数字圆角、外部 elevation 阴影、主操作蓝紫渐变和禁止视觉依赖。

`theme.ts` 仅 `projectThemes` 主题值区、`index.html` 首屏画布、认证/打印、4px 紧凑状态、圆形/胶囊、焦点/选中 inset 和数据图形使用“准确文件 + 选择器/属性类型”小型 allowlist；不得使用整文件或宽泛目录跳过。脚本支持可选扫描根目录，并由 Node `node:test` 临时 fixture 验证每类失败和合法例外。

## 测试设计

### 单元测试

- `AppLayout.test.tsx`：多个代表路由产生同一壳层 class、Sider 宽度、折叠行为和内容焦点。
- `ThemeProvider.test.tsx`：浅/深主题注入完整颜色、字体、圆角、阴影和动效变量；Ant Design 映射使用同一常量。
- 共享组件既有测试：PageHeader、MetricTile、StatusTag、TableRegion 的语义行为不变。
- 视觉契约脚本：用临时测试文件验证每类禁止模式会失败、合法 `--ps-*`/数据图形表达通过。

### Playwright

1. 登录真实本地/CI 栈，遍历主要业务路由并读取 `.app-sider`、`.app-header`、`.app-content`、品牌区、搜索和账号区的计算样式，比较统一几何、字体、表面和边界。
2. 以 `/users`、`/configuration/prompts`、`/observations/insights` 分别代表数据列表、编辑审核和分析洞察：
   - 1440px 浅色/深色视觉基线；
   - 375px 浅色基线；
   - 关键动态文字、时间和真实数据区域使用遮罩或稳定断言。
3. system 主题、键盘、`:focus-visible`、焦点恢复和 reduced-motion 使用行为/计算样式断言；真实 200% 通过 Playwright 持久 Chromium 加载最小 Manifest V3 fixture，调用浏览器 `chrome.tabs.setZoom` 后验证三类页面，不把 CDP 页面缩放仿真当作浏览器缩放。
4. 打印页检查应用导航隐藏、内容不裁切；认证页只做无回归 smoke。

视觉截图使用已有 Playwright，不增加像素比较依赖。基线只覆盖三个页面类型，避免为每个路由维护全页快照。

壳层矩阵覆盖 `/`、产品、任务、发布、GEO、设置、用户、审计和全部配置中心入口，并通过真实 API 补充产品详情、任务详情、内容编辑、平台规则和 Prompt 查询路由。出版详情、attention/repair、观测纠错和 AI channel 动态路由继续由既有 MVP/AI E2E 覆盖，不复制业务建数流程。

九个基线为 `/users`、Prompt、GEO 洞察各自的 1440px light/dark 与 375px light；使用 viewport screenshot、关闭动画/光标、2% 最大差异比例和仅动态值遮罩。系统主题、reduced-motion、真实浏览器 tab zoom 和打印使用行为/计算样式断言。

## 兼容与迁移

- 路由 URL、React 组件导出和 API 契约保持不变。
- 页面结构调整只移动视觉容器或删除冗余包装，不移动业务状态所有权。
- 先统一 AppLayout，再逐类删除页面覆盖；每一步都运行代表路由，避免一次删除全部 CSS 后集中排错。
- 深浅主题共用语义角色；不得仅在浅色下调通。

### AC11 授权解阻

- `mvp-flow.spec.ts` 的用户创建请求改为消费权威 `UserCreate.temporary_password`；不增加兼容字段，不修改 OpenAPI 或服务端校验。
- 预览步骤先从真实 API 响应确认目标任务满足 OPEN、PUBLIC、用户 Prompt 非空且模型可用，再通过现有可访问 Select 交互选择精确 ID；若前置状态不成立，修正测试建数顺序或等待条件，不放宽产品按钮门禁。
- 修改范围默认只有既有 E2E；若证据指向产品缺陷而非测试漂移，停止并回报，不以 fallback、skip 或静默默认掩盖。

## 风险与回滚

- 最大风险是删除高特异性规则后局部 Ant Design 样式暴露。实施按壳层、Token、三类页面、测试四个阶段推进，每阶段检查 diff 和代表路由。
- 视觉基线可能受系统字体和动态数据影响；通过小范围基线、遮罩、阈值和计算样式组合降低波动，不降低真实失败的可见性。
- 若某页面必须保留特殊结构，例外只能停留在内容区，并在 `visual-system.md` 已有特殊页面边界内说明；不得恢复路由级壳层。
- 不使用 `git reset` 或覆盖用户文件；出现回归时按本任务 diff 反向修改对应阶段。
