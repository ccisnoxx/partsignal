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
  - 配置保留的 `probe.962850.xyz` → 旧 TLS 443 目标，目标当前不可达，
    且与当前 SSH 别名 `aaitr` 的 Shadowsocks `18443` 不是同一协议路径；
    权威 DNS 为 NXDOMAIN；
  - `brutal.962850.xyz` → 本机 Reality；
  - 其他 SNI → Hostdzire。
- Hostdzire `brutal` 8443 vhost 同时声明 `mux.962850.xyz`，但权威 DNS
  NXDOMAIN，DMIT 当前没有把 `mux` 显式送到该 vhost。后续 52 天 stream 日志
  证明 7 月仍有成功、最长近 3 小时的 `mux` 长连接；脱敏历史配置确认它是
  multiplex-enabled VLESS/Reality，经 `11089/11090` handshake 到 Hostdzire
  `8443`。用户已根据当前 sing-box 零引用和这组历史证据确认退役：不恢复旧
  服务，保留历史，并在获授权后删除 Hostdzire 活动别名。
- 证书 SAN：`962850.xyz`、`*.962850.xyz`；不覆盖嵌套子域。
- DMIT、Hostdzire、Aaitr 和当前开发工作站的 resolver/hosts 均未发现内部
  `962850.xyz` 记录，也未发现嵌套名称。工作站没有域专用 resolver 或活动常见
  mesh 客户端；其私网 DNS 上游会为公共 NXDOMAIN 合成短 TTL A，但
  `mux/probe/plain/www` 和随机嵌套名称经系统解析均无可达 HTTP/TLS 服务。
  上游设备配置和其他客户端仍不能由该结果代替。
- 完整证据见 P0
  `research/domain-inventory-2026-07-28.md`、
  `research/aaitr-inventory-2026-07-28.md` 和
  `research/dmit-stream-reality-2026-07-28.md`、
  `research/mux-probe-traffic-contract-2026-07-28.md`、
  `research/workstation-resolver-inventory-2026-07-28.md`。
- 临时随机 TXT 写控制已完成：双权威、双公共可见，随后精确删除并在四端确认
  NXDOMAIN；Cloudflare BIND export 已验证为 14 条用户记录加 2 条 provider
  NS，并按授权保存到 Hostdzire root 专用 `0700` 目录的 `0600` 文件。注册商
  登录截图不是 Lighthouse/HSTS/preload 正式门禁；公开 RDAP 状态已保留，账户
  恢复与自动续费未独立验证的风险单列。
- 根域、`relay`、Hostdzire default 443、`brutal` 与 HSTS 的未执行精确提案见
  `research/domain-remediation-proposed-diff-2026-07-28.md`。
