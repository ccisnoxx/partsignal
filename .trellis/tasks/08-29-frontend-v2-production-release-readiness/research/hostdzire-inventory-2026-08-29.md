# Hostdzire 脱敏只读 Inventory（2026-08-29）

## 范围与方法

- 目标：SSH 原生别名 `hostdzire`。
- 模式：`BatchMode` 只读查询；未发生 host-key conflict。
- 未执行：文件写入、Git 写操作、软件安装、服务/容器 start/stop/restart/reload、备份、migration、数据库业务查询、对象存储访问。
- 未读取或输出：`.env` 内容、`Environment=` 值、credentials、token、private key、证书私钥、业务数据库内容、公网 IP 明文。

## 主机与容量

- hostname：`scrapy`；Debian GNU/Linux 12；Linux `6.1.0-42-cloud-amd64`；`x86_64`；时区 `Asia/Shanghai`。
- SSH 用户：root；Nginx 与 Docker systemd service 为 active/enabled。
- 4 vCPU；内存约 5.8 GiB、可用约 2.2 GiB；无 swap。
- 根盘 98 GiB，已用约 50 GiB，可用约 44 GiB，使用率约 53%。
- 主机还运行 `md2word-p0`、`sub2api-plus`、`vaultwarden`、`cliproxyapi` 等 Compose 项目，Production 规划不能假设资源独占。

## PartSignal 运行拓扑

- 唯一已发现项目为 `partsignal-staging`，`running(7)`；没有已核验的独立 PartSignal Production Compose project。
- 活动 Compose 文件：`/root/partsignal/releases/mvp-20260825-172239-2a6fd940b848/deploy/compose.staging.yaml`。
- `/root/partsignal/current` 指向该 release；远端 release 不是 Git worktree，无法以 `git status` 核验来源。
- 容器：frontend、api、worker、scheduler、postgres、redis、fake-oss。API/worker/scheduler/postgres/redis healthy；frontend/fake-oss 无 Compose healthcheck。
- 回环端口：API `19000`、frontend `19080`、fake OSS `19001`；PostgreSQL/Redis 无宿主机 `5432/6379` 监听。
- 当前数据库 revision：`0043_geo_platform_identity`；无残留 migrate container。
- 当前 staging 使用 `APP_ENV=staging`、deterministic generator、development object storage；这些非敏感枚举仅用于证明它不是 Production 配置。
- 容器 mount source 与只读体量：PostgreSQL `/root/partsignal-data/postgres` 约 66 MiB，Redis `/root/partsignal-data/redis` 约 7.8 MiB，fake OSS `/root/partsignal-data/objects` 约 592 KiB；三者均在根盘同一 ext 文件系统，合计不足 75 MiB。

## Nginx、TLS 与 HTTP

- 活动站点：`/etc/nginx/sites-enabled/partsignal-staging.conf`，指向 sites-available 同名文件；没有发现启用的 `partsignal.conf` Production site。
- `geo.962850.xyz`：`/api/` → `127.0.0.1:19000`，`/object-storage/` → `127.0.0.1:19001`，`/assets/` 与其他路径 → `127.0.0.1:19080`。
- 证书公开有效期：2026-07-02 至 2026-09-30；只记录 fullchain 公共证书引用，不记录私钥路径或内容。
- 公网与回环 `/api/health/live`、`/api/health/ready` 返回 HTTP 200；公网 `/`、`/login`、`/products` 返回 200。
- 当前 Frontend V2 artifact 的安全头存在，hashed asset 为 immutable，缺失 asset 为 404，未发现 `.map` 或 `sourceMappingURL`。这些只证明当前 Staging artifact，不证明 Production 拓扑就绪。

## Production 缺口

- 当前 release 的 `deploy/compose.prod.yaml` 没有 frontend service。
- Production Nginx template 期望 `/var/www/partsignal-frontend/current`；远端该路径不存在，当前 release 内也没有已构建的 `frontend-v2/dist`。
- Production Compose 配置要求显式 `PARTSIGNAL_BACKEND_IMAGE` 与 `PARTSIGNAL_VERSION`；无安全 env 值时只读展开会 fail closed。
- 当前备份目录 `/root/partsignal/backups` 可见压缩 PostgreSQL 备份元数据至 2026-08-25；未读取内容，未证明异地、加密、保留或恢复有效。
- 主机无 swap 且共享多项目；新增并行 Production stack、Frontend build、migration 与 restore rehearsal 必须先做容量预算。
- 用户已选择原地转换并丢弃当前 Staging 数据；现有体量允许先把三个数据目录原子移入同文件系统 quarantine，再初始化干净 Production，而无需立即执行不可恢复删除。
- 宿主 Node `v24.17.0`、npm `11.13.0`、Python `3.11.2`、Docker `29.4.1`、Compose `v5.1.3`；Frontend artifact 的权威构建链仍是 Dockerfile 的 Node 22 / Nginx 1.27，不能用宿主版本替代。

## 无法通过本次只读 Inventory 证明的事项

- Production secret 的正确性、轮换、权限与 external-service 实际授权。
- Production 数据的敏感度、规模、RPO/RTO、备份内容、恢复可用性与业务不变量。
- 远端 release 对应的真实 Git dirty 状态；必须由本地来源与 release manifest 证明。
- Production Frontend 静态发布、原子切换、rollback 与正式 vhost 的可执行性。
- 正式 Production 浏览器、业务写路径、AI/OSS、migration、rollback drill 与观察 Gate。

## 发布前只读重验集合

在任何远端 write set 提交审批前，重新采集并比较：主机容量、监听端口、Compose project/container/image digest、Nginx target/checksum 与 `nginx -t`、certificate expiry、iptables 精确规则、release/current、DB revision、migrate container 集合、backup metadata 及公网/回环 live/ready。输出继续只保留键名、状态、digest 与脱敏摘要。
