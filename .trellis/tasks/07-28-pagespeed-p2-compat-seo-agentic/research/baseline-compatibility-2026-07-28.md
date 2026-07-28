# Baseline 兼容性实施与验证证据

## 当前 PageSpeed 原始证据

- 权威报告：`ibm9s8ga5b`，desktop，Lighthouse 13.4.0，采集时间
  `2026-07-27T14:18:47.385Z`。
- 报告的 Baseline「Newly Available」包含 `scrollend`、`:has()`、
  `text-wrap`、`backdrop-filter` 和 `mask`。
- 本记录只关闭不扩大公开面的兼容性实施；SEO、`llms.txt` 和生产 source map
  仍受公开面确认门禁约束。

## 来源、根因与兼容实现

| 功能 | 权威来源与根因 | 最小安全实现 | 验证与关闭条件 |
| --- | --- | --- | --- |
| `scrollend` | React DOM 19.2.7 的 `react-dom-client.*.js` 含事件支持代码；`frontend/src` 没有 `scrollend` 或 `onScrollEnd` 调用，当前业务不依赖该事件 | 不增加无消费者的 polyfill；继续使用原生 `scroll` 与 Ant Table 滚动容器 | Chromium、Firefox、WebKit 均能横向滚动表格，`scrollLeft > 0`；项目搜索保持零业务调用 |
| `:has()` | 原项目样式用它推导 header、Products Modal 和打印路由；Ant Design 6.5.0 的 13 个样式模块也包含该选择器 | 项目所有用法改为 `header-context-stacked`、`products-create-dialog`、`app-shell-print` 显式类；Ant 分发文件不打补丁，在项目边界用稳定类和 `:focus-within` 覆盖关键焦点反馈 | `rg ':has\(' frontend/src` 为零；三浏览器验证 header、Modal、打印、Input/Radio/Tabs/菜单焦点和表格滚动 |
| `text-wrap: balance` | Ant Form `node_modules/antd/es/form/style/index.js:137`；项目没有直接使用 | 浏览器不支持时按 CSS 语法规则忽略该声明并使用普通换行；不复制 Ant 样式 | 在 375px Modal 中注入超长中英文 Ant Form label，三浏览器均实际多行、`scrollWidth≤clientWidth` |
| `backdrop-filter` | 项目登录卡片、壳层和浮层样式 | 复用 `global.css`、`workspace.css` 现有 `@supports not`，降级到不透明背景和边框 | 常规三浏览器验证增强路径；另用 Firefox 原生 preference 关闭该特性，实际验证非透明 fallback |
| `mask-image` | `global.css` 登录页 `::after` 纯装饰点阵 | fallback-first：默认 `display:none`，仅在正向 `@supports` 中显示并设置 mask；不影响内容或交互 | 默认规则本身是安全降级；三浏览器支持时确认伪元素显示且 mask 不为 `none` |

Ant 的 `:has()` 来源清单为 card、checkbox、date-picker、form、input-number、
input、radio、select、splitter、tabs、tooltip、tree 共 13 个 ES 样式文件。依赖自身
实现不在 `node_modules` 内修改，避免安装后丢失或形成私有分叉；关键交互的项目
fallback 和浏览器回归是本项关闭证据。

## 权威代码位置

- `frontend/src/app/AppLayout.tsx`
  - 根据准确 route 输出 `app-shell-print`；
  - 普通 header 输出 `header-context-stacked`；
  - Dropdown 关闭后将焦点归还触发按钮；
  - Drawer 提供可访问名称，菜单内 Escape 一次关闭并归还焦点。
- `frontend/src/features/product-facts/ProductsPage.tsx`
  - Products Modal 使用 Ant `rootClassName="products-create-dialog"`。
- `frontend/src/styles/global.css`
  - mask 纯装饰伪元素默认隐藏，仅在支持时显示；
  - 保留登录 backdrop 降级。
- `frontend/src/styles/workspace.css`
  - 显式类替代项目 `:has()`；
  - 为 Ant Input、Select、Checkbox、Radio、Tabs 提供 `:focus-within`
    可见焦点；
  - 保留通用 backdrop 降级。
- `frontend/tests/e2e/compatibility.spec.ts`
  - 以 API route mock 隔离生产和真实后端，覆盖上述功能与焦点回收。

## 验证结果

2026-07-28 本地结果：

```text
Chromium / compatibility.spec.ts: 3 passed
Firefox  / compatibility.spec.ts: 3 passed
WebKit   / compatibility.spec.ts: 3 passed
Firefox（禁用 backdrop）:          1 passed
AppLayout + ProductsPage unit:   20 passed
ESLint:                         passed
Vite production build:          passed
```

干净的跨浏览器复测命令：

```bash
cd frontend
npm exec -- playwright test tests/e2e/compatibility.spec.ts --project=trusted-types-firefox
npm exec -- playwright test tests/e2e/compatibility.spec.ts --project=trusted-types-webkit
npm exec -- playwright test tests/e2e/compatibility.spec.ts --project=compatibility-firefox-no-backdrop
```

验收阈值：

- `frontend/src` 中 `:has()` 为 0；
- 三浏览器每个常规项目 3/3 通过，Firefox 禁用 backdrop 项目 1/1 通过；
- 375px 表格可滚动且无页面级横向溢出；
- 超长中英文 Ant Form label 实际多行且不溢出容器；
- Modal、Dropdown、Drawer 均可由键盘关闭并把焦点归还触发器；
- mask/backdrop 的支持与不支持分支都有确定结果，不依赖模糊猜测。

## 行为、公开面、部署与回滚

- 行为变化：移动 Drawer 显示标题“主导航”；Dropdown 和 Drawer 的键盘关闭行为
  更明确；打印、header 和 Modal 布局从祖先推导改为组件显式声明。
- 公开面变化：无；不改变索引、DNS、响应头、source map 或匿名可访问资产。
- 部署：随正常前端构建发布；发布后在登录、Products、打印路由复跑同一用例。
- 回滚：回滚上述前端文件即可；无数据迁移、缓存契约或不可逆状态。
- 额外授权：本项不需要。生产部署本身仍需单独授权。
