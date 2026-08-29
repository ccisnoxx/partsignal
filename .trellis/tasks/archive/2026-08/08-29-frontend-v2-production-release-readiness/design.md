# Frontend V2 Production Release Readiness — Design

## 1. 设计状态

本设计按用户决定采用“原地 Production 转换 + V2-only + 丢弃 Staging 数据”方案，不创建并行长期 Production stack，不保留 V1 fallback，也不把当前 PostgreSQL、Redis 或 fake OSS objects 提升为 Production 数据。设计已获批准并进入 Repository Readiness 实施；授权不延伸到远端数据处置、配置写入、容器替换、Nginx reload 或线上切换。

“直接覆盖部署”在这里指复用现有域名、Nginx、回环端口与 Compose project 边界完成一次维护窗口转换；它不表示覆盖同名 release/image tag、跳过备份或在运行中逐文件替换。

## 2. 当前与目标拓扑

### 2.1 当前

```text
geo.962850.xyz
  -> outer Nginx partsignal-staging.conf
     -> 127.0.0.1:19080 V2 frontend container
     -> 127.0.0.1:19000 staging API
     -> 127.0.0.1:19001 fake OSS
        -> staging worker/scheduler/PostgreSQL/Redis
```

### 2.2 目标

```text
geo.962850.xyz
  -> outer Nginx production-owned site
     -> 127.0.0.1:19080 V2-only frontend container
     -> 127.0.0.1:19000 production API
        -> production worker/scheduler/PostgreSQL/Redis
        -> real OSS + real AI provider
```

目标继续使用现有回环端口和 Compose project runtime identity，因此没有第二套常驻环境的内存成本。权威配置、环境文件、service 集合、文档和观测标签必须从 Staging 语义转换为 Production；fake OSS 与 deterministic generator 不得留在目标运行态。

## 3. 单一发布 Owner

- Frontend V2 继续使用已经通过 Staging artifact 验收的容器模式，Production Compose 正式拥有 `frontend` service。
- `deploy/nginx/partsignal.conf.template` 的宿主静态 root `/var/www/partsignal-frontend/current` 路径退役；Production 外层 Nginx 继续反代 frontend loopback port。仓库不得同时维护静态与容器两套 Production owner。
- Candidate 生成器机器验证 clean `main`、`HEAD == origin/main == manifest commit` 和确定性 `git archive`；不可覆盖 manifest 固定 Git SHA、release ID、backend/current V2/previous V2 image ID 与 RepoDigest、schema revision，以及固定 tracked-file allowlist 的 checksum。
- 当前活动 V2 image/release 在切换前冻结为“上一份已验证 V2”回滚目标。V1 源码、镜像和 pipeline 不参与发布或回滚。

## 4. 原地转换顺序

1. 从 clean `main` 生成 V2-only candidate 和 manifest，完成 Repository/Artifact Gate。
2. 只读重验远端漂移，冻结当前 V2 image、Compose/Nginx checksum、DB revision、container 集合和回滚命令。
3. 以不输出 secret 值的方式准备独立 Production env，执行 fail-closed config preflight 和真实 AI/OSS 探针。
4. 获得远端写授权后进入维护窗口，停止 API/Worker/Scheduler 产生新业务写入，保存精确运行态证据。
5. 在固定排他锁和持久状态文件下，把约 66 MiB PostgreSQL、7.8 MiB Redis 和 592 KiB fake OSS objects 逐目录原子 rename 到同文件系统 run-scoped quarantine；Production 不挂载或读取 quarantine，进程中断后按 run ID 幂等续跑。
6. 只有状态、run ID、canonical data root、quarantine target 和两个空活动目录全部匹配时，才把 manifest 摘要、release/commit/schema 和 backend/frontend image ID 绑定到 `CLEAN_INIT_DEPLOYING`；pull 后实际 image ID 也必须匹配，之后才能执行 migration-to-head。通过幂等维护命令创建 `admin` 与必须首次改密的 `content_editor`，随后只启动 API 与 V2 frontend。
7. 通过 API/Frontend 验证真实 OSS/AI；Gate=`MET` 后，同一 manifest 才能显式激活非默认 `production-async` profile 并标记 `PRODUCTION_INITIALIZED`。upgrade 使用独立 `UPGRADE_DEPLOYING/UPGRADE_PREPARED` 候选阶段，不能未部署直接激活。fake-oss 保持停止且不进入目标 service 集合。
8. Nginx 移除 staging object-storage proxy 等非 Production owner，配置原子更新；`nginx -t` 通过并获 reload 授权后生效。
9. 完成回环、公网、浏览器和受控 Production 写验收，随后进入观察窗口。
10. Observation Gate 通过后删除 V1 source/build/deploy pipeline，并再次运行仓库与发布门禁；quarantine、旧 V1 artifact、fake-oss container/image 与 `.env.staging` 的物理清理仍是独立破坏性授权。

## 5. Gate 状态机

```text
INVENTORIED
  -> DATA_DISPOSITION_DECIDED
  -> REPOSITORY_READY
  -> V2_ARTIFACT_READY
  -> PRODUCTION_CONFIG_READY
  -> DATA_RECOVERY_OR_RESET_READY
  -> MAINTENANCE_WINDOW_READY
  -> IN_PLACE_CONVERSION_COMPLETE
  -> OBSERVATION_MET
  -> V1_PIPELINE_REMOVED
  -> RELEASE_READY
```

Gate 证据绑定 candidate。Frontend、backend、migration、Compose、Nginx、Production config contract 或数据处置发生变化时，按 `implement.md` 的失效矩阵重跑，不继承过期 Staging Gate。

## 6. 回滚设计

### 6.1 Frontend

只允许回到切换前冻结的 V2 image，使用同一 backend/schema 下的 frontend-only recreate；不得构建或恢复 V1。切换前后必须证明 API、Worker、Scheduler、PostgreSQL、Redis、DB revision 和 Nginx checksum 不变。

### 6.2 Nginx

只恢复同一已验证版本的 site template 与 PartSignal security snippet；先 `nginx -t`，再经单独授权 reload。Nginx 回滚不授权替换 application image 或修改数据库。

### 6.3 Application

只有旧 V2 backend 与当前 schema/业务合同兼容时才允许 application rollback。若本次没有 backend/schema 变化，则保持 backend 不变；若发生变化，必须在 candidate 冻结前给出兼容性或恢复证明。

### 6.4 数据

默认不执行 Alembic downgrade。旧 Staging 数据只作为维护窗口 quarantine 保留，不进入 Production；若空库初始化或验证失败，停止新 Production 写入，关闭新 service，把新目录移出活动路径并原子恢复三个旧目录及旧 Staging 配置/运行态。Observation Gate 通过后，数据回滚边界转为 Production 自身的备份恢复，quarantine 不再承担业务回滚职责。

## 7. 停止条件

- quarantine run ID、三个精确 source/target、磁盘余量、恢复命令或新 Production data owner 不明确：不进入维护窗口。
- Candidate tag 可覆盖、manifest 与实际 image/runtime digest 不一致：停止。
- Production env 缺键、引用 `.env.staging`、development adapter、fake OSS、deterministic generator 或 `AI_ALLOW_LOCAL_HTTP=true`：停止。
- 旧目录隔离不完整、新空库 migration/账号初始化失败、DB revision 漂移、Production 出现旧对象引用或 `preflight-integrity` 非零：停止。
- 当前 V2 rollback image、Nginx snapshot、Compose state 或维护窗口恢复命令未冻结：停止。
- `nginx -t`、live/ready、CSP/source-map/cache、核心浏览器、权限或受控写验收失败：不结束维护窗口；按实际故障层恢复。
- 观察期出现新 5xx、upstream premature close、restart/OOM、Worker/Scheduler 异常或数据不变量失败并达到批准阈值：停止 V1 pipeline 删除并执行回滚决策。

## 8. 文档和合同收敛

- `compose.prod.yaml`、Production deploy script、容器化 Frontend V2、Nginx proxy template 与 Hostdzire runbook 收敛为一个 Production owner。
- `backend/app/cli.py` 已把开发语义的 `seed-demo` 收敛为生产可用、幂等且不输出密码的 `initialize-accounts`；现有事务与“不覆盖既有账号”逻辑仍是唯一账号初始化 owner，没有兼容别名或第二套实现。
- `partsignal-staging` 若因平滑原地转换保留为 Docker project 名，文档必须明确它只是历史 runtime identifier，不再代表环境语义；不得再使用 Staging env 或 fake OSS。
- `docs/GEO系统前后端技术与部署方案.md` 的旧静态路径与 `deploy/nginx/partsignal.conf.template` 的静态 root 一并更新或退役。
- API/database contract 无变化时不修改 `contracts/openapi.yaml` 或 `contracts/database.md`；如实施需要合同变化，回到 Planning 单独评审。

## 9. 敏感信息与授权

- `.env`、credentials、token、private key、业务数据和原始敏感快照不进入仓库、命令输出或 Task artifacts。
- Repository 修改、Production env 写、数据备份/清理/迁移、容器替换、Nginx reload、受控业务写、V1 源码删除和旧 artifact 清理分别取得授权。
- `/root/partsignal/current` 仍只是验收记录，不作为容器或流量回滚机制。
