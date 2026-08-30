# Hostdzire V2 Production Execution

## 目标

从最终规划批准后重新冻结的 clean `origin/main` candidate，在 Hostdzire 以 V2-only、quarantine-first 和 60 分钟硬维护窗口完成 Production artifact/configuration、空库 clean-init、真实 AI/OSS、异步服务激活、Nginx 切换与 Observation；成功或失败都必须保留可复核证据和明确恢复路径，不永久清理历史资源。

## 用户价值

- Hostdzire 运行态与 canonical `frontend/`、当前 backend、Production Compose、真实 AI/OSS 和安全头合同收敛。
- 新 PostgreSQL 只由当前 migration 和账号初始化建立，不继承未经本轮 Gate 证明的旧业务状态。
- 公网在新运行态完成真实外部服务与 identity Gate 前保持硬维护边界，避免半初始化状态接收业务写入。
- 失败时保留旧数据、失败新数据、镜像、manifest、日志与 Nginx 备份，可恢复到已验证旧运行态。

## 已确认事实

### 仓库

- `main == origin/main == d78b299069b222adb78507067334751737f679da`；`111a2b2b` 已实现 Production registry/local image delivery、local `--pull never`、manifest identity 校验与 V1 hard reject。
- 当前 planning task 是唯一未跟踪目录，因此 `d78b2990` 不是最终 release candidate；candidate 必须在规划批准、必要仓库合同修改和获批提交完成后 fresh fetch 冻结。
- canonical `frontend/` 是唯一前端源码 owner；V1 不进入 manifest、Production Compose、runtime fallback 或 rollback。
- Production Compose 固定 project `partsignal-staging`，Production 不声明 fake-oss；Worker/Scheduler 只在 `production-async` profile 中激活。
- 当前脚本已建立 manifest、维护锁、quarantine/restore 与 clean-init 状态机，但 Production env 文件身份、真实 AI/OSS Gate 证据、post-start container identity、actual DB revision 与 Nginx 写/reload 仍需本任务的显式执行控制。详见 `research/repository-contract-audit.md`。

### 历史 Gate 完整性

- 已归档 `08-29-hostdzire-v2-clean-deployment` 只完成仓库 local candidate 合同与 2026-08-29 只读 inventory；远端 Artifact/Configuration、Maintenance/Data、Nginx、Cutover、Observation 均未执行。
- 该任务和此前五个 Production planning task 的远端结论必须继续保持 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE / NOT_STARTED / NONE`，不得恢复执行、继承或改写为 `MET`。

### 当前 Hostdzire Inventory

- 本轮只读 inventory captured at `2026-08-30T00:53:02+08:00`，hostname `scrapy`，remote mutation=`NONE`。
- 4 vCPU、约 5.80 GiB memory、2,301,513,728 bytes available、无 swap；根盘 46,581,321,728 bytes available，inode 22%。
- `partsignal-staging` 仍运行 frontend/api/worker/scheduler/fake-oss/postgres/redis 7 个容器；镜像、health、restart/OOM 和三份历史 Compose source 与 2026-08-29 一致。
- data/quarantine device 是 `2049`；活动 postgres/redis/objects 合计 80,654,336 bytes；quarantine root 与 cutover state 仍 missing。DB revision=`0043_geo_platform_identity`，size=`10,714,135` bytes。
- `/root/partsignal/current` 仍指向 `mvp-20260825-172239-2a6fd940b848`；62 个 release；未发现 release manifest。
- `/root/partsignal/shared/.env.production` missing，所有 allowlist `*_configured=false`；这是 Artifact/Configuration blocker。
- Nginx 1.29.8、`nginx -t` successful；活动 target SHA-256 仍为 `ea41ef...982`，security snippet 仍为 `c946c3...931e`，活动站点仍代理 `19000/19080/19001` 与 `/object-storage/`。
- 明确漂移只有瞬时 load 和约 0.49 MiB Redis / 0.52 MiB data growth；其他可比字段无漂移。完整 exact IDs、metadata 与差异见 `research/hostdzire-read-only-inventory.md`。

## 需求

### R1. Planning and Authorization

- 当前保持 `status=planning`；必须先完成并由用户在后续消息明确批准本 PRD、`design.md`、`implement.md` 和 authorization package 基线，才能运行 `task.py start`。
- `task.py start`、仓库实施批准和 commit 批准均不自动授权远端 mutation。
- Artifact/Configuration、Nginx Maintenance Write、Nginx Maintenance Reload、Maintenance/Data、Final Nginx Write、Final Nginx Reload 与任何 recovery reload 必须分别展示当次全字面量 package 并取得授权。
- 本轮 inventory 只作为 baseline；任何执行 package 前必须重读并比较，漂移即停止和重新评审。

### R2. Repository Maintenance Guard Contract

- 在 candidate freeze 前增加仓库 owner 的 PartSignal maintenance Nginx 模板，并纳入 manifest tracked-file allowlist、Production deploy test、Runbook 和附录。
- maintenance 模板保留既有 host/TLS/ACME/security snippet 边界，但不代理 API、frontend、storage 或静态 root；业务路径返回明确维护状态。
- 这是确保新 API/frontend 复用 `19000/19080` 时不会在真实 AI/OSS Gate 前通过旧 Nginx 接受公网写入的最小控制；不得用停全局 Nginx、修改 DMIT/DNS/TLS、临时防火墙或第二套 Compose 替代。

### R3. Candidate and Artifact Provenance

- candidate 必须来自 fresh clean `main`，满足本地与 Host checkout 的 `HEAD == origin/main`，使用唯一不可复用 release ID。
- Host 使用不存在的精确 release 目录创建 clean Git checkout；backend 只从 `backend/`、frontend 只从 canonical `frontend/` 顺序构建，两者共用 release ID。
- manifest 必须由当前 producer 排他创建，绑定 source archive、schema head、backend/current frontend/previous verified V2 frontend identity 与完整 tracked allowlist；所有 V1 reference 和 test escape hatch fail closed。
- archive、manifest、release、image tag 均不可覆盖；生成后和维护前分别复算 archive/manifest/tracked-file/image identity。
- 每次 build 前 available memory ≥2 GiB、root available ≥10 GiB；不满足时在旧运行态仍完整的阶段停止。禁止 prune 或删除旧资源腾挪空间。

### R4. Production Configuration and Secret Boundary

- `/root/partsignal/shared/.env.production` 是唯一 Production env owner，必须由用户或运维 owner 经安全渠道 provision，为普通非 symlink、`root:root 0600`。
- 不复制 `.env.staging`；Production session、AI encryption、database、Redis、seed account 与 OSS credential 均使用独立受控配置。
- 证据只能输出文件 metadata、固定枚举和 `*_configured`；不得输出 URL、DSN、bucket、AccessKey、password、token、Cookie、Header、request body 或 secret 值。
- Configuration Gate 必须通过 Compose `config --quiet` 与现有 status-only `preflight-production-config`；结构预检不替代真实 AI/OSS Gate。

### R5. Hard Maintenance Boundary and Time Budget

- 在停止任何容器前，先按 fixed candidate maintenance 模板备份并原子替换 PartSignal site、`nginx -t`，再取得独立 reload 授权。
- T0 是公网首次验证 maintenance response 的时间；60 分钟窗口从 T0 计时，不从后续容器 stop 计时。
- T+10 前完成精确 7 容器停止和静默证明；T+20 前达到 `PRODUCTION_PREPARED`；T+35 前完成真实 AI/OSS 与 activation；T+45 前准备完成 final Nginx transition；T+60 必须是经验证新 Production 或经验证恢复旧运行态。
- 任一阈值未达即进入对应恢复；不能用“仍在排查”延长窗口。

### R6. Exact Maintenance and Quarantine

- 只停止当次 inventory 证明属于 `partsignal-staging` 的 frontend/api/worker/scheduler/fake-oss/postgres/redis full container IDs；逐个复核 project/service label。
- 禁止 `down`、container rm、`--remove-orphans`、宽泛 glob、全局 Docker 操作或影响其他 Compose project。
- 停止后必须证明 7 targets stopped、`19000/19001/19080` 释放、无 active/quarantine/failed-production mount，再运行 fixed release `prepare-production-data.py quarantine <run-id>`。
- 旧 `/root/partsignal-data/{postgres,redis,objects}` 只通过权威状态机同 device 原子 rename 到精确 quarantine run；新活动 root 只创建空 postgres/redis，不创建或挂载 objects。
- path/state/device/owner/mount 漂移或状态机错误立即停止；只按脚本持久状态使用同一 run ID 续跑，不手工 rename 或编辑 state JSON。

### R7. Clean-init and Runtime Identity

- 以 fixed release、local image mode、同一 release/manifest/run/env/data root 运行权威 deploy script；不得用手工 Compose 绕过 manifest、维护锁或状态机。
- prepared 后、external Gate 前必须重新验证实际 API/frontend/PostgreSQL/Redis container full ID 与 image ID、archive/manifest checksum、实际 Alembic revision、integrity、账号初始化、health/live/ready；actual revision 必须等于 manifest schema head。
- `PRODUCTION_PREPARED` 时 Worker/Scheduler/fake-oss 必须保持停止，maintenance Nginx 仍阻断公网。
- candidate tag 在 build 后至 Observation 前不得被并发改写；任何 post-start image mismatch 进入恢复。

### R8. Real AI/OSS and Activation Gate

- 真实 AI/OSS Gate 必须在同一 prepared candidate 上验证真实权限、连通性、TLS/Host、超时与明确失败、CORS、预签名上传、后端 HEAD、短期下载和空旧对象引用。
- 不得使用 deterministic/fixed-success provider、development storage、fake-oss、`AI_ALLOW_LOCAL_HTTP=true`、关闭证书验证或输出 credential 代替真实 Gate。
- 证据必须绑定 manifest SHA-256 与时间，只保存安全 ID/status；只有本轮证据完整时才可在一次 activate 命令环境设置 `PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET`。
- activation 后重新验证 API/frontend/Worker/Scheduler actual image、health、restart/OOM 和 state=`PRODUCTION_INITIALIZED`；fake-oss 保持 stopped 且 retained。

### R9. Nginx Final Transition and Acceptance

- Nginx write 只允许当前 exact target、原始/maintenance backup 和同目录 temp；enabled symlink 与 security snippet 默认不变。
- 每次 write 均要求 target baseline checksum、root owner、`0644`、same-device atomic replace 和 `nginx -t`；reload 每次单独授权。
- final template 只代理 `19000/19080`，拒绝 `19001`、`/object-storage/` 与静态 root。
- final reload 后验证 loopback/public live/ready、login/home/canonical deep links、legacy redirects、permissions、representative read/write、assets immutable、HTML/SPA no-cache、missing asset/`.map` 404、JS 无 `sourceMappingURL`、CSP/security 与 object-storage boundary。
- 浏览器只从本机真实入口执行，使用既有 Playwright Test 或任务独立 `playwright-cli` session；不在服务器安装浏览器，不持久化或输出 credential，所有临时 session 在收口前关闭。

### R10. Observation, Recovery and Historical Integrity

- Observation 记录 Nginx 5xx/upstream、API error、container restart/OOM、Worker/Scheduler、PostgreSQL/Redis、AI/OSS 和核心业务结果；只有本轮实际证据完整的 Gate 可标记 `MET`。
- 失败先停止新写入/服务，保留日志、manifest、container、state 和 Nginx evidence；restore 把失败新数据保留到 `failed-production/`，再恢复旧三叶与精确旧 7-service runtime。
- Nginx 恢复仍需 atomic backup restore、`nginx -t` 与独立 recovery reload。默认不执行 Alembic downgrade。
- 一旦 state=`RESTORED`，本窗口只验证并恢复旧运行态，不手改 state 或第二次 clean-init。
- 未执行项=`NOT_STARTED`；用户取消项=`CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE`；不得继承历史 `MET` 或改写旧任务。
- 本任务不执行永久清理；稳定上线后的 cleanup 必须是后续独立 destructive task。

## 范围内

- maintenance Nginx template 的最小仓库合同、manifest allowlist、测试与权威文档同步。
- candidate freeze、Host clean checkout、顺序 build、source archive、manifest、env metadata/config preflight。
- PartSignal site maintenance/final Nginx 原子写与逐次独立 reload 授权。
- 精确停机、quarantine、空库 migration/integrity/account initialization、prepared runtime、真实 AI/OSS、async activation。
- loopback/public/browser/业务验收、Observation、分层恢复和本任务证据收口。

## 范围外

- V1 runtime fallback、V1 源码/构建/pipeline 恢复或 V1 image 作为 rollback。
- DNS、TLS、证书、DMIT、HSTS policy/preload、其他 Nginx site 或其他 Compose project 修改。
- API、数据库业务合同、产品功能或权限模型变更。
- 永久删除 quarantine、failed-production、旧或 Production env、fake-oss、V1/旧 image、release、archive、manifest、Nginx backup、build cache 或非 PartSignal 资源。
- `docker system prune`、任何 prune、宽泛 glob 删除、`down --remove-orphans`。
- 未批准的 remote mutation、自动 commit/push/archive 或在最终规划批准前运行 `task.py start`。

## 验收标准

- [x] AC1：用户已在本最终规划之后明确批准，并已运行 `task.py start`；批准前 remote mutation=`NONE`，无 commit/push。
- [x] AC2：maintenance Nginx template、manifest allowlist、deploy tests 与 Runbook 合同一致，required repository validation 通过。
- [ ] AC3：fresh fetch 证明 clean `main == origin/main`，固定不可复用 release/archive/manifest/backend/frontend/rollback V2 identity，无 V1/test escape/覆盖。
- [ ] AC4：Artifact/Configuration package 逐字面量获批并执行；env 为普通非 symlink `root:root 0600`，配置与 preflight 通过，证据无 secret。
- [ ] AC5：maintenance Nginx write 与 reload 分别获批并通过，T0 明确，公网在 clean-init/external Gate 期间保持硬维护状态。
- [ ] AC6：Maintenance/Data package 与最终 drift inventory 一致，只停止精确 7 个 PartSignal container；旧三叶进入精确 quarantine，未永久删除。
- [ ] AC7：空库 migration 后 actual revision 等于 manifest schema head，integrity、账号、prepared health 与实际 container/image identity 全部通过。
- [ ] AC8：同一 manifest 的真实 AI/OSS Gate 通过后才激活 Worker/Scheduler；state=`PRODUCTION_INITIALIZED`，fake-oss stopped/retained。
- [ ] AC9：final Nginx write 与 reload 分别获批，Production 无 `19001`/`/object-storage/` owner；公网、浏览器、权限、代表读写、cache/map/CSP/security 通过。
- [ ] AC10：60 分钟硬窗口满足；Observation 无新增 P0/P1、未解释 restart/OOM/5xx、identity drift 或 secret 泄漏，或已恢复到经验证旧运行态。
- [ ] AC11：任务记录 actual commit/release/run/manifest/images/state/Nginx checksums、downtime、每个 Gate 与残余风险；只标记本轮真实 `MET`。
- [ ] AC12：未清理 quarantine、failed-production、旧 env/image/release/manifest/Nginx backup/fake-oss/V1 或非 PartSignal 资源；旧归档任务状态不变。

## 规划状态

需求、范围、风险取舍与可观察验收已收敛；没有仓库可回答或用户必须先回答的 blocking open question。用户已在 2026-08-30 后续消息中批准最终规划并授权运行 `task.py start`，任务现进入仓库实施准备。远端 mutation 仍未授权，所有远端 package 继续保持 `DRAFT_NOT_AUTHORIZED`；任何后续 material planning change 都必须重新进行 final review。
