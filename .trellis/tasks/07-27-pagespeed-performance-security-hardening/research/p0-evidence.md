# P0 已确认取证

## PageSpeed 桌面报告

- 报告 URL：`https://pagespeed.web.dev/analysis/https-geo-962850-xyz/w9w0p3qogw?form_factor=desktop`
- 抓取时间：`2026-07-27T07:04:15.295Z`
- Performance `0.81`，CLS `0.2240526165210154`，TBT `228ms`（展示 `230ms`）。
- `layout-shifts` 记录两个 `body` 项，分值 `0.1126521535580524` 和 `0.111400462962963`。

## 认证启动链

- `frontend/src/main.tsx`：React 入口加载 `App` 与全局 CSS。
- `frontend/src/app/App.tsx`：`BrowserRouter` 内由 `AuthProvider` 包裹全部路由。
- `frontend/src/features/auth/AuthProvider.tsx`：`/api/v1/auth/me` 返回 204 时显式消费空响应并得到 `user=null`。
- `frontend/src/app/ProtectedRoute.tsx`：认证未决时渲染 `.centered` Skeleton，未认证后 Navigate 到 `/login`。
- `frontend/src/styles/global.css`：`.centered` 使用 `margin:16vh auto`；`.login-page` 使用 `min-height:100dvh` 的完全不同布局。

## Nginx 与线上响应

- 宿主机通过项目 SSH alias `hostdzire` 只读确认 Nginx `1.29.8`。
- 当前站点：`/etc/nginx/sites-available/partsignal-staging.conf`。
- 当前共享 snippet：`/etc/nginx/snippets/security-headers-web.conf`，只定义：
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- `/assets/` 和 `/` 均定义自己的 `add_header Cache-Control`。Nginx 默认只在当前层没有 `add_header` 时继承上层，因此公网静态响应丢失全部 server 级安全头。
- 2026-07-27 实测：
  - `/`、`/index.html`、当前 JS：只有 Cache-Control，没有 CSP/HSTS/COOP/XFO/nosniff/referrer。
  - API location：仍返回 XFO/nosniff/referrer，证明 server snippet 本身生效但被静态 location 覆盖。
- Nginx 官方文档确认 `add_header_inherit merge` 从 1.29.3 起可合并父级与当前级 `add_header`。

## CSP 兼容边界

- `frontend/index.html` 有一个无 `src` 的内联主题启动脚本，React 挂载前同步设置主题画布，不能未经验证地删除或阻断。
- `ThemeProvider` 使用 Ant Design CSS-in-JS，运行时需要 inline style。
- `DirectUpload` 使用服务端返回的 HTTPS URL，平台 Logo/下载地址也可能来自 HTTPS 对象存储。
- 前端未发现 iframe、`postMessage` 或依赖 `window.opener` 的业务流程。
