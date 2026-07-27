# PageSpeed 性能与安全加固

## Goal

依据 2026-07-27 PageSpeed 桌面端报告，分阶段降低认证首屏布局偏移和主线程负担，补齐公网安全响应头并修复爬虫路径。P0 已完成并提交，P1 已完成验证但尚未提交；本轮进入 P2 收益审查：

1. 为内部 SPA 明确 `noindex, nofollow` HTML 索引意图。
2. 仅在具备明确业务收益时增加 meta description、`llms.txt` 或生产 source map。
3. 复核 PageSpeed 报告中的约 `80ms` 渲染阻塞项；P1 已消除大部分初始 CSS 后，不为追逐审计提示增加无收益复杂度。

P0/P1 的安全头、认证、登录、资源分包、静态动画和 `robots.txt` 契约必须保持。P2 不以提高公开 SEO 或 Lighthouse 单项通过率为目标。

## Background

- PageSpeed 桌面端基线为 Performance 81、CLS `0.224`、TBT `230ms`。`layout-shifts` 明确记录两个 `body` shift，合计 `0.2240526165`。
- `/` 的真实启动链为 `App` → `AuthProvider` 请求 `/api/v1/auth/me` → `ProtectedRoute` 渲染 Skeleton → 204 后重定向 `/login`。
- `ProtectedRoute` 当前复用 `.centered`：`margin: 16vh auto` 且没有全视口占位；登录页使用另一套 `min-height: 100dvh` Grid。
- Hostdzire 实际运行 Nginx 1.29.8。站点 server include 的共享安全 snippet 只定义 `X-Content-Type-Options`、`X-Frame-Options` 和 `Referrer-Policy`；`/assets/` 与 `/` 自己声明 `add_header Cache-Control`，因此不继承 server 级头。
- 线上 `/`、`/index.html` 和当前 JS 均缺少上述旧头及 CSP、HSTS、COOP；没有本地 `add_header` 的 API location 仍返回旧三项头，证明继承根因成立。

## Requirements

### R1. P0 安全响应头

- PartSignal 的公网安全头必须由仓库内项目专属 Nginx 配置唯一持有，不再依赖未纳入仓库且会影响其他站点的共享 snippet。
- 使用宿主机已确认支持的 `add_header_inherit merge`，让 location 的 Cache-Control 与 server 级安全头同时存在；不得在每个 location 复制整套安全头。
- 最终强制响应头至少包括：
  - `Content-Security-Policy`：限制脚本为同源和经过校验的内联主题脚本哈希；禁止 object、base 和 frame ancestor。
  - `Strict-Transport-Security: max-age=31536000`，不使用 `includeSubDomains` 或 preload。
  - `Cross-Origin-Opener-Policy: same-origin`。
  - `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`。
- CSP 必须兼容 `frontend/index.html` 的内联主题启动脚本。哈希从脚本准确字节计算，并由自动检查防止配置漂移；不得改用 `script-src 'unsafe-inline'` 或猜测性宽松 fallback。
- `style-src 'unsafe-inline'` 仅用于现有 Ant Design CSS-in-JS；`connect-src` 与 `img-src` 必须保留服务端签发的 HTTPS 对象存储上传和图片 URL。

### R2. P0 认证启动 CLS

- `AuthProvider`、`/api/v1/auth/me` 204 语义、认证错误和登录重定向行为保持不变。
- 认证加载态使用专属全视口布局所有者，不修改共享 `.centered` 错误态，也不显示登录表单或猜测认证结果。
- 未登录访问 `/` 的本地生产性能验证 CLS 必须 `< 0.1`；目标值为 `≤ 0.01`。
- 验证必须从导航前注册 `PerformanceObserver`，覆盖真实加载态到 `/login` 的完整切换，不能在登录页稳定后才开始采样。

### R3. 验证与交付边界

- 完成定向 Vitest、Playwright、typecheck、lint、production build、Nginx 配置检查、项目安全头/哈希检查和本地生产性能验证。
- 不部署、不推送、不创建分支。提交前展示 commit plan 并等待用户确认。
- 保留所有既存未跟踪 `.playwright-cli/page-*.yml`，不得纳入实现或提交。
- P1 完成后执行独立 Trellis check；所有高、中严重级问题必须解决。

### R4. P1 登录首包 JS/CSS

- 未登录 `/` 的入口不得静态加载 `AppLayout`、改密页或工作台专属 CSS；认证数据流和登录行为保持不变。
- 复用现有 `React.lazy`、`Suspense` 和 Vite CSS code splitting，不增加依赖、手工 vendor 分组、预加载框架或通用加载抽象。
- `global.css` 只保留所有路由都需要的基础、认证和登录样式；工作台样式由已认证的 `AppLayout` 动态边界加载。
- 本地生产构建和同口径 Chromium 冷启动中，匿名登录首屏 JS/CSS 传输量与未使用源码字节必须低于本轮修改前基线；不得以提高 CLS、TBT 或破坏登录换取体积下降。

### R5. P1 登录 SVG 动画

- 六条装饰路径保留静态虚线视觉，但不得继续执行 `stroke-dashoffset` 动画。
- 删除不再使用的 `login-flow` keyframes 和方向覆盖；不得用 JavaScript、计时器或另一种非合成 SVG 属性动画替代。
- 普通动态偏好下六条路径的 computed `animation-name` 必须为 `none`；既有 reduced-motion 契约保持。

### R6. P1 robots.txt

- `frontend/public/robots.txt` 是抓取策略唯一来源，内容为 `User-agent: *` 与 `Disallow: /`，符合内部系统默认不公开索引的定位。
- Vite 构建必须将该文件原样复制到 `dist/robots.txt`；本地生产预览返回 `200`、`text/plain` 且正文不得包含 SPA HTML。
- 不为一个静态文件增加 Nginx exact location；现有 `try_files $uri` 已是权威静态服务边界。

### R7. P2 内部系统索引策略

- `frontend/index.html` 必须声明 `<meta name="robots" content="noindex, nofollow" />`，明确所有 SPA HTML 路由不应被公开索引或继续跟踪链接。
- `frontend/public/robots.txt` 继续使用 `Disallow: /` 阻止抓取；meta robots 是对实际获取 HTML 的 crawler 的页面级补充，不是认证或保密机制，也不替代服务端权限。
- 不增加 meta description：系统没有公开搜索获客目标，描述只服务搜索结果摘要，和 `noindex` 目标冲突。
- 不增加 `llms.txt`：系统没有对外公开的模型训练、文档发现或能力目录契约；Google Search 明确不使用该文件，添加它只会增加维护源和内部能力暴露面。
- 不为 `/llms.txt` 增加静态占位文件、后端路由或 Nginx 特例。该 URL 不属于产品契约，允许它继续遵循现有 SPA fallback；接受 Lighthouse 对这一非标准文件继续提示失败。

### R8. P2 source map

- 生产构建继续使用 Vite 默认 `build.sourcemap: false`，构建产物不得包含 `.map` 文件或 `sourceMappingURL`。
- 当前没有错误监控或私有 source map 上传消费者，因此不得为通过 Lighthouse 诊断项公开发布源码映射。
- 将来只有在接入明确的错误监控流程后，才能独立设计 hidden/private source map 的生成、上传和产物排除；不得直接把 `.map` 放进 Nginx 可公开服务的 `dist`。

### R9. P2 约 80ms 渲染阻塞项

- 原 PageSpeed 桌面报告的唯一阻塞资源是 `22422 B` CSS，审计估算持续 `86ms`、节省约 `80ms`；这不是业务运行时契约。
- P1 后匿名入口 CSS 已降至 `10418 B` 原始、约 `2.69 KiB` gzip / `2991 B` 本地传输，且没有外部字体或 CSS 依赖。P2 不内联 critical CSS、不异步加载首屏 CSS、不增加 preload/manual chunks。
- 最小验证必须确认生产入口仍只有一个小型首屏 stylesheet、工作台 CSS 仍按需加载，且匿名冷启动 CLS `< 0.1`、长任务和 TBT 不高于 P1 基线。

## Acceptance Criteria

- [x] AC1：渲染后的 staging/production Nginx 配置通过 `nginx -t`，`/`、`/index.html`、`/assets/*` 在本地验证环境中同时含缓存头和项目安全头。
- [x] AC2：CSP 的 `script-src` 包含与当前内联主题脚本完全匹配的 SHA-256；自动检查在脚本或头部单边变化时失败。
- [x] AC3：匿名 `/` 冷启动真实经过 `/api/v1/auth/me` 204 并进入 `/login`，布局偏移采样 CLS `< 0.1`，认证与主题无控制台错误。
- [x] AC4：定向前端测试、typecheck、lint、production build、部署脚本自检和本地性能验证通过。
- [x] AC5：未修改后端、OpenAPI、数据库、权限、业务状态、P1/P2 功能或既存用户文件。
- [x] AC6：文档明确记录安全头权威、Nginx 1.29.3+ 版本前提、CSP 哈希维护、验证和回滚边界。
- [x] AC7：匿名登录首屏不请求工作台 JS/CSS，初始 JS/CSS 传输量和未使用源码字节均低于 P1 本地基线。
- [x] AC8：登录、认证 204 重定向和改密路由行为不变；相关 Vitest、Playwright、typecheck、lint 和生产构建通过。
- [x] AC9：六条 `.login-flow-lines path` 的 computed `animation-name` 为 `none`，构建 CSS 不再包含 `stroke-dashoffset` 或 `login-flow` keyframes。
- [x] AC10：生产预览 `/robots.txt` 返回 `200 text/plain` 和 `Disallow: /`，不含 `<html>`。
- [x] AC11：同口径匿名冷启动 CLS `< 0.1`，目标 `≤ 0.01`；TBT 和长任务数不得高于 P1 本地基线。
- [x] AC12：未修改后端、OpenAPI、数据库、权限、安全头、P2 功能或既存用户文件，且未部署、推送或创建分支。
- [x] AC13：源码和生产构建的 HTML 均包含唯一的 `meta[name="robots"]`，值为 `noindex, nofollow`；登录和认证行为不变。
- [x] AC14：生产 HTML 没有 meta description，构建产物没有 `llms.txt`、`.map` 或 `sourceMappingURL`；每个不实施项都有证据和收益判断。
- [x] AC15：生产入口仍只引用一个小于 `4 KiB` gzip 的初始 CSS；工作台 CSS 不进入匿名入口，匿名冷启动 CLS `< 0.1`，长任务和 TBT 不高于 P1 基线。
- [x] AC16：完成定向 Playwright、production build、生产性能检查和 `git diff --check`；未修改后端、契约、数据库或 Nginx，未部署、推送或未经确认提交。

## Out of Scope

- 公开 SEO、搜索摘要优化、`llms.txt`、公开或私有 source map 基础设施、critical CSS、异步首屏 CSS、手工 chunk/preload。
- `/llms.txt` exact 404、额外 Nginx 爬虫 location、Search Console 移除或部署后索引运营。
- 后端、公共 API、数据库、部署执行、Git 提交和推送。
- CSP nonce/sub_filter、HSTS preload、父域策略、Service Worker、新依赖或第二套安全头系统。
