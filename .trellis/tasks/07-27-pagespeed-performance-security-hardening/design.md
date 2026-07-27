# 设计：PageSpeed P0 安全响应头与认证启动稳定性

## 设计目标

在两个现有权威边界修复根因：

1. 公网 HTTP 安全策略由 PartSignal 自己的 Nginx snippet 持有，并通过 Nginx 原生继承合并覆盖所有 location。
2. 认证未决阶段由 `ProtectedRoute` 持有稳定的全视口几何，不改变认证数据流。

不为 P0 引入新依赖、运行时状态、兼容分支或第二套认证/部署机制。

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

## 不采用的方案

- 不在每个 Nginx location 复制六个安全头；这会产生多份权威。
- 不修改宿主机共享 snippet；它不在仓库且会影响其他站点。
- 不用 CSP `unsafe-inline`、动态 nonce、Nginx `sub_filter` 或运行时占位替换。
- 不删除 `/auth/me`、缓存未认证结论、预渲染登录表单或增加延时。
- 不修改共享 `.centered`，避免错误页和其他消费者出现全视口行为变化。

## 回滚

- Nginx：恢复上一个 PartSignal 站点和项目 snippet，`nginx -t` 后 reload；不涉及应用数据。长期 HSTS 一旦被客户端接收不能即时撤销，部署时必须先用短 `max-age` 验证，属于部署阶段门禁，本轮不执行。
- 前端：恢复 `ProtectedRoute`、`.auth-boot`、性能测量和对应测试即可；不涉及服务端状态或契约。
