# PageSpeed 与全域整改完成度审计

## 审计口径

- 权威报告：desktop `ibm9s8ga5b`，Lighthouse 13.4.0。
- 日期：2026-07-28（Asia/Shanghai）。
- `Local Closed` 只表示代码、测试或人工本地证据完整，不替代部署后的 PageSpeed。
- `Open` 项均保留在任务验收中，没有因不计分、收益低、内部系统或实验性审核跳过。

## P0：安全与全域 HTTPS

| 项目 | 当前证据 | 状态与关闭条件 |
| --- | --- | --- |
| CSP 兼容性 | 主题脚本外置；HTML 零内联；`script-src 'self'`，无 `unsafe-inline`、`unsafe-eval` 或旧 hash；安全检查通过 | Local Closed；部署后 PageSpeed CSP audit 通过才最终关闭 |
| Trusted Types | 共享 `marked → DOMPurify` 边界；六处 React sink；三份依赖 `textContent` 补丁；Chromium enforcing 与 Firefox/WebKit 清洗测试通过 | Local Closed；生产 report-only 全路由零违规后切 enforcing，PageSpeed audit 通过 |
| DOM sink 所有权 | 安全脚本遍历 `frontend/src`，拒绝直接 HTML DOM API、未登记或变量来源漂移的 `dangerouslySetInnerHTML` | Local Closed |
| 域名控制权 | Cloudflare credentialed GET、权威 NS、RDAP 和两机配置只读证据已完成 | Open：需授权临时 TXT 写/删证明、脱敏注册商证据和受控 BIND export |
| DNS/内部清单 | 14 条 Zone、8 个公开 A、DMIT/Hostdzire、证书和已见配置名已有脱敏清单 | Open：需 Aaitr/internal resolver/hosts 只读授权；`relay/mux/probe` 用户决定 |
| 根域与全部保留名称 HTTPS | 根域无 Web DNS；`relay` 误落 API；`brutal` HTTP 失败；其余当前矩阵已记录 | Open：需 DNS/Nginx/部署授权，逐名证书、同主机升级、业务探测和 default catchall 通过 |
| HSTS `includeSubDomains` | 当前仅 geo/vault 有一年 HSTS 且无 `includeSubDomains` | Open：全域 HTTPS 后依次完成 300s、7d、30d、一年及完整观察期 |
| preload | 官方风险、全子域约束和 6–12 周或更久移除限制已记录 | Open：观察期完成后再次取得不可逆确认，提交并最终验证 `preloaded` |

## P1：性能

| 报告项 | 当前处理与证据 | 状态与关闭条件 |
| --- | --- | --- |
| 未使用 JavaScript 137,660B | 入口 raw/gzip 从 852/276.38KiB 降至 628.64/207.94KiB；本地估算 114,163B | Open：仍高于本地 AC1 100KiB；部署后同口径 PageSpeed ≤100KiB 且下降≥25% |
| 未使用 CSS 17,320B | 匿名入口移除不必要 Ant 注入；本地 CSS-in-JS 源码浪费 166,674B，不与 PSI 压缩口径混用 | Open：部署后 PageSpeed ≤12KiB 且下降≥25% |
| 110ms 入口任务 | 旧报告只有入口 URL，无 map/调用栈；当前入口移除全局 AntApp，五样本不再出现同等任务 | Open：新 PageSpeed map/trace 证明消失或给出函数级 after |
| 90ms 入口任务 | 登录主题 `Segmented` 改原生 radio，受保护控件留在懒 chunk；当前不再出现 | Open：同上 |
| 75ms 入口任务 | 登录纯展示 Ant 组件退出匿名入口，认证 Form/Input/Button 保留；当前不再出现 | Open：同上 |
| 61ms 入口任务 | 初始 transfer 减少 64,158B；残余 63–64ms LoAF 为 `scripts=[]` 渲染阶段 | Open：同上 |
| 181ms Unattributable | 五次 blank、五次静态页和五次应用冷启动均未复现 | Open：新 PageSpeed 复测；若仍存在继续 trace，未经用户决定不关闭 |
| 网络依赖链 | 初始仅主题脚本、入口 CSS、入口 JS、一次 `/auth/me`；无工作台资源 | Local Closed；部署后 network dependency tree 不回退 |
| `/auth/me` | 每次恰好一次，认证启动画面两帧后才释放，不阻塞首个可见状态 | Local Closed；线上保持一次 |
| LCP 渲染延迟 | LCP 仍为安全说明，不隐藏；本地限速 FCP/LCP 最大 1.376/1.504s | Open：PageSpeed FCP/LCP≤0.8s、SI≤1.2s、Performance≥99 |
| 入口 CSS | 3,078B transfer，单个外部同源文件，无内联 CSP 放宽 | Local Closed；线上≤4KiB且无 FOUC |
| DOM | 119 节点、深度17、最大子节点9，低于 128/18/9；CLS=0 | Local Closed；线上不回退 |
| cache lifetimes | Nginx 设计为 HTML 不长缓存、哈希资产 immutable | Open：部署响应头与 PageSpeed audit |
| CLS culprits | 本地五样本 CLS=0 | Open：PageSpeed 对应 audit 继续通过 |
| document latency | 本地 preview 不是生产 TTFB | Open：线上最终 URL 无额外重定向、TTFB≤200ms、audit 通过 |
| duplicated JavaScript | Vite 路由边界和构建产物已检查 | Open：PageSpeed audit 继续通过 |
| font display | 无远程字体 | Open：PageSpeed audit 继续通过 |
| forced reflow | LoAF 没有脚本归因，未用模糊优化掩盖 | Open：PageSpeed audit 继续通过 |
| image delivery | 登录首屏无内容图片 | Open：PageSpeed audit 继续通过 |
| legacy JavaScript | 使用当前 Vite 构建，不新增 legacy bundle | Open：PageSpeed audit 继续通过 |
| third parties | 匿名初始链无第三方 | Open：PageSpeed audit 继续通过 |
| viewport | viewport meta、多视口、200% zoom 已检查 | Open：PageSpeed audit 继续通过 |
| minification | Vite production minification 通过 | Open：PageSpeed audit 继续通过 |
| total weight | 初始 212,518B，低于 275KiB | Local Closed；PageSpeed audit 继续通过 |
| bootup/main-thread/max potential FID | 最长任务64ms、TBT中位0ms/最大14ms；页面脚本 task 目标仍由 PSI 判断 | Open：PageSpeed audits 通过且页面自有任务≤50ms |
| unsized images | 登录首屏无内容图片；已有图像尺寸规则不变 | Open：PageSpeed audit 继续通过 |

## P2：兼容性、SEO、Agentic 与人工检查

| 项目 | 当前证据 | 状态与关闭条件 |
| --- | --- | --- |
| `scrollend` | 仅 React DOM 依赖含支持代码，项目无消费者；三浏览器原生滚动通过 | Local Closed |
| 项目 `:has()` | `frontend/src` 为零；header、Modal、打印均由显式类拥有 | Local Closed |
| Ant `:has()` | 13 个依赖样式文件；不 patch node_modules，项目边界提供关键焦点 fallback | Local Closed；新 PageSpeed 记录依赖来源与 fallback |
| `text-wrap: balance` | Ant Form 来源；375px 超长中英文 label 在三浏览器多行且不溢出 | Local Closed |
| `backdrop-filter` | 常规三浏览器通过；Firefox 原生关闭特性后 fallback 1/1 通过 | Local Closed |
| `mask-image` | 纯装饰采用默认隐藏、支持时显示的 fallback-first | Local Closed |
| production source map | 当前未启用 | Open：需公开面授权；完整 `sourcesContent`、秘密扫描、匿名抓取和 PageSpeed valid-source-maps 通过 |
| noindex | 当前仍为 `noindex,nofollow` | Open：需授权改变内部系统索引契约，部署后 crawlable audit 通过 |
| robots | 当前仍为 `Disallow: /` | Open：需同一授权改为 `Allow: /` 并更新现有回归测试 |
| meta description | 当前不存在 | Open：需同一授权发布已设计文案，SEO=100 |
| `llms.txt` | 当前不存在 | Open：需同一授权发布最小 H1、根/登录链接，Agentic=3/3 |
| 10 项 accessibility manual | 每项有人、日期、环境、步骤和证据；3 个实际缺陷已修复并回归 | Local Closed；部署后 Accessibility=100 才完成 AC5 |
| structured data manual | 源码、渲染 DOM、Schema.org Validator 均为0实体；Rich Results 匿名入口要求登录已如实记录 | Local Closed：0实体、0无效实体，不伪造 JSON-LD |
| 旧 README 约束 | 仍保留“不维护 description/llms/map” | Open：授权实施公开项时同步改写，当前保留避免提前改变契约 |

## 当前质量门禁

- `npm test`：24 个 Vitest 文件、142 项通过；Node 视觉与主题启动契约 19 项通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过；入口 `628.64 KiB raw / 207.94 KiB gzip`。
- `node deploy/scripts/check-nginx-security.mjs`：通过。
- Chromium/Firefox/WebKit compatibility：各 3/3；Firefox 禁用 backdrop：1/1。
- 五样本生产 preview 性能：最长任务 64ms、TBT 中位/最大 0/14ms、CLS 0、
  FCP/LCP 最大 1.376/1.504s、初始传输 212,518B。
- `git diff --check`：通过。

## 下一关闭顺序

1. 取得公开索引、`llms.txt`、source map、部署、DNS/TLS/TXT 和域名用途集中授权。
2. 完成获授权代码与文档更新并重跑全量门禁。
3. 部署 P0/P1/P2，执行 production TT report-only、响应头、浏览器和三次
   PageSpeed desktop 复测；逐 audit id 更新本矩阵。
4. 完成全域 HTTPS 后按完整 max-age 观察 HSTS 阶段。
5. 最终 preload 前再次取得不可逆确认；达到 `preloaded` 才关闭目标。
