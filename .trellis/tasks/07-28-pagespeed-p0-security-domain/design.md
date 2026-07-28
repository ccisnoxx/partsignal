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

`deploy/scripts/check-nginx-security.mjs` 同时拥有静态 DOM sink 门禁：项目源码
不得直接调用 `innerHTML`、`outerHTML`、`insertAdjacentHTML`、
`document.write` 或 `createContextualFragment`；所有 React
`dangerouslySetInnerHTML` 的文件、数量和值变量必须与共享 Markdown 边界登记一致。
新增或漂移 sink 会让安全检查显式失败。

Ant Design 的 CSS 字符串并非 HTML。选择 `textContent` 是原生、等价且最小的
修复；使用 `patch-package` 固化当前 `@rc-component/util`、`@ant-design/icons`
和开发态 cssinjs 探测补丁。补丁版本和文件不匹配时安装失败，避免升级后静默失效。

先用 report-only CSP 收集所有路由；确认零未处理 sink 后切换 enforcing。
生产回滚只能回到 report-only，不能创建宽松 default policy。

## 域名台账

台账字段：FQDN、记录类型和值、Cloudflare proxy、公开/内部/保留、负责人、
业务用途、入口、TLS 终止点、证书 SAN、80、443、HSTS、日志、整改/退役结论。

证据来源：

- Cloudflare 完整 Zone 和注册商证明；
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
- 已审计的两台机器没有内部 Zone/hosts 记录，但 Aaitr 和其他客户端 resolver
  尚未审计，不能据此宣布内部清单完成。

正式控制权证明分三层：

1. 脱敏注册商账户证据确认域名、锁定、到期和可管理状态；
2. Zone-scoped credentialed GET 与完整 BIND export 确认读控制和全量记录；
3. 经授权创建随机临时 TXT，权威/公共双重验证后删除，确认本次写控制。

完整原始 Zone 导出包含可能敏感的验证 TXT，只放受控运维存储；仓库只保存脱敏
派生台账、哈希和审计时间，不保存 token、账户 ID 或 TXT 内容。

## 当前流量拓扑与权威配置

```text
Cloudflare DNS (unproxied A → 154.21.86.86)
  └─ DMIT /etc/nginx/nginx.conf
     ├─ :80 ──PROXY──> Hostdzire 10.0.0.2:80
     ├─ :443 default ─PROXY──> Hostdzire 10.0.0.2:443
     ├─ :443 probe ──> Aaitr 10.0.0.3:443
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
- `mux` 恢复与 `brutal` 一致的 SNI 路径但不新增公共 DNS。
- `probe` 恢复 Aaitr 443、证书和监控；无 Aaitr 权限时不得进入 HSTS 阶段。
- `relay` 先确认用途；无业务则删除 A，有业务则建立独立 80/443 vhost。
  不允许继续由 `api` vhost 接收未知 Host。
- 增加明确的 443 default catchall，使用有效证书后关闭未知 Host，避免未来误配
  名称静默落入首个业务 vhost；该防护不能替代逐名 HTTPS。
- 新增仓库 `deploy/nginx/962850-hsts.conf`，部署为
  `/etc/nginx/snippets/962850-hsts.conf`；所有 TLS vhost include。
- PartSignal 和 vault 原有独立 HSTS 行删除，避免第二事实源。

## HSTS 阶段和回滚

1. `max-age=300; includeSubDomains`，等待 5 分钟。
2. `max-age=604800; includeSubDomains`，等待 7 天。
3. `max-age=2592000; includeSubDomains`，等待 30 天。
4. `max-age=31536000; includeSubDomains`，额外观察至少 30 天。
5. 经最终确认改为
   `max-age=63072000; includeSubDomains; preload` 并提交。

首阶段的进入条件不是“配置能通过”：完整 Zone、内部/嵌套名称、Aaitr、
`relay/mux/probe` 结论和所有保留名称 HTTPS 必须先关闭。每阶段从根域实际
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
- Cloudflare 只读 Zone 查询已完成；TXT 写证明、根域/`relay` DNS、Aaitr、
  宿主 Nginx、HSTS 和部署仍需在实际操作前展示精确 diff/命令和回滚并请求确认。
- `relay` 删除或保留、`mux/probe` 修复或退役会改变外部/内部行为，不能由实现者
  静默选择。
