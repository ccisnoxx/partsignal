# PageSpeed 与全域整改完成度审计

## 审计口径

- 权威报告：desktop `ibm9s8ga5b`，Lighthouse 13.4.0。
- 日期：2026-07-28（Asia/Shanghai）。
- `Local Closed` 只表示代码、测试或人工本地证据完整，不替代部署后的 PageSpeed。
- 父任务 AC1 不把任何 `Local Closed` 计作最终关闭；只有对应线上响应、
  浏览器/PageSpeed 和授权证据满足关闭条件后才转为 `Closed`。
- `Open` 项均保留在任务验收中，没有因不计分、收益低、内部系统或实验性审核跳过。

## P0：安全与全域 HTTPS

| 项目 | 当前证据 | 状态与关闭条件 |
| --- | --- | --- |
| CSP 兼容性 | 主题脚本外置；HTML 零内联；`script-src 'self'`，无 `unsafe-inline`、`unsafe-eval` 或旧 hash；安全检查通过 | Local Closed；部署后 PageSpeed CSP audit 通过才最终关闭 |
| Trusted Types | 共享 `marked → DOMPurify` 边界；六处 React sink；三份依赖 `textContent` 补丁；三浏览器在生产构建 preview 注入权威完整 CSP 后各 2 项通过，不冒充 Nginx 实发响应 | Local Closed；生产实际响应头、report-only 全路由零违规后切 enforcing，PageSpeed audit 通过 |
| DOM sink 所有权 | TypeScript AST 遍历 `frontend/src`（排除测试）与 `frontend/public`，拒绝直接 HTML DOM API、未登记 sink、已知常量/方法别名或重赋值漂移；负向自检通过，任意动态路径留给 TT 运行时门禁 | Local Closed |
| 域名控制权 | Cloudflare credentialed GET、权威 NS、公开 RDAP、14 条脱敏 Zone、随机 TXT 四端可见→精确删除→API absence→四端 NXDOMAIN，以及 16 条解析记录的 BIND 原文受控落盘已完成 | Closed：技术读写控制已证明；注册商登录/自动续费/nameserver 恢复能力未独立验证，作为运维残余风险，不是 Lighthouse/HSTS/preload 硬门槛 |
| DNS/内部清单 | DMIT、Hostdzire、Aaitr 与当前工作站已盘点；工作站私网 DNS 合成短 TTL A 但未暴露隐藏 Web；`mux` 已证实曾有真实 VLESS/Reality + multiplex 长连接；Aaitr `18443` 与旧 `probe:443` 不一致；用户确认二者退役 | Open：其他 resolver 未盘点；获线上配置授权后删除 Hostdzire `mux` 活动别名和 DMIT `probe` map，保留历史，并验证双权威/双公共 NXDOMAIN、活动配置零引用和未知 SNI fail-closed |
| 根域与全部保留名称 HTTPS | 根域无 Web DNS；`relay` 误落 API；`brutal` HTTP 失败；精确 DNS/Nginx 提案与独立回滚已记录 | Open：需用户授权应用发布、Hostdzire reload 和 DNS；随后逐名证书、同主机升级、业务探针和 default catchall 全通过 |
| HSTS `includeSubDomains` | 当前仅 geo/vault 有一年 HSTS 且无 `includeSubDomains` | Open：全域 HTTPS 后依次完成 300s、7d、30d、一年及完整观察期 |
| preload | 官方风险、全子域约束和 6–12 周或更久移除限制已记录 | Open：观察期完成后再次取得不可逆确认，提交并最终验证 `preloaded` |

## P1：性能

| 报告项 | 当前处理与证据 | 状态与关闭条件 |
| --- | --- | --- |
| 未使用 JavaScript 137,660B | 入口 raw/gzip 从 852/276.38KiB 降至 628.69/207.99KiB；本地估算 114,187B | Open：仍高于本地 AC1 100KiB；部署后同口径 PageSpeed ≤100KiB 且下降≥25% |
| 未使用 CSS 17,320B | 匿名入口移除不必要 Ant 注入；本地 CSS-in-JS 源码浪费 166,674B，不与 PSI 压缩口径混用 | Open：部署后 PageSpeed ≤12KiB 且下降≥25% |
| 110ms 入口任务 | 旧报告只有入口 URL，无 map/调用栈；当前入口移除全局 AntApp，五样本不再出现同等任务 | Open：新 PageSpeed map/trace 证明消失或给出函数级 after |
| 90ms 入口任务 | 登录主题 `Segmented` 改原生 radio，受保护控件留在懒 chunk；当前不再出现 | Open：同上 |
| 75ms 入口任务 | 登录纯展示 Ant 组件退出匿名入口，认证 Form/Input/Button 保留；当前不再出现 | Open：同上 |
| 61ms 入口任务 | 初始 transfer 减少 64,111B；正式样本无 Long Task，残余最大 153.3ms LoAF 为 `blockingDuration=0`、`scripts=[]` 渲染阶段 | Open：同上 |
| 181ms Unattributable | 五次 blank、五次静态页和五次应用冷启动均未复现 | Open：新 PageSpeed 复测；若仍存在继续 trace，未经用户决定不关闭 |
| 网络依赖链 | 初始仅主题脚本、入口 CSS、入口 JS、一次 `/auth/me`；无工作台资源 | Local Closed；部署后 network dependency tree 不回退 |
| `/auth/me` | 每次恰好一次，认证启动画面两帧后才释放，不阻塞首个可见状态 | Local Closed；线上保持一次 |
| LCP 渲染延迟 | LCP 仍为安全说明，不隐藏；本地限速五样本 FCP/LCP 最大 1.368/1.492s | Open：PageSpeed FCP/LCP≤0.8s、SI≤1.2s、Performance≥99 |
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
| total weight | 初始 212,565B，低于 275KiB | Local Closed；PageSpeed audit 继续通过 |
| bootup/main-thread/max potential FID | 正式五样本无 Long Task、TBT中位/最大均0ms；残余 LoAF 无脚本且 blockingDuration=0 | Open：PageSpeed audits 通过且页面自有任务≤50ms |
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
| production source map | `build.sourcemap:true`；72 maps、1281 sources 与 sourcesContent 完整，秘密/凭据/路径门禁与 Nginx JSON 头测试通过 | Local Closed；部署后匿名抓取和 PageSpeed valid-source-maps 通过才最终关闭 |
| noindex | 已按授权改为 `index,follow`，匿名浏览器回归通过 | Local Closed；部署后 crawlable audit 通过 |
| robots | 已按授权改为 `Allow: /`，静态资产 200 且不回退 SPA | Local Closed；部署后实际响应和 audit 通过 |
| meta description | 已发布准确且不暴露私有事实的静态文案 | Local Closed；部署后 SEO=100 |
| `llms.txt` | 最小 H1、授权说明和根/登录两个公开链接；API/权限/内部信息负面门禁通过 | Local Closed；部署后 200、有效链接和 Agentic=3/3 |
| 10 项 accessibility manual | 每项有人、日期、环境、步骤和证据；3 个实际缺陷已修复并回归 | Local Closed；部署后 Accessibility=100 才完成 AC5 |
| structured data manual | 源码、渲染 DOM、Schema.org Validator 均为0实体；Rich Results 匿名入口要求登录已如实记录 | Local Closed：0实体、0无效实体，不伪造 JSON-LD |
| 旧 README 约束 | 已同步为公开发现、完整 source map 与认证/权限边界 | Local Closed |

## 当前质量门禁

- `npm test`：24 个 Vitest 文件、142 项通过；Node 视觉与主题启动契约 19 项通过。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过；入口 `628.69 KiB raw / 207.99 KiB gzip`。
- `node deploy/scripts/check-nginx-security.mjs`：通过。
- Chromium/Firefox/WebKit compatibility：各 3/3；Firefox 禁用 backdrop：1/1。
- 五样本生产 preview 性能：Long Task 为 0、TBT 中位/最大 0/0ms、CLS 0，
  FCP/LCP 最大 1.368/1.492s、初始传输 212,565B；coverage 样本的残余最大
  LoAF 153.3ms 为 `blockingDuration=0`、`scripts=[]`。
- `git diff --check`：通过。

## 下一关闭顺序

1. 补齐其他内部 resolver 清单；获线上配置授权后完成 `mux/probe` 活动引用
   退役。注册商截图不再作为技术硬门槛，BIND 原文已受控落盘。
2. 用户审阅精确生产提案后，授权应用发布、Hostdzire reload 和根域/`relay`
   DNS；完成获授权发布并重跑全量门禁。
3. 部署 P0/P1/P2 后，执行 production TT report-only、响应头、浏览器和三次
   PageSpeed desktop 复测；逐 audit id 更新本矩阵。
4. 完成全域 HTTPS 后按完整 max-age 观察 HSTS 阶段。
5. 最终 preload 前再次取得不可逆确认；达到 `preloaded` 才关闭目标。
