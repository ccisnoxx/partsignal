# P2 规划取证

## PageSpeed 原始审计

- 报告：`https://pagespeed.web.dev/analysis/https-geo-962850-xyz/w9w0p3qogw?form_factor=desktop`
- desktop `render-blocking-insight` 只有旧 CSS `https://geo.962850.xyz/assets/index-BDHQES6F.css`：传输 `22422 B`、持续 `86ms`、估算节省 `80ms`。
- `meta-description`、`llms-txt` 和 `valid-source-maps` 均失败；后两项不计入对应分数权重，source map 提示只改善开发调试，不减少终端下载或执行成本。
- `robots-txt` 的 38 个错误来自 `/robots.txt` 返回整份 SPA HTML，已由 P1 静态资产修复但尚未部署。

## 当前仓库与构建边界

- `frontend/index.html` 没有 description 或 robots meta；所有 SPA 路由共享该入口。
- `frontend/vite.config.ts` 没有 `build.sourcemap`，Vite 默认值为 `false`。仓库没有 Sentry、错误监控或 source map 上传脚本；当前 `dist` 没有 `.map` 或 `sourceMappingURL`。
- Docker 会把完整 `dist` 复制进静态 Nginx；Nginx `try_files` 会公开服务任何真实 `.map`，因此直接开启 source map 会扩大源码和内部模块结构暴露面。
- 仓库没有 `llms.txt`。缺失路径按现有 SPA fallback 返回 `index.html`；为该非产品 URL 新增 exact 404 需要同步容器、production 和 staging 三个服务边界，没有业务收益。
- P1 当前构建的匿名入口 CSS 为 `10418 B` 原始、约 `2.69 KiB` gzip，本地浏览器传输 `2991 B`；相比报告旧 CSS 传输下降约 `86.7%`。没有 `@font-face`、CSS `@import` 或外部字体请求。

## 线上只读复核

2026-07-27 20:55 CST 读取 `https://geo.962850.xyz`：

- `/`：`200 text/html`、`1587 B`，只有标题，没有 description/robots meta。
- `/robots.txt`：`200 text/html`、`1587 B`，仍是旧 SPA fallback。
- `/llms.txt`：`200 text/html`、`1587 B`，同一 SPA fallback。

P1/P2 均未部署；线上状态不能用于证明本地修改已生效。

## 权威外部语义

- [Google Search Central](https://developers.google.com/search/docs/crawling-indexing/robots/intro) 说明：`robots.txt` 阻止抓取但不保证 URL 不进入索引；`noindex` 必须由 crawler 实际读取 HTML meta 或响应头。登录和权限才是保护私有内容的边界。
- [Google Search Central 的生成式 AI 指南](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) 说明 Google Search 不使用 `llms.txt`，创建该文件不会改善 Google Search 或生成式搜索可见性。
- [Vite 官方构建配置](https://vite.dev/config/build-options#build-sourcemap) 说明 `build.sourcemap` 默认 `false`；`true`/`hidden` 都会生成独立 map，`hidden` 只是不在 bundle 中写引用注释，并不会自动阻止 map 被发布。

## P2 决策

| 项目 | 结论 |
|---|---|
| meta robots | 实施一行 `noindex, nofollow`，明确共享 SPA HTML 的内部索引意图。 |
| meta description | 不实施；内部系统没有搜索摘要收益，与 `noindex` 目标冲突。 |
| `llms.txt` | 不实施；没有公开能力目录/训练契约，Google Search 不使用，继续接受 Lighthouse 提示。 |
| source map | 不实施；没有私有消费者，公开发布增加暴露面且无终端性能收益。 |
| 约 `80ms` 阻塞项 | 不实施额外优化；P1 已把唯一 CSS 降至约 `2.69 KiB` gzip，critical/async CSS 的复杂度和闪烁风险大于剩余收益。 |

## 实施事实

- `frontend/index.html` 增加唯一的 `<meta name="robots" content="noindex, nofollow" />`；所有 SPA HTML 路由共享该索引意图。
- 现有主题 E2E 在匿名根路径断言 meta 唯一且值准确，没有新建测试框架或辅助层。
- `frontend/README.md` 记录抓取、索引与服务端访问控制的边界，以及不实施 meta description、`llms.txt`、source map、critical/async CSS、Nginx 特例、依赖和抽象的决定。
- P2 没有修改 Nginx、Vite 配置、CSS 加载方式、后端、API、数据库、依赖或部署文件。

## 本地验证结果

- 定向主题 E2E 首次因 `127.0.0.1:5173` 未启动而 8 项均报 `ERR_CONNECTION_REFUSED`，没有到达断言；使用现有 `npm run dev -- --host 127.0.0.1` 启动 Vite 后原命令重跑，8/8 通过。
- `npm run build` 通过。`dist/index.html` 包含唯一的 `<meta name="robots" content="noindex, nofollow">`，没有 meta description；构建产物没有 `llms.txt`、`.map` 或 `sourceMappingURL`。
- 生产入口只有一个 `index-*.css`，原始大小约 `10.42 kB`，实测 gzip `2713 B`，低于 `4 KiB`；工作台 CSS 继续是独立的 `AppLayout-*.css`。
- `PARTSIGNAL_PERF_SAMPLES=5 npm run perf:production` 通过。五个匿名样本的最大 CLS 为 `0`，Long Task 数为 `0`，TBT 为 `0ms`；初始 JS/CSS transfer 分别为 `277040 B` 和 `2991 B`，与 P1 结果一致。
- 生产性能脚本直接计算匿名 TBT，并对 Long Task 数、TBT 和受保护路由资源设置零回归门禁；不再只依赖结果人工解读。
- 源码与构建产物断言、`git diff --check` 均通过。P2 没有执行部署、推送或提交。

## Trellis check

- 独立检查发现 P2 产物命令缺少 meta description 负向断言，已补入并验证。
- 权威语义原先只写来源名称，已补充 Google Search Central 和 Vite 官方直链。
- P1 的动画产物正则会误报必须保留的 `.login-flow-*` 静态类，已收窄为只匹配 `stroke-dashoffset`、`@keyframes login-flow` 或对应 animation 声明。
- 生产性能脚本原先采集 Long Task 但未直接计算 TBT，也未门禁匿名加载工作台资源；已增加报告字段和零回归断言，五样本重跑通过。
- 最终没有未解决的高、中严重级问题。

## 规范同步判断

- P2 没有新增 API、数据、配置格式、组件模式或跨层契约，不需要新增 `.trellis/spec/` 规则。
- 长期可执行边界已经由 `frontend/index.html`、`frontend/public/robots.txt`、生产性能脚本和 E2E 持有；面向维护者的目的与不实施项写入 `frontend/README.md`。继续写入前端视觉规范会造成重复权威。

## 残余边界

- P2 尚未部署，不能据此声称公网 meta、`robots.txt` 或 PageSpeed 报告已变化；部署后仍需从公网复核。
- `robots.txt` 与 meta robots 依赖 crawler 遵循约定，不提供认证或保密能力；服务端权限仍是私有内容的唯一安全边界。
