# 域名安全运维契约

## 1. Scope / Trigger

适用于根域或子域的 DNS、Nginx/SNI、证书、HSTS、preload、公开面或服务退役
变化。此类工作必须有 Trellis 任务、逐名台账、精确实施方案和单独外部写授权；
只读调查和产品选择不等于线上执行授权。

## 2. Signatures

Cloudflare 操作只使用官方 Zone-scoped API：

```text
GET    /client/v4/zones?name={fqdn}&account.id={account_id}&status=active
GET    /client/v4/zones/{zone_id}/dns_records
GET    /client/v4/zones/{zone_id}/dns_records/export
POST   /client/v4/zones/{zone_id}/dns_records
DELETE /client/v4/zones/{zone_id}/dns_records/{record_id}
```

宿主操作使用项目 SSH 别名与原生命令：

```text
ssh dmit <read-or-approved-write-command>
ssh hostdzire <read-or-approved-write-command>
nginx -T
nginx -t
systemctl reload nginx
```

## 3. Contracts

- 输入：唯一根域、唯一 active/full Zone、期望变更前记录集合、精确 record ID、
  逐名用途/退役结论、TLS 终止点和用户授权范围。
- 凭据：只从宿主既有 root-only 配置读取；不得输出、复制到仓库、命令行参数、
  日志或任务文档。
- 原始 BIND/API/配置快照：保存到 root 所有的 `0700` 运维目录，文件 `0600`；
  仓库只保存脱敏记录、时间、大小、SHA-256 和受控路径。
- DNS 写入：创建后必须在两台权威 NS 和两个公共 resolver 得到唯一期望值；
  删除后必须同时满足 API absence 与四端 NXDOMAIN。
- Nginx 写入：固定目标 allowlist、变更前快照、同文件系统临时文件和原子替换；
  `nginx -t` 成功后才 reload。
- HSTS：先关闭公开、内部、嵌套和未来名称的 HTTPS/退役边界，再按任务定义的
  短周期到长周期逐级观察；正式 preload 另取不可逆确认。

## 4. Validation & Error Matrix

| 条件 | 处理 |
| --- | --- |
| Zone 查询不是唯一 active/full | 停止，不读写任何记录 |
| 变更前记录集合或目标 record ID 漂移 | 重新生成提案并让用户复核 |
| 原始快照目录/文件权限不是 `0700`/`0600` | 停止写操作并修正权限 |
| 权威或公共 resolver 返回值不一致 | 停止后续阶段，等待一致或回滚本次记录 |
| `nginx -t` 失败 | 不 reload；按精确快照恢复 |
| reload 后业务、证书或 default fail-closed 探针失败 | 停止后续 DNS/HSTS 阶段并回滚本层 |
| 任一内部/嵌套名称仍未知 | 不启用 `includeSubDomains` |
| preload 风险未再次确认 | 不添加 `preload`，不提交表单 |

## 5. Good / Base / Bad Cases

- Good：唯一 Zone 与 record ID、受控快照、四端 DNS 验证、配置检查和逐名业务
  探针全部通过，再进入下一层。
- Base：只读证据和提案完成但未获外部写授权；保持线上不变，任务状态为 Open。
- Bad：按名称批量删除、把公共 NXDOMAIN 当作内部不存在、跳过观察期、以默认
  Web 200 冒充退役/协议成功，或因回滚恢复已废弃监听。

## 6. Tests Required

- DNS：API 唯一性、双权威、`1.1.1.1`、`8.8.8.8`；删除后 API absence 和
  四端 NXDOMAIN。
- 配置：变更前后 `nginx -T` 与 SHA-256、`nginx -t`、服务 active。
- TLS/HTTP：逐名证书链/主机名/到期、80 同主机升级、443 业务响应、未知 SNI
  fail-closed。
- 退役：活动 Nginx/sing-box/监听/防火墙零服务引用，历史快照与审计仍存在。
- HSTS/preload：每阶段实际响应头、完整观察时间、内部/外部网络矩阵和官方状态
  API；最终以 `preloaded` 而非“已提交”关闭。

## 7. Wrong vs Correct

### Wrong

```text
按 FQDN 删除所有匹配记录 → reload 未检查的 Nginx → 直接启用 preload
```

### Correct

```text
唯一 Zone/record ID → 受控快照 → 单层原子变更 → 配置与业务验证
→ 双权威/双公共验证 → 完整 HSTS 观察 → 单独确认 preload
```

## 8. Scenario: API upstream 空闲连接协调

### 8.1 Scope / Trigger

Nginx 使用 upstream 连接池代理 Uvicorn API 时，必须显式协调双方的空闲连接寿命；
该约束不适用于前端或对象存储 upstream。

### 8.2 Signatures

```text
Nginx API upstream: keepalive_timeout 30s;
Uvicorn API command: --timeout-keep-alive 35
```

### 8.3 Contracts

- 必须保持 `Nginx 30s < Uvicorn 35s`，由代理提前 5 秒淘汰空闲连接。
- production 与 staging 使用相同精确值，并由部署自检锁定。
- 不增加 `proxy_next_upstream`、客户端静默重试或业务 fallback。

### 8.4 Validation & Error Matrix

| 条件 | 处理 |
| --- | --- |
| 任一环境缺少精确的 `30s` 或 `35` | 部署自检失败，不发布 |
| `nginx -t` 失败 | 不 reload，恢复同一已验证旧 release |
| 出现 premature close 且容器无重启/OOM | 核对生效配置和 API 进程参数，不先增加重试 |
| 发布后健康探针或浏览器请求失败 | 停止更新 `current`，按完整 release 回滚 |

### 8.5 Good / Base / Bad Cases

- Good：两侧精确值通过静态门禁、Compose 解析和 `nginx -t`，发布后连续探针正常。
- Base：本地缺少 staging 环境文件时，由隔离部署脚本验证结构并明确记录直接校验跳过。
- Bad：只延长一侧超时，或用代理/业务重试掩盖空闲连接竞态。

### 8.6 Tests Required

- `check-nginx-security.mjs` 和部署脚本自检通过。
- production/staging Compose 能解析，且 API 命令包含精确的 `35`。
- 部署后至少连续 6 次、间隔 6 秒执行只读 API 探针，并核对时间窗内无新的
  `upstream prematurely closed connection`。

### 8.7 Wrong vs Correct

```text
Wrong: Uvicorn 5s + Nginx 长期保留连接 → 增加 proxy retry
Correct: Nginx 30s < Uvicorn 35s → 代理先淘汰连接 → 不增加重试
```

## 9. Scenario: Docker bridge 回连宿主机公网 HTTPS

### 9.1 Scope / Trigger

当容器访问的公网 FQDN 因 GeoDNS 或同机部署解析为 Hostdzire 自身公网 IP 时，流量会从
Docker bridge 进入宿主机 INPUT 链。所有 Docker 项目需要复用宿主机 HTTPS 时使用本契约；
普通公网出站、容器间通信和宿主机其他端口不在此放行范围。

### 9.2 Signatures

持久规则固定写入 `/etc/iptables/rules.v4`，运行时规则必须与之等价：

```text
-A INPUT -d <HOSTDZIRE_PUBLIC_IP>/32 -i docker0 -p tcp -m tcp --dport 443 -j ACCEPT
-A INPUT -d <HOSTDZIRE_PUBLIC_IP>/32 -i br+ -p tcp -m tcp --dport 443 -j ACCEPT
```

其中 `br+` 是 iptables 的接口前缀匹配，覆盖当前和未来的 Docker 用户自定义 bridge；
`docker0` 单独覆盖默认 bridge。

### 9.3 Contracts

- 只允许 Docker bridge 回连宿主机自身公网 IP 的 TCP 443；不得同步开放 22、80 或其他端口。
- 不按某个 Compose 项目的临时网段或 bridge ID 写规则；网络重建后仍应匹配 `docker0` 与 `br-*`。
- 不使用无接口约束的 `172.16.0.0/12` 放行，避免伪造 RFC1918 来源扩大宿主机入口。
- `internal: true` 网络仍由 Docker 路由边界隔离；INPUT 规则不得被解释为授予外部默认路由。
- 修改前备份持久文件，先执行 `iptables-restore --test`，再应用等价运行时规则；失败必须恢复文件并删除本次新增运行时规则。
- 外部 AI 验证只使用无效诊断凭据确认 401/403 和耗时，不读取或调用已公开的真实密钥。

### 9.4 Validation & Error Matrix

| 条件 | 处理 |
| --- | --- |
| 宿主机请求成功、容器 TCP 连接同一公网 IP 超时 | 核对 FQDN 是否解析到宿主机自身 IP，以及 INPUT 默认策略和 bridge 规则 |
| `iptables-restore --test` 失败 | 不应用运行时规则，恢复持久文件备份 |
| 容器访问宿主机 22/80 变为可达 | 立即回滚；规则范围过宽 |
| 443 可达但供应商仍返回 401/403 | hairpin 已恢复，进入凭据/权限排障，不扩大防火墙 |
| 443 可达但应用仍报超时 | 核对 TLS、应用超时和 Nginx `request_time`，不增加重试或静默 fallback |
| 公网 smoke、Nginx 或容器健康失败 | 保留现场并回滚本次规则 |

### 9.5 Good / Base / Bad Cases

- Good：`docker0` 与 `br+` 仅命中宿主机公网 443；多个项目 bridge 均快速得到供应商明确 HTTP 响应，22/80 继续超时。
- Base：目标 FQDN 不解析到宿主机自身 IP；无需 hairpin 规则，按普通公网出站排障。
- Bad：只放行单个 Compose 网段导致其他项目继续失败，或放行整个私网来源到全部宿主机端口。

### 9.6 Tests Required

- 枚举 `docker network inspect`，确认 bridge 项目与接口命名边界。
- `iptables-restore --test < /etc/iptables/rules.v4` 通过，运行时 `iptables -S INPUT` 存在两条等价规则。
- 从至少两个不同项目 bridge 无凭据访问目标 HTTPS，5 秒内返回明确 401/403；PartSignal API 容器使用实际固定 DNS 传输做同样检查。
- 从容器连接宿主机公网 IP 的 22/80 仍失败，443 成功。
- `nginx -t`、公网 smoke、API ready 和关键容器健康均通过。

### 9.7 Wrong vs Correct

```text
Wrong: 只放行 172.24.0.0/16，或允许 172.16.0.0/12 访问宿主机全部端口
Correct: docker0 + br+ → 仅宿主机公网 IP:443 → 持久/运行时一致并验证其他端口仍关闭
```
