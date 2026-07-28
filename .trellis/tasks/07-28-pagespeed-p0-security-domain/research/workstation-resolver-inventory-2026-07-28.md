# 当前工作站 resolver、hosts 与名称引用只读盘点

> 2026-07-28 用户随后确认 `mux`、`probe` 退役。本文关于未知消费者的旧 Open
> 项不再要求恢复服务，但其他网络/resolver 的名称引用清单仍须完成。

## 范围与方法

- 时间：2026-07-28 14:59:23 CST。
- 目标：确认当前开发工作站是否通过 hosts、域专用 resolver 或常见 mesh
  客户端引入 `962850.xyz` 内部/嵌套名称，并核对仓库中的活动名称引用。
- 只读检查 `/etc/hosts`、`/etc/resolver`、`scutil --dns`、进程命令名和仓库
  `deploy/`、`docs/`、`frontend/`、`backend/`、`.github/`。
- 未读取 WireGuard peer、私钥、token、口令或容器 secret；私网 resolver 地址
  在本文统一记为 `<workstation-private-resolver>`。

## 结果

| 检查面 | 脱敏结果 | 结论 |
| --- | --- | --- |
| `/etc/hosts` | 无 `962850.xyz` 引用 | 无本机 hosts 覆盖 |
| `/etc/resolver` | 目录不存在 | 无 macOS 域专用 resolver 文件 |
| `scutil --dns` | 一个 RFC1918 上游、无 search domain、无 `962850.xyz` scoped resolver；其余为 mDNS/reverse zones | 本机无显式 split-horizon 配置；继续以查询和端到端探测核对上游运行时视图 |
| 常见 mesh/VPN 进程 | 进程命令名中未发现 WireGuard、Tailscale、ZeroTier、Nebula、Headscale、OpenVPN 或 Cloudflared | 本次采样没有活动客户端；未运行或其他设备上的配置仍不在证明范围 |
| 活动仓库引用 | 非 Trellis/历史材料中只发现 `geo.962850.xyz` | 应用和部署仓库未引入新的内部或嵌套名称 |

Cloudflare 脱敏 Zone 和既有远端盘点仍记录以下名称类别：

- Web：`api`、`brutal`、`cpa`、`geo`、`leak`、`md2word`、`relay`、`vault`；
- 保留/历史：`mux`、`probe`、`plain`；
- 邮件策略：`_dmarc`、`cf2024-1._domainkey`；
- 临时控制证明：
  `_partsignal-control-<随机>.962850.xyz`，已按 record ID 删除并验证
  NXDOMAIN。

`a.b.962850.xyz` 只在证书覆盖范围说明中作为嵌套名称示例，不是已发现记录。

## 私网 DNS 上游运行时

对已知 Web、保留、历史、邮件和随机嵌套名称分别查询 A、AAAA、CNAME，并与
`1.1.1.1` 对照。结果显示 `<workstation-private-resolver>` 使用通用的短 TTL
合成地址机制：

- 公共有效名称和部分公共 NXDOMAIN 子域的 A 查询返回不同的
  `<synthetic-A>`，带 authoritative 标志；UDP/TCP 结果一致；
- `mux`、`probe`、`plain`、`www` 和两个随机嵌套名称均被合成 A，而公共
  resolver 对这些名称返回 NXDOMAIN；
- 随机 `.invalid` 返回 NXDOMAIN，其他公共域及不存在子域也可能获得合成 A；
  因此这不是足以证明 `962850.xyz` 私有权威 Zone 的专属行为，也不能把合成 A
  当作真实源站地址；
- 私网 resolver 不返回公开 SOA，不能用它完成 Zone 全量证明。

随后通过系统解析对 `mux`、`probe`、`plain`、`www` 和随机嵌套名称执行短时、
不跟随跳转的 HTTP/HTTPS 探测：HTTP 均为空响应，TLS 均在握手阶段失败，没有
状态码、证书或重定向。该证据确认当前工作站路径没有可达的隐藏 Web/TLS 服务，
但不能说明合成地址设备的配置，也不能代表其他客户端。

## 关闭边界

当前工作站的本机 hosts、域专用 resolver 和活动常见 mesh 客户端范围可标记为
已盘点；当前私网 resolver 运行时对已知/随机名称的解析与 HTTP/TLS 行为也已
记录。以下范围仍为 Open，不能从本机结果外推：

1. `<workstation-private-resolver>` 的实际配置、Zone、forwarder 和合成地址
   所有权；
2. 其他办公网、家庭路由器、WireGuard/mesh 客户端和移动设备；
3. 外部 CI runner、云主机或未运行客户端的 hosts/resolver。

当前工作站路径没有发现隐藏服务；`mux`/`probe` 已确认退役，但其他客户端和
resolver 清单及线上活动引用删除完成前仍不得进入 HSTS `includeSubDomains`
阶段。
