# `962850.xyz` DNS、Nginx 与 HSTS 精确变更提案

## 1. 边界和授权状态

本文是评审用提案，不是服务变更执行记录。除按用户授权把 Cloudflare BIND 原文
保存到 Hostdzire root 专用运维目录外，没有修改 Cloudflare DNS、DMIT、
Hostdzire/Aaitr 服务、证书、Nginx、sing-box 或线上业务环境。

2026-07-28 用户已确认：

- 根域先由 HTTP 同主机升级到 HTTPS，再由
  `https://962850.xyz/` 跳转到 `https://geo.962850.xyz/`；
- 删除 `relay.962850.xyz` 的公开 DNS；
- `mux.962850.xyz`、`probe.962850.xyz` 退役，删除活动引用但保留历史证据；
- Cloudflare 随机 TXT 控制权证明和 Aaitr 只读盘点；
- 公开索引、`robots Allow: /`、meta description、最小 `llms.txt` 和可匿名
  获取、包含 `sourcesContent` 的生产 source map。

以下动作仍未获执行授权：

- 发布 PartSignal 当前本地版本；
- 新增根域 A、删除 `relay` A；
- 修改或 reload Hostdzire/DMIT/Aaitr 服务；
- 运行会触发 DNS-01、签发或部署证书的 ACME 续期验证；
- 启用任一 `includeSubDomains` 阶段；
- 添加 `preload` 指令或提交正式 preload 表单。

`mux` 和 `probe` 的退役依据不同：

- `mux` 的历史日志和脱敏配置确认了 VLESS/Reality + multiplex、共享 443 /
  历史专用 30090、`11089/11090` 与 Hostdzire `8443` handshake 路径，并证明
  7 月仍有真实长连接；当前 sing-box、DMIT Nginx 和防火墙均已无该服务入口；
- `probe` 仍缺真实协议、负责人和有效目标，52 天日志只有本轮 4 条 502 审计
  探测。

本提案不恢复历史监听，也不用默认 Web 200、占位 404 或协议转换冒充业务修复。
退役只删除剩余活动引用，历史备份、聚合日志和脱敏审计不删除。

## 2. 已复核的当前事实

### 2.1 DNS 与控制权

- Cloudflare Zone 为 `active/full`，当前 14 条记录。
- 8 个公开 Web A 均为 DNS-only、TTL auto，指向 DMIT 公网入口
  `154.21.86.86`。
- 根域当前只有 MX/TXT，没有 A/AAAA/CNAME。
- `relay` 当前有一个 A；`mux`、`probe` 为权威 NXDOMAIN。
- 一次性随机 TXT 已在 `jule.ns.cloudflare.com`、
  `neil.ns.cloudflare.com`、`1.1.1.1`、`8.8.8.8` 同时可见，随后按唯一
  record ID 删除；Cloudflare API 为零记录且四端均为 NXDOMAIN。
- 仓库只保存 14 条记录的脱敏派生清单、TXT 内容哈希和 BIND export 内容哈希；
  当前 export 包含 14 条用户记录和 2 条 provider NS，原文已保存到 Hostdzire
  root 专用 `0700` 运维目录
  `/root/partsignal-ops/pagespeed-p0-20260728/` 的 `0600`
  `cloudflare-962850.xyz.bind`；SHA-256 为
  `1ba08f457da1d5469c9eac0ea65cdab358c31e4e3d10ddc91ebaff164714daba`。
- Cloudflare credentialed GET 与随机 TXT 写后删证明已经直接证明 DNS 技术控制。
  注册商登录截图不是 Lighthouse、HSTS 或 preload 正式要求；公开 RDAP 已记录
  Spaceship、到期日和 transfer lock，账户恢复/自动续费未独立验证的风险单列。

### 2.2 入口、证书和默认路由

- DMIT 80 把 Web 流量以 PROXY protocol 转到 Hostdzire 80。
- DMIT 443 用 SNI 分流；除 `probe`、`brutal` 外的非空 SNI默认转到
  Hostdzire 443。
- Hostdzire 80 已有 `default_server` 并返回 444。
- Hostdzire 443 没有 `default_server`；当前第一个 443 vhost 是 `api`，
  所以根域、`relay`、`mux` 等未知 Host 会错误落入 API。
- 现有证书 SAN 为 `962850.xyz` 和 `*.962850.xyz`，当前有效；不覆盖
  `a.b.962850.xyz`。
- Hostdzire 根用户 crontab 经主 Agent 复核，存在一条活动的每日
  `23:49` `acme.sh --cron`；`certbot.timer` 为 disabled。早先“未发现
  acme.sh 调度”的临时结论作废。存在调度不等于续期、部署和 reload 已通过
  端到端验收。

### 2.3 特殊名称

- `brutal` 的 443 Reality fallback 最终由 Hostdzire 8443 TLS vhost 响应；
  `/` 当前为 200，缺失文件才为 404。其 HTTP 当前落 80 default 444。
- `relay` 没有专属 Hostdzire vhost，HTTPS 当前错误落入 API。
- `mux` 只有 Hostdzire 8443 的合并 `server_name` 和 DMIT 历史非活动路由；
  当前 443 走默认 Web 路径。没有专用业务可用性证据。
- `probe` 仍由 DMIT 指向旧 TLS 443 目标且握手失败；当前 Aaitr 只有非 TLS
  Shadowsocks 2022 `18443`，两者不是同一协议或地址角色。

## 3. 精确期望差异

### 3.1 Cloudflare DNS

```diff
+ A  962850.xyz        154.21.86.86  TTL=auto  proxied=false
- A  relay.962850.xyz  154.21.86.86  TTL=auto  proxied=false
```

不新增 `www`、`mux`、`probe`、通配或 AAAA。MX、SPF、DMARC、DKIM 及其余
7 个现有 Web A 不变。

执行前必须重新 GET 并断言：

1. Zone 仍为唯一 `active/full`；
2. 根域 A/AAAA/CNAME 仍为空；
3. `relay` 仍恰好只有一个 A，目标、proxy 和 TTL 与受控原始导出一致；
4. 其余记录集合与变更前 BIND export 哈希一致。

Cloudflare 写操作按返回的唯一 record ID 执行，不能按模糊名称批量删除。原始
BIND export、API 响应和 record ID 只保存到 Hostdzire `0700` 目录中的
`0600` 文件；仓库仅保存脱敏记录、哈希、时间和结果。

### 3.2 Hostdzire 新增根域 vhost

新增 `/etc/nginx/sites-enabled/962850.xyz.conf`：

```nginx
server {
    listen <HOSTDZIRE_WG_ADDRESS>:80 proxy_protocol;
    server_name 962850.xyz;

    return 308 https://962850.xyz$request_uri;
}

server {
    listen <HOSTDZIRE_WG_ADDRESS>:443 ssl proxy_protocol;
    http2 on;
    server_name 962850.xyz;

    include /etc/nginx/snippets/cert-962850.xyz.conf;
    include /etc/nginx/snippets/ssl-common.conf;
    include /etc/nginx/snippets/962850-hsts-root.conf;

    return 308 https://geo.962850.xyz/;
}
```

`<HOSTDZIRE_WG_ADDRESS>` 在受控候选文件中从现有 `geo`/`api` 的同一
`listen` 地址逐字复用，不在仓库证据中保存内部地址。HTTP 保留路径完成同主机
升级；HTTPS 根域统一落到 `geo` 根路径，不把根域任意路径误映射为 PartSignal
业务路由。

### 3.3 Hostdzire 新增 443 默认拒绝

新增 `/etc/nginx/conf.d/00-default-https.conf`：

```nginx
server {
    listen <HOSTDZIRE_WG_ADDRESS>:443 ssl proxy_protocol default_server backlog=8192;
    http2 on;
    server_name _;

    include /etc/nginx/snippets/cert-962850.xyz.conf;
    include /etc/nginx/snippets/ssl-common.conf;

    return 444;
}
```

它只关闭未知 SNI/Host 错落首个 API vhost 的现存漏洞，不替代任何已知名称的
专属 vhost。若该变更发现未登记的真实业务 Host，正确处理是先加入域名台账并
建立专属 HTTPS，而不是永久移除 default catchall。

### 3.4 Hostdzire 修复 `brutal` HTTP

在 `/etc/nginx/sites-enabled/brutal.962850.xyz.conf` 的现有 8443 server
之前新增：

```nginx
server {
    listen <HOSTDZIRE_WG_ADDRESS>:80 proxy_protocol;
    server_name brutal.962850.xyz;

    return 308 https://brutal.962850.xyz$request_uri;
}
```

现有 8443 `root`、`index`、`try_files`、证书和 Reality handshake 均不改；
`server_name` 按 3.8 只移除已退役的 `mux`。`/` 必须继续为 200，不能改成
固定 404。

### 3.5 HSTS 不降级的两层所有权

为避免把 `geo`、`vault` 现有一年 HSTS 临时降到 300 秒，使用两个静态
snippet，不引入 `map`、变量策略或站点复制值：

`/etc/nginx/snippets/962850-hsts-host.conf`：

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
```

该 snippet 替换 `geo`、`vault` 的现有独立 HSTS 行，并由 `api`、`cpa`、
`geo`、`leak`、`md2word`、`vault` 及 `brutal` 8443 TLS vhost 引用。
这只统一并保持各精确主机的一年策略，不带 `includeSubDomains` 或 `preload`。

`/etc/nginx/snippets/962850-hsts-root.conf` 在 HTTPS 准备阶段为：

```nginx
add_header Strict-Transport-Security "max-age=300" always;
```

它只由根域 443 vhost 引用。首次 `includeSubDomains` 授权后才改为：

```nginx
add_header Strict-Transport-Security "max-age=300; includeSubDomains" always;
```

之后只修改该一行，依次为 7 天、30 天、一年；最终不可逆确认后才改为两年并
添加 `preload`。这样根域继承策略只有一个事实源，现有精确主机安全强度不降低。

### 3.6 PartSignal source map 响应

仓库 `frontend/nginx.conf` 已在前端容器内为 `/assets/*.map` 配置
`application/json` 和 immutable；Hostdzire 外层唯一安全头 snippet 统一提供
`X-Content-Type-Options: nosniff`。`partsignal-staging.conf` 继续把
`/assets/` 代理到容器，不复制第二套扩展名逻辑；发布后验证外层没有覆盖容器的
Content-Type，且最终响应只有一个有效的 `nosniff`。

### 3.7 此批次明确不改

- DMIT `/etc/sing-box/config.json`；
- Aaitr `/etc/sing-box/config.json`；
- `mux`、`probe` DNS；
- `brutal` Reality/VLESS/Brutal 凭据、端口和上游；
- 邮件、其他 7 个 Web A、`www`、通配或嵌套名称；
- `includeSubDomains`、`preload` 和 preload 表单。

### 3.8 `mux` / `probe` 退役

当前活动面已复核：

- DMIT sing-box 没有 `mux` 或 `probe` inbound；
- DMIT Nginx 没有 `mux` map、11089 剥离层或 30090 listener，但仍有
  `probe.962850.xyz → <legacy-probe-target>:443`；
- DMIT live/persistent firewall 均无 30090；
- Hostdzire 8443 仍把 `mux.962850.xyz` 与 `brutal.962850.xyz` 合并声明；
- `mux`、`probe` 的双权威和双公共 DNS 均为 NXDOMAIN。

因此最小差异只有两处：

```diff
# Hostdzire /etc/nginx/sites-enabled/brutal.962850.xyz.conf
-server_name brutal.962850.xyz mux.962850.xyz;
+server_name brutal.962850.xyz;

# DMIT /etc/nginx/nginx.conf
 map $ssl_preread_server_name $https_backend {
     ""                 127.0.0.1:9;
-    probe.962850.xyz   <legacy-probe-target>:443;
     brutal.962850.xyz  127.0.0.1:11085;
     default            <hostdzire-wg>:443;
 }
```

不删除 DNS，因为两名已是 NXDOMAIN；不改 sing-box、防火墙、历史备份或日志。
顺序固定为：Hostdzire 同一份通过 `nginx -t` 的配置同时安装 443 default
catchall、移除 `mux` 别名并 reload；验证 default 444 后，才在 DMIT 移除
`probe` map 并 `nginx -t`/reload。这样合成 DNS、缓存 SNI 或手工
`--resolve` 也只会被 Hostdzire default 444 拒绝，不会回退到 API。

关闭阈值为：双权威和双公共均 NXDOMAIN；活动 `nginx -T`、sing-box 配置、
监听端口和防火墙零 `mux/probe` 服务引用；两名经 DMIT 443 均不能取得业务
vhost 响应；`brutal` Reality 与 8443 fallback 保持原行为。历史日志只作为
退役审计，不要求恢复探针。

## 4. 部署顺序和验收

### 4.1 进入条件

- 用户审阅本文并明确授权本批 DNS/Nginx/应用发布；
- Cloudflare 原始 BIND export 已进入受控存储，技术读写控制证明完整；
- 用户已确认 `mux`/`probe` 退役，且两处最小活动引用删除和回滚已经成文；
- 已完成其余 WireGuard/mesh/办公网 resolver/hosts 的清单，无未知名称；
- PartSignal 发布产物的 source map 泄密门禁、构建和回归全部通过。

### 4.2 顺序

1. 保存 Cloudflare BIND export、API 记录快照和哈希。
2. **应用阶段**：严格按独立任务
   `07-28-production-redeployment` 的已评审维护窗口、备份、隔离恢复和有损迁移
   门禁发布 PartSignal 候选版本到既有 `geo`，验证公开资产、source map、
   CSP/TT、登录和权限边界。迁移前失败按该任务恢复旧 release；迁移后失败保持
   停写和现场，等待负责人决定前滚或主库恢复，不能笼统回滚应用。任一失败都
   停止本流程，此时尚未修改本提案的 Hostdzire vhost 或 DNS。
3. 保存 Hostdzire `nginx -T`、下列 allowlist 目标、证书元数据和服务状态；
   目标文件不存在时记录为 `originally-absent`。
4. **Hostdzire Nginx 阶段**：将 allowlist 中全部候选写到目标目录同文件系统
   临时文件，设置 `root:root 0644`，再逐文件原子 `mv`；该候选包含 default
   catchall 和 `mux` 别名删除。
5. `nginx -t`；失败立即按备份恢复，不能 reload。
6. `systemctl reload nginx`，确认 active；不 restart sing-box。
7. 在 DNS 变更前用 `--resolve <name>:<port>:154.21.86.86` 完成根域、
   `brutal`、所有现有 Web 名称、未知 Host 和既有 Reality 客户端回归。失败则
   回滚 Nginx 并停止；此时尚未修改 DNS。
8. **DMIT `probe` 退役阶段**：在 root 专用 `0700` 临时目录以 `0600` 保存
   `/etc/nginx/nginx.conf` 和 `nginx -T`，原子删除唯一 `probe` map 行；
   `nginx -t` 成功后 reload，验证 `probe` SNI 落入已通过的 default 444。
   失败按 5.5 恢复，Hostdzire 安全 catchall 保留。
9. **DNS 阶段**：Cloudflare 新增根域 A；两权威 NS 和两个公共 resolver 均
   返回唯一正确 A。
10. Cloudflare 按唯一 record ID 删除 `relay` A；四端等待并确认 NXDOMAIN。
11. 保存变更后 Zone、两端 `nginx -T`、证书、响应矩阵和脱敏审计记录。

Hostdzire 备份和修改 allowlist 固定为：

```text
/etc/nginx/conf.d/00-default-https.conf
/etc/nginx/sites-enabled/962850.xyz.conf
/etc/nginx/sites-enabled/api.962850.xyz.conf
/etc/nginx/sites-enabled/cpa.962850.xyz.conf
/etc/nginx/sites-enabled/partsignal-staging.conf
/etc/nginx/sites-enabled/leak.962850.xyz.conf
/etc/nginx/sites-enabled/md2word-api.962850.xyz.conf
/etc/nginx/sites-enabled/vault.962850.xyz.conf
/etc/nginx/sites-enabled/brutal.962850.xyz.conf
/etc/nginx/snippets/962850-hsts-host.conf
/etc/nginx/snippets/962850-hsts-root.conf
```

与 5.1 回滚模板配套的备份命令为：

```bash
set -eu
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_DIR=$(mktemp -d "/root/nginx-rollback-${STAMP}.XXXXXX")
chmod 0700 "$BACKUP_DIR"

printf '%s\n' \
    /etc/nginx/conf.d/00-default-https.conf \
    /etc/nginx/sites-enabled/962850.xyz.conf \
    /etc/nginx/sites-enabled/api.962850.xyz.conf \
    /etc/nginx/sites-enabled/cpa.962850.xyz.conf \
    /etc/nginx/sites-enabled/partsignal-staging.conf \
    /etc/nginx/sites-enabled/leak.962850.xyz.conf \
    /etc/nginx/sites-enabled/md2word-api.962850.xyz.conf \
    /etc/nginx/sites-enabled/vault.962850.xyz.conf \
    /etc/nginx/sites-enabled/brutal.962850.xyz.conf \
    /etc/nginx/snippets/962850-hsts-host.conf \
    /etc/nginx/snippets/962850-hsts-root.conf \
    >"$BACKUP_DIR/targets"
: >"$BACKUP_DIR/originally-absent"

while IFS= read -r target; do
    if test -f "$target"; then
        install -D -m 0600 -o root -g root "$target" "$BACKUP_DIR$target"
    else
        printf '%s\n' "$target" >>"$BACKUP_DIR/originally-absent"
    fi
done <"$BACKUP_DIR/targets"

nginx -T >"$BACKUP_DIR/nginx-T.txt" 2>&1
chmod 0600 "$BACKUP_DIR/targets" \
    "$BACKUP_DIR/originally-absent" \
    "$BACKUP_DIR/nginx-T.txt"
printf '%s\n' "$BACKUP_DIR"
```

### 4.3 阈值

| 项目 | 验收条件 |
|---|---|
| Nginx | `nginx -t` 成功；reload 后 active；错误日志无新增配置/上游错误 |
| 根域 DNS | 两权威 NS + `1.1.1.1` + `8.8.8.8` 仅返回 `154.21.86.86` |
| 根域 HTTP | `308`，`Location` 为相同 host HTTPS 并保留请求路径 |
| 根域 HTTPS | 证书主机名/链/到期通过；`308` 到 `https://geo.962850.xyz/`；响应自身带当前 root HSTS |
| 已知 Web 名称 | HTTP 只同主机升级；HTTPS 证书有效且业务探针与变更前一致 |
| 未知 Host | 不再落 API；Hostdzire 443 default 返回 444/空响应 |
| `relay` | Cloudflare API 零记录；双权威 + 双公共均 NXDOMAIN |
| `mux` / `probe` | 双权威 + 双公共均 NXDOMAIN；活动 Nginx/sing-box/监听/防火墙零服务引用；经 DMIT 443 不返回业务 vhost |
| `brutal` | HTTP 308 同主机；443 TLS fallback `/` 仍 200；既有 Reality 客户端无副作用探针通过 |
| source map | 匿名 200；`application/json`、`nosniff`、immutable；PageSpeed `valid-source-maps` 通过 |
| ACME | cron 活动；受控续期后新证书 SAN/链/部署路径正确，Nginx reload 成功 |

任一业务探针、证书、Reality 鉴权、默认拒绝或 DNS 唯一性失败，都不得进入
`includeSubDomains`。

## 5. 独立回滚

### 5.1 Hostdzire

变更前建立 `0700` 备份目录，保存每个目标文件；原本不存在的文件单独登记。
每个候选先写 `<target>.new`，再同文件系统 `mv -T`。`nginx -t` 或行为探针
失败时执行以下受控恢复模板；`BACKUP_DIR` 必须替换为本次变更前记录的精确
绝对路径：

```bash
set -eu
BACKUP_DIR=/root/nginx-rollback-YYYYmmddTHHMMSSZ.XXXXXX
TARGETS_FILE="$BACKUP_DIR/targets"
ABSENT_FILE="$BACKUP_DIR/originally-absent"

test -d "$BACKUP_DIR"
test -f "$TARGETS_FILE"
test -f "$ABSENT_FILE"

is_allowed_target() {
    case "$1" in
        /etc/nginx/conf.d/00-default-https.conf|\
        /etc/nginx/sites-enabled/962850.xyz.conf|\
        /etc/nginx/sites-enabled/api.962850.xyz.conf|\
        /etc/nginx/sites-enabled/cpa.962850.xyz.conf|\
        /etc/nginx/sites-enabled/partsignal-staging.conf|\
        /etc/nginx/sites-enabled/leak.962850.xyz.conf|\
        /etc/nginx/sites-enabled/md2word-api.962850.xyz.conf|\
        /etc/nginx/sites-enabled/vault.962850.xyz.conf|\
        /etc/nginx/sites-enabled/brutal.962850.xyz.conf|\
        /etc/nginx/snippets/962850-hsts-host.conf|\
        /etc/nginx/snippets/962850-hsts-root.conf) return 0 ;;
        *) return 1 ;;
    esac
}

while IFS= read -r target; do
    is_allowed_target "$target"
    backup="$BACKUP_DIR$target"
    if test -f "$backup"; then
        tmp=$(mktemp "${target}.rollback.XXXXXX")
        install -m 0644 -o root -g root "$backup" "$tmp"
        mv -T -- "$tmp" "$target"
    fi
done <"$TARGETS_FILE"

while IFS= read -r target; do
    is_allowed_target "$target"
    rm -f -- "$target"
done <"$ABSENT_FILE"

nginx -t
systemctl reload nginx
systemctl is-active --quiet nginx
```

不得使用通配删除、目录级覆盖、`git checkout` 或重启 sing-box 代替精确回滚。

### 5.2 根域 DNS

若根域上线失败，按本次创建返回的唯一 record ID 删除根域 A，确认 Cloudflare
API、双权威和双公共均恢复无 A；DNS 恢复传播完成后再按 5.1 回滚根域 vhost。
MX/TXT 不变。若 DNS 阶段任一步失败，先恢复 DNS，再决定是否回滚已经通过探针
的 Nginx；不能在根域 A 仍解析时先移除根域 vhost。

### 5.3 `relay`

若删除后证实仍有合法消费者，先停止关闭流程并确认负责人、协议和目标。紧急
恢复只能按变更前受控快照重建原 A；保留新的 443 default fail-closed，不能
恢复“未知 Host 落入 API”的错误行为。随后为 `relay` 建立专属服务契约和
80/443 vhost。

### 5.4 HSTS

- 首个 `includeSubDomains` 阶段前，root snippet 不含该指令。
- 阶段内故障优先修复 HTTPS；必要时 root snippet 发送 `max-age=0` 只能影响
  后续收到该响应的动态 HSTS，不能即时撤销已缓存策略。
- preload 后必须保持有效 HTTPS、移除 `preload` 指令并提交官方 removal；
  多数 Chrome 用户通常仍需 6–12 周，其他浏览器可能更久。

### 5.5 `mux` / `probe` 退役

Hostdzire 回滚使用 5.1 的受控快照，只把
`/etc/nginx/sites-enabled/brutal.962850.xyz.conf` 恢复到变更前版本，
`nginx -t` 后 reload；新的 443 default catchall 必须保留，不能恢复未知 Host
落入 API 的错误行为。

DMIT 回滚只从本次 `0700` 目录的 `0600` 快照原子恢复
`/etc/nginx/nginx.conf`，`nginx -t` 后 reload。不得从 7 月历史备份恢复
sing-box inbound、11089/11090、30090 或防火墙规则。若回滚是因为发现合法
消费者，停止 HSTS 流程并让用户重新决定产品契约；不自动重建退役服务。

任何回滚都保留本次前后 `nginx -T`、哈希和聚合日志，不删除历史证据。

## 6. 仍需用户提供的事实或授权

### 6.1 内部解析范围

除 DMIT、Hostdzire、Aaitr 和当前工作站外，仍需确认哪些 WireGuard/mesh
客户端、办公网 DNS、路由器、CI/CD runner 或私有 resolver 可能解析或引用
`962850.xyz`。`mux/probe` 已作出退役决定，不再等待未知服务契约。

### 6.2 控制与执行

- Cloudflare BIND 原文已按授权保存到 Hostdzire root 专用 `0700` 目录的
  `0600` 文件；注册商登录截图不再是技术硬门槛。
- 在上述内部解析范围关闭后，另行明确授权：
  1. 本批应用发布 + Hostdzire reload + 根域/`relay` DNS；
  2. DMIT `probe` map 删除；Hostdzire `mux` 别名删除包含在第 1 项配置批次；
  3. 受控 ACME 续期验证；
  4. 每个 `includeSubDomains` 阶段；
  5. 最终 `preload` 指令和正式表单提交。

## 7. 官方流程校验

2026-07-28 复核 `hstspreload.org`：

- 所有公开、内部和嵌套子域都必须支持有效 HTTPS；
- 80 若存在必须先同主机升级到 HTTPS；
- 根域 HTTPS 重定向响应自身必须带 HSTS；
- 建议按 300 秒、7 天、30 天逐级并等待完整 `max-age`；
- preload 要求根域至少一年、`includeSubDomains` 和 `preload`；
- 官方明确 HSTS 推荐但 preload 不再普遍推荐；
- removal 到达多数 Chrome 通常需 6–12 周，其他浏览器可能更久。

因此，本任务在一年 `includeSubDomains` 观察完成后仍必须单独取得最终不可逆
确认，不能把“用户要求最终 preload”解释为提前授权表单提交。
