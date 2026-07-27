# P1 核实证据

## 根因与权威位置

- `frontend/src/app/App.tsx` 静态导入 `LoginPage`、`ChangePasswordPage` 和 `AppLayout`。业务页面虽已在 `routeLoaders.ts` 使用 `React.lazy`，匿名登录仍会下载改密页与完整工作台壳层。
- `frontend/src/main.tsx` 静态导入唯一的 `frontend/src/styles/global.css`。该文件在同一初始 chunk 中包含认证、登录、工作台和全部业务页面样式。
- `frontend/src/features/auth/LoginPage.tsx` 渲染六条 `.login-flow-lines path`；`global.css` 为所有 path 设置 `animation: login-flow 16s linear infinite`，其 keyframes 修改 `stroke-dashoffset`。该 SVG 属性不能由浏览器合成线程执行。
- 仓库没有 `frontend/public/robots.txt`。`frontend/nginx.conf` 和外层 `deploy/nginx/partsignal.conf.template` 都使用 `try_files $uri $uri/ /index.html`，因此缺失文件会进入 SPA fallback；真实静态文件会被同一规则优先服务。

## 线上响应核实

2026-07-27 20:08 CST 读取 `https://geo.962850.xyz/robots.txt`：

- HTTP `200`
- `Content-Type: text/html`
- `Content-Length: 1587`
- 正文包含 `<title>PartSignal · GEO 内容运营</title>` 与 `<div id="root"></div>`

结论：线上当前返回 SPA `index.html`，不是 crawler 文件。P1 不部署；实现后只做本地生产预览，公网复核留到批准部署后。

## 修改前本地生产基线

基线提交：`ac0f1db`。命令：

```bash
cd frontend
PARTSIGNAL_PERF_SAMPLES=1 npm run perf:production
```

固定条件：Chromium、`1440×1000`、`100ms` 延迟、`1.6Mbps` 下行、全新 BrowserContext、`/api/v1/auth/me` 返回 204。

| 指标 | 基线 |
| --- | ---: |
| 初始 JS transfer | `314653 B` |
| 初始 CSS transfer | `22439 B` |
| 匿名 CLS | `0` |
| Long Task 数 | `0` |
| TBT | `0ms` |

另在相同构建和匿名路径使用 Playwright Chromium JS/CSS coverage，按重叠 range 合并后统计解压源码：

| 指标 | total | used | unused |
| --- | ---: | ---: | ---: |
| JS | `970319 B` | `359216 B` | `611103 B` |
| CSS | `140387 B` | `7298 B` | `133089 B` |

coverage 数据用于本地改前/改后同口径比较，不等同于 PageSpeed 的线上压缩传输节省值。

## 修改与部署边界

- 前端静态代码和资产：`App.tsx`、`ProtectedRoute.tsx`、`AppLayout.tsx`、`global.css`、新 `workspace.css`、视觉守卫、登录 E2E、`public/robots.txt`。
- 不修改 API、认证语义、后端、OpenAPI、数据库、Nginx 模板或安全响应头。
- Vite 构建是文件复制和分包权威；外层 Nginx 已有真实文件优先的 `try_files`，无需配置特例。

## 修改后本地生产结果

同一台机器、同一网络模拟和视口下执行：

```bash
cd frontend
PARTSIGNAL_PERF_SAMPLES=5 npm run perf:production
```

五个全新匿名 BrowserContext 的结果一致：

| 指标 | 修改前 | 修改后 | 变化 |
| --- | ---: | ---: | ---: |
| 初始 JS transfer | `314653 B` | `277040 B` | `-12.0%` |
| 初始 CSS transfer | `22439 B` | `2991 B` | `-86.7%` |
| 初始 JS + CSS transfer | `337092 B` | `280031 B` | `-16.9%` |
| 最大 CLS | `0` | `0` | 持平 |
| Long Task 数 | `0` | `0` | 持平 |
| TBT | `0ms` | `0ms` | 持平 |

同口径 Chromium coverage：

| 指标 | 修改前 | 修改后 | 变化 |
| --- | ---: | ---: | ---: |
| JS total | `970319 B` | `854019 B` | `-12.0%` |
| JS unused | `611103 B` | `508586 B` | `-16.8%` |
| CSS total | `140387 B` | `10418 B` | `-92.6%` |
| CSS unused | `133089 B` | `3189 B` | `-97.6%` |

生产构建输出独立的 `AppLayout-*.js` 与 `AppLayout-*.css`。匿名 `/` → `/login` 只请求入口 JS/CSS；带认证夹具访问 `/` 时浏览器再请求两个 AppLayout 资源，且 `.app-shell` 的布局和背景声明生效。

生产预览 `/robots.txt` 返回 `200 OK`、`Content-Type: text/plain`，正文准确为：

```text
User-agent: *
Disallow: /
```

构建 CSS 不含 `stroke-dashoffset`、`@keyframes login-flow` 或对应 animation 声明；普通动态偏好的 E2E 确认六条 path 的 `animation-name` 均为 `none`。

## 已运行验证

```text
Vitest：3 files / 17 tests passed
视觉守卫 Node test：15 passed
Playwright theme.spec.ts：8 passed
typecheck：passed
lint + 视觉源码守卫：passed
production build：passed
perf:production（5 samples）：passed
git diff --check：passed
```

## Trellis check 结果

- 发现并修复一项中风险 CSS 边界遗漏：`/change-password` 是受保护但不经过 `AppLayout` 的独立路由；原全局移动端 `.ant-btn { min-height: 40px; }` 若随工作台 CSS 延迟加载，会让该页失去既有触控尺寸。
- 修复位置：将该规则保留在 `global.css`，并增加“直接进入改密路由不加载工作台资源且按钮保持 `40px`”的 E2E。
- 最终重新运行定向 Vitest、视觉守卫、8 项主题 E2E、typecheck、lint、production build、5 样本生产性能和 coverage，均通过。
- `.trellis/spec/frontend/visual-system.md` 已同步基础/认证与工作台 CSS 的加载所有权、独立改密页例外和三条资源加载断言。

## 剩余边界

- 本轮未部署，因此不能声称线上 PageSpeed 分数、TBT 或未使用资源已改变；批准部署后需重新运行桌面 PageSpeed。
- 线上 `/robots.txt` 仍是旧 SPA fallback，直到新前端静态产物部署；部署后需复核正文、`Content-Type` 与 P0 安全响应头。
- 主入口仍有约 `276.74 KiB` gzip，主要来自登录必需的 React、Ant Design、主题和认证依赖；P1 不引入手工 vendor chunk 或替换组件库。
