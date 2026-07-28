# 设计：P0 安全与全域 HTTPS

## CSP 外置主题启动

`frontend/public/theme-init.js` 保存现有主题启动逻辑，`index.html` 在 React
入口前以经典同源 `<script src="/theme-init.js"></script>` 同步执行。该文件设置
`data-theme-mode`、`data-theme`、`color-scheme`、背景色和 `theme-color`；
不依赖 React，也不吞掉无关错误。

它故意不使用 defer/async：首帧主题是安全且无闪烁的启动契约。文件单独
`no-cache`，其余哈希资产保持 immutable。安全头检查改为断言 HTML 无内联脚本、
外置文件存在且 `script-src 'self'`，不再计算哈希。

## Trusted Types 安全边界

新增一个共享 Markdown 渲染模块，拥有：

1. `marked.parse`；
2. DOMPurify 清洗；
3. 支持浏览器中 DOMPurify 内部的 `dompurify` Trusted Types policy；
4. 不支持浏览器中的相同 DOMPurify 字符串结果。

React 19 的 `dangerouslySetInnerHTML.__html` 类型已经接受 `TrustedHTML`。
六处调用只保留 `renderSanitizedMarkdown(markdown)`，不允许页面自建 policy。
不再套一层调用 DOMPurify 的自建策略：Chromium enforcing 会阻断该回调内部
DOMPurify 的解析 sink；由 DOMPurify 自己持有且不导出的策略直接返回清洗结果，
公开能力更小。

`deploy/scripts/check-nginx-security.mjs` 同时拥有静态 DOM sink 门禁：浏览器
生产源码（`frontend/src` 中排除测试，以及 `frontend/public`）不得直接调用
`innerHTML`、`outerHTML`、`srcdoc`、`insertAdjacentHTML`、
`document.write`、`DOMParser.parseFromString` 或
`createContextualFragment`；所有 React
`dangerouslySetInnerHTML` 的文件、数量和值变量必须与共享 Markdown 边界登记一致。
检查器使用项目已有 TypeScript AST，不依赖仅匹配固定格式的正则；负向自检覆盖
换行、sink 值重赋值、字面量/常量计算成员名、`document` 别名和危险方法别名。
新增或漂移 sink 会让安全检查显式失败。任意运行时动态计算仍由 Chromium
Trusted Types enforcing 和生产全路由 report-only 兜底，不把静态扫描冒充完整
JavaScript 符号执行。

Ant Design 的 CSS 字符串并非 HTML。选择 `textContent` 是原生、等价且最小的
修复；使用 `patch-package` 固化当前 `@rc-component/util`、`@ant-design/icons`
和开发态 cssinjs 探测补丁。补丁版本和文件不匹配时安装失败，避免升级后静默失效。

先用 report-only CSP 收集所有路由；确认零未处理 sink 后切换 enforcing。
生产回滚只能回到 report-only，不能创建宽松 default policy。

浏览器回归直接解析权威 Nginx snippet 中的完整生产 CSP，并把它注入生产构建
preview 的 document 响应，不用仅含 Trusted Types 指令的测试替代品。该用例证明
构建产物在此 enforcing 策略下可运行，不证明 preview 或外层 Nginx 已真实下发
响应头；真实响应只在部署后按响应头矩阵关闭。Vite 开发服务器会注入内联 React
Refresh preamble，完整生产 `script-src 'self'` 应当拒绝它，不能为通过开发态
测试而放宽 CSP。

## 域名台账

台账字段：FQDN、记录类型和值、Cloudflare proxy、公开/内部/保留、负责人、
业务用途、入口、TLS 终止点、证书 SAN、80、443、HSTS、日志、整改/退役结论。

证据来源：

- Cloudflare 完整 Zone、随机 TXT 写控制证明和公开 RDAP；
- DMIT/Hostdzire/Aaitr `nginx -T`、stream SNI、实际证书；
- acme.sh 列表和续期 hook，不读取密钥；
- 内部 resolver/VPN/mesh、`/etc/hosts`、访问和错误日志；
- 公共 DNS、CT 日志只用于交叉检查。

任何名称都不能因公共 NXDOMAIN 自动视为无影响；preload 同样约束内部和未来解析。

2026-07-28 的 credentialed Zone GET、权威 DNS、DMIT/Hostdzire 配置、证书与
响应矩阵保存在 `research/domain-inventory-2026-07-28.md`。该证据确认：

- Cloudflare Zone 为 `active/full`，14 条记录中有 8 个公开 Web A；
- `dmit` 是 80/443 四层入口，普通 Web TLS 在 `hostdzire` 终止；
- `relay` 是 Zone 中此前遗漏的现存 A，当前误落入 `api` 默认 vhost；
- `probe` 和 `mux` 是配置保留名而非当前公共记录；
- 该轮已审计的两台机器没有内部 Zone/hosts 记录；当时 Aaitr 和其他客户端
  resolver 尚未审计，不能据此宣布内部清单完成。

后续 Aaitr 只读盘点已确认该主机也没有本地域、hosts、443 或 TLS 证书；当前
只有非 TLS Shadowsocks `18443`。该主机与 DMIT 的旧 `probe:443` 目标不是
同一地址/协议路径，不能据此直接改端口。完整候选变更和回滚见
`research/domain-remediation-proposed-diff-2026-07-28.md`。

正式技术控制权证明分三层：

1. Zone-scoped credentialed GET 与完整 BIND export 确认读控制和全量记录；
2. 经授权创建随机临时 TXT，权威/公共双重验证后删除，确认本次写控制；
3. 公开 RDAP 记录注册商、到期日与 transfer lock，作为恢复风险背景。

完整原始 Zone 导出包含可能敏感的验证 TXT，只放受控运维存储；仓库只保存脱敏
派生台账、哈希和审计时间，不保存 token、账户 ID 或 TXT 内容。
注册商登录截图不属于 Lighthouse、HSTS 或 preload 的正式门禁；在上述读写控制
证据已完成的前提下不再要求。未独立验证的注册商登录、自动续费和 nameserver
恢复能力作为残余运维风险保留，不冒充已证明。

## 当前流量拓扑与权威配置

```text
Cloudflare DNS (unproxied A → 154.21.86.86)
  └─ DMIT /etc/nginx/nginx.conf
     ├─ :80 ──PROXY──> Hostdzire 10.0.0.2:80
     ├─ :443 default ─PROXY──> Hostdzire 10.0.0.2:443
     ├─ :443 probe ──> legacy probe target :443（当前 TLS 失败）
     └─ :443 brutal ──> sing-box Reality
                         └─ handshake ──> Hostdzire 10.0.0.2:8443
```

HSTS 只能由实际 TLS 终止响应发送。普通站点、根域、默认 TLS catchall 和
`brutal` fallback 的权威配置在 Hostdzire；DMIT stream 层只验证路由，不添加
HTTP header。

## HTTPS 与域级 HSTS 所有权

- 根域新增 DNS，Hostdzire 新增根域 vhost，共用现有覆盖根域的证书。
- `http://962850.xyz/*` 308 到相同 host HTTPS；根域 HTTPS 带 HSTS 后 308
  到 `https://geo.962850.xyz/`。
- `brutal` 增加 80 redirect vhost，并在实际 8443 TLS 终止处包含域级 HSTS。
- 用户已确认删除 `relay` A；Hostdzire 无对应 vhost 可删。删除前先增加 443
  default catchall，不允许缓存 DNS 或手工 Host 继续落入 `api`。
- 用户已确认退役 `mux`/`probe`。历史日志和白名单配置确认 `mux` 曾为
  multiplex-enabled VLESS/Reality，路径为共享 443/历史专用 30090 →
  `11089/11090` → Hostdzire `8443` handshake，并有真实长连接；这些证据解释
  退役风险，但不再构成恢复要求。最小关闭是保留历史日志/备份，删除 DMIT
  `probe` 活动映射和 Hostdzire 8443 的 `mux` 活动别名，不恢复 sing-box inbound、
  30090 或公共 DNS。
- 增加明确的 443 default catchall，使用有效证书后关闭未知 Host，避免未来误配
  名称静默落入首个业务 vhost；该防护不能替代逐名 HTTPS。
- 新增 host-only snippet，保持所有现有 TLS vhost 一年 HSTS；`geo` 和
  `vault` 的独立行替换为该 snippet，不降低现有强度。
- 根域单独引用 root snippet：准备阶段为 300 秒但不含
  `includeSubDomains`，后续只修改该一行完成阶段递增。它是域级继承策略的
  唯一事实源，不需要 Nginx `map` 或站点复制值。

## HSTS 阶段和回滚

0. 根域准备值 `max-age=300`，不含 `includeSubDomains`；现有子域保持一年。
1. `max-age=300; includeSubDomains`，等待 5 分钟。
2. `max-age=604800; includeSubDomains`，等待 7 天。
3. `max-age=2592000; includeSubDomains`，等待 30 天。
4. `max-age=31536000; includeSubDomains`，额外观察至少 30 天。
5. 经最终确认改为
   `max-age=63072000; includeSubDomains; preload` 并提交。

首阶段的进入条件不是“配置能通过”：完整 Zone、内部/嵌套名称、
`relay/mux/probe` 退役和所有保留名称 HTTPS 必须先关闭。每阶段从根域实际
响应生效时间起等待完整 `max-age`，期间监控 DNS、TLS、同主机跳转、HSTS、
证书到期/续期、Nginx/stream/Reality 错误和用户报告；任一新名称先完成 HTTPS
再发布 DNS。

进入下一阶段前，从两个外部网络和一个内部/VPN 环境验证：

- 权威 NS 与公共 resolver 记录一致；
- 所有 Web 名称 80 只同主机升级，443 证书链/主机名/到期均通过；
- 根域 443 的 308 自身带当前阶段 HSTS；
- `www` 和其他退役名仍为 NXDOMAIN；
- `hstspreload.org/api/v2/preloadable` 在最终阶段零 error/warning。

失败优先修复 HTTPS；preload 后移除需保持 HTTPS、去掉 preload 并提交 removal，
不能承诺即时撤销。官方当前明确说明 preload 不再普遍推荐，移除通常需
6–12 周到达多数 Chrome、其他浏览器可能更久；因此加入 `preload` 指令与正式
提交必须作为独立最终确认，不能与短期 HSTS 观察授权混同。

## 授权

- 本地 CSP/TT 代码和测试不扩大公开面，可以直接实施。
- 索引/source map 属 P2 授权。
- 用户已确认随机 TXT、Aaitr 只读、根域跳转、删除 `relay` DNS并退役
  `mux/probe`；随机 TXT 已完成并删除，Aaitr 只读已完成。
- 用户授权的 Cloudflare BIND 原文已保存到 Hostdzire root 专用 `0700` 运维
  目录，文件为 `0600`；仓库仅保存路径、时间、大小和 SHA-256。
- 2026-07-28 用户已确认执行第一批生产整改，授权应用发布、Hostdzire/DMIT
  Nginx 精确变更、根域 A 新增和 `relay` A 删除；随后另行确认按已展示范围
  commit 并 push `main`。授权仍不含 ACME 受控续期、`includeSubDomains`
  或 preload。
- 第一批必须先满足发布来源门禁，再按
  `research/domain-remediation-proposed-diff-2026-07-28.md` 备份、分层执行和
  回滚；不得因已获线上授权而部署脏工作树或跳过 Git push 的单独确认。
