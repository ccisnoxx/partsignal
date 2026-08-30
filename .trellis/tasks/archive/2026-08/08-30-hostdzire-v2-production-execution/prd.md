# Hostdzire 开发环境 V2 全量重建

## 目标

把 Hostdzire 当前 `partsignal-staging` 开发运行态视为可丢弃环境：永久清空 PostgreSQL、Redis 与 fake-oss 对象数据，删除当前七个 PartSignal 容器和当前运行的 backend/frontend 应用镜像，从 clean `origin/main` 新建 release，使用 canonical `frontend/` 和当前 backend 完成 Staging full rebuild，并恢复现有公网入口。

## 用户价值

- 回到开发阶段最短部署路径，不再把一次可丢弃环境重建当作正式 Production 数据迁移。
- 通过仓库已有 Staging full deploy 自动完成 build、migration、账号初始化和健康检查。
- 保留必要的删除边界，只保护其他项目、secret 与非目标主机资源，不引入 manifest、quarantine、rollback 和多段 Nginx 授权。

## 已确认事实与用户决定

- 用户确认当前仍处于开发阶段，业务数据库、Redis 与 fake-oss 对象数据可永久删除，不要求备份、quarantine 或恢复旧数据。
- 用户允许删除原 PartSignal 容器和当前运行应用镜像后重新构建；不授权全局 Docker prune 或其他项目资源删除。
- 当前唯一 PartSignal Compose project 为 `partsignal-staging`，存在 frontend/api/worker/scheduler/fake-oss/postgres/redis 七个容器；Hostdzire 同时运行四个范围外 Compose project。
- 三个业务数据 owner 为 `/root/partsignal-data/{postgres,redis,objects}`；cutover state、quarantine 和 failed-production 均不存在。
- 当前 Nginx 已代理 Staging 固定端口 `19000/19001/19080`，重建后端口不变，因此无需修改或 reload Nginx；重建期间允许短暂公网 upstream failure。
- `/root/partsignal/shared/.env.staging` 存在且为 `root:root 0600`；`.env.production` 缺失不影响本次 Staging 重建。
- 开发机与 Hostdzire 均证明 `origin/main == a663bcce9fd49da9c5aea7f257372fc318447234`。
- `deploy-staging.sh full` 是空库重建的权威入口；`redeploy-staging-fast.sh` 跳过 migration 与账号初始化，不能使用。
- 原 Production execution 中已完成的 A1 artifact evidence 保留为历史事实，但 A2、Production manifest、rollback tag、maintenance/quarantine/cutover/Observation 均因本次范围变更取消。

## 需求

### R1. 精确删除边界

- 破坏性执行前重新读取 hostname、Compose projects、目标容器 full ID、project/service label、mount、image ID 和 `19000/19001/19080` owner。
- 只停止和删除重新核验后属于 `partsignal-staging` 的七个容器，以及可能残留的同 project `migrate` one-shot 容器。
- 禁止 `docker system prune`、`docker image prune -a`、`docker network prune`、宽泛 glob、`down --remove-orphans` 或任何影响其他 Compose project 的操作。

### R2. 开发数据永久重置

- 在目标容器全部停止和删除、三个目录无活动 mount 后，永久删除并重建 `/root/partsignal-data/postgres`、`redis`、`objects`。
- 保留 `/root/partsignal-data` 根目录；重建 owner/mode 分别为 `70:0 0700`、`999:0 0755`、`0:0 0755`。
- 不创建 backup、quarantine、failed-production 或 Production cutover state，不执行 restore 或 Alembic downgrade。

### R3. 应用镜像策略

- 在删除旧容器后，删除执行前重新核验的当前运行 backend/frontend 应用 image ID，确保本轮生成新的 Staging version tag。
- 保留 `postgres:16-alpine`、`redis:7.4-alpine`、A1 candidate、release/archive 和历史未使用 PartSignal images；清理历史镜像不影响上线，退出本次范围。

### R4. Clean main release

- 从 Hostdzire 直接访问的权威 origin 创建新的、不可覆盖的 `mvp-<timestamp>-<short-commit>` release 目录；验证 branch/main、HEAD 与 `origin/main` 一致且工作区 clean。
- 不修改 A1 已冻结 checkout，不覆盖旧 release，不从开发机 ARM64 Docker 传输镜像。
- 新 release 的 `.env.staging` 只链接 `/root/partsignal/shared/.env.staging`，不得输出或复制 secret 值。

### R5. Staging full rebuild

- 使用新 release 中的 `deploy/compose.staging.yaml` 与 `deploy/scripts/deploy-staging.sh`，显式 `PARTSIGNAL_DEPLOY_MODE=full` 和唯一 `PARTSIGNAL_VERSION`。
- 权威脚本负责 Compose config、构建 API/Frontend、启动 PostgreSQL/Redis/fake-oss、integrity preflight、migration、Worker/Scheduler/API/Frontend、账号初始化与 loopback 探针。
- 不使用 Production Compose、Production manifest、`deploy.sh`、`activate-production.sh`、`prepare-production-data.py` 或 `redeploy-staging-fast.sh`。

### R6. 验收与 current

- 验证七个服务存在，PostgreSQL/Redis/API/Worker/Scheduler 为 healthy，restart/OOM 无异常，端口 `19000/19001/19080` 恢复。
- 验证实际 Alembic revision 等于仓库唯一 head，`admin` 与 `content_editor` 已初始化但不输出密码。
- 验证 loopback 与公网 live/ready、首页、一个 canonical SPA deep link，以及 fake-oss 唯一测试对象的 PUT/HEAD/GET/DELETE 闭环。
- 全部验收通过后，原子更新 `/root/partsignal/current` 指向新 release；失败时保留现场和日志，不恢复已删除开发数据。

## 范围外

- Production `.env.production`、真实 AI/阿里云 OSS、Production manifest、quarantine、rollback image、维护页和 Production Nginx 切换。
- 旧数据备份或恢复、Alembic downgrade、历史 release/archive/A1 artifact 删除。
- 全部历史 PartSignal images、build cache、Docker 基础镜像或网络清理。
- 其他 Compose project、DNS、TLS、证书、DMIT、Nginx site 或非 PartSignal 文件修改。
- 仓库业务代码、API、数据库合同或产品功能变更。

## 验收标准

- [x] AC1：执行前 inventory 重新证明目标 host、七个 exact container、project/service label、mount、data leaf 和当前应用 image identity，无范围外资源混入。
- [x] AC2：用户批准最终计划与单次破坏性执行批次后，七个目标容器和可能残留的 migrate 容器被停止、删除，其他 Compose project 未变化。
- [x] AC3：三个业务数据叶目录被永久清空并按固定 owner/mode 重建；数据根和范围外路径保留。
- [x] AC4：当前运行 backend/frontend 应用镜像被定向删除；基础镜像、A1 artifact 和历史未使用镜像保留。
- [x] AC5：新 release 来自 fresh `origin/main`，commit identity 与工作区 clean 得到证明，`.env.staging` 只链接共享 secret owner。
- [x] AC6：Staging full deploy 成功完成 build、migration、账号初始化和七服务启动。
- [x] AC7：Alembic head、容器 health、端口、loopback/public live/ready、首页、SPA deep link 和 fake-oss 文件闭环通过。
- [x] AC8：验收后 `current` 原子指向新 release；Nginx、其他 Compose project、Production artifact 和 secret 值均未修改或泄露。

## 规划状态

用户已明确批准最新最终规划和单次破坏性范围。开发环境全量重建于 `2026-08-30T13:41:50+08:00` 完成，全部 AC 已满足；实际 identity、删除结果和验收证据见 `research/development-rebuild-execution.md`。
