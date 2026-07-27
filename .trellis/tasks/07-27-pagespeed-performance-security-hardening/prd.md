# PageSpeed 性能与安全加固

## Goal

依据 2026-07-27 PageSpeed 桌面端报告，分阶段降低认证首屏布局偏移和主线程负担，补齐公网安全响应头并修复爬虫路径。本轮实现授权严格限于 P0：

1. 修复 Nginx `add_header` 继承导致公网 HTML、JS 和 CSS 丢失安全响应头的问题。
2. 消除未登录访问 `/` 时认证加载态切换到登录页造成的显著 CLS。

P1 的首包分包、动画和 `robots.txt`，以及 P2 的索引策略、`llms.txt`、source map 和低收益渲染阻塞项均保留在后续阶段，本轮不得顺手实现。

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
- P0 完成后执行独立 Trellis check；所有高、中严重级问题必须解决。

## Acceptance Criteria

- [x] AC1：渲染后的 staging/production Nginx 配置通过 `nginx -t`，`/`、`/index.html`、`/assets/*` 在本地验证环境中同时含缓存头和项目安全头。
- [x] AC2：CSP 的 `script-src` 包含与当前内联主题脚本完全匹配的 SHA-256；自动检查在脚本或头部单边变化时失败。
- [x] AC3：匿名 `/` 冷启动真实经过 `/api/v1/auth/me` 204 并进入 `/login`，布局偏移采样 CLS `< 0.1`，认证与主题无控制台错误。
- [x] AC4：定向前端测试、typecheck、lint、production build、部署脚本自检和本地性能验证通过。
- [x] AC5：未修改后端、OpenAPI、数据库、权限、业务状态、P1/P2 功能或既存用户文件。
- [x] AC6：文档明确记录安全头权威、Nginx 1.29.3+ 版本前提、CSP 哈希维护、验证和回滚边界。

## Out of Scope

- P1：登录首包 JS/CSS 分包、SVG 动画、`robots.txt`。
- P2：meta/noindex、`llms.txt`、source map、80ms CSS 阻塞项。
- 后端、公共 API、数据库、部署执行、Git 提交和推送。
- CSP nonce/sub_filter、HSTS preload、父域策略、Service Worker、新依赖或第二套安全头系统。
