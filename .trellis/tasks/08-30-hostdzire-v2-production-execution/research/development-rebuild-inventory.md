# Hostdzire 开发环境全量重建只读基线

## 结论

- captured at：`2026-08-30T13:20:55+08:00`
- target：SSH alias `hostdzire` / hostname `scrapy` / `linux/amd64`
- remote mutation：`NONE`
- 用户已确认当前为开发阶段，业务数据库、Redis 和 fake-oss 对象数据可永久清空；旧 PartSignal 容器和当前运行应用镜像可删除后重建。
- 本轮应使用 `deploy/compose.staging.yaml` 与 `deploy/scripts/deploy-staging.sh` 的 `full` 模式，不进入 Production manifest、quarantine、rollback 或 Nginx 切流状态机。

## 不得触碰的其他 Compose 项目

Hostdzire 同时运行以下非 PartSignal 项目，全部排除在删除和重建范围外：

```text
cliproxyapi
md2word-p0
sub2api-plus
vaultwarden
```

## 当前 PartSignal 容器

Compose project 固定为 `partsignal-staging`。执行前必须重新读取并同时匹配 full ID、project label、service label 和 mount；以下 ID 只作为本次规划基线：

```text
frontend  7e46e918710ae3f9b42a5880403b220ffc86c2b65b244908077f9d457e105b75
api       0b2c7f5b2d0dc4562cb5aa1b6ec1833f3785d33fac974481bc4b83ad57a38c94
worker    dd5cee10ef2ad33deeefa83beb31c41be74523a909ee87c02223048b3dd05f5d
scheduler e2fd2a6cf36a3a56640c9e245ee1284eadc3bc2d275205974f9f3df6793421a8
fake-oss  57736713655b6695cb6cfb3adb7219ba1fbb926b384467223403a11333261c34
postgres  680ac051e558b83894318e5b9ba3dd59cdfe905326fad084ba6662870b709acc
redis     4a4d9ac94eaaf8c27c80c5ea406f03cd1de4483103546b9441e5dea812466bba
```

所有容器均为 running，health 可用的 service 均为 healthy，restart=`0`、OOM=`false`。当前应用镜像为：

```text
backend  sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f
frontend sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111
```

PostgreSQL `postgres:16-alpine` 与 Redis `redis:7.4-alpine` 是重建依赖，不属于应用镜像删除目标。大量历史 PartSignal image 与 A1 candidate image 也不影响本次重建，默认保留，避免把必要部署扩大成清理任务。

## 数据目录

当前没有 quarantine、failed-production 或 cutover state。三个可永久清空的业务数据叶目录为：

```text
/root/partsignal-data/postgres | directory | owner=70:0  | mode=0700 | device=2049 | bytes=68128385
/root/partsignal-data/redis    | directory | owner=999:0 | mode=0755 | device=2049 | bytes=15496333
/root/partsignal-data/objects  | directory | owner=0:0   | mode=0755 | device=2049 | bytes=558290
```

`/root/partsignal-data` 根目录必须保留。执行时只在所有目标容器停止并移除、三个路径无活动 mount 后，删除并按上述 owner/mode 重建三个叶目录。

## 源码与配置

- `origin/main == a663bcce9fd49da9c5aea7f257372fc318447234`，开发机和 Hostdzire `git ls-remote` 结果一致。
- A1 checkout `/root/partsignal/releases/production-20260830-101614-a663bcce` 为 clean checkout，但属于已经冻结的 Production artifact，不在原目录内 pull 或改写。
- 新重建应创建一个不可覆盖的 `mvp-<timestamp>-a663bcce` release 目录，从 `origin/main` clone/checkout 后验证 clean commit。
- `/root/partsignal/shared/.env.staging` 为 regular `root:root 0600`，只在新 release 中创建 `.env.staging` symlink；不读取或输出其值。
- `.env.production` missing 不再是 blocker，因为本次明确运行 Staging full deploy。

## Nginx 与端口

- 当前 target：`/etc/nginx/sites-available/partsignal-staging.conf`
- target SHA-256：`ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`
- `nginx -t` successful。
- 当前代理 `19000`、`19001`、`19080`；Staging full deploy 恢复相同端口，因此本次不修改或 reload Nginx。
- 删除和构建期间公网会短暂返回 upstream failure；用户已选择开发环境直接重建，不增加维护页流程。

## 权威重建入口

`deploy/scripts/deploy-staging.sh` 的 `full` 模式依次执行 Compose config、构建 API/Frontend、启动 PostgreSQL/Redis/fake-oss、空库可安全通过的只读 integrity preflight、migration、启动 Worker/Scheduler/API/Frontend、初始化账号、Compose 状态与 loopback ready/homepage 探针。

`redeploy-staging-fast.sh` 跳过 migration 和账号初始化，不能用于数据清空后的重建。Production `deploy.sh`、`activate-production.sh` 和 `prepare-production-data.py` 也不属于本次范围。
