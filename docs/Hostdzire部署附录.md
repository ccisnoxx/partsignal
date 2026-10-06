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
  --tracked-file deploy/scripts/check-production-inputs.py \
  --tracked-file deploy/scripts/prepare-production-data.py \
  --tracked-file deploy/scripts/production_upgrade_recovery.py \
  --tracked-file deploy/scripts/production_migration_runtime.py \
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

python3 ./deploy/scripts/check-production-inputs.py --deployment-boundary "$ps_env"
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

### 未初始化升级的显式前向恢复

只适用于旧版本已 initialized 后的 upgrade，当前 phase 为 UPGRADE_DEPLOYING 或 UPGRADE_PREPARED，且存在与当前 candidate/attempt 匹配、尚未消费的持久化失败记录。clean-init、跨 schema、冻结迁移镜像程序变化、无完整归档或无法证明静默均停止，由负责人另行设计备份恢复；不把 previous_candidate 直接恢复成 initialized。

1. 保持已验证的公网 maintenance 503。取得绑定目标、失败 release/manifest SHA、新 release/manifest/image、维护窗口、停止/恢复负责人和具体操作的批准。`approval_ref` 只是批准记录引用，不是批准本身；本附录不授予远端操作权限。
2. 保留失败状态、manifest、archive、迁移/启动日志和容器身份。`deploy.sh` 在成功 begin-upgrade 后的明确非零退出路径，由状态所有者记录 candidate、attempt、stage、exit_code/signal、failed_at、failure_kind 和低敏 evidence_ref；从状态的 `current_upgrade_failure_id` 取得当次 `failure_id`。中断导致该原子记录未完成时不得补造，继续保持维护。修正版使用新不可变 release ID 和镜像，走 clean main 候选生产者；不要覆盖旧 tag/manifest/archive。registry 镜像交付如需 pull，须先按本次新身份交付并核对；恢复入口不隐式 pull，也不启动业务服务。

   若问题是在 UPGRADE_PREPARED 后发现，必须另行取得明确声明“该候选不可继续激活”的批准与问题证据，再以失败候选变量执行 `python3 ./deploy/scripts/prepare-production-data.py declare-pre-activation-failure "$failed_manifest_path" --approval-ref "$approved_declaration_ref" --evidence-ref "$pre_activation_failure_evidence_ref"`。该记录明确标为操作员批准声明，exit_code/signal 为 null，不声称部署命令失败；声明批准与恢复批准分别保存。未记录失败的正常 deploying/prepared 候选不能走恢复入口。
3. 在原维护窗口和维护锁下，使用**已绑定失败版本**的权威 Compose/runtime 停止 api、worker、scheduler、frontend、postgres、redis 和实际遗留 service，等待在途写入结束。恢复入口会核对完整固定 project 及其他运行容器的数据挂载；任一检查不确定即拒绝，不提供 force。
4. 在修正版 release checkout 执行以下已替换为当次真实输入的精确命令（路径均为绝对普通文件；两个归档名须匹配各 manifest）：

```sh
PARTSIGNAL_VERSION="$fixed_release_id" \
PARTSIGNAL_BACKEND_IMAGE="$fixed_backend_repository" \
PARTSIGNAL_FRONTEND_IMAGE="$fixed_frontend_repository" \
PARTSIGNAL_DATA_ROOT=/root/partsignal-data \
PARTSIGNAL_RUNTIME_ENV_FILE=/root/partsignal/shared/.env.production \
PARTSIGNAL_MIGRATION_IMAGE="$frozen_migration_reference" \
  python3 ./deploy/scripts/prepare-production-data.py recover-upgrade "$fixed_manifest_path" \
  --failed-release-id "$failed_release_id" \
  --failed-manifest-sha256 "$failed_manifest_sha256" \
  --failure-id "$failure_id" \
  --failed-manifest "$failed_manifest_path" \
  --failed-source-archive "$failed_source_archive" \
  --source-archive "$fixed_source_archive" \
  --recovery-id upr_YYYYMMDD_HHMMSS \
  --approval-ref "$approved_recovery_record_ref"
```

正式 `recover-upgrade` 入口自动进入 signal-managed run-locked，内层验证继承锁 FD。旧 state manifest SHA 认证失败材料，新 consumer 认证修正版并消费 failure_id。

manifest 单列 `images.migration` 的 reference/image ID/RepoDigest。首次候选默认与 backend 相同；修正版生成 manifest 时必须传 `--migration-image "$frozen_migration_reference"`，保留失败执行绑定的原迁移镜像。每次恢复、deploy、activate 或后续 rollback 都显式传 `PARTSIGNAL_MIGRATION_IMAGE="$frozen_migration_reference"`。权威 Compose 的 migrate 只执行该镜像；修复 backend 负责应用启动、CLI、完整性/readiness。

MIGRATION_RUNTIME_V1 使用冻结 migration image ID 创建无网络/数据挂载、只读且不启动的临时容器，静态导出全部 rootfs：所有 app 源码和数据、配置/db/models、动态导入目标、Python/依赖/startup/缓存、共享库、基础系统与执行配置均进入指纹。Python 源码/缓存 mtime 同样冻结；/app 内拒绝 pyc/pyo。临时停止容器精确清理，不执行镜像 Python 自证。非空 Entrypoint、非 /app WorkingDir 与隐式 Volumes 拒绝；迁移 command 由权威 Compose 固定。局部 AST 不是完整运行时证明。

首次 begin-upgrade 必须在迁移前验证并原子冻结 candidate-bound migration image/runtime。恢复比较失败执行记录、旧/新 manifest、实际旧/新 migration image；严格要求原 image ID 和完整指纹不变。两份认证 archive、当前 checkout 与 migration image 的 Alembic Python/SQL/ini 另行一致性校验。修复 backend 可改变独立应用 artifact；不能替换迁移程序。缺旧身份、镜像或历史证明、未知版本/任何不一致都停止，不补造。runtime.env 允许键由 manifest 已认证的 check-production-inputs.py 静态声明拥有，包含合法可选日预算；可编辑模板不能授权 PATH/PYTHONPATH/LD_PRELOAD 等额外覆盖。业务配置仍须生产输入与应用预检。

成功仅一次原子写固定候选与完整 failure/runtime receipt，仍 UPGRADE_DEPLOYING；previous_candidate/失败历史保留，不直接初始化。

5. 执行既有 `deploy.sh`，全部正常后才 UPGRADE_PREPARED；该恢复候选 prepared 前还须以权威 Compose 的 `--pull never --no-deps` backend 通过既有 preflight-integrity 和真实 alembic_version 检查。然后重新完成真实 AI/OSS Gate、身份、health 及单独 activation 批准，再执行 `activate-production.sh`。最后按独立授权恢复公网 Nginx；恢复入口不自动开放流量。
6. 再次失败维持 maintenance，保存新失败候选和阶段。每次同候选 deploy 重入建立新 attempt，旧失败记录不再可消费；修正版失败须新 failure_id。完全相同 recovery_id/输入仅在仍 deploying、尚未开始新的部署 attempt 且全服务停止时重放回执；不同输入、prepared/initialized 或旧请求均拒绝。再次修 artifact 必须新 release、新恢复 ID 与新批准，不能改旧回执。状态原子写前中断仍旧候选、写后中断固定新候选；读取状态后按唯一候选续跑，不手改或删除状态。

直接调用上述恢复命令与部署/激活使用相同 run-locked 生命周期。SIGTERM/SIGINT 转发整个子进程组，有限等待并必要时 SIGKILL，子孙结束后才释放维护锁；实际恢复 probe 期间向父 PID 发 SIGTERM 的定向测试保护这一入口。中断不等于 Engine 操作已回滚；核对实际容器、schema、临时停止容器与持久阶段，保留 maintenance。SIGKILL/断电不能运行清理，必须现场确认静默。

恢复证据使用[升级恢复模板](./geo-monitoring/04-delivery/geo-1007-upgrade-recovery.template.yaml)，未知保持 null/NOT_VERIFIED。本地测试不证明目标服务器、公网 maintenance、备份、外部服务或批准已就绪。

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

迁移镜像证明拒绝整个 `/app` 中的 `.pyc/.pyo`，并拒绝冻结迁移镜像、runtime 和宿主机环境中的非空 `PYTHONPYCACHEPREFIX`。静态 export 冻结树外依赖、startup 与缓存内容及 Python mtime，不执行镜像 Python 自证。禁写缓存不等于禁止读取缓存。canonical backend/Dockerfile 在 runtime/test 的 uv sync 后清理整个 `/app` 缓存；历史含应用缓存镜像保持安全停止，不覆盖旧镜像。真实 app 模块 unchecked-hash 缓存和树外依赖变更反例由 `test-upgrade-image-cache.py` 验证。

首次 initialized→upgrade 在迁移之前由状态所有者验证 runtime/host 与冻结镜像默认环境不指定非空 PYTHONPYCACHEPREFIX，原子记录与完整 candidate 绑定的 DEFAULT_PYTHON_CACHE_V1 执行策略。恢复必须验证失败执行的既有策略；仅当前配置正常不足以证明历史。历史缺失、unknown 或候选错配均拒绝，不能在同候选重入或恢复时补造历史证明；保留 maintenance，另行设计显式备份 abort/recover。成功恢复绑定新策略，回执保留旧策略。历史 runtime 清除反例已用真实 Docker loader 与接管前状态测试验证。

upgrade 镜像交付顺序：verify-upgrade-entry 通过完整 manifest consumer 并只读判定 phase/candidate → Compose config → registry pull（local不pull）→ frozen image ID/RepoDigest验证 → begin-upgrade 原子证明cache policy与绑定candidate → run/up。入场判定与begin共用状态所有者规则；错误manifest/另一候选在pull前拒绝，registry未缓存镜像不能要求先inspect；pull/identity/policy失败均不开始首次upgrade。clean-init时序保持原合同。
