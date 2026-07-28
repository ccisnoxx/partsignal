# `962850.xyz` 域名、HTTPS 与 HSTS 只读证据

## 证据边界

- 采集时间：2026-07-28。
- 所有本地、Cloudflare 和 SSH 操作均为只读；未修改 DNS、证书、Nginx、
  HSTS、服务或线上文件。
- SSH 范围仅为用户授权的 `dmit` 与 `hostdzire`。未连接 Aaitr
  `10.0.0.3`，也未读取其他设备。
- Cloudflare 查询复用 Hostdzire 上现有 `acme.sh` 凭据，仅调用 Zone 和
  DNS records 的 GET 接口；token、Zone ID、账户 ID、TXT 内容和私钥均未
  输出或写入仓库。
- 公共 DNS 使用权威 NS `jule.ns.cloudflare.com` 复核，避免本机递归
  resolver 返回的合成地址污染结论。

## 控制权与证书证据

| 证据 | 只读结果 | 结论 |
|---|---|---|
| Cloudflare credentialed Zone GET | `962850.xyz` 为 `active`、`full`，NS 为 `jule`/`neil.ns.cloudflare.com`，共 14 条记录 | 已证明现有凭据可读取当前权威 Zone；账户标识只保留哈希指纹 |
| 权威 NS/SOA | SOA serial `2409161408`；权威查询与 Zone API 的记录名称一致 | Cloudflare 是当前 DNS 权威 |
| RDAP | 注册商 Spaceship；注册 2024-04-19，过期 2034-04-19，`client transfer prohibited` | 公开注册状态正常；仍需脱敏的注册商账户控制截图或导出作为操作权证 |
| `acme.sh --list` | `962850.xyz` + `*.962850.xyz`，DNS provider 为 `dns_cf`，下次续期 2026-08-30 | 已存在 DNS-01 自动续期链路 |
| 线上证书 | Let's Encrypt YE2；SAN 为根域和一级通配；2026-07-02 至 2026-09-30；SHA-256 `FC:D3:…:0E:B5` | 覆盖根域和一级子域，不覆盖 `a.b.962850.xyz` |
| 凭据/私钥权限 | `account.conf`、证书任务配置和私钥均为 `0600 root:root`；每日 cron 执行 `acme.sh --cron` | 未发现凭据文件权限放宽；续期部署仍需增加独立验收 |

当前证据能证明 Zone 读取权和既有 DNS-01 使用能力，但不把“持有一个历史
token”冒充为本次正式写控制证明。实施时创建随机、一次性的
`_partsignal-control-<UTC>.962850.xyz` TXT，经两个权威 NS 和至少两个公共
resolver 验证后删除，并保存新增、查询、删除和最终 NXDOMAIN 的审计记录。
该写入和删除必须先获用户授权。

## 完整公开 Zone

Cloudflare API 返回 14 条记录：

- Web A：`api`、`brutal`、`cpa`、`geo`、`leak`、`md2word`、`relay`、
  `vault`，均直连 `154.21.86.86`，未启用 Cloudflare proxy，TTL 自动。
- 根域：三条 Cloudflare Email Routing MX 和一条 SPF TXT；无 A/AAAA/CNAME。
- 邮件策略：`_dmarc` TXT、`cf2024-1._domainkey` TXT。
- Zone 中无 AAAA、CAA、DNSSEC DS，也无通配 DNS。
- `www`、`mux`、`probe`、`plain` 为权威 NXDOMAIN。

MX/TXT 标签不是 Web 服务，不要求为其创建 A/AAAA 或虚构 HTTPS；但必须保留
邮件用途、负责人和变更影响。任何新建 A/AAAA/CNAME、内部 split-horizon
记录或嵌套子域都会继承根域 HSTS，必须进入同一台账和证书门禁。

## 入口和 TLS 所有权

### DMIT

- 主机地址 `154.21.86.86`，Nginx `1.29.8`。
- 权威配置：`/etc/nginx/nginx.conf`。
- 80 端口把普通 Web 流量以 PROXY protocol 转发到 Hostdzire
  `10.0.0.2:80`。
- 443 使用 `ssl_preread`：
  - `probe.962850.xyz` → Aaitr `10.0.0.3:443`；
  - `brutal.962850.xyz` → 本机 sing-box；
  - 其他 SNI → Hostdzire `10.0.0.2:443`。
- DMIT 不终止普通 Web TLS，因此 HSTS 不能配置在此层。
- `/etc/sing-box/config.json` 的 `brutal` Reality handshake 目标为
  Hostdzire `10.0.0.2:8443`；敏感入站凭据未读取。
- Unbound 只把查询经 DoT 转发到 Cloudflare，没有 `962850.xyz` local-zone
  或 local-data；`/etc/hosts` 也没有该域名记录。
- `10.0.0.3:443` 当前 TCP 不可达。未获 Aaitr 权限前不能断言 `probe`
  已退役或可安全保留。

### Hostdzire

- WireGuard 地址 `10.0.0.2`，Nginx `1.29.8`。
- 证书配置：
  `/etc/nginx/snippets/cert-962850.xyz.conf`、
  `/etc/nginx/ssl/962850.xyz/` 和
  `/root/.acme.sh/962850.xyz_ecc/`。
- 活动 TLS vhost：
  - `api`：`/etc/nginx/sites-enabled/api.962850.xyz.conf`；
  - `cpa`：`/etc/nginx/sites-enabled/cpa.962850.xyz.conf`；
  - `geo`：`/etc/nginx/sites-enabled/partsignal-staging.conf`；
  - `leak`：`/etc/nginx/sites-enabled/leak.962850.xyz.conf`；
  - `md2word`：
    `/etc/nginx/sites-enabled/md2word-api.962850.xyz.conf`；
  - `vault`：`/etc/nginx/sites-enabled/vault.962850.xyz.conf`；
  - `brutal`、`mux`：
    `/etc/nginx/sites-enabled/brutal.962850.xyz.conf` 的 8443 vhost。
- Hostdzire 没有本地 DNS 服务，也没有 `/etc/hosts` 域名覆盖。
- 仅 `geo` 的 PartSignal snippet 和 `vault` 独立行发送
  `Strict-Transport-Security: max-age=31536000`；其他 TLS vhost 未发送。

## 当前逐名矩阵

| 名称 | 权威 DNS / 用途 | HTTP | HTTPS / 证书 | 当前 HSTS | 阻断与最小安全处理 |
|---|---|---|---|---|---|
| `962850.xyz` | 仅 MX/TXT，无 Web 地址 | 不可达 | 不可达；preload API 报 `domain.tls.cannot_connect` | 无 | 经授权新增 A；Hostdzire 新增 80 同主机 308 和 443 根域 vhost，443 响应先带 HSTS 再 308 到 `geo` |
| `www` | NXDOMAIN | N/A | N/A | 继承未来根域策略 | 不主动创建；每阶段确认仍无记录。若新增，必须先提供 HTTPS |
| `api` | A；API | 301 同主机 HTTPS | 有效，200 | 无 | TLS vhost 引用唯一域级 HSTS snippet |
| `cpa` | A；代理服务 | 301 同主机 HTTPS | 有效，404 为探测路径业务响应 | 无 | TLS vhost 引用域级 snippet |
| `geo` | A；PartSignal | 301 同主机 HTTPS | 有效，200 | `max-age=31536000` | 改为域级 snippet，移除 PartSignal 私有 HSTS 第二事实源 |
| `leak` | A；静态测试站 | 301 同主机 HTTPS | 有效，404 为探测路径业务响应 | 无 | TLS vhost 引用域级 snippet |
| `md2word` | A；Web/API | 301 同主机 HTTPS | 有效，200 | 无 | TLS vhost 引用域级 snippet |
| `vault` | A；Vaultwarden | 301 同主机 HTTPS | 有效，404 为探测路径业务响应 | `max-age=31536000` | 改为域级 snippet并删除站点私有 HSTS 行 |
| `brutal` | A；Reality 伪装入口 | 空响应，未同主机升级 | 有效，Reality 回落到 Hostdzire 8443，404 | 无 | Hostdzire 增加 80 redirect vhost；8443 vhost引用域级 snippet；验证 Reality 与 Web fallback 均不变 |
| `relay` | A；无已确认负责人/配置 | 空响应 | 有效但错误落入 `api` 默认 vhost，200 | 无 | 硬阻断。确认业务后仅二选一：删除无用 A，或建立专属 80/443 vhost；不得让未知 Host 继续落入 API |
| `mux` | NXDOMAIN；Hostdzire 8443 配置保留名 | N/A | 若内部解析到 DMIT，当前默认 443 路径不能到 8443 | 无 | 硬阻断。确认保留则补齐明确 SNI/80/443 路径；否则从活动 vhost 删除并保留审计 |
| `probe` | NXDOMAIN；DMIT 配置指向 Aaitr | N/A | `10.0.0.3:443` 当前不可达 | 未知 | 硬阻断。获 Aaitr 只读权限后确认修复或退役；结论前不得进入 includeSubDomains |
| `plain` | NXDOMAIN；仅历史配置线索 | N/A | N/A | N/A | 不恢复；确认活动配置、内部 resolver、hosts 和日志均无引用后标记历史退役 |
| `_dmarc` / `_domainkey` | TXT 邮件策略 | 非 Web | 非 Web | 不适用 | 保留并记录邮件负责人；不得为通过 Web 检查伪造地址 |

`relay` 的访问日志只有本次审计探测量级，不能据此推断无人使用。删除 DNS 或
改变其默认路由仍需业务确认。

## 内部和嵌套子域未决边界

已证明 DMIT/Hostdzire 没有本地 `962850.xyz` DNS Zone 或 hosts 覆盖；这不等于
全网没有内部名称。进入首个 `includeSubDomains` 阶段前还必须：

1. 获权只读检查 Aaitr `10.0.0.3` 的 Nginx/证书、resolver、hosts 和 `probe`；
2. 盘点所有 WireGuard/mesh 客户端、办公网 DNS、容器编排、CI/CD secrets 的
   **名称引用**，只保存 FQDN、用途和负责人，不保存 secret 值；
3. 从 Cloudflare 审计日志、DMIT/Hostdzire SNI/Host 日志和证书透明度日志交叉
   检查历史名称；
4. 对 `a.b.962850.xyz` 形式的嵌套名称逐个提供显式 SAN/更深层通配证书；
   当前 `*.962850.xyz` 不覆盖它们；
5. 对无法长期提供有效 HTTPS 的名称，只有修复、退役 DNS/服务，或在 preload
   前迁出 `962850.xyz` 三种安全选择；不能以忽略证书错误、HTTP fallback 或
   “内部系统”豁免。

## HSTS / preload 当前状态和不可逆性

- `hstspreload.org` 状态 API：`status=unknown`，当前未预加载。
- preloadable API：因根域没有 Web DNS，返回
  `domain.tls.cannot_connect`。
- 官方要求覆盖所有公开、内部和嵌套子域；根域必须有效 HTTPS，根域 HTTPS
  重定向响应本身也必须发送 HSTS。
- 官方建议按 300 秒、7 天、30 天逐级观察并等待完整 `max-age`；本任务再增加
  1 年 `includeSubDomains` 的至少 30 天观察，最后才考虑两年 + `preload`。
- 官方页面当前明确说明 HSTS 推荐、preload 本身不再普遍推荐。用户已明确要求
  正式提交，因此计划保留该目标，但添加最终不可逆确认。
- 移除 preload 通常需 6–12 周到达多数 Chrome，其他浏览器可能更久；
  `max-age=0` 也不能撤回已分发的 preload。

权威参考：

- `https://hstspreload.org/`
- `https://hstspreload.org/removal/`
- `https://developers.cloudflare.com/dns/manage-dns-records/how-to/import-and-export/`

## 进入外部实施前的硬门禁

- 完整 Zone、注册商控制证据和 TXT 写控制证明均完成且脱敏存档。
- `relay`、`mux`、`probe` 的保留/退役选择获得用户确认。
- Aaitr 和其他内部 resolver/hosts 清单完成，无未知名称。
- 所有保留 Web 名称的证书、80 同主机升级、HTTPS 业务探测和监控均通过。
- 根域、DNS、Nginx、HSTS、部署的精确 diff 与回滚命令已展示并获授权。
- 任一条件不满足即保持现有 HSTS，不启用 `includeSubDomains`，更不添加
  `preload`。
