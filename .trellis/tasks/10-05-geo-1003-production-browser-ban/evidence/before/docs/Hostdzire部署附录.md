# Hostdzire Production 部署附录

本附录给出 `geo.962850.xyz` 原地转换的命令合同和恢复检查。所有示例都必须先替换为当次已核验的 release、镜像、路径和 checksum，并作为精确授权包交由用户批准；不要直接把示例视为线上写授权。

## 1. SSH 与敏感信息

只使用本机 OpenSSH alias：`ssh hostdzire '<已批准的精确命令>'` 与 `scp <source> hostdzire:<approved-target>`。`hostdzire` 是应用主机唯一写入目标；`dmit` 仅在公网入口异常时只读诊断。主机密钥冲突必须停止，不能自动接受新 key 或执行 `ssh-keygen -R`。

禁止读取或输出私钥。Production env、数据库密码、会话密钥、账号密码、OSS/AI 凭据不得进入仓库、发布包、manifest、普通日志、对话或无受控权限的临时文件。完整 runtime env 仅可存放于明确批准、权限受限的配置文件和原子安装暂存；AI API Key 仍禁止写入任何文件，遵守第 6 节 true-TTY 合同。

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
  --tracked-file deploy/nginx/partsignal-maintenance.conf.template \
  --tracked-file deploy/scripts/deploy.sh \
  --tracked-file deploy/scripts/activate-production.sh \
  --tracked-file deploy/scripts/prepare-production-data.py \
  --tracked-file deploy/scripts/rollback-production-frontend.sh \
  --tracked-file deploy/nginx/partsignal.conf.template \
  --tracked-file deploy/nginx/partsignal-security-headers.conf \
  --output "$manifest_path"
```

生成器会机器验证当前分支、clean working tree、`HEAD == origin/main == --commit`，并重新生成该 commit 的 `git archive` 比较 SHA-256；测试逃生开关不得出现在候选环境。输出目标采用排他创建，存在即失败。三个镜像都必须具有合法且非空的 `repo_digests`；tracked file 必须与脚本固定 allowlist 完全一致。部署和激活会重新计算这些文件的 SHA-256，并同时核对 `PARTSIGNAL_VERSION == release_id`、本地 image ID 与 RepoDigest；任何漂移都拒绝继续。不得手工修改清单。

镜像交付模式由 `PARTSIGNAL_IMAGE_DELIVERY_MODE` 控制，未设置时为 `registry`；registry 模式保留 pull 后校验。Hostdzire 从本地构建候选时必须显式使用 `local`，此模式跳过 pull、要求候选 image 已存在，并在任何 `docker compose run`/`up` 前校验 manifest image ID 与 RepoDigest，相关命令均固定 `--pull never`。空值或未知模式、以及 V1 镜像仓库都会 fail closed。

## 3. Production env 预检

开发/生产完整模板、AI 初始化输入清单、本地准备与持久配置交付见[配置准备说明](./production-configuration.md)。输入就绪检查在 release freeze 前完成；本节检查使用随后冻结的新候选。现有 `deploy.sh` 不负责上传 env，普通发布复用固定文件。

共享文件固定为 `/root/partsignal/shared/.env.production`，权限 `0600`。转换前只输出键名或状态，不能输出值：

在已核验的候选 release 目录执行；`release_id`、两个 image repository 与绝对 `manifest_path` 必须属于同一新冻结候选。先由 manifest consumer 复算 tracked deployment files 并验证本地 image ID/RepoDigest，再执行直接 Compose probe；此 probe 会创建并删除一个 one-off 容器，须有对应授权。本地镜像交付固定 `--pull never --no-deps`，不拉取镜像、不启动或重建依赖服务。任何 identity 或现存 network label 不匹配都停止，不进入维护。

```sh
set -eu
ps_env=/root/partsignal/shared/.env.production
test -f "$ps_env"
test ! -L "$ps_env"
test "$(stat -c '%a' "$ps_env")" = 600

PARTSIGNAL_VERSION="$release_id" \
PARTSIGNAL_BACKEND_IMAGE="$backend_repository" \
PARTSIGNAL_FRONTEND_IMAGE="$frontend_v2_repository" \
python3 ./deploy/scripts/prepare-production-data.py \
  verify-candidate-images "$manifest_path"

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
docker compose --env-file "$ps_env" -f deploy/compose.prod.yaml \
  run --rm --pull never --no-deps api \
  python -m app.cli preflight-production-config
```

结构预检成功不代表真实 AI/OSS Gate 已通过；仍需受控验证权限、连通性、超时、CORS、预签名上传、HEAD 和短期下载。

## 4. 只读 drift inventory

远端写授权前重新核验 hostname/时间/资源，精确 Compose project/service/container/image/health/restart，`19000/19001/19080` listener，DB revision、migrate container 集合、Nginx enabled target/checksum/`nginx -t`，TLS 有效期与续期 owner，current/release/manifest，以及三个数据目录的类型、device、owner、mode 和 size。

任何值与授权包不一致都停止并重新评审。只读 inventory 不查看表内容、对象内容、环境变量值或 container secret。

Production project 固定为 `partsignal-staging`。三个网络的 physical name、Compose logical key 与 `com.docker.compose.network` label 必须分别精确等于 `partsignal-staging-internal`、`partsignal-staging-egress`、`partsignal-staging-edge`；三者的 `com.docker.compose.project` 必须为 `partsignal-staging`，只有 internal 网络为 `internal: true`。`name:` 相同不能代替 logical label 一致性，Compose 在 Engine 操作时会检查 ownership。只读核对示例：

```sh
docker network inspect \
  --format '{{.Name}}|{{index .Labels "com.docker.compose.project"}}|{{index .Labels "com.docker.compose.network"}}|{{.Internal}}' \
  partsignal-staging-internal partsignal-staging-egress partsignal-staging-edge
```

不匹配时退回仓库修复和完整 Repository Release Gate，不手工 relabel、删除或重建现存网络，不使用 external network、临时 override、其他 project 或手工容器绕过 ownership。manifest tracked Compose 变化后，旧 release/archive/images/manifest 仅保留为历史失败证据；新 release 必须使用新的 commit、release ID、run ID、archive、image tags 和 manifest，不覆盖、retag、删除或复用旧身份。

## 5. 数据隔离合同

执行前必须先按第 8 节把 manifest 固定的 maintenance 模板原子安装、通过 `nginx -t`，再取得独立 reload 授权；公网首次稳定返回该模板的 `503 PartSignal maintenance` 后记录 T0。只有维护状态已生效，才能按 `scheduler`、`worker`、`api`、`frontend`、`fake-oss`、`postgres`、`redis` 的顺序停止旧容器；必须先停止调度和写入生产者，再停止状态存储，并确认没有活动业务写入。然后运行：

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
PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
PARTSIGNAL_RELEASE_MANIFEST="$manifest_path" \
PARTSIGNAL_DEPLOY_MODE=clean-init \
PARTSIGNAL_CUTOVER_RUN_ID=prr_YYYYMMDD_HHMMSS \
ENV_FILE=/root/partsignal/shared/.env.production \
COMPOSE_FILE=deploy/compose.prod.yaml \
  ./deploy/scripts/deploy.sh
```

`clean-init` 先验证状态为 `QUARANTINED`、run ID/固定根/隔离目标匹配、两个活动目录为空且没有 `objects`，并把状态绑定到 manifest 摘要、release/commit/schema、backend/frontend 镜像引用、image ID 与 RepoDigest；脚本同时复算固定 tracked files，且只接受 `deploy/compose.prod.yaml`。local 模式不 pull，在任何 create/run/up 前再次核对本地 image ID 与 RepoDigest；registry 模式则保留 pull 后核对。随后才执行 PostgreSQL/Redis、Production config preflight、migration、空库 integrity、`initialize-accounts`、API/Frontend 与回环探针。成功后状态为 `PRODUCTION_PREPARED`，Worker/Scheduler 仍保持停止。

clean-init 成功且阶段为 `PRODUCTION_PREPARED` 后，先由真实 credential owner 在 Hostdzire 交互式 TTY 运行一次 AI bootstrap。以下参数均为非 secret，必须按 credential owner 提供的受控 provider 配置显式填写；不得从品牌、名称或 URL 猜测协议或 model：

```sh
PARTSIGNAL_VERSION="$release_id" \
PARTSIGNAL_BACKEND_IMAGE="$backend_repository" \
PARTSIGNAL_FRONTEND_IMAGE="$frontend_v2_repository" \
python3 ./deploy/scripts/prepare-production-data.py \
  bootstrap-ai prr_YYYYMMDD_HHMMSS "$manifest_path" \
  --channel-name "$channel_name" \
  --channel-description "$channel_description" \
  --protocol-type openai-compatible-chat-completions \
  --provider-brand "$provider_brand" \
  --base-url "$provider_https_base_url" \
  --timeout-seconds "$provider_timeout_seconds" \
  --model-display-name "$model_display_name" \
  --model-id "$exact_provider_model_id" \
  --request-parameters-json "$validated_non_secret_parameters_json"
```

三个 `PARTSIGNAL_*` 变量都是非 secret 的候选身份：`release_id` 必须等于 manifest release ID，`backend_repository` 与 `frontend_v2_repository` 必须是不带 tag 的 image repository，并且分别与 `release_id` 拼接后精确等于 manifest 的完整 backend/frontend image reference；它们不会从上一条 `clean-init` 命令的临时环境继承。脚本在同一 maintenance lock 内复核 run ID、绝对 manifest、candidate、`PRODUCTION_PREPARED` 与唯一运行 API 容器的 project/service/image/running/mount identity，然后才用 `getpass` 从真实 TTY 无回显读取 API Key，并通过 `docker exec -i` stdin 调用容器内 `python -m app.cli bootstrap-production-ai`。API Key 不得通过 argv、环境变量、文件、shell history、日志、Docker metadata、Trellis 或对话传入；getpass 发生 echo fallback、non-TTY、EOF 或 Ctrl-C 都必须退出。第一版不支持自定义 Header。

host 在 backend 启动前把无 secret 的 `ai_bootstrap_attempt` 原子记录为 `STARTED`。任何已有 attempt 或数据库中任意 AI channel/model/header 都拒绝再次执行；完整成功才更新 `SUCCEEDED`，明确失败更新 `FAILED`，结果未知保留 `STARTED`。provider 失败保留停用且 test=`FAILED` 的配置供调查，不自动重试或替换 credential；`STARTED/FAILED` 都阻断 activation，只能做脱敏只读核对或停止精确 API 容器后恢复数据，不得 force-clear。

bootstrap 的真实连接测试成功只证明该 model 的 credential 注入与连接边界；不得单独把 External Services Gate 写成 `MET`。继续完成受控的真实 AI/OSS Gate，包括 AI 结果语义与失败边界、OSS 空 namespace/零旧对象引用、预签名上传、HEAD、短期下载和 CORS。只有全部 Gate=`MET` 后才运行：

```sh
PARTSIGNAL_VERSION="$release_id" \
PARTSIGNAL_BACKEND_IMAGE="$backend_repository" \
PARTSIGNAL_FRONTEND_IMAGE="$frontend_v2_repository" \
PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
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

Nginx 写与 reload 是独立授权。每个授权包都包含 enabled symlink target、旧/新 SHA-256 和不可覆盖的备份路径。顺序固定为排他精确备份、同目录临时文件、owner/mode 与 checksum 校验、同文件系统原子替换、`nginx -t`，最后另取 reload 授权。失败立即恢复备份并再次 `nginx -t`。

停止任何容器前，先从 manifest 固定的 `deploy/nginx/partsignal-maintenance.conf.template` 渲染维护站点。它保留现有 host、HTTP 到 HTTPS、ACME、TLS 和 PartSignal security snippet，HTTPS 业务路径固定返回 `503`、`Content-Type: text/plain`、`Cache-Control: no-store`、`Retry-After: 3600` 和正文 `PartSignal maintenance`；不得声明 upstream、`proxy_pass`、静态 root、`19000`、`19001`、`19080` 或 `/object-storage/`。maintenance write 与 maintenance reload 分别授权，公网首次验证维护响应时记录 T0。

真实 AI/OSS Gate、activation 和候选 identity/health 全部通过后，才从 manifest 固定的 Production 模板执行第二次原子写入；final write 与 final reload 仍分别授权。Production 模板必须代理 `19000` 和 `19080`，不包含静态 root、`19001` 或 `/object-storage/`。API upstream `keepalive_timeout 30s`，Uvicorn `--timeout-keep-alive 35`。

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

观察期记录 Nginx 5xx/upstream、API error、restart/OOM、Worker/Scheduler、DB/Redis、AI/OSS 与核心业务结果。V1 源码/pipeline 已按 2026-08-29 开发阶段范围决策在仓库内退役，不代表 Observation Gate 已执行或为 `MET`；2026-08-29 开发任务的 Production Gate 均为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`，不能由本轮继承。quarantine、旧 release/image、fake-oss 和 `.env.staging` 清理仍需破坏性授权。
