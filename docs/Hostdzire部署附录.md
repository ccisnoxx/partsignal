# Hostdzire Production 部署附录

本附录给出 `geo.962850.xyz` 原地转换的命令合同和恢复检查。所有示例都必须先替换为当次已核验的 release、镜像、路径和 checksum，并作为精确授权包交由用户批准；不要直接把示例视为线上写授权。

## 1. SSH 与敏感信息

只使用本机 OpenSSH alias：`ssh hostdzire '<已批准的精确命令>'` 与 `scp <source> hostdzire:<approved-target>`。`hostdzire` 是应用主机唯一写入目标；`dmit` 仅在公网入口异常时只读诊断。主机密钥冲突必须停止，不能自动接受新 key 或执行 `ssh-keygen -R`。

禁止读取或输出私钥。Production env、数据库密码、会话密钥、账号密码、OSS/AI 凭据不得进入仓库、发布包、manifest、普通日志、对话或临时文件。

## 2. Candidate manifest

先确认本地已更新远端引用；在 clean `main`、`HEAD == origin/main` 的状态下，把 `git archive --format=tar.gz <commit>` 输出到仓库外，再运行：

```sh
python3 deploy/scripts/create-release-manifest.py \
  --release-id "$release_id" \
  --commit "$commit_sha" \
  --source-archive "$source_archive" \
  --backend-image "$backend_image" \
  --frontend-image "$frontend_v2_image" \
  --rollback-frontend-image "$previous_verified_v2_image" \
  --schema-head 0043_geo_platform_identity \
  --tracked-file deploy/compose.prod.yaml \
  --tracked-file deploy/scripts/deploy.sh \
  --tracked-file deploy/scripts/activate-production.sh \
  --tracked-file deploy/scripts/prepare-production-data.py \
  --tracked-file deploy/scripts/rollback-production-frontend.sh \
  --tracked-file deploy/nginx/partsignal.conf.template \
  --tracked-file deploy/nginx/partsignal-security-headers.conf \
  --output "$manifest_path"
```

生成器会机器验证当前分支、clean working tree、`HEAD == origin/main == --commit`，并重新生成该 commit 的 `git archive` 比较 SHA-256；测试逃生开关不得出现在候选环境。输出目标采用排他创建，存在即失败。三个镜像都必须具有合法且非空的 `repo_digests`；tracked file 必须与脚本固定 allowlist 完全一致。部署和激活会重新计算这些文件的 SHA-256，并同时核对 `PARTSIGNAL_VERSION == release_id`、本地 image ID 与 RepoDigest；任何漂移都拒绝继续。不得手工修改清单。

## 3. Production env 预检

共享文件固定为 `/root/partsignal/shared/.env.production`，权限 `0600`。转换前只输出键名或状态，不能输出值：

```sh
set -eu
ps_env=/root/partsignal/shared/.env.production
test -f "$ps_env"
test ! -L "$ps_env"
test "$(stat -c '%a' "$ps_env")" = 600

COMPOSE_PROJECT_NAME=partsignal-staging \
PARTSIGNAL_VERSION="$release_id" \
PARTSIGNAL_BACKEND_IMAGE="$backend_repository" \
PARTSIGNAL_FRONTEND_IMAGE="$frontend_v2_repository" \
PARTSIGNAL_RUNTIME_ENV_FILE=$ps_env \
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
docker compose --env-file "$ps_env" -f deploy/compose.prod.yaml config --quiet

COMPOSE_PROJECT_NAME=partsignal-staging \
PARTSIGNAL_VERSION="$release_id" \
PARTSIGNAL_BACKEND_IMAGE="$backend_repository" \
PARTSIGNAL_FRONTEND_IMAGE="$frontend_v2_repository" \
PARTSIGNAL_RUNTIME_ENV_FILE=$ps_env \
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
docker compose --env-file "$ps_env" -f deploy/compose.prod.yaml run --rm api \
  python -m app.cli preflight-production-config
```

结构预检成功不代表真实 AI/OSS Gate 已通过；仍需受控验证权限、连通性、超时、CORS、预签名上传、HEAD 和短期下载。

## 4. 只读 drift inventory

远端写授权前重新核验 hostname/时间/资源，精确 Compose project/service/container/image/health/restart，`19000/19001/19080` listener，DB revision、migrate container 集合、Nginx enabled target/checksum/`nginx -t`，TLS 有效期与续期 owner，current/release/manifest，以及三个数据目录的类型、device、owner、mode 和 size。

任何值与授权包不一致都停止并重新评审。只读 inventory 不查看表内容、对象内容、环境变量值或 container secret。

## 5. 数据隔离合同

执行前必须停止旧 `api`、`worker`、`scheduler`、`frontend`、`fake-oss`、`postgres` 和 `redis`，并确认没有活动业务写入。然后运行：

```sh
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
PARTSIGNAL_QUARANTINE_ROOT=/root/partsignal-data-quarantine \
  python3 ./deploy/scripts/prepare-production-data.py \
  quarantine prr_YYYYMMDD_HHMMSS
```

脚本只允许固定 Production 根目录；测试路径必须通过显式 test-only 开关。它拒绝路径别名、任一祖先符号链接、嵌套根、独立 mountpoint、跨 device、运行中的历史 Compose project，以及任一运行容器与活动数据根存在祖先/后代重叠的挂载。每个 rename/mkdir 的目录项先同步到磁盘，再原子更新权限为 `0600` 的状态文件；中断后使用同一命令和 run ID 续跑。脚本不执行 `rm`、不创建新 `objects`、不把 quarantine 挂载给 Production。

## 6. Clean init

在候选 release 目录运行，变量必须与 manifest 和 Production env 对应：

```sh
PARTSIGNAL_VERSION="$release_id" \
PARTSIGNAL_BACKEND_IMAGE="$backend_repository" \
PARTSIGNAL_FRONTEND_IMAGE="$frontend_v2_repository" \
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
PARTSIGNAL_RELEASE_MANIFEST="$manifest_path" \
PARTSIGNAL_DEPLOY_MODE=clean-init \
PARTSIGNAL_CUTOVER_RUN_ID=prr_YYYYMMDD_HHMMSS \
ENV_FILE=/root/partsignal/shared/.env.production \
COMPOSE_FILE=deploy/compose.prod.yaml \
  ./deploy/scripts/deploy.sh
```

`clean-init` 先验证状态为 `QUARANTINED`、run ID/固定根/隔离目标匹配、两个活动目录为空且没有 `objects`，并把状态绑定到 manifest 摘要、release/commit/schema、backend/frontend 镜像引用、image ID 与 RepoDigest；脚本同时复算固定 tracked files，且只接受 `deploy/compose.prod.yaml`。镜像 pull 后再次核对本地 image ID 与 RepoDigest。随后才执行 PostgreSQL/Redis、Production config preflight、migration、空库 integrity、`initialize-accounts`、API/Frontend 与回环探针。成功后状态为 `PRODUCTION_PREPARED`，Worker/Scheduler 仍保持停止。

使用 API/Frontend 完成真实 AI/OSS Gate。只有 Gate=`MET` 后才运行：

```sh
PARTSIGNAL_VERSION="$release_id" \
PARTSIGNAL_BACKEND_IMAGE="$backend_repository" \
PARTSIGNAL_FRONTEND_IMAGE="$frontend_v2_repository" \
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
PARTSIGNAL_RELEASE_MANIFEST="$manifest_path" \
PARTSIGNAL_DEPLOY_MODE=clean-init \
PARTSIGNAL_CUTOVER_RUN_ID=prr_YYYYMMDD_HHMMSS \
PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
ENV_FILE=/root/partsignal/shared/.env.production \
COMPOSE_FILE=deploy/compose.prod.yaml \
  ./deploy/scripts/activate-production.sh
```

激活脚本必须在同一维护锁内精确匹配部署阶段绑定的 manifest 和实际 image ID，再验证 `PRODUCTION_PREPARED` 与 API/Frontend，显式启用非默认 `production-async` profile，最后推进到 `PRODUCTION_INITIALIZED`。不得用 `upgrade` 绕过空库顺序，也不得加入 `--remove-orphans`。正常 upgrade 从既有 `PRODUCTION_INITIALIZED` 进入候选级 `UPGRADE_DEPLOYING`，部署成功后成为 `UPGRADE_PREPARED`；只有同一 manifest 通过外部 Gate 才能激活并返回 `PRODUCTION_INITIALIZED`。普通 `docker compose up -d` 不得启动 Worker/Scheduler。

## 7. fake OSS 退出

`fake-oss` 必须在移动 objects 前停止。Production Compose 不声明该 service、端口 `19001` 或 `/object-storage/` 代理。真实 OSS Gate 未通过前保留已停止的 container/image 证据；通过并另获授权后才按完整 container ID 和 service label 删除，禁止 `down --remove-orphans` 或宽泛 prune。

## 8. Nginx 原子更新

Nginx 写与 reload 是独立授权。授权包包含 enabled symlink target、旧/新 SHA-256 和备份路径。顺序固定为 `cp -a` 精确备份、同目录临时文件、owner/mode 与 checksum 校验、同文件系统原子替换、`nginx -t`，最后另取 reload 授权。失败立即恢复备份并再次 `nginx -t`。

Production 模板必须代理 `19000` 和 `19080`，不包含静态 root、`19001` 或 `/object-storage/`。API upstream `keepalive_timeout 30s`，Uvicorn `--timeout-keep-alive 35`。

## 9. Frontend V2-only 回滚

仅当故障被证明局限于 frontend artifact 时，切换 manifest 中上一份已验证 V2：

```sh
PARTSIGNAL_VERSION="$release_id" \
PARTSIGNAL_BACKEND_IMAGE="$backend_repository" \
PARTSIGNAL_FRONTEND_IMAGE="$frontend_v2_repository" \
PARTSIGNAL_ROLLBACK_FRONTEND_IMAGE="$previous_v2_repository" \
PARTSIGNAL_ROLLBACK_FRONTEND_VERSION="$previous_v2_tag" \
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
PARTSIGNAL_RELEASE_MANIFEST="$manifest_path" \
ENV_FILE=/root/partsignal/shared/.env.production \
COMPOSE_FILE=deploy/compose.prod.yaml \
  ./deploy/scripts/rollback-production-frontend.sh
```

脚本只接受当前 Production 状态绑定 manifest 中的 `rollback_frontend` reference、image ID 与 RepoDigest，并在同一维护锁内执行 `--no-deps --no-build --pull never` frontend-only recreate；成功后记录活动 frontend 身份。前后比较 API、Worker、Scheduler、PostgreSQL、Redis container/image、DB revision、Nginx checksum 和 release record；只允许 frontend container/image 变化。V1 不属于 Production 回滚目标。

## 10. 数据恢复

如果 clean-init 或验收失败且决定恢复旧 Staging 数据，先停止新 service 并确认无新写入，保留日志/manifest/container evidence，再运行：

```sh
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
PARTSIGNAL_QUARANTINE_ROOT=/root/partsignal-data-quarantine \
  python3 ./deploy/scripts/prepare-production-data.py \
  restore prr_YYYYMMDD_HHMMSS
```

脚本在同一固定锁内先验证所有路径、device、container/mount 静默和状态，再把失败 Production 数据保留到 `<run-id>/failed-production/`，逐叶恢复旧 `postgres`、`redis`、`objects`。每个 rename 都记录位置，进程中断后同一 restore 命令可继续；不删除任一版本。随后恢复旧 `.env.staging`、Staging Compose/Nginx 和当前 V2 image。Nginx 恢复仍须 `nginx -t` 与单独 reload 授权。默认不运行 Alembic downgrade。

## 11. 验收与观察

切换后检查回环、公网 HTTP、V2 artifact、登录后核心只读流、受控写、真实 AI/OSS、容器健康和资源。HTML/SPA 必须 `no-cache`，hashed assets 必须 immutable，missing asset/`.map` 必须 `404`，JS 无 `sourceMappingURL`，CSP/安全头只由外层 Nginx 持有，且 `/object-storage/` 不存在 Production 代理。

观察期记录 Nginx 5xx/upstream、API error、restart/OOM、Worker/Scheduler、DB/Redis、AI/OSS 与核心业务结果。只有 Observation Gate=`MET` 后才能单独实施 V1 源码/pipeline 删除；quarantine、旧 release/image、fake-oss 和 `.env.staging` 清理仍需破坏性授权。
