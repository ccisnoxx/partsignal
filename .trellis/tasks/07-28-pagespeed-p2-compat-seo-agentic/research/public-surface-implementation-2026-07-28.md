# 公开发现与 production source map 实施证据

## 授权记录

- 日期：2026-07-28（Asia/Shanghai）。
- 用户在修改公开面前明确确认按推荐方案实施：`index,follow`、robots
  `Allow: /`、准确 meta description、只含 H1 和两个公开链接的最小
  `llms.txt`，以及可匿名访问、包含 `sourcesContent` 的完整 production
  source map。
- 确认时已说明：搜索和第三方缓存不能召回；source map 会提高客户端源码与业务
  流程可读性。认证与服务端权限继续是业务数据安全边界。

## 本地实施

- `frontend/index.html` 使用批准的 robots meta 和 description。
- `frontend/public/robots.txt` 允许抓取；`frontend/public/llms.txt` 只公开产品
  入口、登录入口和授权用户说明，不包含 API、权限模型、账号类型、内部主机、
  训练许可或私有文档。
- `frontend/vite.config.ts` 使用 `build.sourcemap: true`。构建命令显式选择该
  权威配置，避免本地残留的已忽略旧配置被 Vite 优先加载，并在构建后运行
  `scripts/check-production-assets.mjs`。
- 门禁检查 SEO/Agentic 静态资产、map JSON、`sources` 与
  `sourcesContent` 一一对应、编译资产的 `sourceMappingURL`，并扫描 `.env`
  路径、凭据特征、私钥、敏感 `VITE_*` 环境变量、本机构建路径和构建环境中的
  敏感变量值。发现问题时构建显式失败，不隐藏或裁剪 map。
- `frontend/nginx.conf` 为 `/assets/*.map` 设置 JSON Content-Type 和
  immutable 缓存；外层唯一安全头 snippet 统一提供
  `X-Content-Type-Options: nosniff`，避免容器和外层重复发送同一安全头；
  Node 回归测试同时锁定这两个配置所有权。

## 本地验证

2026-07-28 的本地结果：

```text
check-production-assets.test.mjs: 4 passed
scripts/*.test.mjs:               23 passed
theme.spec.ts / e2e --no-deps:    11 passed
TypeScript typecheck:             passed
ESLint + theme guard:             passed
Vite production build + gate:     passed
```

实际 `dist` 产物：

```text
JavaScript source maps:        72
sources:                     1281
sourcesContent:              1281
非字符串 sourcesContent:       0
缺失 sourceMappingURL:          0
```

`dist/index.html`、`dist/robots.txt` 和 `dist/llms.txt` 与批准文本一致。构建门禁
对当前全部公开文本资产和 map 扫描通过。

`theme.spec.ts` 自身 mock 认证边界，因此用 `--no-deps` 定向执行；普通
`--project=e2e` 首次被本地共享数据 setup 的登录依赖阻断，11 个目标用例未运行，
不把该 setup 结果冒充业务回归失败或成功。

## 尚未关闭的线上条件

- 本轮没有部署或访问生产写接口，因此不能声称公网 map/robots/llms 已返回
  预期 Content-Type、缓存头和 200。
- 没有重跑线上 Lighthouse/PageSpeed；SEO=100、Agentic=3/3、
  valid-source-maps 无警告和 Accessibility 保持 100 仍待部署后验证。
- source map 一旦公开可能被第三方长期缓存；回滚只能停止后续公开，不能召回副本。
