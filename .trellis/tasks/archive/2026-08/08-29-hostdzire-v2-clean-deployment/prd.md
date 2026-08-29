# Hostdzire V2 Clean Deployment

## Goal

从规划批准后最新、干净且已同步的 `origin/main` 固定唯一 release commit，在 Hostdzire 依次构建当前 backend 和 canonical `frontend/` 镜像，并用新的 PostgreSQL/Redis 状态完成 migration、账号初始化、V2-only 流量切换与观察。旧业务状态允许丢弃，但本任务不以永久删除旧数据、环境文件、镜像、release 或 quarantine 为完成条件。

本任务是一次新的 Hostdzire Production 部署，不恢复此前已经归档的 Production planning task。那些任务必须继续保持 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE / NOT_STARTED / NONE`，不能改写为 `MET`。

## User Value

- Hostdzire 运行态与当前仓库的 V2-only canonical frontend、Production Compose 和安全合同重新收敛。
- 新数据库只由当前 migration 和账号初始化建立，避免继续继承无法证明 owner 或 schema 的历史业务状态。
- 所有停机、隔离、切换和恢复都有精确对象、可验证停止点和不依赖永久删除的恢复边界。

## Confirmed Facts

### Repository

- 2026-08-29 重新执行 `git fetch --no-tags origin main` 后，`HEAD == origin/main == fb3601f26d97e1f4c80dd812c40f9376b6117e5d`；当前唯一 dirty 内容是本 planning task 目录，因此它不是最终 release commit，正式 candidate 必须在规划批准、Trellis 激活和必要提交完成后重新冻结。
- 当前 Alembic 唯一 head 是 `0043_geo_platform_identity`；Hostdzire 当前数据库 revision 也是 `0043_geo_platform_identity`，但本轮仍从空 PostgreSQL 运行全部 migration，不继承旧库作为新 Production 状态。
- Production Compose 固定 project `partsignal-staging`，服务集合为 `postgres`、`redis`、`migrate`、`api`、`frontend`、`worker`、`scheduler`；`worker`、`scheduler` 只在 `production-async` profile 中激活，Production 不声明 `fake-oss`。
- 当前部署脚本的 `clean-init` 必须在 `prepare-production-data.py quarantine <run-id>` 后运行，并按 PostgreSQL/Redis → Production config preflight → migration → integrity → `initialize-accounts` → API/frontend → 外部服务 Gate → Worker/Scheduler 的顺序推进。
- `deploy.sh` 当前无条件执行 registry `pull`，与“在 Hostdzire 本地重新构建镜像”冲突。实施前必须在权威脚本中增加严格的本地候选模式：默认 registry 行为保持不变；本地模式跳过 pull、所有 create/run/up 使用 `--pull never`，并继续通过 manifest 校验 image ID 与 RepoDigest。不得绕过脚本手工复制第二套部署流程。
- manifest 生成器要求 clean `main`、`HEAD == origin/main`、确定性 `git archive`、合法镜像 ID/RepoDigest、固定 tracked-file allowlist 和排他写入；因此 Hostdzire build checkout 必须是可验证的干净 Git checkout，而不是无 `.git` 的普通源码目录。
- Production env 的固定合同是 `/root/partsignal/shared/.env.production`、普通文件、非符号链接、`root:root`、`0600`；预检只能输出固定枚举和 `*_configured` 状态。
- V1 不是 runtime fallback。新 manifest 的 `rollback_frontend` 固定为切换前正在运行且已经验证的 V2 image；不得选择现存 `partsignal-frontend-v1:*` 镜像。

### Hostdzire Read-only Inventory

- 只读 inventory 时间为 `2026-08-29T23:04:52+08:00`，主机 `scrapy`，4 vCPU、约 5.80 GiB 内存、无 swap；当时 available memory 约 2.17 GiB，根文件系统可用 43.39 GiB，inode 使用 22%。
- 当前 `partsignal-staging` 有 7 个运行容器：`frontend`、`api`、`worker`、`scheduler`、`fake-oss`、`postgres`、`redis`；restart count 均为 0，声明 health 的 5 个容器均 healthy。
- 当前 frontend/backend release 为 `mvp-20260825-172239-2a6fd940b848`：frontend image ID `sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`，backend image ID `sha256:2af343ae4b4bce37accfb192ee46c239788874f865a0450edaed76e95859720f`。该 frontend 是本轮新 manifest 的默认上一份已验证 V2 rollback target。
- 当前 Compose labels 横跨三个历史 release：frontend/API/Worker/Scheduler/fake-oss 指向 `mvp-20260825-172239-2a6fd940b848`，PostgreSQL 指向 `mvp-20260716-1623`，Redis 指向 `mvp-20260710-2125`。这是一致 project 下的历史 source drift，不能把任一单个 Compose 文件误报为完整当前 owner。
- 活动 bind mount 精确为 `/root/partsignal-data/postgres`、`/root/partsignal-data/redis`、`/root/partsignal-data/objects`；合计约 76.4 MiB，其中 PostgreSQL 65.1 MiB、Redis 10.8 MiB、objects 0.6 MiB。三个路径和 quarantine root 位于同一 ext4 device；`/root/partsignal-data-quarantine` 当前不存在。
- `/root/partsignal-data/.partsignal-production-cutover.json` 当前不存在，因此现有运行态不是已经开始或可续跑的 Production clean-init 状态。
- 当前只有 `/root/partsignal/shared/.env.staging`，`root:root`、`0600`；活动 release 的 `.env.staging` 是指向它的符号链接。`/root/partsignal/shared/.env.production` 和活动 release `.env.production` 均不存在，配置创建是远端写入前置条件。
- 当前 Nginx 1.29.8，`nginx -t` 通过；活动 `/etc/nginx/sites-enabled/partsignal-staging.conf` 指向 `/etc/nginx/sites-available/partsignal-staging.conf`，checksum `ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`。它仍代理 `19000`、`19080` 和旧 `19001 /object-storage/`。仓库安全 snippet 与远端 checksum 同为 `c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`，无需改写。
- 当前回环和公网 live/ready、frontend `/login` 均为 200；公网 `/object-storage/` 为 404，但活动 Nginx 仍持有该 location/upstream，不能据公网 404 推断 fake-oss 已退役。
- `/root/partsignal/releases` 有 62 个 release 目录，合计约 1.69 GiB；Docker/containerd image store 约 42.74 GiB，Docker build cache 报告 15.56 GB。当前可用磁盘足以保留旧数据并新增一个 release 和一组镜像，但实施禁止通过 prune 或删除旧镜像/release 获得空间。

详细证据见 `research/repository-contract-audit.md` 与 `research/hostdzire-read-only-inventory.md`。

## Requirements

### R1. Planning and Authorization Boundaries

- 用户已批准最终规划，任务当前为 `status=in_progress`；该批准允许仓库实施，但不授权自动提交、push 或远端写操作。
- 远端 Artifact/Configuration、Maintenance/Data、Nginx Write/Reload 和永久清理仍是独立授权边界；任务激活不自动放行它们。
- 任一授权包必须包含现场重新读取的 release ID、commit、容器 ID、镜像 ID/RepoDigest、路径、checksum、命令顺序、停止条件和恢复命令；inventory 漂移即停止并重新评审。

### R2. Candidate and Build Provenance

- candidate 必须在实施时重新 `fetch`，来自 clean `main`，满足 `HEAD == origin/main`，固定 40 位 commit 和不可复用 release ID。
- Hostdzire 使用不存在的精确 release 目录创建 clean Git checkout；若主机不能从权威 origin 取得该 commit，必须在任何容器/数据写入前停止，不得启用测试逃生开关或用无 Git 来源目录冒充 candidate。
- backend 只从固定 checkout 的 `backend/` 构建；frontend 只从 canonical `frontend/` 构建；两者使用同一 release ID，顺序构建，不并发争抢无 swap 主机内存。
- release manifest 必须在同一 Hostdzire clean checkout 和本地镜像身份上由当前生成器创建，记录 source archive、schema head、backend/frontend、当前活动 V2 rollback image 和 tracked files；不得包含 V1 image。

### R3. Production Configuration

- 以 `/root/partsignal/shared/.env.production` 为唯一 Production env owner；创建方式必须不把值写入仓库、命令行参数、普通日志或对话，权限最终为 `root:root 0600`，且不是符号链接。
- 不复制 `.env.staging` 作为运行时 owner。需要复用的 AI/OSS 配置由用户/运维方在服务器受控提供；Production session、credential-encryption、数据库、账号初始密码等 secret 必须满足现有 Production 独立性合同。
- 只运行脱敏的 `preflight-production-config`；缺失或错误配置明确失败，不用固定成功 adapter、开发存储、fake OSS 或放宽安全设置替代。

### R4. Capacity Gate

- 非停机 build 前和维护窗口前都重新读取 CPU/load、available memory、root filesystem、inode、Docker/containerd 与 PartSignal data/release size。
- 顺序 build 前 available memory 不得低于 2 GiB，root filesystem available 不得低于 10 GiB；不满足即在无停机状态停止。维护窗口前需再次满足至少 10 GiB 可用，并证明 data root 与 quarantine root 同 device。
- 禁止 `docker system prune`、`docker image prune`、宽泛 cache 清理或删除非 PartSignal owner。清理不是本任务部署成功前置条件。

### R5. Exact Maintenance Targets and Data Isolation

- 维护窗口唯一可停止对象是重新 inventory 后仍属于 `partsignal-staging` 的 7 个精确容器：frontend、api、worker、scheduler、fake-oss、postgres、redis；不得使用 `down`、`--remove-orphans` 或选择其他 Compose project。
- 只有全部 7 个目标停止、`19000/19001/19080` 释放、没有活动数据 mount 后，才运行 `prepare-production-data.py quarantine <run-id>`。
- quarantine 的精确源为 `/root/partsignal-data/{postgres,redis,objects}`，目标为 `/root/partsignal-data-quarantine/<run-id>/{postgres,redis,objects}`；这是同文件系统原子 rename，不是删除。活动根只重新创建空 PostgreSQL/Redis 目录，Production 不创建或挂载 `objects`。
- 任何 path alias、symlink、mount、owner/device、state、container drift 或脚本失败都立即停止；使用同一 run ID 续跑或进入明确 restore，不手工猜测中间状态。

### R6. Clean Init and Activation

- 使用修正后的权威 Production deploy script、本地候选模式、同一 manifest/run ID/env/data root 执行 clean-init；不得用手工 Compose 命令绕过状态机。
- migration 后显式读取实际 Alembic revision，必须等于 manifest `schema_head`；空库 integrity 必须无问题；`initialize-accounts` 必须创建或确认 `admin` 和 `content_editor`，不得输出密码。
- `PRODUCTION_PREPARED` 前只允许 PostgreSQL、Redis、API、frontend 运行；真实 AI/OSS Gate 必须绑定同一 release/manifest 并通过后，才能激活 Worker/Scheduler 并进入 `PRODUCTION_INITIALIZED`。
- `fake-oss` 始终保持停止，不加入 Production Compose；不得删除其 container/image。

### R7. Nginx Cutover

- 活动安全 snippet checksum 已与仓库一致，本任务不改写它。
- Nginx 站点只在新 API/frontend 回环和外部服务 Gate 通过后写入：精确备份 `/etc/nginx/sites-available/partsignal-staging.conf`，把固定 release 的 Production 模板渲染为 `10.0.0.2`，以 root-owned `0644` 同目录临时文件原子替换当前 target。
- 渲染结果必须代理 `19000`/`19080`，不包含 `19001`、`/object-storage/` 或静态 root；预期 checksum 由 fixed release 现场计算，本次仓库基线渲染 checksum 为 `aef0a6acace47284126140a673faf7e8d2cf53d5ab17cece206b5188c4f3a9cc`。
- 原子替换后先 `nginx -t`；reload 是单独授权。失败先原子恢复备份、再次 `nginx -t`，不自动修改 DNS/TLS。

### R8. Validation and Observation

- 回环和公网验证覆盖 live/ready、`/login`、首页、canonical deep links、legacy redirects、权限拒绝、代表业务路径、assets immutable、HTML/SPA no-cache、missing asset/`.map` 404、JS 无 `sourceMappingURL`、CSP/安全头与 `/object-storage/` 无 Production 代理。
- 浏览器验收使用项目 Playwright Test Runner 或当前 task 独立 `playwright-cli` session；不在服务器安装浏览器，不持久化或输出凭据，临时 session 结束前关闭并核对。
- Observation 至少检查 Nginx 5xx/upstream、API error、container restart/OOM、Worker/Scheduler、PostgreSQL/Redis、真实 AI/OSS 和核心业务结果。无新增 P0/P1、无未解释 restart/OOM/5xx 且关键路径通过才可记为本任务相应 Gate=`MET`。

### R9. Recovery and Retention

- 推荐并纳入待确认方案：先 quarantine，不立即永久删除。当前旧数据只有约 76.4 MiB，保留成本远低于不可恢复失败风险。
- Nginx 切换前的失败优先停止新写入，保留失败现场并执行 `restore <run-id>`；脚本把失败 Production 数据留在 `failed-production/` 后恢复旧三目录，再用精确历史 Staging Compose、`.env.staging`、当前 backend/frontend/fake-oss image 恢复 7 个旧服务。
- Nginx 切换后的恢复额外原子恢复 Nginx 备份，`nginx -t` 后另取 reload 授权。默认不执行 Alembic downgrade。
- frontend-only 故障可使用 manifest 冻结的当前活动 V2 image；V1、历史 backend 整栈 release 和 `/root/partsignal/current` 都不是 runtime fallback 开关。
- 本任务不永久删除 quarantine、失败数据、`.env.staging`、fake-oss、V1 image、旧 image、release、manifest 或环境文件；清理另建精确 allowlist 和单独破坏性授权。

### R10. Historical Gate Integrity

- 不修改五个已取消 Production task 的 outcome/gate/execution/remote mutation。
- 本任务只对本次实际执行且证据齐全的 Gate 判定 `MET`；未执行项使用 `NOT_STARTED`，用户取消项使用 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`，不得继承历史成功或把历史取消改写为成功。

## In Scope

- 必需的 Production 本地镜像模式合同修正、对应测试和权威部署文档同步。
- fixed release checkout、Hostdzire 顺序 build、source archive、manifest 和脱敏配置预检。
- 精确停机、quarantine、空库 migration、账号初始化、API/frontend 准备、真实 AI/OSS Gate、Worker/Scheduler 激活。
- Nginx Production 模板原子切换、reload、HTTP/浏览器验收、Observation 和按需恢复。
- 本任务自己的证据、状态和文档收口。

## Out of Scope

- V1 runtime fallback，或恢复 V1 源码、构建、测试、CI/Makefile/deploy pipeline。
- DNS、TLS、证书、DMIT 四层入口、HSTS policy 或 preload 变更。
- 永久删除数据库、volume、data root、quarantine、failed-production、环境文件、镜像、release、manifest、Nginx backup 或非 PartSignal owner。
- `docker system prune`、宽泛 glob 删除、`down --remove-orphans`、全局 Docker 清理。
- 修改业务 API、数据库业务合同、业务状态机或前后端产品功能。
- 自动提交、push、`task.py start` 或没有独立授权的远端写入。

## Acceptance Criteria

- [ ] AC1：用户批准本最终规划后，任务才进入 `in_progress`；批准前无远端 mutation、Git commit/push 或部署执行。
- [x] AC2：Production 本地镜像模式在权威脚本和测试中实现，默认 registry 行为保持，local 模式不 pull 且所有相关 create/run/up 均 `--pull never`，manifest identity 校验仍通过。
- [ ] AC3：实施时重新证明 clean `main`、`HEAD == origin/main`、固定 commit/release/source archive；Hostdzire clean checkout、backend/frontend build 和 manifest 可追溯且无 V1 image。
- [ ] AC4：`.env.production` 为非 symlink、`root:root 0600`，Compose config 与脱敏 Production config preflight 通过，输出中无 secret 值。
- [ ] AC5：维护前 inventory 与授权包完全匹配；只停止精确 7 个 PartSignal 容器，无非 PartSignal mutation。
- [ ] AC6：旧 `postgres/redis/objects` 原子移动到精确 quarantine run，未永久删除；新活动 PostgreSQL/Redis 从空状态创建。
- [ ] AC7：migration 后实际 revision 等于 manifest schema head，integrity 空，账号初始化成功，API/frontend 达到 `PRODUCTION_PREPARED`，外部 Gate 后 Worker/Scheduler 达到 `PRODUCTION_INITIALIZED`。
- [ ] AC8：Nginx 备份、原子替换、`nginx -t`、单独 reload 与公网验收通过；Production 无 `19001`/`/object-storage/` owner。
- [ ] AC9：核心浏览器、权限、缓存、source-map、安全头、AI/OSS 和 Observation 验收通过，且无新增 P0/P1、未解释 restart/OOM/5xx 或 secret 泄漏证据。
- [ ] AC10：任一失败都保留现场并按对应恢复层处理；恢复不依赖 V1、永久删除或 Alembic downgrade。
- [x] AC11：旧 Production task 仍为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`；本任务 Gate 状态只反映本轮真实证据。
- [ ] AC12：代码、脚本测试、任务证据和权威部署文档一致；不需要的文档明确说明未变原因。

## Final Review Decision

本规划推荐“先 quarantine、Observation 后仍不在本任务永久删除”，并采用 60 分钟维护窗口硬上限：T+20 分钟未达到 `PRODUCTION_PREPARED`，或 T+45 分钟仍未完成外部 Gate 与 Nginx 切换，则开始恢复；T+60 分钟必须恢复旧运行态或明确进入已验证的新运行态。用户已于 2026-08-29 在最终规划后续消息中明确批准该方案并授权运行 `task.py start` 进入实施；远端写入仍按 Artifact/Configuration、Maintenance/Data、Nginx Write、Nginx Reload 四个独立 Gate 分阶段授权，不由本次任务激活自动放行。

2026-08-30 用户要求在仓库合同修正提交后归档收尾。仓库 AC2 已完成；远端 Artifact/Configuration、Maintenance/Data、Nginx 和 Observation 均未执行，统一记录为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE / NOT_STARTED`，不得解释为部署成功或 Gate=`MET`。
