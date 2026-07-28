# Research: Aaitr 内部域名、`probe` / `mux` 与监听面只读盘点

> 后续 DMIT 日志和脱敏历史配置已恢复 `mux` 的 VLESS/Reality + multiplex
> 服务器端路径并确认真实长连接；见
> `mux-probe-traffic-contract-2026-07-28.md`。本文关于 Aaitr 不承载该服务的
> 结论仍有效，关于 `mux` 协议未知的描述只代表本次 Aaitr 盘点时点。
>
> 2026-07-28 用户随后确认 `mux`、`probe` 退役。本文表格中的 Open/Blocked
> 是决策前历史状态；当前关闭路径是不恢复服务、删除剩余活动引用并保留证据。

- Query: 只读核对 SSH 别名 `aaitr` 所指主机的 resolver、`/etc/hosts`、相关
  服务配置、证书、监听端口、访问日志域名集合，以及 `probe` / `mux` 的用途、
  目标和可达性；查找所有 `*.962850.xyz` 与更深层嵌套名称。
- Scope: internal；远端只读 SSH 调查，主机身份、地址和接口信息按要求脱敏。
- Date: 2026-07-28 13:55:12 +08:00

## Findings

### 1. 证据边界

- 只使用 `ssh aaitr '<read-only commands>'`；SSH 强制
  `StrictHostKeyChecking=yes`、`UpdateHostKeys=no`，未写远端配置、未
  reload/restart 服务，也未运行 Git。
- 远端会话用户为 `root`，但未执行 `sudo` 或任何修改命令。
- 未查看或输出 WireGuard 私钥和证书私钥；未向会话输出或记录 sing-box 口令、
  token、密码或完整证书文件。sing-box 只输出字段白名单；证书只通过 TLS
  握手或公有证书文件提取 SAN、有效期和指纹。
- `/var/log` 和 journal 只输出匹配
  `(?:label.)*962850.xyz` 的 hostname 集合，不保存原始日志行、来源地址、
  请求路径或响应正文。
- 本文使用以下脱敏标记：
  - `<aaitr-wg>`：本次 SSH 主机当前 `wg0` 地址；
  - `<legacy-probe-target>`：任务既有设计中 DMIT 的 `probe` 目标；
  - `<dmit-wg>` / `<hostdzire-wg>`：既有设计中的两个 mesh 节点。

### 2. 任务和文件证据

| 路径 | 一行说明 |
|---|---|
| `.trellis/tasks/07-28-pagespeed-p0-security-domain/prd.md:50` | 域名清单必须交叉检查 resolver、hosts、入口、证书和日志。 |
| `.trellis/tasks/07-28-pagespeed-p0-security-domain/prd.md:52` | Aaitr 与其他 split-horizon resolver 是 AC4 的未完成边界。 |
| `.trellis/tasks/07-28-pagespeed-p0-security-domain/design.md:80` | 既有拓扑把 DMIT `probe` SNI 指向 `<legacy-probe-target>:443`。 |
| `.trellis/tasks/07-28-pagespeed-p0-security-domain/design.md:98` | 既有设计把 `mux` 归入与 `brutal` 相同的 SNI 路径，但不创建公共 DNS。 |
| `.trellis/tasks/07-28-pagespeed-p0-security-domain/implement.md:60` | Aaitr resolver/hosts、`probe` 和内部/嵌套名称是外部 HTTPS 门禁。 |
| `.trellis/tasks/07-28-pagespeed-p0-security-domain/research/domain-inventory-2026-07-28.md:56` | DMIT 当前只有 `probe` SNI 显式指向 Aaitr。 |
| `.trellis/tasks/07-28-pagespeed-p0-security-domain/research/domain-inventory-2026-07-28.md:103` | `mux` 当前公共 DNS 为 NXDOMAIN，Hostdzire 保留 8443 配置名。 |
| Aaitr `/etc/sing-box/config.json:5` | 当前唯一业务服务的入站类型为 `shadowsocks`。 |
| Aaitr `/etc/sing-box/config.json:6` | 入站 tag 为 `ss2022-in`。 |
| Aaitr `/etc/sing-box/config.json:7` | 入站绑定当前 `<aaitr-wg>`；具体地址未写入本文。 |
| Aaitr `/etc/sing-box/config.json:8` | 入站端口为 `18443`。 |
| Aaitr `/etc/sing-box/config.json:12` | 入站包含 sing-box `multiplex` 配置块。 |
| Aaitr `/etc/sing-box/config.json:13` | `multiplex.enabled` 为 `true`。 |
| Aaitr `/etc/sing-box/config.json:19` | 唯一输出类型为 `direct`。 |
| Aaitr `/etc/sing-box/config.json:20` | 输出 tag 为 `direct`。 |
| Aaitr `/etc/systemd/system/sing-box.service` | 活动单元；只读取 `FragmentPath`、服务用户和 `ExecStart` 元数据。 |
| Aaitr `/etc/resolv.conf:1` | 第一个直接配置的公共 nameserver；地址已脱敏。 |
| Aaitr `/etc/resolv.conf:2` | 第二个直接配置的公共 nameserver；地址已脱敏。 |
| Aaitr `/etc/hosts` | 4 条非注释基础记录；没有 `962850.xyz` 匹配。 |

未发现 `/etc/nginx`、`/etc/caddy`、`/etc/apache2`、`/etc/httpd` 等相关
配置目录；活动业务配置仅发现 `/etc/sing-box/config.json`。

### 3. 主机、resolver 与 hosts

- 脱敏身份摘要：Debian 11、Linux 5.10、x86_64、KVM；接口类型为 loopback、
  一个公网 NIC 和 `wg0`。未记录真实 hostname、公网地址、MAC 或 SSH 目标地址。
- `/etc/resolv.conf` 是普通文件，直接列出两个公共 nameserver；没有
  `search` / `domain` 行。
- `systemd-resolved`、dnsmasq、Unbound、`named` / BIND 均不活动。
  `resolvectl` 二进制存在，但 resolved 守护进程不活动。
- 在 `/etc/systemd`、`/etc/NetworkManager`、`/etc/dnsmasq.d`、
  `/etc/unbound`、`/etc/bind`、`/etc/knot` 和 `/etc/coredns` 中没有发现
  `962850.xyz` local zone、local data、forward zone 或 search domain。
- `/etc/hosts` 不含根域、一级子域或嵌套 `962850.xyz` 名称。

结论：**Aaitr 本机不是 `962850.xyz` 的 split-horizon resolver，且没有 hosts
覆盖。** 该结论只覆盖这台 SSH 主机，不外推到其他 WireGuard/mesh 客户端。

### 4. 服务、配置与监听端口

命令证据：

```text
systemctl list-units --type=service --state=running
command -v nginx caddy apache2 httpd sing-box ...
ss -H -lntup
systemctl show sing-box.service -p FragmentPath -p User -p Group -p ExecStart
nl -ba /etc/sing-box/config.json | grep <安全字段白名单>
nft list ruleset / iptables-save | grep <443|18443>
```

只读结果：

| 端口 | 监听者 / 用途 | 证据结论 |
|---|---|---|
| `22/tcp` | SSH | 管理入口。 |
| `18443/tcp` | sing-box `1.13.13` | `shadowsocks` / `ss2022-in`，绑定 `<aaitr-wg>`，启用 sing-box multiplex。 |
| `33987/udp` | WireGuard | mesh 传输端口；未读取 peer 公钥、endpoint 或私钥。 |
| `443/tcp` | 无 | `ss` 无监听；nftables/iptables 也没有发现 `443` 到 `18443` 的转发。 |

- 活动相关服务只有 `sing-box.service`；Nginx、Caddy、Apache、HAProxy、
  Traefik、dnsmasq、Unbound、BIND 均没有活动单元、可执行文件和相应配置目录。
- sing-box 以专用用户/组 `sing-box` 运行，执行
  `sing-box run -c /etc/sing-box/config.json`。
- `/etc/sing-box/config.json` 为 `0640 root:sing-box`、26 行。白名单字段证明
  当前用途是 **Shadowsocks 2022 代理入站 + sing-box 协议复用 + direct 出站**；
  它没有 TLS、证书、HTTP vhost、上游域名或专用 `probe` / `mux` 路由。
- 未发现 Docker、Podman、containerd 可执行文件或活动服务；因此没有发现容器
  监听或容器 access log 的附加盘点面。

### 5. `962850.xyz` 与嵌套名称集合

采用只输出 hostname token 的 Perl 正则扫描，不输出命中行的其他内容：

```text
find <受限配置目录> ... |
  perl -ne '输出 $ARGV、行号和匹配的 *.962850.xyz hostname'

find /var/log -type f -readable -size -100M ... |
  perl -ne '只输出匹配 hostname'

journalctl --since 2026-01-01 --output=cat |
  perl -ne '只输出匹配 hostname'
```

| 来源 | 扫描结果 |
|---|---|
| `/etc/hosts` | 空集 |
| resolver / systemd / sing-box /常见 Web 服务配置 | 空集 |
| `/etc` 其余非敏感、可读配置文件 | 空集 |
| `/usr/local/etc`、`/opt`、排除 `.ssh` / `.acme.sh` / cache 后的 `/root` 配置与脚本 | 空集 |
| 当前进程参数 | 空集 |
| `/var/log` 38 个可读、单文件小于 100 MiB 的日志文件 | 空集 |
| 2026-01-01 至采集时的 systemd journal | 空集 |

因此，Aaitr 本机持久配置和已检查日志中没有发现任何具体
`*.962850.xyz` 名称，也没有 `a.b.962850.xyz` 形式的嵌套名称。后续 TLS
测试主动使用的 `probe.962850.xyz` / `mux.962850.xyz` 不属于驻留配置或历史
日志发现，不能加入“Aaitr 已配置名称”集合。

### 6. 证书 SAN 与到期

- Aaitr 的 `/etc/sing-box`、`/etc/letsencrypt`、`/var/lib/caddy`、
  `/var/lib/acme`、`/etc/acme` 中未发现服务公有证书文件；未访问任何私钥。
- `<aaitr-wg>:18443` 是 Shadowsocks 而非 TLS，`openssl s_client` 没有得到
  X.509 证书。
- `<aaitr-wg>:443` 没有监听，不能提供 `probe` 证书。
- 经 `<dmit-wg>:443`、SNI `probe.962850.xyz` 无法取得 X.509 证书。
- 经同一入口、SNI `mux.962850.xyz` 得到与 `geo` 基线相同的证书：

| 字段 | 结果 |
|---|---|
| SAN | `*.962850.xyz`、`962850.xyz` |
| Not Before | 2026-07-02 14:51:05 UTC |
| Not After | 2026-09-30 14:51:04 UTC |
| SHA-256 | `FC:D3:…:0E:B5` |

该证书来自 DMIT 默认转发后的 Hostdzire TLS 终止，不是 Aaitr 驻留证书。
一级通配 SAN 也不覆盖 `a.b.962850.xyz`。

### 7. `probe` 用途、目标与可达性

既有设计的用途是让 DMIT 根据 `probe.962850.xyz` SNI 把 TLS 转发到
`<legacy-probe-target>:443`；但本次 `ssh aaitr` 主机的运行态与该设计不一致：

| 检查 | 结果 |
|---|---|
| `<aaitr-wg>:18443` TCP | 可达；当前 Shadowsocks 2022 服务 |
| `<aaitr-wg>:443` TCP | 不可达；无监听 |
| `<legacy-probe-target>:443` TCP | 从 Aaitr 不可达 |
| `<dmit-wg>:443` TCP | 从 Aaitr 可达 |
| `<dmit-wg>:443` + `probe` SNI | TLS 失败，无证书、HTTP 状态 `000` |

关键结论：**`probe` 当前不可用，且至少存在“SSH 别名所指主机/mesh 地址/服务
端口”与 DMIT 既有目标不一致。** 目前证据不能判定 `<legacy-probe-target>`
是已离线的旧 Aaitr、另一台未授权设备，还是 DMIT 的陈旧配置；该身份映射必须
由用户确认，不能通过兼容转发或猜测端口掩盖。

### 8. `mux` 用途、目标与可达性

- Aaitr 没有 `mux.962850.xyz` 字符串、TLS vhost、证书或 8443 服务。
- `/etc/sing-box/config.json:12-13` 的 `multiplex.enabled=true` 是
  Shadowsocks 入站的协议复用能力；它**不是**
  `mux.962850.xyz` 域名服务存在的证据。
- 从 Aaitr 到 `<hostdzire-wg>:8443` 的 TCP 测试不可达。该方向可能受
  WireGuard peer 隔离、转发或防火墙约束，只能证明“Aaitr 不能直达”，不能推翻
  既有 Hostdzire 本机 8443 配置证据。
- 将 `mux.962850.xyz` 人工解析到 `<dmit-wg>` 后：
  - TLS 返回根域 + 一级通配证书；
  - `GET /` 返回 HTTP `200`；
  - 证书与 `geo` 基线一致。

结合既有 DMIT 证据中没有 `mux` 的显式 SNI 路由，这个 `200` 只证明
`mux` 当前落入默认 Hostdzire `443` Web 路径，不证明专用 mux 业务可用。
`mux` 的负责人、真实业务协议和保留/退役决定仍为 Open。

### 9. 门禁判断

| 项目 | 状态 | 判断 |
|---|---|---|
| Aaitr 本机 resolver | Closed（本机范围） | 无本地域、forward zone 或活动 resolver 服务。 |
| Aaitr `/etc/hosts` | Closed（本机范围） | 无 `962850.xyz` 名称。 |
| Aaitr 本机具体/嵌套名称 | Closed（已检查来源范围） | 配置、进程和日志集合为空。 |
| `probe` HTTPS | **Open / Blocker** | 目标身份和端口不一致，DMIT SNI TLS 失败。 |
| `mux` 专用路径 | **Open / Blocker** | Aaitr 无该服务；DMIT 仅落入默认 443 Web 路径。 |
| 全 mesh / 办公网内部名称 | **Open / Blocker** | 本次授权只覆盖 Aaitr，其他客户端/resolver 尚未盘点。 |
| `includeSubDomains` | **Blocked** | `probe`、`mux` 和其他内部客户端边界未关闭。 |

最小后续动作不是在 Aaitr 增加兼容监听，而是先确认：

1. `aaitr` SSH 别名是否就是 DMIT `probe` 应指向的设备；
2. 若是，批准后的精确修复应更新唯一权威目标/监听和证书；若不是，需对
   `<legacy-probe-target>` 所属设备另行只读盘点；
3. `mux` 是否确有独立业务；保留时补齐显式 SNI/端口路径，退役时删除活动配置
   残留，不让其继续落入默认 vhost。

## External References

- 本子任务未新增 Web 外部参考；结论来自任务既有拓扑和本次远端运行态。
- 运行版本证据：Debian 11、sing-box `1.13.13`
  （`go1.25.10 linux/amd64`）。
- 既有 HSTS / preload 官方参考继续以
  `research/domain-inventory-2026-07-28.md:141-145` 为准。

## Related Specs

- `.trellis/spec/backend/index.md`、`.trellis/spec/frontend/index.md` 和
  `.trellis/spec/guides/index.md` 已检查；当前 `.trellis/spec/` 没有 DNS、
  Nginx、HSTS、证书或宿主运维专项规范。
- 本调查的权威要求来自本任务 `prd.md:44-65`、`design.md:42-105` 和
  `implement.md:50-70`；不据此修改 spec。

## Caveats / Not Found

- **Open：Aaitr 身份映射。** SSH 别名当前主机的 `<aaitr-wg>` 与设计中的
  `<legacy-probe-target>` 不同；本文按要求不记录真实 hostname 或完整地址。
- **Open：其他内部 resolver/客户端。** Aaitr 无本地域不能证明整个 mesh、
  办公网、CI/CD 或其他 hosts 没有名称。
- **Open：日志覆盖。** 已检查 `/var/log` 和 systemd journal；若应用把访问
  日志保存在未发现的独立数据卷、远程日志系统或其他设备，本次不能覆盖。
- **Open：`mux` 业务所有权。** Aaitr 上的 sing-box multiplex 与
  `mux.962850.xyz` 只是名称相似，不能据此合并为同一业务。
- 未发现 Aaitr 公有证书文件、Web server、443 监听、443→18443 NAT、容器服务、
  `962850.xyz` 持久名称或嵌套名称。
- 本次没有修改任何本地代码、任务规划、远端配置或服务；唯一新增文件是本
  research artifact。
