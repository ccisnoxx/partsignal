# Research: DMIT Stream/SNI、sing-box Reality 与回滚入口只读复核

> 2026-07-28 用户在本盘点后确认 `mux`、`probe` 退役。文中恢复条件只保留为
> 历史风险分析，不再是当前实施方向；活动引用删除见
> `domain-remediation-proposed-diff-2026-07-28.md`。

- Query: 只读复核 DMIT 当前 Nginx stream/SNI map、监听端口、default
  upstream、`probe` / `mux` / `brutal` / `geo` 的实际目标角色，以及
  sing-box/Reality 配置、检查和无凭据回归入口；给出未执行的原子备份、
  reload/restart 和 rollback 命令模板。
- Scope: internal；仅 `ssh dmit` 只读调查。地址、凭据、私钥和用户标识均不
  输出；本文用角色标记代替内部地址。
- Date: 2026-07-28

## Findings

### 1. 调查边界和运行状态

- 只执行 `nginx -T`、`nginx -t`、`sing-box check`、`systemctl show`、
  `ss`、受限字段解析和本机 TLS 握手；没有修改远端文件、服务或 Git。
- Nginx 为 `1.29.8`，`nginx.service` 活动；sing-box 为 `1.13.13`，
  `sing-box.service` 活动。
- `nginx -t` 成功；`sing-box check -c /etc/sing-box/config.json` 退出码为
  `0`。
- Nginx `CanReload=yes`；sing-box `CanReload=no`，且 unit 没有
  `ExecReload`。sing-box 配置生效只能在校验后执行受控 `restart`，不能把
  `systemctl reload sing-box` 写成有效流程。
- 权限未漂移：
  `/etc/nginx/nginx.conf` 为 `0644 root:root`，
  `/etc/sing-box/config.json` 为 `0600 root:root`。

### 2. 文件和权威位置

| 路径 | 一行说明 |
|---|---|
| DMIT `/etc/nginx/nginx.conf:33-55` | stream 日志与 443 SNI 主 map；这是 `nginx -T` 当前唯一活动路由来源。 |
| DMIT `/etc/nginx/nginx.conf:63-65` | 80 的 Hostdzire Web upstream。 |
| DMIT `/etc/nginx/nginx.conf:87-101` | 公网 80 TCP/PROXY protocol 转发。 |
| DMIT `/etc/nginx/nginx.conf:110-129` | 公网 443 `ssl_preread`、动态 `proxy_pass` 和 PROXY protocol。 |
| DMIT `/etc/nginx/nginx.conf:133-141` | `brutal` 普通 Reality 的本地 PROXY protocol 剥离层：`11085 → 13001`。 |
| DMIT `/etc/nginx/nginx.conf:164-187` | 专用 Reality 端口与 SNI 的第二个 map。 |
| DMIT `/etc/sing-box/config.json:18-35` | `vless-in1` 在 `13001`，Reality handshake 到 Hostdzire `8443`。 |
| DMIT `/etc/sing-box/config.json:46-148` | 其余四个 VLESS/Reality inbound，分别在 `13003/13002/13086/13088`，handshake 同为 Hostdzire `8443`。 |
| DMIT `/etc/sing-box/config.json:159-190` | `reality-brutal` 在 `11086`，Reality、multiplex 和 Brutal 均启用。 |
| DMIT `/etc/sing-box/config.json:219-227` | `aaitr-residential` 是到当前 Aaitr `18443` 的 Shadowsocks outbound。 |
| DMIT `/etc/systemd/system/sing-box.service:9` | 唯一启动命令：`sing-box run -c /etc/sing-box/config.json`。 |
| DMIT `/var/log/nginx/stream-access.log` | 443 stream SNI 与选定上游审计日志。 |
| DMIT `/var/log/nginx/stream-error.log` | 普通 stream 错误日志。 |
| DMIT `/var/log/nginx/stream-reality-access.log` | 专用 Reality 端口的 SNI/上游审计日志。 |
| DMIT `/var/log/nginx/stream-reality-error.log` | 专用 Reality 端口错误日志。 |

`nginx -T` 仅展开 `/etc/nginx/nginx.conf`；同目录多个 `.bak` /
`codex-pre-*` 文件不是活动 include，不能当作当前行为。

### 3. 当前 443 SNI map 和目标角色

权威逻辑在 `/etc/nginx/nginx.conf:51-55`：

| SNI | 当前 map 目标角色 | 运行态判断 |
|---|---|---|
| 空 SNI | 本机 discard `:9` | 明确拒绝，不落入 Web default。 |
| `probe.962850.xyz` | `<legacy-probe-target>:443` | 显式旧目标；本机 TLS 回归失败。 |
| `brutal.962850.xyz` | 本机 Nginx `11085` | `11085` 剥离 PROXY header 后到 sing-box `13001` Reality；普通 TLS handshake 回落 Hostdzire `8443`。 |
| `geo.962850.xyz` | `default → <hostdzire-wg>:443` | 没有显式 `geo` 行；普通 Web TLS 在 Hostdzire 443 终止。 |
| `mux.962850.xyz` | `default → <hostdzire-wg>:443` | 活动配置没有 `mux` 特例；当前不是专用 Reality/mux 路径。 |
| 其他非空 SNI | `default → <hostdzire-wg>:443` | 普通 Web default。 |

`/etc/nginx/nginx.conf:112,116,125,129` 分别证明公网 `443` 监听、
`ssl_preread`、按 map 动态转发以及向所选上游发送 PROXY protocol。

本机 `127.0.0.1:443` 的只读 TLS/HTTP 回归结果：

| SNI | TLS | SAN | `GET /` |
|---|---|---|---|
| `geo` | 成功 | 根域 + 一级通配 | `200` |
| `brutal` | 成功 | 根域 + 一级通配 | `200` |
| `mux` | 成功 | 根域 + 一级通配 | `200` |
| `probe` | 失败 | 无证书 | 无 HTTP |

这组结果只证明当前 SNI 路径和普通 TLS fallback；`mux` 的 `200` 是 default
Web 路径证据，不是专用 mux 服务证据。

### 4. 80、Reality 与相关监听

- 公网 `80`：`/etc/nginx/nginx.conf:89,98,101`，经命名 upstream
  `b_http` 转到 Hostdzire `80`，发送 PROXY protocol。
- 公网 `443`：Nginx stream SNI map。
- Nginx 本机 `11085`：只为共享 443 的普通 Reality 剥离 PROXY protocol，
  再转到 sing-box `13001`。
- Nginx `30001/30002/30003/30086/30088`：
  `/etc/nginx/nginx.conf:164-187` 只接受对应端口 +
  `brutal.962850.xyz` SNI，并转到同编号 Reality inbound；其他 SNI 到
  discard `:9`。
- sing-box `13001/13002/13003/13086/13088`：五个
  VLESS/Reality inbound，握手伪装目标均为 Hostdzire `8443`。
- sing-box `11086`：独立 `reality-brutal`，启用 multiplex + Brutal；
  `/etc/nginx/nginx.conf:108` 明确它不经过 Nginx。
- sing-box `1080`：内部 SOCKS inbound，与域名 SNI map 无关。
- DMIT 本机没有 `18443` listener；`18443` 出现在 sing-box outbound，
  目标是当前 Aaitr。

### 5. `probe` 旧目标与 Aaitr `18443` 的精确差异

两条路径是不同协议、地址角色和端口，不能互相当作兼容目标：

| 维度 | DMIT `probe` 旧路径 | Aaitr 当前路径 |
|---|---|---|
| DMIT 配置 | `/etc/nginx/nginx.conf:53` | `/etc/sing-box/config.json:219-227` |
| 目标 | `<legacy-probe-target>:443` | `<aaitr-current-wg>:18443` |
| 协议/用途 | Nginx stream 按 TLS SNI 透传，预期目标能完成 TLS | Shadowsocks outbound；Aaitr 入站启用了 sing-box multiplex |
| 当前结果 | `probe` SNI TLS 失败，无证书 | TCP 服务存在；不是 TLS vhost、不是 Reality handshake 目标 |

Aaitr 侧既有只读证据为
`/etc/sing-box/config.json:5-13`：唯一业务入站是 Shadowsocks，绑定当前
Aaitr mesh 地址，端口 `18443`，`multiplex.enabled=true`；Aaitr 没有 443
监听或 443→18443 NAT。详见
`.trellis/tasks/07-28-pagespeed-p0-security-domain/research/aaitr-inventory-2026-07-28.md:69-84,110-136,178-196`。

因此当前事实仅支持“不一致”；不能据此把 `probe` 猜改到 `18443`，也不能把
Shadowsocks multiplex 解释为 `mux.962850.xyz`。

### 6. `mux` 历史残留

活动 `/etc/nginx/nginx.conf` 没有 `mux` 映射或 `30090` listener。
历史非活动文件
`/etc/nginx/nginx.conf.codex-pre-remove-mux-20260720-161601` 曾包含：

- `:56`：`mux.962850.xyz → 11089`；
- `:149-153`：`11089 → 11090`；
- `:182,192`：`30090:mux.962850.xyz → 11090` 及 `30090` listener。

这些行和历史 sing-box 白名单字段已由后续
`mux-probe-traffic-contract-2026-07-28.md` 交叉检查：`mux` 是启用 multiplex
的 VLESS/Reality 入站，handshake 到 Hostdzire `8443`。52 天 stream 日志中，
7 月 2 日有 73 条成功、最长近 3 小时且双向有字节的 `mux → 11089` 会话；
因此它不是从未使用的占位配置。当前仍不知道负责人、客户端入口和可运行探针，
不能仅凭备份恢复。

### 7. 可运行的只读检查和 Reality 回归

当前服务端配置检查：

```bash
ssh dmit 'nginx -t'
ssh dmit 'sing-box check -c /etc/sing-box/config.json'
```

当前共享 443 的 Reality 普通 TLS fallback 回归，不读取 Reality 凭据：

```bash
ssh dmit \
  'curl --resolve brutal.962850.xyz:443:127.0.0.1 \
    --connect-timeout 5 --max-time 10 --silent --show-error \
    --output /dev/null --write-out "%{http_code}\n" \
    https://brutal.962850.xyz/'
```

证书主机名回归：

```bash
ssh dmit \
  'timeout 10 openssl s_client \
    -connect 127.0.0.1:443 \
    -servername brutal.962850.xyz \
    -verify_hostname brutal.962850.xyz \
    -verify_return_error </dev/null'
```

真正的 Reality 鉴权 E2E 必须在已有、受控的客户端配置上运行；DMIT 未发现可用
客户端回归文件，不能为测试读取服务端私钥/UUID 或临时制造凭据。可在获准的
客户端上用以下模板，`REALITY_SOCKS_PORT` 必须是该既有配置的本地 SOCKS
监听，`PROBE_URL` 必须是已批准的无副作用 HTTPS 探针：

```bash
REALITY_CLIENT_CONFIG=/secure/path/existing-client.json
REALITY_SOCKS_PORT=1080
PROBE_URL=https://example.com/

sing-box check -c "$REALITY_CLIENT_CONFIG"
sing-box run -c "$REALITY_CLIENT_CONFIG" &
REALITY_PID=$!
trap 'kill "$REALITY_PID" 2>/dev/null || true' EXIT
curl --fail --silent --show-error \
  --socks5-hostname "127.0.0.1:${REALITY_SOCKS_PORT}" \
  --connect-timeout 5 --max-time 20 \
  --output /dev/null "$PROBE_URL"
```

### 8. 未执行的原子备份、应用和回滚模板

备份目录先在同一文件系统内完整生成，再用一次 `mv` 发布；sing-box 配置含
凭据，目录保持 `0700`，不得把内容输出到终端或仓库：

```bash
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_ROOT=/root/config-backups
BACKUP_DIR="$BACKUP_ROOT/dmit-$STAMP"
install -d -m 700 "$BACKUP_ROOT"
TMP_DIR=$(mktemp -d "$BACKUP_ROOT/.dmit-$STAMP.XXXXXX")
trap 'test ! -d "$TMP_DIR" || rm -r -- "$TMP_DIR"' EXIT

install -m 644 -o root -g root /etc/nginx/nginx.conf \
  "$TMP_DIR/nginx.conf"
install -m 600 -o root -g root /etc/sing-box/config.json \
  "$TMP_DIR/sing-box-config.json"
nginx -T >"$TMP_DIR/nginx-T.txt" 2>&1
systemctl show nginx.service sing-box.service \
  -p Id -p ActiveState -p FragmentPath -p ExecStart \
  >"$TMP_DIR/service-state.txt"
chmod 600 "$TMP_DIR"/*
mv -T -- "$TMP_DIR" "$BACKUP_DIR"
trap - EXIT
printf '%s\n' "$BACKUP_DIR"
```

候选文件必须先单独校验，再原子替换活动文件。下面只给结构，候选路径由实际
变更单指定：

```bash
set -eu
NGINX_CANDIDATE=/secure/stage/nginx.conf
SINGBOX_CANDIDATE=/secure/stage/sing-box-config.json

nginx -t -c "$NGINX_CANDIDATE"
sing-box check -c "$SINGBOX_CANDIDATE"

NGINX_TMP=$(mktemp /etc/nginx/.nginx.conf.XXXXXX)
SINGBOX_TMP=$(mktemp /etc/sing-box/.config.json.XXXXXX)
trap 'rm -f -- "$NGINX_TMP" "$SINGBOX_TMP"' EXIT
install -m 644 -o root -g root "$NGINX_CANDIDATE" "$NGINX_TMP"
install -m 600 -o root -g root "$SINGBOX_CANDIDATE" "$SINGBOX_TMP"
mv -T -- "$NGINX_TMP" /etc/nginx/nginx.conf
mv -T -- "$SINGBOX_TMP" /etc/sing-box/config.json
trap - EXIT

nginx -t
sing-box check -c /etc/sing-box/config.json
systemctl reload nginx
systemctl restart sing-box
systemctl is-active --quiet nginx sing-box
```

回滚前先校验备份，再用同文件系统临时文件原子替换。`BACKUP_DIR` 必须是本次
变更前打印并记录的精确目录：

```bash
set -eu
BACKUP_DIR=/root/config-backups/dmit-YYYYmmddTHHMMSSZ

nginx -t -c "$BACKUP_DIR/nginx.conf"
sing-box check -c "$BACKUP_DIR/sing-box-config.json"

NGINX_TMP=$(mktemp /etc/nginx/.nginx.conf.rollback.XXXXXX)
SINGBOX_TMP=$(mktemp /etc/sing-box/.config.json.rollback.XXXXXX)
trap 'rm -f -- "$NGINX_TMP" "$SINGBOX_TMP"' EXIT
install -m 644 -o root -g root "$BACKUP_DIR/nginx.conf" "$NGINX_TMP"
install -m 600 -o root -g root \
  "$BACKUP_DIR/sing-box-config.json" "$SINGBOX_TMP"
mv -T -- "$NGINX_TMP" /etc/nginx/nginx.conf
mv -T -- "$SINGBOX_TMP" /etc/sing-box/config.json
trap - EXIT

nginx -t
sing-box check -c /etc/sing-box/config.json
systemctl reload nginx
systemctl restart sing-box
systemctl is-active --quiet nginx sing-box
```

这些模板没有在本次只读调查中执行。它们不替代具体变更的逐行 diff、授权、
分层 reload/restart 顺序和业务回归记录。

## External References

- 本次没有新增外部参考；所有结论来自 DMIT 当前运行配置、本机只读握手和任务
  已保存的 Aaitr 只读证据。
- 运行版本：Nginx `1.29.8`；sing-box `1.13.13`
  (`go1.25.10 linux/amd64`)。

## Related Specs

- 已检查 `.trellis/workflow.md`、`.trellis/spec/guides/index.md`、
  当前任务 `prd.md`、`design.md` 和 `implement.md`。
- `.trellis/spec/` 当前没有 DMIT、Nginx stream、Reality、宿主配置备份或
  HSTS 宿主运维专项规范。
- 本调查直接支撑
  `prd.md:44-65`、`design.md:70-105` 和 `implement.md:50-71` 的外部 HTTPS
  门禁，但不修改任务设计或任何 spec。

## Caveats / Not Found

- `probe` 的旧目标身份、业务负责人和应有协议仍未证实；这里只确认它与当前
  Aaitr `18443` 运行态不同，未提出猜测修复。
- `mux` 已确认历史协议为 multiplex-enabled VLESS/Reality，且存在真实长连接
  流量；活动 443 当前仍走 Hostdzire default Web。它与 Aaitr Shadowsocks
  multiplex 不是同一入站，恢复仍缺客户端/负责人和业务探针。
- 普通 TLS fallback 已回归；没有既有 Reality 客户端配置，因此未执行带凭据
  的 Reality 认证 E2E。启用 HSTS 或修改 Reality 前仍需从受控客户端运行。
- `nginx -t` 和 `sing-box check` 只证明语法/静态配置有效，不证明上游协议、
  证书、SNI、PROXY protocol 或 Reality 鉴权端到端可用。
- 本次没有修改远端、代码、spec、任务规划或 Git；唯一新增文件是本 research
  artifact。
