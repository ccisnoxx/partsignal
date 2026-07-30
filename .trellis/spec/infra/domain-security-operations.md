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
