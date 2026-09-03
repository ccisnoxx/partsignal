# Staging 当前运行态正面门禁

## 结论

2026-08-30 20:12:24（Asia/Shanghai），经用户明确授权使用 `ssh hostdzire` 执行只读核验，`https://geo.962850.xyz` 当前公网实例已与任务材料中记录的 Staging release `mvp-20260830-133651-a663bcce` 形成直接、可交叉验证的运行链路。Staging 身份门禁为 `PASS`。

核验只读取 release symlink、Git commit、运行中 frontend 容器的指定 image/Compose labels、端口绑定、PartSignal Staging Nginx 站点的精确目标/校验和/允许字段，以及公网 health。没有读取或输出 `.env`、容器环境变量、secret、Cookie、Token、证书私钥、请求头或其他敏感配置；没有执行写文件、reload、restart、容器变更或部署动作。

## Release 与 source

| 字段 | 当前运行值 | 已记录 Staging 值 | 结果 |
| --- | --- | --- | --- |
| `/root/partsignal/current` | `releases/mvp-20260830-133651-a663bcce` | 同值 | `PASS` |
| 解析目录 | `/root/partsignal/releases/mvp-20260830-133651-a663bcce` | 同值 | `PASS` |
| Git commit | `a663bcce9fd49da9c5aea7f257372fc318447234` | 同值 | `PASS` |

## Frontend 容器与 Compose

按 `com.docker.compose.project=partsignal-staging` 和 `com.docker.compose.service=frontend` 过滤，运行中容器精确为 1 个。

| 字段 | 当前运行值 | 已记录/合同值 | 结果 |
| --- | --- | --- | --- |
| 容器 | `partsignal-staging-frontend-1` | Staging frontend service | `PASS` |
| image reference | `partsignal-frontend:mvp-20260830-133651-a663bcce` | 同值 | `PASS` |
| image ID | `sha256:c0826f2a31e30d160252c1385e6b2b14d3fcfc58ec49692b0202cb45533dca1e` | 同值 | `PASS` |
| Compose project | `partsignal-staging` | 同值 | `PASS` |
| Compose service | `frontend` | 同值 | `PASS` |
| working dir | `/root/partsignal/releases/mvp-20260830-133651-a663bcce/deploy` | 当前 release 的 `deploy/` | `PASS` |
| config file | `/root/partsignal/releases/mvp-20260830-133651-a663bcce/deploy/compose.staging.yaml` | Staging Compose | `PASS` |
| host binding | `127.0.0.1:19080` | Staging frontend loopback port | `PASS` |

## Nginx 与公网链路

| 字段 | 当前运行值 | 已记录/合同值 | 结果 |
| --- | --- | --- | --- |
| 启用站点 | `/etc/nginx/sites-enabled/partsignal-staging.conf` | Staging 站点 | `PASS` |
| 解析目标 | `/etc/nginx/sites-available/partsignal-staging.conf` | 同值 | `PASS` |
| SHA-256 | `ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982` | 同值 | `PASS` |
| server name | `geo.962850.xyz` | 权威目标 | `PASS` |
| frontend upstream | `partsignal_staging_frontend → 127.0.0.1:19080` | 与容器绑定同端口 | `PASS` |
| API upstream | `partsignal_staging_api → 127.0.0.1:19000` | Staging API loopback | `PASS` |
| storage upstream | `partsignal_staging_storage → 127.0.0.1:19001` | Staging fake OSS loopback | `PASS` |

同一观察窗口的公网探测：

```text
https://geo.962850.xyz/                  200, PartSignal Frontend V2
https://geo.962850.xyz/api/health/live  200, status=ok
https://geo.962850.xyz/api/health/ready 200, postgresql=ok, redis=ok
```

## 证据闭环

链路为：

```text
geo.962850.xyz
  → enabled partsignal-staging.conf
  → partsignal_staging_frontend
  → 127.0.0.1:19080
  → 唯一 partsignal-staging/frontend 容器
  → partsignal-frontend:mvp-20260830-133651-a663bcce
  → image sha256:c0826f...
  → Compose working_dir 位于 current release
  → current release Git commit a663bcce...
```

该链路把公网域名、当前启用 upstream、运行中容器、Compose project、release、image ID 与 source commit 直接关联，满足 PRD R10 的正面 Staging 身份要求。它不证明波次 3 业务流程本身通过；业务写入仍必须使用唯一 TEST 前缀、精确 registry、UI 操作、反向清理和既定停止条件。
