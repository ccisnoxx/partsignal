# Hostdzire 2026-08-30 只读 Inventory

## 边界与时间

- SSH alias：`hostdzire`
- hostname：`scrapy`
- captured at：`2026-08-30T00:53:02+08:00`
- kernel：`Linux 6.1.0-42-cloud-amd64`
- 远端 mutation：`NONE`
- 未读取或输出：Production env 值、容器 Env、数据库业务表、对象内容、Cookie、DSN、密码、token、API key、OSS/AI credential。
- `.env.production` 不存在，因此所有 allowlist `*_configured` 状态均按 `false` 报告，没有打开任何环境文件。

## 主机与 Docker 容量

| 项目 | 2026-08-30 observed |
| --- | --- |
| CPU/load | 4 vCPU；`0.68 / 0.34 / 0.25` |
| Memory | 6,225,702,912 bytes total；2,301,513,728 bytes available；no swap |
| Root filesystem | 105,087,164,416 bytes total；53,120,462,848 used；46,581,321,728 available；54% |
| Root inode | 6,553,600 total；1,422,873 used；22% |
| Docker root | `/var/lib/docker`；1,336,352,768 bytes |
| containerd store | `/var/lib/containerd`；45,887,737,856 bytes |
| Docker logical images | 216 total / 13 active；45.35 GB；35.36 GB reclaimable |
| Docker build cache | 933 records；15.56 GB；12.92 GB reclaimable |

当前 available memory 约 2.14 GiB，只比既定顺序构建阈值 2 GiB 高约 0.14 GiB；无 swap。Artifact Gate 必须在 backend/frontend 每次构建前重新检查，不能以当前一次通过替代后续通过，也不能通过 prune 腾挪。

## Compose projects

当前 `docker compose ls --all`：

| Project | Status | Config source |
| --- | --- | --- |
| `partsignal-staging` | running(7) | 三个历史 release 的 `compose.staging.yaml` |
| `cliproxyapi` | running(1) | `/root/CLIProxyAPI/docker-compose.yml` |
| `md2word-p0` | running(4) | md2word 两份 Compose |
| `sub2api-plus` | running(3) | `/root/sub2api-plus/docker-compose.yml` |
| `vaultwarden` | running(1) | `/opt/vaultwarden/compose.yaml` |

只有 `partsignal-staging` 在本任务 mutation allowlist；其他 project 全部是不可触碰对象。

## PartSignal 容器精确身份

| Service | Full container ID | Image ref / full image ID | State |
| --- | --- | --- | --- |
| frontend | `7e46e918710ae3f9b42a5880403b220ffc86c2b65b244908077f9d457e105b75` | `partsignal-frontend:mvp-20260825-172239-2a6fd940b848` / `sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111` | running；health none；restart 0；OOM false |
| api | `0b2c7f5b2d0dc4562cb5aa1b6ec1833f3785d33fac974481bc4b83ad57a38c94` | `partsignal-backend:mvp-20260825-172239-2a6fd940b848` / `sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f` | running/healthy；restart 0；OOM false |
| worker | `dd5cee10ef2ad33deeefa83beb31c41be74523a909ee87c02223048b3dd05f5d` | same backend | running/healthy；restart 0；OOM false |
| scheduler | `e2fd2a6cf36a3a56640c9e245ee1284eadc3bc2d275205974f9f3df6793421a8` | same backend | running/healthy；restart 0；OOM false |
| fake-oss | `57736713655b6695cb6cfb3adb7219ba1fbb926b384467223403a11333261c34` | same backend | running；health none；restart 0；OOM false |
| postgres | `680ac051e558b83894318e5b9ba3dd59cdfe905326fad084ba6662870b709acc` | `postgres:16-alpine` / `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | running/healthy；restart 0；OOM false |
| redis | `4a4d9ac94eaaf8c27c80c5ea406f03cd1de4483103546b9441e5dea812466bba` | `redis:7.4-alpine` / `sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99` | running/healthy；restart 0；OOM false |

Compose source drift 未变化：frontend/api/worker/scheduler/fake-oss 来自 `mvp-20260825-172239-2a6fd940b848`，postgres 来自 `mvp-20260716-1623`，redis 来自 `mvp-20260710-2125`。任何停止操作都必须用当次重新读取的 full ID + project/service label，不能由单个 Compose 文件推断 owner。

## Bind mounts、数据与数据库

| Path | Metadata | Size | Mount |
| --- | --- | ---: | --- |
| `/root/partsignal-data` | directory；uid:gid `0:0`；`0755`；device `2049` | 80,654,336 bytes | `/dev/sda1` ext4 `/` |
| `/root/partsignal-data/postgres` | directory；uid:gid `70:0`；`0700`；device `2049` | 68,210,688 bytes | bind to postgres `/var/lib/postgresql/data` |
| `/root/partsignal-data/redis` | directory；uid:gid `999:0`；`0755`；device `2049` | 11,833,344 bytes | bind to redis `/data` |
| `/root/partsignal-data/objects` | directory；uid:gid `0:0`；`0755`；device `2049` | 606,208 bytes | bind to fake-oss `/data` |
| `/root/partsignal-data-quarantine` | missing | — | — |
| `.partsignal-production-cutover.json` | missing | — | — |

PostgreSQL 只读结果：revision=`0043_geo_platform_identity`；current database size=`10,714,135` bytes。未读取业务表。

## Listeners 与 HTTP 状态

- PartSignal loopback listeners：`127.0.0.1:19000`、`19001`、`19080`。
- Nginx listeners：`10.0.0.2:443`、`23.80.89.175:443`、`0.0.0.0:80`。
- loopback live/ready/frontend 均为 `200`。
- public live/ready/login 均为 `200`；public `/object-storage/` 为 `404`。

`404` 不能证明 object-storage owner 已退出，因为活动 Nginx 仍有 `19001` upstream 与 `/object-storage/` location。

## Release、manifest 与环境文件

- `/root/partsignal/current` 是相对 symlink `releases/mvp-20260825-172239-2a6fd940b848`，解析到 `/root/partsignal/releases/mvp-20260825-172239-2a6fd940b848`。
- `/root/partsignal/releases` 仍有 62 个一级 release 目录，总计 1,811,075,072 bytes；最近目录仍是当前 release。
- 在 releases 两层范围内没有 `*.manifest.json`。
- `/root/partsignal/shared/.env.production` missing；不是已配置但权限错误，而是对象不存在。
- 因 env 文件缺失，`database_configured`、`redis_configured`、seed account password、session secret、AI encryption key、content generator、AI local HTTP、object storage backend、OSS endpoint/bucket/access keys 与 app env 的 `*_configured` 状态全部为 `false`。

## Nginx

- systemd unit `nginx` active；unit reload owner 是 `systemctl reload nginx` 对应的 master HUP。
- enabled：`/etc/nginx/sites-enabled/partsignal-staging.conf`
- target：`/etc/nginx/sites-available/partsignal-staging.conf`
- target：regular file；`root:root 0644`；device `2049`；SHA-256 `ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`
- active upstreams：API `19000`、frontend `19080`、storage `19001`；存在 `/object-storage/`。
- security snippet：regular file；`root:root 0644`；SHA-256 `c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`，与仓库一致。
- Nginx `1.29.8`；`nginx -t` successful。
- 当前仓库 Production 模板以 `10.0.0.2` 渲染的 SHA-256 仍为 `aef0a6acace47284126140a673faf7e8d2cf53d5ab17cece206b5188c4f3a9cc`。

## 与 2026-08-29 inventory 的漂移

### 已确认漂移

| 项目 | 2026-08-29 | 2026-08-30 | 判定 |
| --- | --- | --- | --- |
| load | `0.63 / 0.52 / 0.37` | `0.68 / 0.34 / 0.25` | 正常瞬时漂移，授权时需再读 |
| Redis size | 约 10.8 MiB | 11,833,344 bytes（约 11.29 MiB） | 约增长 0.49 MiB |
| total data size | 约 76.4 MiB | 80,654,336 bytes（约 76.92 MiB） | 约增长 0.52 MiB |
| root used | 约 49.46 GiB | 约 49.47 GiB | 约增长 0.01 GiB，接近旧值取整误差 |

### 可比字段无漂移

- hostname、vCPU、总内存、无 swap、根盘约 43.39 GiB available、inode 22%。
- Docker logical images/build cache、Docker/containerd store 量级。
- 7 service 集合、service image reference/full image ID、health、restart/OOM、Compose source drift。
- 三个 bind mount、device、owner/mode；quarantine 与 cutover state 仍 missing。
- DB revision 与 database size 完全相同。
- loopback/public HTTP 状态与三个 PartSignal listener。
- current target、62 个 release、活动 Nginx target/checksum/upstream、security snippet checksum、Nginx version/test。
- `.env.production` 仍 missing。

### 新增可见但无旧基线可比较

- 本轮首次在持久研究文件中记录 7 个 full container ID、所有 Compose project、Nginx systemd reload owner 与公网 listener；这些是新的证据字段，不应误报为漂移。

## 当前 Gate 结论

- Repository audit：`OBSERVED`，不是远端 Gate=`MET`。
- Read-only inventory：`COMPLETED_NO_REMOTE_MUTATION`。
- Artifact/Configuration：`NOT_STARTED`，且 `.env.production` missing 是 blocker。
- Maintenance/Data、Nginx Write、Nginx Reload、Cutover、Observation：全部 `NOT_STARTED`。
- 旧归档任务继续保持 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE / NOT_STARTED`。
