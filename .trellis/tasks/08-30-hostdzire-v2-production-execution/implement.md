# Hostdzire V2-only Production 远端执行计划

## 1. 当前状态与执行前提

- 当前任务已由用户批准并通过 `task.py start` 进入 `in_progress`；本文件定义后续执行步骤，不授予任何远端写权限。
- 用户对最终规划和任务启动的批准不等于批准任一远端写包。
- 上一归档任务的 Remote Gate 结果保持 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE / NOT_STARTED`，不得继承为本轮 `MET`。
- 本轮执行必须从新的只读冻结证据开始；只有在本轮真实执行且证据完整时，Gate 才能标记 `MET`。
- 永久清理不属于本任务。quarantine、failed-production、旧环境、旧镜像、旧 release、manifest、Nginx backup、fake-oss 和非 PartSignal 资源全部保留。

## 2. Required Validation

实施阶段每次修改仓库合同后，先运行直接覆盖变更的检查：

```bash
node deploy/scripts/check-nginx-security.mjs
deploy/scripts/test-deploy-staging.sh
deploy/scripts/test-deploy-production.sh
uv run --project backend pytest backend/tests/unit/test_cli.py
make test-deploy-scripts
git diff --check
```

如果仓库合同、共享部署脚本或核心状态迁移发生变化，候选冻结前再运行可独立执行的完整质量门：

```bash
make verify
```

`make verify` 是候选冻结前的可选完整套件；若因环境或既有失败无法通过，必须记录失败归因、已完成的替代验证和剩余风险，不得把未观察到的结果写成成功。

## 3. 执行阶段

### Step 0：最终规划审查与批准边界

- [x] 已审计最新仓库 Production 部署合同和 `111a2b2b` 引入的 local candidate / manifest V1 hard reject 行为。
- [x] 已完整复核 2026-08-29 归档任务与研究证据。
- [x] 已完成 2026-08-30 新一轮 Hostdzire 只读 inventory 与漂移对比。
- [x] 已形成四类授权域，并把 Nginx 写入和 reload 拆成独立授权。
- [x] 用户已在 2026-08-30 后续消息中批准本规划。
- [x] 用户已在同一消息中明确授权运行 `task.py start`，任务进入实施准备。

完成条件：规划批准与任务启动授权已经记录；后续可以进入 Step 1，但仍须遵守仓库变更、commit 和各远端 package 的独立授权边界。

### Step 1：补齐仓库侧维护页合同

目标是在任何容器停止或候选启动前，让站点进入一个不代理现有或候选运行时的站点级维护状态，封闭 19000/19080 端口复用造成的提前公开窗口。

- [x] 新增仓库 owner 的 `deploy/nginx/partsignal-maintenance.conf.template`。
- [x] 保留 Production TLS、ACME 和安全头合同；维护配置不包含应用、静态资源、对象存储 upstream，也不代理 19000、19001、19080。
- [x] 固定 `503`、`text/plain`、`no-store`、`Retry-After: 3600` 和无敏感信息的维护响应，供外部证据稳定识别。
- [x] 将维护模板加入 manifest producer/consumer 的 8 项受控 allowlist、三组 manifest 测试输入、exact-set 断言、Nginx 安全检查和部署文档。
- [x] 未增加 V1 runtime fallback、第二套前端源码、第二份可编辑业务内容或 Staging fast-redeploy 范围。
- [x] 目标检查通过：Nginx security checker、Staging/Production deploy self-test、Backend CLI 4 tests、Shell syntax、Python compile 和 `git diff --check`。
- [x] `make test-deploy-scripts`：临时启动本机既有 Colima 后完整通过，包括 frontend image build、container artifact、Staging/Production self-test；验证完成后 Colima 已恢复停止。

完成条件：Step 1 仓库合同与全部 Required Validation 已完成，diff 只包含经批准的仓库合同、测试、规范、权威文档和任务状态记录。尚未冻结 candidate，也未取得任何远端写入授权。

### Step 2：冻结 local candidate 与 manifest identity

- 在干净的 `main` 上确认 `HEAD == origin/main`，记录 exact commit。
- 按 `deploy/scripts/create-release-manifest.py` 建立 local candidate；记录 manifest SHA-256、schema version、release name、commit、frontend/backend image tag、image ID、archive SHA-256 和所有 tracked file digest。
- 冻结候选后不得重新 tag、覆盖 archive、修改 tracked file 或复用不同构建产物。
- 消费前重新计算 manifest、archive 和 tracked file digest；导入后验证 archive 内 image ID 与 manifest 一致。
- 启动前和启动后都重新读取 tag 对应 image ID，消除 tag identity 的时间差窗口。

完成条件：Package A 中所有 candidate identity 字段均为 literal 值，任何一项不一致都显式失败并保持现场。

### Step 3：提交 Artifact/Configuration Authorization Package（Package A）

Package A 必须完整列出：

- local candidate 的 commit、release、manifest path/SHA/schema、两个 image tag/ID、archive path/SHA 和 tracked file digest；
- 远端目标路径、传输方式、允许创建的 release/manifest/env 文件及其 exact owner/mode；
- `.env.production` 的 allowlist 配置项与 `*_configured` 结果，不得包含任何 secret 值；
- 环境文件必须是 canonical regular file、非 symlink、`root:root 0600`；创建和替换必须采用临时文件、元数据校验和原子替换；
- 数据库 revision、Compose project、端口、镜像身份和候选消费前后校验；
- 写入失败时保留的 staging/failed-production 路径及禁止触碰的资源。

完成条件：用户对 Package A 给出独立、明确授权；该授权不包含维护、数据迁移、Nginx 写入或 reload。

### Step 4：维护前最终只读冻结与漂移门

在第一次远端写入前重新读取并与本规划 inventory 逐项比较：

- 主机和 Docker 容量、Compose projects；
- PartSignal 全量容器 ID、service、image/tag/ID、state、health、restart/OOM；
- mounts、data roots、device、owner、mode、size；
- listeners、HTTP 基线、数据库 revision/size；
- release/current/manifest；
- Nginx enabled target、target checksum、upstreams、security snippet checksum、`nginx -t` 与 systemd reload owner；
- `.env.production` 是否存在、是否普通文件、是否 symlink、owner/mode 和 allowlist `*_configured` 状态。

任何影响授权对象身份、容量、端口、数据状态、Nginx 状态或环境文件状态的漂移都使已有写包失效。必须停止、更新证据并重新提交受影响的 exact package。

### Step 5：提交并执行 Maintenance Nginx Write Package（Package N1）

- N1 只授权把当前已核验 checksum 的 enabled target 原子替换为已核验 checksum 的维护配置。
- 写前创建带时间戳且不可覆盖的 Nginx backup；记录 source、backup、temporary 和 final path。
- 写入仅允许：生成临时文件、校验 owner/mode/checksum、原子 rename、运行 `nginx -t`。
- 若 `nginx -t` 失败，恢复原文件并再次验证；不得 reload。

完成条件：用户独立批准 N1，写后 `nginx -t` 成功，但此时仍未 reload，维护窗口尚未开始。

### Step 6：提交并执行 Maintenance Nginx Reload Package（Package N2）

- N2 只授权对已通过 `nginx -t` 且 checksum 与 N1 一致的维护配置执行一次 reload。
- reload 后立即从外部确认维护响应，且 Production 应用、静态和对象存储 upstream 不再可达。
- 外部首次确认维护响应的时间记为 `T0`；60 分钟硬维护窗口从 `T0` 开始。

完成条件：用户独立批准 N2，reload 成功、外部维护响应成立，并记录 T0。若维护状态不成立，不得停止容器。

### Step 7：提交并执行 Maintenance/Data Authorization Package（Package M）

Package M 的 exact targets 必须来自 Step 4 的冻结证据：

- 仅停止列出的 7 个 PartSignal 容器 ID；禁止 `down --remove-orphans` 和任何宽泛 selector。
- 停止后确认目标容器退出、19000/19001/19080 不再监听，其他 Compose project 未变化。
- 使用同一设备上的原子 rename，把 `/root/partsignal-data` 移入唯一、不可覆盖、带时间戳的 quarantine path。
- 明确 quarantine device、owner/mode/size 和原数据根不存在；不得删除、复制覆盖或修改旧数据内容。
- clean-init 只允许创建新的 `/root/partsignal-data` 以及 PostgreSQL、Redis 所需根目录，并按容器实际 UID/GID 设置 owner/mode；Production 不重建或挂载 `objects`。
- clean-init 状态机必须是单向状态：`QUARANTINED -> CLEAN_INIT_DEPLOYING -> PRODUCTION_PREPARED -> PRODUCTION_INITIALIZED`；状态文件采用临时文件和原子替换，禁止复用 `RESTORED` 数据根继续部署。

完成条件：用户独立批准 M；每个状态转换都有前置条件和只读后置核验，失败时停止在当前状态并保留现场。

### Step 8：执行 clean-init、数据库准备和候选启动

- 仅在维护页已经公开、Package M 已授权且时间预算仍满足时开始。
- 启动 PostgreSQL 和 Redis 后，等待其真实 health；由权威部署脚本调用 `prepare-production-data.py begin-clean-init`、`mark-prepared` 和 `verify-prepared`，不得手工绕过状态机。
- 数据库必须从空状态迁移到 manifest 声明且仓库支持的 revision；实际 revision 必须与 manifest/候选预期一致。
- 所有管理员、会话、AI encryption、AI provider 和 OSS 配置必须来自经授权的 Production env；缺失即显式失败。
- prepared 阶段只启动 API/frontend，并与 PostgreSQL/Redis 一起复核 exact image ID；Worker/Scheduler 必须保持停止直到真实 AI/OSS Gate 通过，fake-oss 始终保持停止并保留。不得从 registry pull，不得使用 V1 或其他 tag fallback。
- 在 loopback 完成 live、ready、登录页、V2 静态资源和基本业务状态检查。

完成条件：状态达到 `PRODUCTION_PREPARED`，候选运行时健康，但仍被维护页隔离。

### Step 9：真实 AI/OSS Gate 与激活

- AI Gate 必须执行真实 provider 调用，记录非 secret 的 provider/model、请求时间、结果类别和可追溯业务记录；禁止仅写入字符串 `MET`。
- OSS Gate 必须通过真实 OSS 执行写入、读取校验和删除本轮唯一测试对象；记录 bucket、object key、checksum 和清理结果，不输出 credential。
- 任一外部 Gate 失败、超时或无法证明都保持 `NOT_MET`，不得激活或公开候选。
- 成功后由 `activate-production.sh` 在同一 manifest/run 上调用 `mark-initialized`，把状态推进到 `PRODUCTION_INITIALIZED`，并再次核验 API、worker、scheduler、frontend、数据库和 Redis 健康。

完成条件：只有本轮真实证据完整的 AI 和 OSS Gate 可标记 `MET`。

### Step 10：提交并执行 Production Nginx Write Package（Package N3）

- N3 只授权把 checksum 已核验的维护配置原子替换为 manifest 对应的 Production 配置。
- Production 配置必须从仓库 template 渲染，使用 exact host IP、端口和 security snippet；不得从旧远端配置手工拼接。
- 写前为维护配置创建新的不可覆盖 backup；写后校验 checksum、owner/mode、upstreams 与禁止项，并运行 `nginx -t`。
- `nginx -t` 失败时恢复维护配置并保持不 reload。

完成条件：用户独立批准 N3，目标文件已原子替换且 `nginx -t` 成功；站点仍未 reload，仍显示维护页。

### Step 11：提交并执行 Production Nginx Reload Package（Package N4）

- N4 只授权对 N3 已核验 checksum 的 Production 配置执行一次 reload。
- reload 后从 loopback 和 public origin 检查 `/api/v1/live`、`/api/v1/ready`、V2 登录页、静态资源缓存、对象存储路径、TLS 和安全头。
- 重新读取 enabled target、checksum、upstreams、`nginx -t`、systemd 状态和 listeners。

完成条件：用户独立批准 N4；public acceptance 全部成立后才宣告 Production 公开成功。

### Step 12：观察至 T+60 并关闭维护窗口

- 从 T0 到 T+60 持续记录关键阶段时间，任一步预计无法在剩余窗口内安全完成时，立即进入分层恢复。
- 观察 API/worker/scheduler/frontend/PostgreSQL/Redis state、health、restart/OOM、关键日志、public live/ready、登录页和真实外部依赖结果。
- T+60 前完成成功判定或恢复；不得以继续排障为由突破硬窗口。

完成条件：成功路径证据完整且无异常，或已完成与当前故障层级匹配的恢复。

### Step 13：分层失败恢复

- 候选传输/校验失败：保留 staging/failed-production，撤销未消费候选，不触碰运行时与数据。
- 维护配置写入失败且未 reload：恢复 original Nginx 文件并校验，不需要 reload。
- 已进入维护但未停止容器：恢复 original 配置，经独立写授权和 reload 授权退出维护。
- 已 quarantine、尚未创建新数据根：删除仅在本轮创建且已逐项证明为空的新根后，原子恢复 quarantine；不得删除 quarantine。
- 已创建或写入新数据根：先把新根原子移动到唯一 `failed-production`，再原子恢复 quarantine；禁止覆盖任何既有路径。
- 候选已启动但尚未公开：停止 exact candidate 容器，保留日志和 failed-production，然后恢复数据与原运行时。
- 候选已公开：先通过独立 Nginx write/reload 授权重新进入维护，再停止 exact candidate，恢复原数据、原镜像 ID 和原 Nginx 配置。
- 任一恢复步骤身份不明确、目标已存在、跨设备或证据不足时停止并请求新授权，不猜测、不强行清理。

完成条件：旧 Production 可验证恢复，或现场被安全冻结并明确报告未恢复原因；任何失败现场都保留。

### Step 14：收尾与后续边界

- 汇总本轮实际执行命令、exact object identity、时间线、Gate 结果、漂移、恢复动作和未完成项。
- 核对代码、manifest、环境元数据、数据库 revision、Nginx、容器与权威文档一致。
- 只有本轮真实执行且证据完整的 Gate 标记 `MET`；其余保持 `NOT_STARTED`、`NOT_APPLICABLE`、`NOT_MET` 或明确失败状态。
- 不删除 quarantine、failed-production、旧 env、旧 image、release、manifest、Nginx backup、fake-oss 或非 PartSignal 资源。
- 若后续需要永久清理，创建独立 destructive cleanup task，重新 inventory、列出 exact targets、恢复价值和独立授权。

## 4. 关键停止条件

出现以下任一情况立即停止当前阶段，不扩大授权范围：

- 候选 manifest、archive、tracked files、tag/image ID 或 commit identity 不一致；
- `.env.production` 不是 canonical regular file、存在 symlink、不是 `root:root 0600` 或必需项未配置；
- 数据根、容器、Nginx target/checksum、端口、数据库 revision 或其他 Compose project 发生未授权漂移；
- 维护页未公开却准备停止容器，或 Production 候选在真实 AI/OSS Gate 前可由公网访问；
- 任一 exact target 无法唯一识别、目标路径已存在、原子 rename 跨设备或 backup 会覆盖；
- `nginx -t`、health、数据库迁移、真实 AI/OSS、public acceptance 任一失败；
- 剩余时间不足以在 T+60 前完成成功或安全恢复；
- 需要永久删除、Docker prune、DNS/TLS/证书修改或非 PartSignal 资源变更。

## 5. 明确不执行的操作

本任务不得执行 `docker system prune`、`docker compose down --remove-orphans`、宽泛 glob 删除、永久数据清理、旧镜像/release/manifest/backup 删除、fake-oss 删除、非 PartSignal 容器变更、DNS 修改、TLS/证书修改、自动 commit 或 push。任何这类需求都必须进入后续独立任务和独立授权。
