# `mux` / `probe` 历史流量与退役依据

> 2026-07-28 用户在复核当前 sing-box 零引用后确认 `mux`、`probe` 退役。
> 本文保留此前发现的历史流量与协议证据，用于解释退役风险和防止误删审计；
> 恢复候选已作废，不得据本文自动重建监听或凭据。

## 范围与安全边界

- 2026-07-28 只读检查 DMIT `2026-06-06T23:51:01Z` 至
  `2026-07-28T07:05:50Z` 的 Nginx stream 轮转日志。
- 只输出 SNI 命中数、状态、目标端口、聚合字节和最长会话；不保存来源地址、
  原始日志、UUID、Reality 密钥、VLESS 用户或口令。
- 历史 sing-box JSON 只解析白名单字段：type/tag/listen port、TLS/Reality、
  server name、handshake 目标角色和 multiplex 开关。

## `mux` 不是纯残留

| 日志日期/层 | 会话 | 状态/端口 | 聚合行为 |
| --- | ---: | --- | --- |
| 2026-07-02，主 443 stream | 73 | 全部 200 → `11089` | 双向有实际字节；最长 `10782.026s` |
| 2026-07-13，主 443 stream | 1 | 200 → `11089` | 双向有实际字节；`62.314s` |
| 2026-07-20，主 443 stream | 2 | 全部 200 → `11089` | 双向有实际字节 |
| 2026-07-20，Reality stream | 9 | 全部 `listen=30090`、200 → `11090` | 双向有实际字节；最长 `169.341s` |
| 2026-07-28，当前主 443 | 4 | 全部 200 → Hostdzire `443` | 本轮审计探测，只证明当前错误落入默认 Web |

主 stream 与 Reality stream 是相邻层，不能把 2 与 9 简单相加为独立用户会话。
但 7 月 2 日的 73 条长连接、双向字节和接近 3 小时的最长会话足以反驳“从未有
真实消费者”。当前仍不知道消费者和负责人。

## 历史协议链

DMIT 六份 2026-07-20 历史 sing-box 配置对白名单字段给出一致结果：

```text
shared :443 + SNI mux.962850.xyz
  → Nginx 127.0.0.1:11089（历史 PROXY protocol 剥离层）
  → sing-box 127.0.0.1:11090
     type=vless
     tag=reality-mux-443
     tls.enabled=true
     tls.reality.enabled=true
     server_name=mux.962850.xyz
     multiplex.enabled=true
     Reality handshake → <hostdzire-wg>:8443
```

历史 Nginx 还存在 `30090 + mux SNI → 11090` 的专用入口；端口聚合确认 7 月
20 日的 9 条 Reality 会话全部来自 30090，而主 443 同日另有 2 条成功会话。
两条入口都有历史消费者证据，因此不能把 `mux` 描述为“从未使用”；用户仍可
基于当前配置与产品需要决定退役。退役不删除这些日志或历史配置。

## 当前防火墙与 reload 能力

2026-07-28 脱敏只读检查：

- `nft -j list ruleset`：IPv4 `filter/INPUT` base chain policy 为 `drop`；
- live ruleset 和所有持久化候选中均无 `30090`；
- `/etc/iptables/rules.v4` 逐端口放行现有 TCP
  `30001/30002/30003/30086/30088`，不含 TCP/UDP 30090；
- `netfilter-persistent` 为 enabled/active；
- `systemctl show sing-box` 返回 `CanReload=no`、active/running；恢复 inbound
  必须 restart，不能把 reload 写成无中断操作。

该检查没有保存来源地址或完整防火墙规则。它证明当前 30090 已不在活动或持久化
监听面；退役无需修改防火墙或重启 sing-box。

## `probe`

- 52 天日志中没有 2026-07-28 审计前的 `probe.962850.xyz` 命中。
- 当前 4 条均为本轮只读探测，全部 `502`，目标端口 443、零返回字节。
- 旧目标与当前 Aaitr `18443` Shadowsocks 不同；仍没有协议、目标身份、负责人
  或成功探针。

## 最小安全结论

- `mux`：DMIT 当前 Nginx、sing-box、监听和防火墙均已无服务入口；只剩
  Hostdzire 8443 的活动 `server_name` 别名。获线上配置授权后删除该别名，
  不恢复共享 443、30090、11089/11090 或 sing-box inbound。
- `probe`：当前唯一活动引用是 DMIT 指向失效旧目标的 SNI map；获授权后删除
  该行，不把 Aaitr `18443` 或占位 HTTPS 解释成替代服务。
- 两名保持双权威/双公共 NXDOMAIN，活动配置零服务引用，并由 Hostdzire 443
  default catchall 拒绝缓存或人工解析流量。历史备份和本文证据保留。
