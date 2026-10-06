# Production 候选交付与维护隔离契约

## Scenario：registry 与 Host 本地候选交付

### 1. Scope / Trigger

修改 `deploy/scripts/deploy.sh`、`activate-production.sh`、候选 manifest producer/consumer 或 Production 镜像仓库约束时适用。运维步骤仍以 `docs/Hostdzire部署上线流程.md` 和 `docs/Hostdzire部署附录.md` 为权威；本规范只约束代码实现与回归测试。

### 2. Signatures

- `PARTSIGNAL_IMAGE_DELIVERY_MODE`：可选环境键；未设置为 `registry`，显式值只允许 `registry` 或 `local`，空值无效。
- `deploy/scripts/deploy.sh`：准备 PostgreSQL/Redis、migration、账号、API/frontend。
- `deploy/scripts/activate-production.sh`：外部 Gate 通过后激活 Worker/Scheduler。
- `create-release-manifest.py` 与 `prepare-production-data.py`：分别是候选身份 producer 与共享 consumer。
- `prepare-production-data.py bootstrap-ai`：`PRODUCTION_PREPARED` 下唯一的 Host root/operator AI bootstrap 入口；复用同一 cutover state、candidate consumer 与 maintenance lock。

### 3. Contracts

- `registry` 保持 `pull -> verify-candidate-images -> run/up`。
- `local` 不 pull；候选镜像必须已存在，manifest image ID/RepoDigest 校验必须早于第一个 Compose `run/up`，相关 `run/up` 必须使用 `--pull never`。
- Production Compose project 固定 `partsignal-staging`，network logical key、physical name 与既有 network label 精确相等，均为 `partsignal-staging-internal/egress/edge`。internal=true；migrate/API/worker/scheduler 只连接 internal+egress，PostgreSQL/Redis 只连接 internal，frontend 只连接 edge。不使用 external/override 或更换 project 绕过 ownership。
- runbook 的直接 local preflight 必须先通过同一 release manifest 的 tracked-file/image identity 校验，再使用 `run --rm --pull never --no-deps`；不能让 probe 隐式 pull 或启动依赖服务。
- backend、frontend、rollback frontend 的 repository 末段以 `backend-v1` 或 `frontend-v1` 结尾时，producer 和 consumer 都必须拒绝；deploy/activate 还应在状态转换前拒绝对应环境变量。
- V1 不能进入 manifest、Production Compose 操作或 frontend rollback；V2-only 不依赖 UI 隐藏或人工约定。
- GEO-1003：deploy/activate/rollback 在维护锁和状态变更前执行 `check-production-inputs.py --deployment-boundary <runtime_file>`；Browser true、非权威 Compose/overlay、除 production-async 外的 profile、Browser 会话材料均明确失败。生产 Compose 固定 APP_ENV=production，Browser 原始输入由共用 Settings 拒绝；展开任何 profile 无 Browser 服务或会话卷。完整配置合同和非生产骨架边界见 `docs/production-configuration.md`。
- `bootstrap-ai` 在同一维护锁内验证 run ID、manifest/candidate、phase 和正在运行 API 容器的 project/service/image/running/mount identity；不得读取 `.Config.Env`，不得启动 one-off service 或执行 `run/up/pull`。
- host 在调用 backend 前原子写入无 secret 的 `ai_bootstrap_attempt=STARTED`；任何已有 attempt 都拒绝重入。完整成功更新 `SUCCEEDED`，明确失败更新 `FAILED`，结果未知保持 `STARTED`；`verify-prepared`/activation 必须拒绝 `STARTED` 或 `FAILED`，且不提供 force-clear。
- credential 只从真实交互式 no-echo TTY 经 `docker exec -i` stdin 传入；禁止 argv、environment、文件、history、日志、Docker metadata 或异常透传。bootstrap 成功不自动把完整 External Services Gate 标为 `MET`。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| key 未设置 | 使用 `registry` |
| key 为空或未知 | 状态码 `2`，输出中文“无效的 Production 镜像交付模式” |
| local 镜像缺失或 identity 漂移 | 在任何 `run/up` 前失败 |
| manifest 含 V1 current/rollback reference | producer 或共享 consumer 明确失败 |
| registry candidate 合法 | 保持 pull 后校验与既有启动顺序 |
| bootstrap phase/candidate/container identity 不匹配 | backend 未启动，attempt/数据库不变，明确失败 |
| 已有 attempt 或任意 AI 配置 | 拒绝重试/覆盖，不调用 provider |
| provider 明确失败 | attempt=`FAILED`，保留停用配置与 FAILED test state，activation 拒绝 |
| backend 结果未知或输出丢失 | attempt 保持 `STARTED`，禁止重试和 activation，只读核对或恢复 |

### 5. Good / Base / Bad Cases

- Good：Host 已顺序构建当前 backend 与 canonical `frontend/`，使用 `local`，identity 校验后以 `--pull never` 运行。
- Base：未设置 delivery mode，继续使用 registry 流程。
- Bad：local 模式缺镜像、传空 mode、使用 `partsignal-frontend-v1`，或篡改 rollback manifest；全部 fail closed。

### 6. Tests Required

`deploy/scripts/test-deploy-production.sh` 至少断言：

- registry 的 pull、identity verification、首个 up 顺序；
- local 无 pull，所有相关 `run/up` 均含 `--pull never`；
- missing image 在 `run/up` 前失败；
- 空/非法 mode 的具体错误；
- backend/frontend V1、producer V1 和 consumer 的 tampered rollback V1 都被拒绝；
- 负向用例检查具体错误原因，不能只检查非零退出码。
- 实际 Compose config 精确断言三组 logical/name identity、全部 service network 集合与 internal/安全拓扑；本地真实 Engine 对已存在且 label 匹配的网络运行七个 service probe，并对三个旧 label 分别断言具体 mismatch。测试直接使用权威 Production Compose，仅在本地 Unix socket 且固定 project/network 未被占用时创建 owned 资源，退出后 container/network/temp 归零；不能 skip Engine 或使用 sleep 等待。
- `bootstrap-ai` 的 TTY/no-echo、fallback/non-TTY/EOF/SIGINT、wrong run/manifest/candidate/phase/container identity、attempt 重入与 unknown result；断言 secret 不进入命令、state、stdout/stderr 或 Docker inspect 请求。
- `verify-prepared` 和 activation 对 `STARTED/FAILED` fail closed，对无 attempt 的既有 upgrade 兼容路径保持原行为。

### 7. Wrong vs Correct

#### Wrong

```sh
docker compose up -d api frontend
```

手工 Compose 绕过 manifest/state owner，也允许 CLI 隐式 pull。

#### Correct

```sh
PARTSIGNAL_IMAGE_DELIVERY_MODE=local ./deploy/scripts/deploy.sh
```

由权威脚本完成候选校验、`--pull never` 和既有状态转换。

## Scenario：Production Nginx maintenance guard

### 1. Scope / Trigger

修改 Production manifest tracked-file allowlist、`deploy/nginx/partsignal-maintenance.conf.template`、Production/maintenance Nginx 切换顺序或对应部署自检时适用。该场景只约束仓库候选和维护隔离合同；远端 Nginx write/reload 仍必须按 Hostdzire Runbook 取得独立 exact authorization。

### 2. Signatures

```text
deploy/nginx/partsignal-maintenance.conf.template
deploy/nginx/partsignal.conf.template
deploy/nginx/partsignal-security-headers.conf
node deploy/scripts/check-nginx-security.mjs
deploy/scripts/test-deploy-production.sh
```

维护 HTTPS 响应固定为：

```http
HTTP 503
Content-Type: text/plain
Cache-Control: no-store
Retry-After: 3600

PartSignal maintenance
```

### 3. Contracts

- manifest producer 与 consumer 的 `REQUIRED_TRACKED_FILES` 必须同时包含 maintenance template 和生产输入检查脚本；Production 自检的全部 manifest 创建路径和 exact-set 断言必须使用相同 11 项集合。
- maintenance template 保留 `geo.962850.xyz`、`<HOSTDZIRE_WG_ADDRESS>`、HTTP 到 HTTPS、ACME、TLS、PartSignal security snippet 和 `add_header_inherit merge`。
- maintenance template 不得声明 upstream、`proxy_pass`、静态 `root`、`19000`、`19001`、`19080` 或 `/object-storage/`；API/frontend 即使已在同一 loopback 端口启动，也不能通过公网访问。
- 停止任何 PartSignal 容器前必须先完成 maintenance write、`nginx -t`、独立 maintenance reload 和公网 `503` 验证；首次验证时间是 60 分钟硬窗口的 T0。
- 真实 AI/OSS Gate、activation、runtime identity 和 health 全部通过后，才能执行 final Production write；final reload 与 maintenance reload 不能共用授权。
- manifest checksum 只证明候选模板身份，不证明远端 target 已安装；远端 backup、checksum、atomic replace、`nginx -t` 和 reload 证据仍由当次授权包负责。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| producer/consumer/test 任一 allowlist 缺少 maintenance template | 候选生成、消费或 Production 自检失败，不冻结 candidate |
| maintenance template 缺少 TLS/ACME/security owner | `check-nginx-security.mjs` 或 Production 自检失败 |
| maintenance template 包含 upstream、代理、静态 root 或应用端口 | Production 自检失败，不允许进入 N1 |
| maintenance reload 后公网不是固定 `503` | 不停止容器，不开始 Maintenance/Data |
| external Gate 前准备安装 final Production template | 停止，保持 maintenance 公开边界 |
| `nginx -t` 失败 | 不 reload，按 exact backup 恢复并再次测试 |

### 5. Good / Base / Bad Cases

- Good：同一 manifest 冻结 maintenance/Production template；先公开固定维护响应，再停止容器和 clean-init；真实 Gate 后才独立切回 Production。
- Base：仓库合同和 candidate 准备完成，但远端 N1/N2 未获授权；旧运行态和活动 Nginx 保持不变。
- Bad：先停止容器、只改 DNS/防火墙、停全局 Nginx，或让旧 Nginx 在真实 Gate 前代理复用 `19000/19080` 的新候选。

### 6. Tests Required

`deploy/scripts/test-deploy-production.sh` 至少断言：

- maintenance template 精确包含 host、HTTP/HTTPS listen、ACME、TLS、安全 snippet、`add_header_inherit merge`、固定状态/正文/cache/retry 响应；
- maintenance template 不包含 upstream、`proxy_pass`、静态 root、三个应用端口或 `/object-storage/`；
- producer、consumer、三组 manifest producer test input 与 manifest exact-set assertion 均包含相同 11 项 tracked files（包含 `check-production-inputs.py`）；
- `check-nginx-security.mjs` 把 maintenance template 与 Production/Staging template 一起检查，拒绝缺少安全 snippet、缺少 header inheritance 或重复安全头。

### 7. Wrong vs Correct

#### Wrong

```text
停止旧容器 → clean-init 启动新 API/frontend 到 19000/19080
→ 旧 Nginx 立即把未完成真实 Gate 的候选暴露到公网
```

#### Correct

```text
manifest 固定 maintenance template → atomic write → nginx -t
→ 独立 reload 授权 → 公网 503/T0 → exact stop + clean-init + real Gate
→ final template atomic write → nginx -t → 独立 final reload 授权
```


## Scenario：未 initialized 的升级 artifact 前向恢复

`prepare-production-data.py recover-upgrade` 是唯一显式失败恢复入口。接受 UPGRADE_DEPLOYING/UPGRADE_PREPARED，但阶段本身不能证明失败；必须消费匹配当前 candidate/attempt 的未消费 failure record。完整命令、批准及维护顺序由 Hostdzire 部署附录拥有；GEO-1007 用户任务对应 delivery GEO-1008 范围。

- 原子状态 owner 仍为 prepare-production-data.py。每次 begin-upgrade 创建独立 upgrade_attempt；重试使旧失败不可消费，历史 upgrade_failures 不可覆盖。deploy.sh 在 begin 成功后的明确非零退出路径记录 candidate、attempt、stage、exit_code/signal、failed_at、failure_kind 和低敏 evidence_ref。未写成事实即安全停止，不补造。
- prepared 后的问题须独立批准的 declare-pre-activation-failure；标为 OPERATOR_DECLARED_PRE_ACTIVATION_FAILURE，不声称部署退出。已声明失败的 prepared attempt 禁止激活。
- manifest 的 images.migration 单独冻结 reference/image ID/RepoDigest；首次默认 backend。Compose migrate 消费 PARTSIGNAL_MIGRATION_IMAGE（完整 reference，默认当前 backend），应用 API/CLI 使用 backend。恢复必须保留失败执行的 migration image ID，不能回退到修复 backend；缺旧身份或首次运行时证明停止。
- MIGRATION_RUNTIME_V1 指纹由 production_migration_runtime.py 唯一拥有。冻结 migration image 全部 rootfs：所有 app、配置、模型、动态 helper/数据文件、Python、依赖、startup/字节码、共享库、基础系统及执行配置，含 Python 缓存选择所需 mtime。不得把局部 AST 或外部文件哈希相同宣称为完整闭包；可变 backend 与完整冻结迁移程序分离。
- 环境证明使用冻结 ID 的 stopped container 静态 export，不启动、不执行镜像 Python、无网络/数据挂载；/app 的 pyc/pyo 拒绝，非空 Entrypoint/非 /app WorkingDir/隐式 Volumes 拒绝。临时资源按唯一归属精确清理。Cmd 被权威 Compose 覆盖，不参与迁移程序身份；恢复仍严格保持原迁移 image ID。
- 首次 begin-upgrade 在迁移前验证 manifest/实际 migration image/当前 Alembic tree，并原子冻结 candidate-bound runtime。失败、新 manifest 指纹及两个 migration image 全部相同；认证 archive 与 checkout 的 Alembic Python/SQL/ini 单独比较。app 运行时已由完整迁移镜像冻结，允许修复 backend 的独立 artifact。历史缺证、未知版本、迁移镜像/程序/schema/Alembic变化均停止。
- producer/consumer/已知调用者使用相同 11 项 tracked-file allowlist，包含两个证明模块。旧 manifest 只按 state 冻结 sha 认证；新 manifest 不豁免 tracked hash、所有镜像 ID 或 RepoDigest。runtime.env 允许键由 manifest 已认证的 check-production-inputs.py 静态声明拥有，包含合法可选日预算；可编辑模板不能授权额外加载环境覆盖；默认缓存策略仍在首次迁移前证明。
- 维护锁内验证整个 project/活动数据 mount stopped。正式 recover 自动进入 run-locked，内层验证继承 FD；SIGINT/SIGTERM 转发整组，10秒后必要时 SIGKILL，再确认全部子孙不可执行才释放锁。OS 状态不可读则持续持锁；SIGKILL/断电须现场核对 Engine 资源。
- 一次原子写只绑定新 candidate、phase=UPGRADE_DEPLOYING 和完整 failure/runtime receipt；previous_candidate/历史保留，不 pull/up、不修改DB、不 initialized。相同请求仅在未开始新 attempt、仍 deploying 且全服务 stopped 时重放。完整 redeploy/readiness、backend integrity/schema 证明、外部 Gate/activation 仍必须执行。

定向验证：make test-upgrade-recovery；固定本地 project/network 空闲时 make test-upgrade-recovery-compose。真实 recovery SIGTERM 在阻塞 fake docker ps 期间注入；Compose 的失败后信号只证明演练清理，不能扩大到进行中 Engine。Production 编排/manifest 消费者使用 test-deploy-production.sh；合成 AI/OSS MET 不是生产门禁。

registry 交付顺序：verify-upgrade-entry → Compose config → pull api/worker/scheduler/frontend/migrate → 全镜像 ID/RepoDigest → begin-upgrade 验证/冻结 → run/up。local 不 pull；错误 manifest/另一候选在 pull 前拒绝。
