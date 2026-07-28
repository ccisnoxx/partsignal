# 当前 PageSpeed 与域名证据

## PageSpeed

- 报告：`ibm9s8ga5b`，desktop，Lighthouse 13.4.0。
- 采集时间：`2026-07-27T14:18:47.385Z`。
- 分数：Performance 0.99、Accessibility 1、Best Practices 1、SEO 0.54、
  Agentic Browsing 0.67。
- FCP/LCP 0.5s、TBT 90ms、CLS 0、Speed Index 1.2s、TTI 0.9s。
- 未使用 JS：入口 274,409 B，浪费 137,660 B。
- 未使用 CSS：Ant CSS-in-JS 17,360 B，浪费 17,320 B。
- 长任务：181ms Unattributable；入口 JS 110ms、90ms、75ms、61ms。
- 网络链：HTML → 入口 JS → `/api/v1/auth/me`；另有一个入口 CSS。
- LCP 元素：登录页安全说明段落；element render delay 约 1.33s。
- DOM：128 节点、最大深度 18、最大子节点 9。
- SEO：noindex/robots、缺 description。
- Agentic：llms.txt 缺 H1 和有效链接。
- Best Practices：缺 production source map；CSP 旧浏览器兼容提示；
  缺 Trusted Types；HSTS 缺 includeSubDomains/preload。
- Baseline：scrollend、`:has()`、text-wrap、backdrop-filter、mask。
- Manual：十项 accessibility 和 structured data。

## 域名与入口只读证据

- Cloudflare credentialed Zone GET：Zone 为 `active/full`，共有 14 条记录；
  权威 NS 为 `jule`/`neil.ns.cloudflare.com`。
- 根域只有 MX/TXT，无 A/AAAA/CNAME；`www` 为 NXDOMAIN。
- 8 个公共 A：`api`、`brutal`、`cpa`、`geo`、`leak`、`md2word`、
  `relay`、`vault`，均直连 DMIT `154.21.86.86`。
- 当前 HSTS：`geo`、`vault` 仅 `max-age=31536000`；其他已测名称缺失。
- `brutal` HTTPS 有效但 HTTP 当前失败。
- `relay` HTTP 失败，HTTPS 错误落入 `api` 默认 vhost 且无 HSTS。
- DMIT `ssl_preread`：
  - 配置保留的 `probe.962850.xyz` → `10.0.0.3:443`，目标当前不可达，
    但权威 DNS 为 NXDOMAIN；
  - `brutal.962850.xyz` → 本机 Reality；
  - 其他 SNI → Hostdzire。
- Hostdzire `brutal` 8443 vhost 同时声明 `mux.962850.xyz`，但权威 DNS
  NXDOMAIN，DMIT 当前没有把 `mux` 显式送到该 vhost。
- 证书 SAN：`962850.xyz`、`*.962850.xyz`；不覆盖嵌套子域。
- DMIT Unbound 与两机 hosts 未发现内部 `962850.xyz` 记录；Hostdzire 没有
  本地 DNS 服务。这不能代替 Aaitr、其他 VPN 客户端和内部 resolver 清单。
- 完整证据见 P0
  `research/domain-inventory-2026-07-28.md`；正式写控制仍需经授权的临时 TXT。
