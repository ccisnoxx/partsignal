# Hostdzire 开发环境 V2 全量重建设计

## 设计判断

本次不是 Production 原地转换，而是可丢弃 Staging 开发环境重置。最小正确设计是继续使用已经公开运行的 `partsignal-staging` Compose/Nginx 拓扑，只替换其容器、三个业务数据叶目录和当前应用镜像，再由仓库已有 Staging full deploy 重建。

Production manifest、quarantine、previous V2 rollback、真实 Production external Gate 和四段 Nginx 授权都不解决本次需求，因此全部退出执行路径。A1 历史 artifact 保留但不作为 Staging full deploy 输入。

## 当前与目标拓扑

```text
当前
Nginx -> 19000 API / 19001 fake-oss / 19080 canonical Frontend V2
partsignal-staging -> 7 services -> disposable postgres/redis/objects

重建窗口
Nginx unchanged -> upstream temporarily unavailable
exact PartSignal containers removed
three data leaves removed and recreated empty
new clean main release builds new staging backend/frontend tags

目标
Nginx unchanged -> same 19000/19001/19080
partsignal-staging -> fresh postgres/redis/fake-oss/API/Worker/Scheduler/Frontend
fresh migration head + initialized development accounts
```

## 所有权边界

- 源码：fresh `origin/main` clone 到新的不可覆盖 release 目录。
- Secret：`/root/partsignal/shared/.env.staging`；新 release 只创建 symlink。
- 容器：执行前 full ID 与 `com.docker.compose.project/service` label 双重确认。
- 数据：只允许三个显式叶目录，根目录与其他路径保留。
- 应用镜像：只删除重建前实际运行的 backend/frontend full image ID；基础镜像和历史清理退出范围。
- 网络：保留现有三个 `partsignal-staging-*` 网络，由新 Compose 复用，避免无收益的删除与重建。
- 流量：保留当前 Nginx target；开发重建窗口允许短暂 502，不增加维护页。

## 执行流

```text
final read-only re-freeze
  -> exact stop: scheduler, worker, api, frontend, fake-oss, postgres, redis
  -> exact container remove (+ exited migrate if present)
  -> prove ports and mounts released
  -> delete/recreate postgres, redis, objects leaves
  -> delete old running backend/frontend image IDs
  -> clone fresh main into unique release
  -> link shared .env.staging
  -> deploy-staging.sh full
  -> verify migration/accounts/health/ports/public/fake-oss
  -> atomically switch current symlink
```

任一步失败即停止，不通过 prune、fallback tag、Production script 或手工跳过 migration 掩盖失败。旧开发数据永久删除后没有恢复路径；失败恢复方式是修复新环境并重新运行 full deploy。

## 为什么选择 Staging full deploy

`deploy-staging.sh full` 已把空库重建所需顺序放在一个 owner：

1. Compose config；
2. 构建 API 与 canonical Frontend；
3. 启动 PostgreSQL、Redis、fake-oss；
4. integrity preflight；缺业务表时返回空问题集；
5. migration 到 head；
6. 启动 Worker/Scheduler/API/Frontend；
7. 幂等初始化账号；
8. Compose 状态、API ready 与前端首页探针。

`redeploy-staging-fast.sh` 明确跳过 migration 和账号初始化，不能用于空库。Production Compose 则要求缺失的 `.env.production`、manifest 和状态机，属于错误工具。

## 删除与失败边界

- 删除命令只接受执行前重新核验的显式 full container/image ID 和三个绝对数据路径。
- 不使用 `$HOME`、`~`、通配符、宽泛 selector 或运行时命令替换解析破坏性目标。
- 删除数据前再次扫描所有 running container mounts；任何未知 owner 立即停止。
- 新 release、image tag 或 symlink target 已存在时立即停止，不覆盖。
- full deploy 失败时保留新 release、构建镜像、容器状态和日志；不恢复已删除数据，不自动删除失败现场。
- `current` 只在完整验收通过后更新，因此失败时仍指向旧 release 记录，但不代表旧运行态可恢复。

## 验证

- Compose：七个服务、project/service labels、image tag、health、restart/OOM。
- 数据：三个 leaf 非空状态符合新服务运行，PostgreSQL revision 为唯一 head，账号存在。
- 网络：`19000/19001/19080` listener owner 与 loopback live/ready/homepage。
- 公网：live/ready、首页和一个 canonical deep link。
- 对象存储：本次唯一对象完成签名上传、HEAD/complete、GET 字节一致与 DELETE；不尝试恢复旧对象。
- 边界：其他 Compose project、Nginx checksum、shared env metadata 与 A1 artifact identity不变。
