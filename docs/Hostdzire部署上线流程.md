# PartSignal Hostdzire Production 发布 Runbook

当前支持人工 GEO 数据录入和已经实现的 API 型采集。Browser Collector、浏览器会话材料、自动登录和浏览器页面采集属于后续功能，当前版本不支持、不开启、不部署。

本文档是 `https://geo.962850.xyz` 的 Production 发布权威入口。发布支持既有版本升级、保留旧数据隔离后的首次安装，以及明确获准丢弃旧数据的清空重建；容器化Frontend V2是唯一前端owner。详细命令和恢复检查见[部署附录](./Hostdzire部署附录.md)，稳定安全边界见[部署与运维](./operations.md)。

仓库就绪不等于已经获准修改服务器。上传 release、写入环境文件、停止容器、移动数据、替换 Nginx、reload、受控业务写入和物理清理都需要针对精确目标的远端授权。

## 1. 固定运行边界

| 项目 | Production 合同 |
| --- | --- |
| 公网入口 | DMIT 只做四层 SNI/端口转发和 `proxy_protocol` |
| 应用主机 | Hostdzire，TLS 终止、站点 Nginx 与全部应用容器的唯一写入目标 |
| Compose project | `partsignal-staging`；仅为原地转换保留的历史 runtime identifier，不代表环境语义 |
| Compose networks | logical key、physical `name:` 与既有 network label 均为 `partsignal-staging-internal/egress/edge`；internal 保持 `internal: true` |
| Production env | `/root/partsignal/shared/.env.production`，权限 `0600`，不与 `.env.staging` 共享 |
| 活动数据 | `/root/partsignal-data/postgres`、`/root/partsignal-data/redis` |
| 旧环境隔离 | 保留数据安装使用 `/root/partsignal-data-quarantine/<run-id>`，不得被 Production mount；fresh-init 不创建隔离目录 |
| 回环端口 | API `127.0.0.1:19000`；Frontend V2 `127.0.0.1:19080` |
| Production services | `postgres`、`redis`、`migrate`、`api`、`worker`、`scheduler`、`frontend` |
| Frontend owner | `deploy/compose.prod.yaml` 的 `frontend` service，源码只来自 canonical `frontend/`；现有 Production image identity 保持 V2 命名 |
| Nginx owner | `deploy/nginx/partsignal-maintenance.conf.template` 在维护阶段阻断全部应用 upstream；`deploy/nginx/partsignal.conf.template` 在 Gate 通过后代理 API 与 Frontend V2 回环端口 |
| 对象存储 | 真实 `aliyun_oss`；Production 不运行或代理 `fake-oss` |
| 业务状态 | PostgreSQL 是唯一来源；Redis 只承担 Celery Broker |

Production 不使用 `/var/www/partsignal-frontend/current`，`/root/partsignal/current` 也只可作为验收记录，不能充当容器或流量回滚开关。

## 2. Gate 与停止条件

发布按 Repository、Artifact、Configuration/Capacity、Rehearsal、Remote Preparation、Cutover、Observation 顺序推进。每次先选择实际适用范围：代码验证与部署交付分开；容量/恢复演练和完整产品验收由本次变化或明确交付要求触发。未执行的检查如实记录为 NOT_RUN 或说明不适用依据，不宣称全部 Gate 通过。前一项适用 Gate 未通过时不得进入后一项。

出现以下任一情况立即停止：

- 本地不是干净的 `main`，候选提交与 `origin/main` 不一致，或 release/image/manifest 可覆盖。
- SSH 主机密钥冲突、目标身份或只读 inventory 与授权包不一致。
- 现存网络的 `com.docker.compose.project` 或 `com.docker.compose.network` 与固定 project/logical key 不一致；物理 `name:` 一致仍不足以通过 Engine ownership 校验。
- Production env 引用 `.env.staging`，或配置为 `deterministic`、development storage、fake OSS、非安全 Cookie、`AI_ALLOW_LOCAL_HTTP=true`。
- 保留旧数据的clean-init/upgrade缺少其要求的quarantine、恢复命令或已验证previous V2；清空重建则必须明确授权固定三个数据目录的内容丢弃，并具备新安装输入和安全停止/重建路径。
- migration、完整性、账号初始化、Compose health、`nginx -t`、live/ready、缓存/CSP/source-map 或浏览器验收失败。
- 真实 AI/OSS 只能通过放宽安全策略、固定成功适配器或输出凭据才能验证。

## 3. Repository 与 Candidate

### 验证选择合同

代码验证在开发/修复阶段按 [项目测试策略](./testing.md#验证选择与证据复用) 选择快速/领域检查，部署消费其记录。准备部署指定 commit 时执行完整 `make verify-release`；仅完成任务、形成新 SHA/release ID 或冻结候选不要求日常开发反复全量验证。同一已验证候选重启复用有效证据。先核实目标、数据保留方式、现有 runtime、AI 初始化方式、schema 和外部服务，再集中修复、验证并准备工件，避免每发现一个缺项就启动一轮全量检查。

| 变化 | 源码验证与工件 | 部署现场验证 |
| --- | --- | --- |
| 同一候选重启 | 复用原证据和镜像；不构建、不迁移、不初始化账号 | initialized/candidate/config/image 身份、应用健康、版本与最小 smoke |
| 纯文档/治理记录 | 文档、链接和 diff 检查；通常不发布应用 | 如有部署，只使用已验证应用工件 |
| 普通前端/后端修改 | 选择直接覆盖受影响合同的静态检查或相关测试；完整用户流程变化加定向 E2E；按构建输入变化重建镜像 | 固定候选的运行身份及受影响业务路径 |
| 迁移、权限、发布状态、恢复或依赖边界变化 | 直接覆盖该合同的集成/迁移/部署验证；高后果变更独立复核 | 对应迁移、配置、授权或恢复证明 |
| 当前交付明确要求完整门禁，或定向证据不足以覆盖具体剩余风险 | 在准备收敛的最终候选执行完整门禁并记录原因；候选形成不是触发原因 | 按实际交付范围验收 |

选择检查时：Nginx/template/security 修改运行 `check-nginx-security.mjs`；Production 执行器变化选择对应 Production/升级/重启测试；staging 脚本变化才运行 staging 自检；CLI 变化选择相关 CLI 测试。没有这些变化且旧证据输入未变，不因部署再运行这些源码检查。修改失败先重跑失败检查和直接影响范围；扩大范围须有新增风险依据。

验证记录可采用 [记录模板](../deploy/validation-record.example.json)，包含 candidate/baseline commit、changed paths、实际命令/结果、复用来源/输入未变依据、未验证范围，以及完整门禁触发原因。记录是操作者的证据索引，不是可信签名或测试执行器。旧 SHA 的全套结果不能直接写成新 SHA 的全套通过；可明确组合旧基线与本次增量证据。代码、依赖、测试配置或环境输入变化时，仅使依赖该输入的证据失效。

准备部署指定 commit 的完整手工验证入口为 `make verify-release`，旧 `make verify` 保持相同范围；小任务与功能切片分别选择快速/领域目标，详见 [测试策略](./testing.md#手工分层命令)。GitHub 只用于备份与服务器拉取，没有 Actions 部署步骤。Docker 部署可以使用 commit SHA 追踪源码；不要求 GitHub Release 或 Git tag。这里的 release ID 与镜像 tag 是既有不可变工件身份，继续绑定完整 commit、image ID/RepoDigest 和 manifest，不能省略或覆盖。日常部署脚本不隐式调用源码验证；消费有效证据并补充实际变化的现场检查。保留 Docker 构建缓存和已有依赖；源码、构建配置和依赖未变的镜像可复用其不可变身份。需要新 tag 时由 producer 冻结真实 image ID/RepoDigest，不能伪造身份或覆盖旧 release。

候选必须来自 clean、已推送的 `main`。默认 `previous-frontend` 恢复策略还冻结 previous V2 镜像；获准清空重建的 `fresh-rebuild` 将该角色记录为不适用。使用 `git archive` 生成不可覆盖源归档，构建 backend 和 Frontend V2 镜像后，通过 `deploy/scripts/create-release-manifest.py` 冻结完整 commit、源归档 SHA-256、backend/migration/current V2 的 image ID 与非空 RepoDigest、schema head、版本化 migration_runtime 指纹，以及固定 14 项 allowlist 中的 Production Compose、状态/部署/激活/输入检查脚本、Production/maintenance Nginx 模板和安全 snippet 校验和。migration 首次默认 backend；严格失败恢复须以 `--migration-image` 保留失败执行的原迁移镜像，并以 `PARTSIGNAL_MIGRATION_IMAGE` 将其完整 reference 传入后续正式命令。完整迁移程序由该镜像全部 rootfs 与执行配置冻结，修复 backend 独立变化。输入检查脚本 `check-production-inputs.py` 和迁移归档与运行时证明模块 `production_upgrade_recovery.py`、`production_migration_runtime.py`，以及部署执行 owner `production_deployment.py`、supervisor `production_maintenance_execution.py` 和清空边界 owner `production_fresh_reset.py` 必须按附录一起传入 tracked files。manifest 采用排他创建；部署和激活会复算 tracked files，并要求 `PARTSIGNAL_VERSION` 精确等于 release ID。不得复用 tag、覆盖文件或从 release 目录名推断 Git 状态。

Production 镜像交付模式由 `PARTSIGNAL_IMAGE_DELIVERY_MODE` 显式控制；未设置时默认为 `registry`，按既有顺序 pull 后校验 manifest 中的 image ID 与 RepoDigest。Hostdzire 本地构建候选必须明确设置为 `local`：脚本跳过 pull，但要求候选镜像已存在，并在任何 `docker compose run`/`up` 前完成同一 manifest 的身份校验，同时为相关路径传入 `--pull never`。空值或其他模式，以及任何 V1 镜像仓库，均立即拒绝；不得用手工 Compose 命令绕过该合同。

## 4. Production 配置

完整模板、本地只读检查命令与准备流程见[开发与 Production 配置准备](./production-configuration.md)。开发复制 `.env.example → .env`；生产独立复制 `.env.production.example → .env.production`，不把开发文件转换为生产文件。AI初始化方式在维护前明确：选择上线后admin-ui时不要求AI输入清单或Key交接；选择维护窗口bootstrap时，九项非secret参数与凭据交接确认集中在`deploy/production-ai.example.json`，该清单不是应用配置加载接口。所选方式的已知缺项应在release freeze和维护前确认，不能等到clean-init中途才索取。runtime 必须为无插值、无控制字符的 literal 配置；暂存安装前再次核验 Compose 实际消费的数据库身份，不能把 `config --quiet` 当作该校验。

本地准备文件可以通过独立受控配置交付安装到 `/root/partsignal/shared/.env.production`；最终文件只能在 Hostdzire 受控创建或更新，权限必须为 `0600`。后续 release 复用它，只有配置变化时才更新，`deploy.sh` 不自动上传或覆盖 env。已有文件更新必须保留现有 secret/数据库身份，并经过精确备份、受控暂存校验、旧 checksum 核验与原子安装；当前 Hostdzire 已有完整文件，不得用新空模板覆盖。至少满足 `APP_ENV=production`、安全 Cookie、`CONTENT_GENERATOR=openai-compatible`、`AI_ALLOW_LOCAL_HTTP=false`、`OBJECT_STORAGE_BACKEND=aliyun_oss`，并使用独立 session/encryption/database/account secrets 和完整低权限 OSS 配置。

只允许通过 `python -m app.cli preflight-production-config` 输出固定枚举与 `*_configured` 状态；不得输出 URL、bucket、AccessKey 或 secret 值。结构预检不能替代真实 AI/OSS 的权限、连通性、超时、CORS、上传/HEAD/读取验证。

附录的 pre-cutover probe 必须先用同一 release 的 manifest consumer 验证 tracked files 和实际镜像 ID/RepoDigest，再以 `run --rm --pull never --no-deps api` 执行；直接 probe 属于 one-off 容器创建授权。出现 network label mismatch 时停止并修复仓库合同，重建 Repository Release Gate；旧冻结 archive/images/manifest 仅为不可覆盖的历史失败证据，新 release 不得复用这些身份。网络修复不得通过手工 relabel/recreate、external、override 或更换 project 绕过 Compose ownership。

### 4.1 日常 Production 重部署

`deploy/scripts/redeploy-production.sh` 是 Host 侧日常入口，消费已准备的不可变 release、镜像与 manifest。源码交付、缓存构建和 manifest 生成沿用第 3 节与附录第 2 节；该入口不负责上传、Git 操作、重新构建或代码测试。不能用旧 `redeploy-staging-fast.sh` 操作 Production。

首次采用须先交付包含新 owner 的正式候选；旧 release 没有 `routine-production` 时，不能只复制包装脚本或覆盖 tracked owner 后继续使用旧 manifest。按既有 Runbook 完成新候选交付后，同候选重启才能复用新入口；不得改写历史 manifest 的 checksum 或恢复策略。

日常路径复用现用 runtime，先检查完整输入合同，再与已认证 API 内的实际配置比较；数据库、OSS、秘密或其他 runtime 键变化均转入配置 Runbook。这样不会检查旧库后把应用重建到另一库，也不会在 prepare 后使用另一份配置激活异步服务。比较仅输出固定状态，不回显配置。

1. 在进入维护前执行 `check`，集中检查候选、runtime、真实镜像、当前 initialized 状态与数据库 head。新版本还要求当前 manifest 和旧/新 source archive，证明实际已部署版本与两份迁移源码一致。schema/迁移变化、缺证明或非 initialized 状态明确拒绝，改走迁移/恢复 Runbook。
2. 经已授权的 Nginx maintenance write/reload 后，`prepare` 再确认真实公网 `503 PartSignal maintenance`，在同一维护锁和 supervisor 下复用既有 `upgrade`。它仍完成配置与数据完整性预检、迁移到同一 head、prepared/readiness，不自报或跳过已有阶段。
3. 在真实外部 Gate 满足后执行 `activate`，再次确认公网维护，复用权威激活入口和真实回环 smoke。`MET` 必须有对应 AI/OSS 证据；不能为了快速升级把 AI 待配置写成 MET。
4. 按既有授权独立原子恢复 Nginx 入口，再执行公网 `smoke`。失败保留维护/状态与具体失败，不自动回滚数据库或抹去失败 attempt。

同一已初始化候选只需重启时执行 `restart`，同样先确认公网维护。该操作使用相同 manifest/state/image 与锁/supervisor，只重建 API/Frontend/Worker/Scheduler；不建立 upgrade、修改持久状态、迁移、初始化账号、构建或拉取镜像。原候选的 `fresh-rebuild` 和 AI 待配置事实保留；重启成功不等于真实 AI 已通过。schema、配置或容器身份未知时停止。

命令与输入见[附录日常入口](./Hostdzire部署附录.md#日常-production-入口)。常规无迁移重部署目标为 5–15 分钟，须记录实际分阶段耗时；这是待测目标，不是已验证承诺。达到目标不允许放宽身份、维护隔离、数据和授权合同。

## 5. 原地转换

转换必须获得包含 release ID、镜像、目录、Nginx target 和命令顺序的远端写授权：

1. 重新只读 inventory，冻结当前 V2 image、Compose/Nginx checksum、容器集合、DB revision 和三个数据目录元数据。
2. 从同一 manifest 固定的 `partsignal-maintenance.conf.template` 渲染维护配置；在 N1 写授权内完成排他备份、同目录临时文件、checksum/owner/mode、原子替换和 `nginx -t`。N2 reload 必须独立授权；公网首次稳定返回 `503 PartSignal maintenance` 后记录 T0，维护配置不得包含应用、静态或对象存储 upstream。
3. T+10 前只按重新读取的 full container ID 和 project/service label，依次停止 `scheduler`、`worker`、`api`、`frontend`、`fake-oss`、`postgres`、`redis`；必须先停止调度和写入生产者，再停止状态存储，不得使用 `--remove-orphans`。
4. 运行 `prepare-production-data.py quarantine <run-id>`。脚本在固定排他锁内验证 canonical 路径、停止的 Compose project、活动 mount、同一 device 和持久阶段，再逐目录原子 rename；失败后以相同 run ID 续跑，不删除数据。
5. 以 `PARTSIGNAL_RELEASE_MANIFEST`、`PARTSIGNAL_DEPLOY_MODE=clean-init`、`PARTSIGNAL_IMAGE_DELIVERY_MODE=local` 和同一 `PARTSIGNAL_CUTOVER_RUN_ID` 运行 Production deploy script。它只在状态为 `QUARANTINED` 且 PostgreSQL/Redis 活动目录为空时，把 manifest 摘要、release/commit/schema 和镜像 ID 绑定到状态；local 模式不 pull，在任何 create/run/up 前核对实际 image ID 与 RepoDigest，再执行配置预检、migration、完整性检查、`initialize-accounts`，随后只启动 API/Frontend V2 并把阶段推进到 `PRODUCTION_PREPARED`。
6. 新安装用户可明确选择上线后在管理界面配置AI；此时由`defer-ai-configuration RUN_ID MANIFEST`在同一维护锁、prepared/candidate/API identity及AI空集校验后记录admin-ui移交，无Key/TTY前提、无bootstrap成功状态。其他新安装在同一维护锁、同一run ID/manifest/candidate且阶段为`PRODUCTION_PREPARED`时，由Hostdzire credential owner使用 `prepare-production-data.py bootstrap-ai` 的交互式 no-echo TTY 输入真实 AI API Key。Header 可选，按需以 `--header-name` / `--sensitive-header-name` 指定名称，值同样无回显读取；不指定时不要求 Header。该命令只对 manifest 绑定且正在运行的 API 容器执行 `docker exec -i`，先原子创建停用的 channel、可选 Headers 和 model，再真实测试连接，只有 `PASSED` 才原子启用；credential/Header 值不得进入 argv、环境变量、文件、日志、history、Docker inspect 或对话。任何已有 AI 配置、已有 bootstrap attempt、provider 失败、revision 冲突或结果未知都 fail closed，禁止重试或覆盖。
7. bootstrap 成功只证明该 AI model 的凭据注入与连接测试路径，不等于完整 External Services Gate。继续完成真实 AI 正式生成、OSS 权限/失败、空 namespace、零旧对象引用和受控上传/HEAD/短期读取/CORS Gate；`fake-oss` 保持停止且不属于 Production service 集合。维护窗口bootstrap路径Gate=`MET`后，只有同一manifest且bootstrap attempt已确认成功时才能运行`activate-production.sh`；显式admin-ui新安装在真实OSS验证后使用`OSS_MET_AI_PENDING`，owner重验同候选移交，保留AI待配置，upgrade不接受此Gate。激活显式启用非默认 `production-async` profile 并把阶段推进到 `PRODUCTION_INITIALIZED`。
8. 从同一 manifest 固定的 Production 模板生成最终站点；N3 写授权仍要求原子替换和 `nginx -t`，N4 reload 再单独授权。此前运行中的 Nginx 必须持续返回维护响应。
9. 完成回环、公网、浏览器、权限、OSS与受控写验收，进入观察期；admin-ui路径保留AI待配置，管理员真实配置/测试/启用后的AI业务验收另行完成，不能提前声明完整UAT通过。T+60 前必须得到经验证的新 Production 或经验证恢复的旧运行态，不能延长窗口继续排障。

物理删除 quarantine、`.env.staging`、fake-oss container/image 或旧 release/image 不属于上述转换授权。V1 仓库源码已在独立的开发阶段 cutover 中退役，该事实不扩大任何远端删除或 Production 转换授权。

### 5.1 明确丢弃旧数据的fresh-init

仅在用户明确要求现有PartSignal站点清空重建时适用。该决定覆盖旧数据隔离、备份和恢复要求；不扩大为删除其他project、TLS、runtime、镜像全局prune或真实OSS共享bucket。必须在新源码/镜像/manifest和真实OSS配置已就绪后才进入维护；维护窗口bootstrap还需AI输入/owner就绪，用户明确选择admin-ui时无需这些AI凭据准备，只需完成显式移交路径的候选验证，避免先删除后发现所选安装路径缺项。

状态owner在固定maintenance lock内认证新候选、run ID、canonical数据根、三个普通目录及其inode、静止project和重叠挂载，再清空postgres/redis/objects的内容。先持久化真实RESETTING，完成后为RESET_READY；同run/candidate可受控续跑，目录替换、不同输入或已有非reset发布状态拒绝。不创建quarantine，不手写QUARANTINED或PRODUCTION_INITIALIZED。

fresh候选显式声明`fresh-rebuild`恢复策略，旧previous V2为不适用，frontend-only rollback明确拒绝。部署使用`fresh-init`，空库迁移、账号初始化和PRODUCTION_PREPARED由现有owner执行；随后按所选方式完成显式admin-ui移交及真实OSS Gate，或受保护AI bootstrap及完整真实AI/OSS Gate，再由owner激活。失败保持维护并安全停止或重新安装，不宣称旧数据可恢复。精确命令见附录清空重建章节；保留数据的第5节与第7节不替代本路径。

## 6. 验收

必须验证回环与公网 live/ready、V2 首页和 canonical deep links；`/assets/*` immutable、HTML/SPA `no-cache`、缺失 asset 与 `.map` 为 `404`、JS 无 `sourceMappingURL`；CSP/安全头只由外层 Nginx 持有，Production 不暴露 `/object-storage/`。

日常部署验证实际运行 API/Frontend/Worker/Scheduler 的固定 image ID、数据库 head、live/ready、登录页和匿名受保护 API 拒绝；受影响功能增加一条有代表性的业务 smoke。使用已有受保护会话时只执行获准的只读操作，secret 不进入 argv 或普通日志。health、登录页和匿名拒绝只证明这些边界，不证明管理员完整业务或真实 AI/OSS 已通过。

首次完整产品交付或相关体验变化时，浏览器覆盖受影响的 `/login`、首页、Product、Content、Publishing、GEO、Configuration、System 与 legacy redirect，以及 direct link、refresh、Back/Forward、登录 return-to、权限拒绝、revision conflict 和键盘/焦点基线。375/768/1024/1440 视口矩阵只在响应式变化或明确交付要求下运行。浏览器运行在本机独立 Playwright session 或既有测试中，不在服务器安装浏览器，不输出或持久化密码。

## 7. 分层恢复

以下旧版本与数据恢复条目适用于保留旧数据的安装或 upgrade。fresh-init 已明确丢弃旧数据，失败保持维护并安全停止；重新安装须按实际失败状态另行准备，不能伪造旧数据恢复或直接清除发布状态。

- 未 initialized 的 upgrade artifact 失败：保持公网 maintenance，停止完整项目；在持久化失败事实绑定当前 attempt、同 schema/完整迁移运行时且新 manifest/image 全部认证后，按[附录显式前向恢复](./Hostdzire部署附录.md#未初始化升级的显式前向恢复)接管。仍处 UPGRADE_DEPLOYING，需重新 deploy/验收/activate。不能用 frontend rollback、先 activate、手改状态或新候选 begin-upgrade 解锁。
- Frontend：只在 PRODUCTION_INITIALIZED 切回 manifest 冻结的上一份已验证 V2 image，frontend-only recreate；其他 service、DB 和 Nginx 不变。
- Nginx：恢复同一已验证版本的站点和安全 snippet，先 `nginx -t`，再单独授权 reload。
- Application：只有上一份 V2 backend 与当前 schema 合同时才可切回。
- Data：停止新 Production 写入和全部新 service，把失败数据保留到 `failed-production/`，运行 `prepare-production-data.py restore <run-id>` 按持久阶段续跑并恢复旧三个目录，再按旧 Staging 配置恢复运行态。

默认不执行 Alembic downgrade。恢复保留失败现场，不删除 release、镜像、manifest、quarantine 或日志。

## 8. Observation 与仓库退役状态

观察期跟踪 Nginx 5xx/upstream、API 错误、container restart/OOM、Worker/Scheduler、DB/Redis health、AI/OSS 和核心业务结果。该观察期仍是未来真实 Production 发布的独立 Gate。

2026-08-29 的开发阶段范围决策已允许在仓库内删除 V1 并把原 V2 提升为 canonical `frontend/`，不以 Observation Gate 为前置条件；这不是 Production 发布，也不能把未执行的 Remote Preparation、Cutover 或 Observation Gate 写成 `MET`。这些 Gate 对本次任务均为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`。quarantine、旧镜像、release 和旧环境文件的物理清理仍需另一份破坏性授权。
