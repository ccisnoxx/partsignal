# 设计：P1 性能诊断闭环

## 测量所有权

扩展 `frontend/scripts/measure-production-performance.mjs`，复用现有本地生产构建、
Playwright、fixture 和输出。每个全新 BrowserContext 在导航前注册：

- JS/CSS coverage；
- `layout-shift` 和 `longtask` observer；
- `PerformanceResourceTiming`；
- TBT `Σ max(0, duration-50ms)`；
- 登录稳定、主题和请求错误。

公开 source map 属 P2 授权；本地 profiling 可以使用构建产物或 trace 进行归因，
但不因此发布线上 map。

测量采用相同桌面 viewport、网络和匿名 `/`→`/login` 流程，至少三次基线、
五次 longtask 调查。报告口径和 Chromium 解压源码 coverage 不混用。

## 已确定的加载边界

### Ant 运行时

`ThemeProvider` 只持有所有路由共用的主题状态和 CSS Token，不再静态导入 Ant。
`AntThemeProvider` 持有 `ConfigProvider`、locale 和 Ant ThemeConfig，并在
已懒加载的 `AppLayout` 与独立改密页按需加载。`AntApp` 留在 `AppLayout`，
包住使用 `App.useApp()` 的所有工作台子路由。现有搜索未发现登录、改密或
AppLayout 外调用 `App.useApp()`。

### 主题控件

- 登录路由使用原生 radio group 实现展开控件，保留三态、箭头键和焦点可见性，
  不再为单个选择器加载 `Segmented`。
- 工作台使用只导入 `Dropdown/Tooltip/Button` 的紧凑控件。
- 主题 context、模式常量和行为保持一个事实源；不创建通用控件工厂。
- 展开控件不得从 Tab 顺序移除。

登录卡片和登录表单使用原生 `section/h1/h2/p/form/input/button`。字段仍绑定
`LoginRequest`，提交继续调用同一 `/api/v1/auth/login`，保留最短八位校验、
首个无效字段聚焦、密码显隐、pending、服务端错误、会话刷新和原目标跳转。
字段错误通过 `aria-invalid` / `aria-describedby` 关联；密码显隐按钮名称不得与
“密码”字段名称重叠。业务表单、改密页和工作台仍使用 Ant。

该边界由最新 PageSpeed treemap 中 React DOM、React Router、rc-field-form、
rc-trigger、Input、Alert 和 Tooltip 的浪费证据触发，不是凭单次 coverage 猜测。
没有现有路由/条件边界时不制造新抽象。

## CSS 证据

CSS coverage 必须覆盖默认、hover、focus-visible、错误、disabled、light/dark、
Modal、Drawer、Dropdown 和表单校验。只有在这些状态全部未用且代码引用也不存在时
才可删除规则。Ant 组件状态 CSS 不能因 PageSpeed 单一静态截图未触发而删除。

## 长任务调查

最新五个入口任务按 trace 时间点匹配：

- JS parse/evaluate；
- React render/commit；
- CSS-in-JS style generation/injection；
- layout/style recalc；
- 主题和 Router 初始化。

285ms 任务同时采集空白页和静态最小页；若实验均在对照页出现且与应用栈无关，
只形成证据，不由实施者自行判定关闭。

## 加载链与页面结构

`/auth/me` 是已认证用户访问登录入口时恢复会话的权威调用。保留一次请求，断言
无重复且首屏不等待响应。LCP 通过减少入口执行和样式注入优化，不改变文本可见性。

入口 CSS 保持外部加载，因为它很小、可缓存且内联会扩大 CSP/HTML 维护。
DOM 当前已通过；没有 trace 证据时保持视觉和语义结构。

## 通过项门禁

- 哈希资产一年 immutable，HTML 不长期缓存；
- HTTPS 最终 URL 无额外重定向，TTFB≤200ms；
- 无第三方、远程字体、重复 JS、强制 reflow、图片问题或 legacy 浪费；
- bootup≤300ms、main-thread≤700ms、总传输≤275 KiB。

任一回退重新打开对应条目，不能以整体分数覆盖。
