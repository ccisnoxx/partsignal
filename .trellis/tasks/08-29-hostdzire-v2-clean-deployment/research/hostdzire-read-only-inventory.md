# Hostdzire 只读 Inventory

## Boundary and Time

- SSH alias：`hostdzire`
- hostname：`scrapy`
- captured at：`2026-08-29T23:04:52+08:00`
- 只读项目：systemd、Docker/Compose labels、容器状态/挂载/镜像身份、精确路径 metadata/size、allowlist cutover state、数据库 revision/size、监听端口、Nginx directives/checksum/`nginx -t`、回环/公网 HTTP status。
- 未执行：环境值或 container env 读取、数据库业务表读取、secret 输出、容器/image/path/Nginx/DNS/TLS mutation。

## Host Capacity

| Item | Observed |
| --- | --- |
| CPU/load | 4 vCPU；`0.63 / 0.52 / 0.37` |
| Memory | 5.80 GiB total；约 2.17 GiB available；no swap |
| Root filesystem | 97.87 GiB total；49.46 GiB used；43.39 GiB available；54% |
| Inode | 22% used |
| Docker root | `/var/lib/docker`，约 1.24 GiB |
| containerd store | `/var/lib/containerd`，约 42.74 GiB |
| Docker logical summary | images 45.35 GB；build cache 15.56 GB |

旧数据 quarantine 是同 filesystem rename，不复制约 76.4 MiB；新增一份 release 约 26.4 MiB，当前 backend/frontend 虚拟大小约 666 MiB/77.2 MiB。磁盘足以保留旧状态并新增一组候选，主要风险是无 swap 且 available memory 仅约 2.17 GiB，因此 build 必须停机前顺序执行并实时复核内存/load。

## Current Runtime

Compose project `partsignal-staging` 运行 7 个容器：

| Service | Container | Image identity | State |
| --- | --- | --- | --- |
| frontend | `partsignal-staging-frontend-1` | `partsignal-frontend:mvp-20260825-172239-2a6fd940b848` / `sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111` | running，restart 0 |
| api | `partsignal-staging-api-1` | `partsignal-backend:mvp-20260825-172239-2a6fd940b848` / `sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f` | healthy，restart 0 |
| worker | `partsignal-staging-worker-1` | same backend | healthy，restart 0 |
| scheduler | `partsignal-staging-scheduler-1` | same backend | healthy，restart 0 |
| fake-oss | `partsignal-staging-fake-oss-1` | same backend | running，restart 0 |
| postgres | `partsignal-staging-postgres-1` | `postgres:16-alpine` / `sha256:57c72fd...` | healthy，restart 0 |
| redis | `partsignal-staging-redis-1` | `redis:7.4-alpine` / `sha256:6ab0b6e...` | healthy，restart 0 |

当时 `127.0.0.1:19000`、`19001`、`19080` 都在监听。回环 live/ready/frontend 和公网 live/ready/login 返回 200；所有声明 health 的容器 healthy，无 OOM/restart。

## Compose Source Drift

同一 project 的 labels 不来自一个 Compose source：

- frontend/api/worker/scheduler/fake-oss：`mvp-20260825-172239-2a6fd940b848`
- postgres：`mvp-20260716-1623`
- redis：`mvp-20260710-2125`

因此停止目标必须按现场 project/service/container labels 再枚举，不能依赖某一历史 Compose 文件声称完整拥有全部容器。

## Data and Env State

| Path | Metadata | Size |
| --- | --- | ---: |
| `/root/partsignal-data/postgres` | directory，numeric DB owner，`0700` | 65.1 MiB |
| `/root/partsignal-data/redis` | directory，显示 `nginx:root`，`0755` | 10.8 MiB |
| `/root/partsignal-data/objects` | directory，`root:root 0755` | 0.6 MiB |
| `/root/partsignal-data` | directory，`root:root 0755` | 76.4 MiB total |
| `/root/partsignal-data-quarantine` | missing | — |
| cutover state file | missing | — |

数据库只读结果：Alembic revision `0043_geo_platform_identity`，current database size `10,714,135` bytes；未读取业务表。

- `/root/partsignal/shared/.env.staging`：普通文件，`root:root 0600`。
- 活动 release `.env.staging`：指向 shared 文件的 symlink。
- `/root/partsignal/shared/.env.production` 与活动 release `.env.production`：missing。

本 inventory 未读取环境键名或值。Production env 缺失是 Artifact/Configuration Gate blocker。

## Nginx State

- Nginx `1.29.8`，`nginx -t` successful。
- enabled：`/etc/nginx/sites-enabled/partsignal-staging.conf`
- target：`/etc/nginx/sites-available/partsignal-staging.conf`
- active checksum：`ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`
- current upstream：API `19000`、frontend `19080`、storage `19001`；包含 `/object-storage/` proxy。
- security snippet checksum：`c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`，与仓库一致。
- fixed release Production template 用 `10.0.0.2` 渲染的当前仓库基线 checksum：`aef0a6acace47284126140a673faf7e8d2cf53d5ab17cece206b5188c4f3a9cc`。

公网 `/object-storage/` 当时返回 404，但活动配置仍声明 storage owner；Production 验收必须同时检查配置和响应。

## Release and Image Retention

- `/root/partsignal/current` → `releases/mvp-20260825-172239-2a6fd940b848`
- `/root/partsignal/releases`：62 个目录，约 1.69 GiB；current release 约 26.4 MiB。
- current verified V2 rollback candidate：`partsignal-frontend:mvp-20260825-172239-2a6fd940b848` / `sha256:72b206...`。
- 主机仍有 `partsignal-frontend-v1:*`，但不是 rollback target，也不在删除范围。

## Precise Later Mutation Targets

本 planning turn 均未写入；实施前必须重新读取完整 ID/checksum。

### Artifact/Configuration Gate

- new `/root/partsignal/releases/<release-id>` clean checkout。
- new sibling `<release-id>.tar.gz` and `<release-id>.manifest.json`。
- new local images `partsignal-backend:<release-id>`、`partsignal-frontend:<release-id>`。
- new `/root/partsignal/shared/.env.production`，`root:root 0600`，non-symlink。

### Maintenance/Data Gate

- exact 7 `partsignal-staging` service containers；stop but do not delete。
- `/root/partsignal-data/{postgres,redis,objects}`。
- new `/root/partsignal-data-quarantine/<run-id>` and state file。
- new Production containers for postgres/redis/api/frontend/worker/scheduler；fake-oss remains stopped and retained。

### Nginx Gate

- backup `/etc/nginx/sites-available/partsignal-staging.conf.pre-<run-id>`。
- atomic target `/etc/nginx/sites-available/partsignal-staging.conf`。
- enabled symlink/security snippet unchanged by default；reload separately authorized。

### Explicit Non-targets

所有非 `partsignal-staging` resources；`.env.staging`、old/V1 images、old/current releases、quarantine、failed-production、manifest、Nginx backup；DNS/TLS/DMIT/other sites。

## Downtime and Recovery

- build/manifest/env/config preflight before maintenance；failure leaves current runtime intact。
- outage begins when exact 7 containers stop。Same project/ports/data root mean full UI/API maintenance plus paused background jobs until new public acceptance or restore。
- recommended hard window：60 minutes；T+20 without `PRODUCTION_PREPARED` or T+45 without external Gate/Nginx cutover triggers restore；T+60 must be verified new or verified old runtime。
- data restore preserves failed Production and restores old three leaves；old `.env.staging`、current 7-service images、historical Compose sources and Nginx backup remain retained through Observation。
- V1 never participates。Frontend-only rollback uses current V2 `sha256:72b206...`；application/data recovery uses current `0043`-compatible backend and old data，no Alembic downgrade。
