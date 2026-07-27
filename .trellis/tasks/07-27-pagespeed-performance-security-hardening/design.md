# 设计：PageSpeed 分阶段加固

## 设计目标

在现有权威边界修复根因：

1. 公网 HTTP 安全策略由 PartSignal 自己的 Nginx snippet 持有，并通过 Nginx 原生继承合并覆盖所有 location。
2. 认证未决阶段由 `ProtectedRoute` 持有稳定的全视口几何，不改变认证数据流。
3. 匿名入口只装载基础认证资源，已认证工作台资源由现有路由懒加载边界持有。
4. 登录装饰线静态呈现，抓取策略由 Vite public 资产持有，HTML 索引意图由入口文档持有。

不引入新依赖、运行时状态、兼容分支或第二套认证/部署机制。

## 安全响应头设计

### 所有权

- 新增 `deploy/nginx/partsignal-security-headers.conf`，作为 PartSignal 公网安全头唯一仓库来源。
- `deploy/nginx/partsignal.conf.template` 与 `partsignal.staging.conf.template` include 该项目 snippet，并移除通用 `security-headers-web.conf` include。
- 两个 HTTPS server 设置 `add_header_inherit merge;`。宿主机实测 Nginx 1.29.8，满足该指令自 1.29.3 起的版本要求。
- `frontend/nginx.conf` 是受外层 Nginx 保护的容器静态服务，不重复添加安全头，避免代理链产生重复 CSP/HSTS。

### 头部契约

项目 snippet 定义：

```nginx
add_header Content-Security-Policy "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'sha256-<theme-script-hash>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:" always;
add_header Strict-Transport-Security "max-age=31536000" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

约束依据：

- `script-src` 不允许通用 inline/eval，只放行当前内联主题启动脚本的准确 SHA-256。
- Ant Design 运行时注入 `<style>`，因此 `style-src 'unsafe-inline'` 是已确认的必要例外。
- `DirectUpload` 使用服务端签发的 HTTPS URL，平台 Logo 也可能来自 HTTPS 对象存储；因此 `connect-src` 和 `img-src` 保留 HTTPS scheme，不允许 HTTP。
- 应用无 iframe 嵌入、跨窗口通信或 opener 依赖，使用 `frame-ancestors 'none'`、`X-Frame-Options: DENY` 和 `COOP: same-origin`。
- HSTS 不扩散到 `962850.xyz` 的其他子域，也不加入 preload。

### CSP 漂移保护

新增一个只读 Node 检查脚本：

- 从 `frontend/index.html` 提取唯一的无 `src` 内联主题脚本。
- 按浏览器 CSP 规则计算脚本内容 SHA-256/Base64。
- 断言项目安全 snippet 包含该哈希及全部必需头。
- 断言两个外层 Nginx 模板 include 项目 snippet、启用 `add_header_inherit merge`，并不再 include 通用 Web 安全 snippet。

部署脚本自检调用该检查。脚本或 CSP 单边变化会立即失败，不以宽松 header 兜底。

## 认证启动 CLS 设计

- `ProtectedRoute` 的 loading 分支改为 `<main className="auth-boot">`，仍复用 `QueryLoading`。
- `.auth-boot` 固定占满视口并在内部居中有限宽度的 Skeleton；`.centered` 继续只服务错误等普通状态。
- 不在认证未决时渲染登录页，避免认证用户看到登录表单；不改变 `AuthProvider`、React Query 或 redirect。
- `frontend/scripts/measure-production-performance.mjs` 增加匿名冷启动测量：
  - `/auth/me` fixture 返回 204。
  - 导航前注册 `layout-shift` 和 `longtask` observer。
  - 暂缓 204，直到 `.auth-boot` 可见并经过两帧，确保加载态真实绘制后再切换。
  - 等待 `/login` 和登录表单稳定。
  - 输出五个全新 BrowserContext 的 CLS、长任务和初始资源数据，并对 CLS `< 0.1` 设硬门禁。

## P1 登录首包设计

### 已确认根因与权威位置

- `frontend/src/app/App.tsx` 静态导入 `AppLayout` 和 `ChangePasswordPage`。因此匿名 `/` 完成 `/api/v1/auth/me` 204 后进入登录页时，仍下载并解析工作台壳层和改密页。
- `frontend/src/main.tsx` 静态导入唯一的 `frontend/src/styles/global.css`；该文件同时拥有认证样式和全部业务页面样式。Vite 只能输出一个初始 CSS，不能自行判断哪些全局选择器只属于工作台。
- 业务页面本身已经通过 `frontend/src/app/routeLoaders.ts` 使用 `React.lazy`，无需增加 manual chunks 或第二套路由加载器。

### 最小修改

- `App.tsx` 使用现有 `React.lazy` 动态导入 `AppLayout` 和 `ChangePasswordPage`。
- `ProtectedRoute` 使用现有 `QueryLoading` 提供一个 `Suspense` fallback，使已通过认证但正在加载受保护路由代码时仍使用稳定全视口几何。
- `main.tsx` 继续静态导入 `global.css`；该文件只保留基础、主题控件、认证、登录和全局 reduced-motion 规则。
- 新增 `frontend/src/styles/workspace.css`，承接从 `global.css` 原样迁出的工作台规则；由懒加载的 `AppLayout.tsx` 导入。Vite 原生 CSS code splitting 负责生成受保护 CSS chunk。
- CSS 迁移只改变加载边界，不改选择器、声明或响应式行为；视觉守卫把两个项目 CSS 文件视为同一套受控视觉源。

### 不采用

- 不配置 `manualChunks`：它只能重排 vendor，不能消除匿名登录对静态 `AppLayout` 和全局 CSS 的依赖，还会增加长期分包维护。
- 不把每个页面拆成独立 CSS：现有 CSS 高度共享，P1 只需建立认证与工作台两级边界。
- 不懒加载 `LoginPage`：204 后仍必须立即下载该页，不能减少登录完成态总资源，反而增加一次请求和额外 fallback。
- 不改 Ant Design、主题 Provider、认证 Provider 或路由契约。

## P1 登录 SVG 动画设计

- 权威位置是 `frontend/src/styles/global.css` 的 `.login-flow-lines path`、偶数路径方向覆盖和 `@keyframes login-flow`。
- 保留六条 SVG path 与 `stroke-dasharray`，仅删除 `animation`、`animation-direction` 和不再被引用的 keyframes。
- 不用 transform 包裹层替代：wrapper transform 无法复现沿路径移动的虚线；静态装饰已保留信息层级，新增动效没有实际收益。

## P1 robots.txt 设计

- 权威资产是 `frontend/public/robots.txt`。Vite 原样复制到构建根目录，现有 Nginx `location / { try_files $uri $uri/ /index.html; }` 会优先服务真实文件。
- 内容明确禁止所有 crawler 抓取内部系统。既不增加 Nginx exact location，也不把策略写进 SPA 路由或后端。
- 部署边界只包含前端静态产物；本轮不运行部署。上线后通过公网 `/robots.txt` 验证状态、Content-Type、正文和安全响应头继承。

## P1 性能证据与门禁

- 修改前本地生产基线固定在 P0 提交 `ac0f1db`：初始 JS `314653 B`、CSS `22439 B`（传输），JS 未使用 `611103 B`、CSS 未使用 `133089 B`（Chromium coverage 解压源码口径），CLS `0`、长任务 `0`、TBT `0ms`。
- 修改后使用相同构建、网络、视口和 coverage 口径复测；资源量必须下降，CLS 保持 `< 0.1`，长任务和 TBT 不得增加。
- 未部署前不把本地数据冒充新的 PageSpeed 线上分数；上线后的 PageSpeed 和响应检查属于部署后验收。

## P2 收益审查与最小设计

### 已确认现状

- `frontend/index.html` 没有 meta description 或 meta robots；所有 SPA 路由共享这一 HTML 入口。
- `frontend/public/robots.txt` 已在 P1 禁止全站抓取，但 robots 规则本身不保证 URL 不出现在搜索索引；实际业务内容仍由认证和服务端权限保护。
- 仓库、依赖和构建脚本没有错误监控或 source map 上传流程；Vite 默认不生成生产 source map，Nginx 会直接公开服务任何进入 `dist` 的 `.map`。
- PageSpeed 桌面报告的约 `80ms` 提示只指向旧的 `22422 B` CSS。P1 已把匿名入口 CSS 降至 `10418 B` 原始、约 `2.69 KiB` gzip，并维持 CLS、长任务和 TBT 为零。
- 2026-07-27 20:55 CST 线上 `/`、`/robots.txt` 和 `/llms.txt` 仍返回旧的 `1587 B text/html` SPA 产物；P1/P2 均未部署，本轮不得把本地结果描述为线上已修复。

### 决策

| 项目 | 决策 | 权威位置与理由 |
|---|---|---|
| meta robots | 实施 | 在 `frontend/index.html` 增加唯一的 `noindex, nofollow`；它适用于所有 SPA HTML，不增加运行时逻辑。 |
| meta description | 不实施 | 只服务公开搜索摘要，与内部系统 `noindex` 目标冲突，没有业务收益。 |
| `llms.txt` | 不实施 | 没有公开能力目录或训练许可契约；Google Search 不使用该文件，不为 Lighthouse 单项增加维护源或 Nginx 特例。 |
| production source map | 不实施 | 没有私有消费者，公开 map 会暴露源码结构且没有终端性能收益。 |
| 约 `80ms` 阻塞项 | 不实施额外优化 | P1 已将对应初始 CSS 大幅缩小；内联会复制 CSS，异步加载会引入 FOUC，manual chunks/preload 不消除登录页真实依赖。 |

### 索引边界

- `robots.txt` 控制抓取，`meta robots` 表达抓到 HTML 后的索引/跟随意图；二者都不是访问控制。
- 认证、权限和不向匿名响应返回业务数据仍是保密边界。P2 不新增对外文本、路由清单或模型能力说明。
- `/llms.txt` 不是产品 URL。保留通用 SPA fallback 比在三套 Nginx 边界复制 exact location 更小，也避免把非标准审计提示升级成维护契约。

### 验证和部署边界

- Playwright 在匿名登录页断言唯一 meta robots；production build 直接检查 `dist/index.html`。
- 构建后断言不存在 `dist/llms.txt`、`*.map` 和 `sourceMappingURL`，并核对入口 CSS gzip 小于 `4 KiB`。
- 复用现有生产性能脚本验证匿名 `/` → `/login` 的资源、CLS、长任务和 TBT；不重新实现 Lighthouse。
- 本轮不修改 Nginx、后端或契约，不部署、不推送。部署后才可复核公网 meta/robots 和重新运行 PageSpeed。

## 不采用的方案

- 不在每个 Nginx location 复制六个安全头；这会产生多份权威。
- 不修改宿主机共享 snippet；它不在仓库且会影响其他站点。
- 不用 CSP `unsafe-inline`、动态 nonce、Nginx `sub_filter` 或运行时占位替换。
- 不删除 `/auth/me`、缓存未认证结论、预渲染登录表单或增加延时。
- 不修改共享 `.centered`，避免错误页和其他消费者出现全视口行为变化。
- 不为 `robots.txt` 增加后端路由、Nginx 特例或索引管理系统。
- 不为 meta description、`llms.txt`、source map 或旧报告的低收益阻塞提示增加运行时机制。

## 回滚

- Nginx：恢复上一个 PartSignal 站点和项目 snippet，`nginx -t` 后 reload；不涉及应用数据。长期 HSTS 一旦被客户端接收不能即时撤销，部署时必须先用短 `max-age` 验证，属于部署阶段门禁，本轮不执行。
- 前端：恢复 `ProtectedRoute`、`.auth-boot`、性能测量和对应测试即可；不涉及服务端状态或契约。
- P1 前端：恢复 `App.tsx` 的静态导入、`AppLayout.tsx` 的 CSS import 和 CSS 文件迁移即可；删除 public 资产可回滚 robots 行为。所有变更均为静态资源与加载边界，不涉及数据迁移。
- P2：移除 `frontend/index.html` 的单条 meta robots 即可回滚；其余项目没有实现代码，无需回滚。部署后索引变化由外部 crawler 自己收敛，不能由应用即时保证。
