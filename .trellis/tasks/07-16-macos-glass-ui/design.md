# 技术设计

## 1. 设计结论

在现有 React、Ant Design 与主题状态结构上重建一套双主题视觉系统，不新增 UI 依赖、不创建第二套主题模块，也不逐页重写业务组件。

最小可行结构保持为：

1. `frontend/src/app/theme.ts` 拥有随主题变化的颜色、透明度、玻璃、阴影和焦点 token，并同时生成 Ant Design 配置与 CSS 变量；`global.css` 保留浅深主题共用的字体、圆角、动效和间距常量。
2. `frontend/src/app/ThemeProvider.tsx` 继续只负责主题状态、系统解析和 token 注入，不增加新的主题状态或 Provider。
3. `frontend/src/app/AppLayout.tsx` 复用现有侧栏、顶栏、内容区和移动抽屉结构，只调整视觉尺寸或必要类名。
4. `frontend/src/styles/global.css` 重建共享视觉规则，业务 feature 文件仅在浏览器证据证明共享规则无法覆盖时做局部调整。
5. `frontend/index.html` 只保留首屏所需的浅/深画布色镜像，测试保证其与 `theme.ts` 一致。

本任务不拆分子任务。Skill 更新、主题 token、共享样式和双主题验证共同维护一个全站视觉不变量；拆分会留下无法独立验收的半套主题。

## 2. 已验证的现状与约束

- `ThemeProvider` 已统一处理主题偏好、系统主题、跨标签同步、`color-scheme`、CSS 变量和 Ant Design 配置，见 `frontend/src/app/ThemeProvider.tsx:39-108`。
- 首屏脚本在 React 挂载前解析相同存储键并写入画布色，见 `frontend/index.html:9-30`。
- `AppLayout` 已具备目标框架需要的结构，无需新增布局框架或路由层。
- 主题颜色守卫只允许 `frontend/src/app/theme.ts` 在运行时代码中声明颜色，见 `frontend/scripts/check-theme-colors.mjs`。
- 当前全局 `ui-ux-pro-max-cli` 与项目内 skill 均为 `2.11.0`，项目 `data/` 与 React stack 文件完整；CLI 的 `--force` 会同时覆盖其他 bundled skill，因此只能在临时目录生成并定向同步 `ui-ux-pro-max`。
- 历史任务已明确移除截图测试、PNG 基线和 `@axe-core/playwright`，但保留功能 Playwright，见 `.trellis/tasks/archive/2026-07/07-16-remove-visual-baseline-infrastructure/design.md:5-14`。
- 既有响应式约束要求表格在自身边界横向滚动、页面不得整体溢出，并以功能 E2E 与人工检查替代截图快照，见 `.trellis/tasks/07-13-configuration-center-navigation/design.md:109-132`。
- 既有本地化验收要求覆盖 375/768/1024/1440、浅/深主题、中文 `aria-label` 和可读字号，见 `.trellis/tasks/archive/2026-07/07-16-frontend-chinese-localization/design.md:51-65`。

## 3. 视觉系统

### 3.1 颜色与材质

以下值是实施起点，也是评审基线；只有在对比度实测不达标时，才允许在同一语义角色内小幅调整，并把最终值保留在 `theme.ts`。

| 语义 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| 画布 | `#F5F5F7` | `#0F1012` | 页面最底层 |
| 业务表面 | `#FFFFFF` | `#1C1C1E` | 表格、表单、正文、业务卡片 |
| 次级表面 | `#F2F2F7` | `#242426` | 表头、分组、禁用和内嵌区域 |
| 抬升表面 | `#FFFFFF` | `#2C2C2E` | 高层非玻璃内容 |
| 玻璃表面 | `rgba(255,255,255,.82)` | `rgba(28,28,30,.82)` | 侧栏、工具栏、抽屉 |
| 强玻璃表面 | `rgba(255,255,255,.92)` | `rgba(36,36,38,.92)` | 弹窗、下拉层、悬浮操作条 |
| 主文字 | `#1D1D1F` | `#F5F5F7` | 标题与正文 |
| 次文字 | `#515154` | `#D1D1D6` | 描述与标签 |
| 弱文字 | `#6E6E73` | `#A1A1A6` | 辅助信息，仍须满足实际背景对比度 |
| 品牌操作色 | `#0066CC` | `#0A84FF` | 主操作、链接、选中和焦点 |
| 主操作文字 | `#FFFFFF` | `#001B33` | 主按钮文字 |

按 WCAG 相对亮度公式预检：浅色主/次/弱文字对画布分别为 15.46:1、7.26:1、4.66:1；深色主/次/弱文字对业务表面分别为 15.63:1、11.18:1、6.61:1；浅色与深色主按钮文字分别为 5.57:1、4.78:1。实施后仍须以实际透明表面和组件状态复测。

删除旧 `dataCyan*`、`auroraBlue`、`auroraCyan` token。原品牌用途改用 `actionPrimary`、`actionPrimarySoft` 等操作 token；MetricTile 数据 tone 与 Progress 使用现有 `chartSeries2`，状态色与其他图表色继续按成功、警告、危险和多序列语义保留，并分别验证浅、深背景。

### 3.2 Token 结构

保留现有 `ProjectThemeTokens`、`projectThemes`、`applyProjectTheme()` 和 `createAntTheme()`，直接重建字段和值，不引入 Theme 类、工厂或额外配置文件。

在现有背景、文字、边框、操作、状态、代码、图表和阴影 token 上，仅补充玻璃材质真正需要的字段：

- `glassSurface`
- `glassSurfaceStrong`
- `glassBorder`
- `glassBackdrop`

`glassBackdrop` 统一为 `blur(24px) saturate(160%)`。阴影继续复用 `shadowSm`、`shadowMd`、`shadowLg`，不新增多套材质阴影。

### 3.3 字体、圆角和动效

- 以下浅深主题共用值继续由 `global.css` 的基础变量管理，不重复写入两套主题 token。
- 字体使用 `-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`，不下载 Web Font。
- 业务控件保持 36px 基准高度；移动端可点击控件保持至少 40px。
- 圆角采用 8px 控件、12px 小面板、16px 主要内容面板，不使用夸张胶囊形状。
- 动效限制在 150–220ms 的颜色、透明度、边框和阴影变化；移除会让内容视觉跳动的卡片上浮效果，不新增背景动画。
- `prefers-reduced-motion: reduce` 继续关闭页面、主题和组件过渡。

## 4. 层级与玻璃边界

| 层级 | 表面 | 是否模糊 | 代表区域 |
|---|---|---:|---|
| L0 | 画布 | 否 | `body`、`.app-shell`、`.app-content` |
| L1 | 接近不透明业务表面 | 否 | Card、Table、Form、Markdown、审核区、配置区 |
| L2 | 玻璃表面 | 是 | `.app-sider`、`.app-header`、移动 Drawer |
| L3 | 强玻璃表面 | 是 | Modal、Dropdown、`.form-save-bar`、`.form-section-nav` |

浏览器支持时同时设置 `backdrop-filter` 与 `-webkit-backdrop-filter`。不支持时直接使用高不透明度表面和边框；降级路径不依赖 JavaScript，也不隐藏内容。

为控制 GPU 合成成本，普通 Card、Table、Form、MetricTile、Markdown 和每一行列表均禁止使用 `backdrop-filter`。模糊只出现在上述有限共享容器。

## 5. 一体式工作区

### 5.1 桌面端

- 侧栏维持全高和粘性，宽度由 232px 调整为 248px，折叠宽度由 72px 调整为 76px；品牌区固定，菜单区独立纵向滚动，页面主体不增加第二套滚动结构。
- 工具栏维持粘性，标准高度由 64px 调整为 72px；它与侧栏共享玻璃材质、边框与模糊参数。
- 内容区是内嵌画布，不在窗口四周增加悬浮岛间距；桌面内边距使用 32px，页面最大宽度继续受统一容器控制。
- 页面标题区、页面分区和内容面板通过 20–24px 垂直节奏、16px 圆角和轻阴影形成层级。
- 侧栏选中态使用品牌蓝的低透明背景和清晰文字，不保留旧 Cyan 数据色。

### 5.2 移动端

- 继续使用现有 Drawer，不新增底部导航或第二套路由入口。
- 工具栏保持 58px，内容区保持 12–16px 水平间距，避免玻璃岛额外压缩宽度。
- Drawer 使用与桌面侧栏相同的材质、菜单状态和品牌标记。
- 表格仍在 `.table-region` 内横向滚动，页面本身不得横向滚动。

### 5.3 密度

- 框架宽松：增加侧栏品牌区、菜单组、页头和页面分区的留白。
- 业务区中等紧凑：Table 单元格维持约 10–12px 垂直、14px 水平内边距；Form 控件维持 36px；审核双栏、配置网格和摘要区不改成展示型大卡片。
- 页面标题使用约 28–36px 的响应式范围，不通过超大标题占用首屏。

### 5.4 登录页

- 保留现有桌面双栏、移动单栏与主题选择结构。
- 删除 Aurora 渐变、装饰圆环和超大标题；登录 Card 使用不透明 L1 业务表面，通过边框、圆角和阴影与画布分层，不在登录表单上使用模糊。

## 6. Ant Design 与共享组件

`createAntTheme()` 继续映射颜色、圆角、控件高度和动效，并重点覆盖 Layout、Menu、Button、Card、Table、Modal、Drawer、Dropdown、Input、Select、Tabs 与 Tag。组件 token 只表达组件内部状态，玻璃模糊仍由 `global.css` 负责，避免把 CSS 材质逻辑塞进 React。

共享组件保持现有 API：

- `PageHeader`：只由共享 CSS 调整间距、标题比例和 Hero 表面。
- `MetricTile`：保留 tone 与路由行为，只更新边框、数值层级和 hover；不再上浮。
- `ThemeModeControl`：保留浅色、深色、跟随系统三态和中文可访问名称。
- `AppLayout`：保留导航项、权限过滤、预取、退出和移动抽屉行为，只调整视觉尺寸与必要类名。

任何 feature 页面若需要新增视觉类，必须先证明现有共享选择器无法表达；不得复制颜色、玻璃或阴影值。

## 7. 主题数据流与启动边界

```text
localStorage / prefers-color-scheme
        ↓
index.html 首屏脚本（仅模式 + 画布色）
        ↓
ThemeProvider（唯一主题状态）
        ↓
projectThemes ──→ Ant Design Token
        └────────→ CSS 自定义变量
```

主题存储键、模式值、系统监听、跨标签同步和 View Transition 行为均不变。`index.html` 的两项画布色是为避免首屏闪烁保留的有界镜像；E2E 必须阻断 React 主模块加载，在启动脚本独立运行时同时断言 `data-theme`、`color-scheme`、背景色和 `theme-color` 与 `projectThemes` 一致，防止 Provider 挂载后掩盖漂移。

## 8. 文件边界

| 文件 | 计划变更 |
|---|---|
| `.trellis/tasks/07-16-macos-glass-ui/**` | 保存已批准设计、实施约束、任务状态与验收证据 |
| `.codex/skills/ui-ux-pro-max/**` | 在临时目录生成模板，仅在存在差异时定向同步；禁止覆盖其他 skill |
| `frontend/src/app/theme.ts` | 重建双主题 token、玻璃 token 与 Ant Design 映射 |
| `frontend/src/styles/global.css` | 重建工作区、材质、层级、密度、共享组件和响应式样式 |
| `frontend/src/app/AppLayout.tsx` | 只调整侧栏尺寸或材质所需类名，不改导航与行为 |
| `frontend/index.html` | 同步首屏浅/深画布色 |
| `frontend/scripts/check-theme-colors.mjs` | 更新已过时的 Midnight Signal 说明，守卫逻辑保持不变 |
| `frontend/src/app/ThemeProvider.test.tsx` | 增加双主题 CSS 变量与模式切换契约检查 |
| `frontend/tests/e2e/theme.spec.ts` | 增加首屏颜色同步、玻璃降级相关功能检查 |
| `frontend/README.md` | 将旧视觉说明更新为新的双主题材质边界与人工验收要求 |

默认不改 feature 页面、API、路由、Query、契约、后端、部署和依赖。浏览器验收发现共享规则确实无法覆盖时，先回到设计说明具体页面原因，再做最小局部修改。

## 9. 可访问性、响应式与性能

- 关键正文和普通控件文字在实际承载背景上满足至少 4.5:1；焦点环不能只靠颜色变化或被模糊表面吞没。
- 透明表面必须有可见边框，禁止浅色 `white/10` 或深色近透明黑造成内容穿透。
- 图标继续使用 `@ant-design/icons`，不新增 Emoji 或第二套图标库。
- 375/768/1024/1440、浅/深主题检查导航、表格、长表单、弹窗、抽屉、悬浮操作条、错误/空/加载状态和 200% 缩放。
- 修改前后以默认五样本运行生产性能脚本，门禁为不新增 Long Task；该脚本不能直接证明 GPU 合成成本，模糊滚动平滑度仍须在真实浏览器检查。若出现回归，先减少玻璃容器数量或不透明度层级，不给每个组件增加独立优化分支。

## 10. 测试、兼容与回滚

- 单元测试验证主题状态、CSS 变量注入和现有导航行为，不断言脆弱的整页像素。
- Playwright 保留功能主题测试，不恢复 `toHaveScreenshot`、PNG 基线或专用 axe 依赖。
- 玻璃降级以静态检查 `@supports not` 规则和浏览器注入禁用 blur 后的可读性共同验证；不得声称 Chromium 实际模拟了不支持该属性。
- 真实浏览器检查覆盖登录页、工作台、高密度配置页，并保持窗口打开供用户复核。
- 工作台或配置页所需本地 E2E 栈不可用时，任务保持未完成，不以单页浏览器调用替代 AC6。
- 回滚以本任务精确 diff 为单位；由于用户明确不要求旧视觉兼容，不保留 feature flag、旧 token 别名或双套 CSS。

主要风险是深色玻璃对比度与 `backdrop-filter` 的 GPU 成本。设计通过高不透明表面、有限模糊容器、功能降级和生产性能检查控制，不引入额外运行时机制。
