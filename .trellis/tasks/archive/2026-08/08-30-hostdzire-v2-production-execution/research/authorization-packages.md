# Hostdzire 远端授权包基线

## 状态与使用规则

- 基线 ID：`INV-20260830T005302+0800`
- 主机：SSH alias `hostdzire` / hostname `scrapy`
- 当前状态：A1=`EXECUTED_MET`；A2 及后续 package=`DRAFT_NOT_AUTHORIZED`
- 本文件不是远端写授权，也不允许以变量占位符直接执行命令。
- 规划批准和 `task.py start` 只允许进入实施准备；每个包必须在执行当时重新渲染为全字面量 package，展示给用户并取得单独批准。
- 任一 hostname、commit、release/run ID、container full ID/label、image ID/RepoDigest、path identity/device/owner/mode、env metadata、Nginx target/checksum、listener、capacity 或 state 漂移都会使对应 package 失效，必须重新生成。运行态数据 byte size 只在 A1 作为观测值；Package M 停机/quarantine 前仍要求 exact size freeze。
- 任一 package 的授权不自动授权下一 package、恢复 package、reload 或永久清理。

## Package A1：Artifact Build

### 当前 readiness

- fresh fetch 后本地 `main == origin/main == git ls-remote origin/main == a663bcce9fd49da9c5aea7f257372fc318447234`，working tree clean。
- proposed release ID=`production-20260830-101614-a663bcce`；Host 上对应 release directory、archive、manifest、backend/frontend tag 全部 absent。
- Host=`linux/amd64`；A1 exact baseline 于 `2026-08-30T10:53:57+08:00` 观察 available memory=`2,280,304,640` bytes、root/Docker/containerd filesystem available=`46,525,460,480` bytes。执行前必须重读并满足 package 的 literal/threshold Gate。
- 当前 V2 rollback baseline 是 `partsignal-frontend:mvp-20260825-172239-2a6fd940b848` / `sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111` / RepoDigest=`partsignal-frontend@sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111` / `linux/amd64`。
- 状态：`EXECUTED_MET`；用户已独立批准并完成 exact command，actual evidence=`research/package-a1-execution.md`。
- 全字面量命令与 mutation/timeout/failure 边界：`research/package-a1-exact.md`。
- actual archive SHA-256=`38666f7a799aee8cd6966ec69e021a6d427c11a89a5fecff1345c84665021fa8`；backend full ID=`sha256:3a2b4618099644c81dc660d9dbe37fd7f8be5eaa37129dbfbeca447fa6f44380`；frontend full ID=`sha256:2a4fabe9eb4071e499b039484c900a434d75922c71f66af807d629a2d67761bb`；均为 `linux/amd64` 且 RepoDigest 非空。

### 最终 package 必填字面量

1. full commit=`a663bcce9fd49da9c5aea7f257372fc318447234`、schema head=`0043_geo_platform_identity`、release ID=`production-20260830-101614-a663bcce`。
2. 新且不存在的精确目标：
   - `/root/partsignal/releases/production-20260830-101614-a663bcce`
   - `/root/partsignal/releases/production-20260830-101614-a663bcce.tar.gz`
   - `partsignal-backend:production-20260830-101614-a663bcce`
   - `partsignal-frontend:production-20260830-101614-a663bcce`
3. fixed origin、clean checkout、`HEAD == origin/main == commit` 与 deterministic `git archive` 命令。
4. backend 只从 fixed checkout `backend/`、frontend 只从 canonical `frontend/` 顺序 build；每次 build 前重读 available memory/root capacity。
5. build 后 backend/frontend full image ID、全部非空 RepoDigest、`linux/amd64` 和 tag identity；rollback V2 identity 只读复核。
6. 每条 create/build/inspect 命令、预计最长耗时、硬停止条件和“当前 7-service Staging/Nginx/data/env 未变”的退出证据。

### 已发现冲突的旧 planning baseline（当前 blocker）

- 只创建上述新 release checkout、source archive 和两个新 image tag；存在即停止，不覆盖。
- backend 仅从 fixed checkout `backend/` 顺序构建；frontend 仅从 fixed checkout canonical `frontend/` 顺序构建。
- 每次 build 前 available memory ≥2 GiB、root available ≥10 GiB；不满足立即停止。
- 禁止 manifest/env/Compose/Nginx/container/data mutation；禁止 cross-build、`docker save/load`、pull fallback、任何 prune、旧 image/release/env/manifest 删除或 tag 覆盖。

### required evidence before package closes

- clean source、archive path/size/SHA-256，以及 backend/frontend/rollback V2 reference、full image ID、全部 RepoDigest、platform。
- 新 backend/frontend 都是 `linux/amd64` 且 RepoDigest 非空；任何失败保留现场并停止，不进入 A2。
- 当前 7-service runtime、Nginx、data path、env metadata 和 public HTTP 保持 package 前状态。

## Package A2：Manifest / Configuration

### 前置

- A1 已独立获批并完成；A1 的 archive 与三类 image identity 已成为本包字面量输入。
- `/root/partsignal/releases/production-20260830-101614-a663bcce.manifest.json` 必须仍不存在。
- `/root/partsignal/shared/.env.production` 仍由用户或运维 owner 经安全渠道 provision；代理不接收、复制、显示或记录值。

### 最终 package 必填字面量

1. commit/release/schema、source archive path/size/SHA-256。
2. backend/current frontend/rollback frontend 的 exact reference、full image ID、全部 RepoDigest 和 `linux/amd64` platform。
3. manifest producer 全字面量命令、8 个 tracked file path/SHA-256、output path 与排他 `0600` 创建合同。
4. manifest 生成后的 SHA-256，以及 archive/tracked/image identity 独立复算命令；禁止重新 build 或 retag。
5. `/root/partsignal/shared/.env.production` 的 regular/non-symlink、`root:root 0600` metadata，以及只含固定枚举和 `*_configured` 的 status-only evidence。
6. Compose `config --quiet`、Production preflight、frontend container artifact 和 deploy-script validation；任何输出不得包含 secret。

### mutation allowlist

- 旧 baseline 写成“只允许排他创建 manifest，并执行只读 identity/metadata/configuration 验证”；审计已证明这不足以描述 mandatory validation，不能作为当前授权 allowlist。
- 不创建或替换 env；不重建/retag image，不修改 checkout/archive、运行容器、Nginx 或数据的持久边界继续有效。

Step 3B 审计已证明 mandatory validation 实际会创建并清理精确 one-off container/temp file；这与“其余只读”存在 material conflict。用户已批准 `research/package-a2-exact.md` 记录的 correction，包括 network precheck、full-image frontend wrapper 与 owned cleanup，但这不授权执行 A2；env missing 时仍不得运行。
- manifest producer、frontend artifact 或 configuration 任一失败即停止并保留现场。

### required evidence before package closes

- manifest SHA-256、schema head、archive identity、8 个 tracked digest 和三类 image identity 全部一致。
- Production env metadata、Compose `config --quiet` 与 status-only preflight 通过；输出审计无 secret。
- 当前 7-service runtime、Nginx、data path 和 public HTTP 保持 package 前状态。

## Package N1：Nginx Maintenance Write

这个包必须在 Package A2 完成后、Maintenance/Data 前执行。它只写站点文件，不 reload。

### 当前 exact baseline

- enabled symlink：`/etc/nginx/sites-enabled/partsignal-staging.conf`
- target：`/etc/nginx/sites-available/partsignal-staging.conf`
- target owner/mode/device：`root:root 0644` / device `2049`
- target SHA-256：`ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`
- security snippet：`/etc/nginx/snippets/partsignal-security-headers.conf`
- security SHA-256：`c946c3a33dc8f3ae078545cb37df3b6a65759ca589345ed485139bdd9148931e`
- Nginx：`1.29.8`，当前 `nginx -t` successful。

### 最终 package 必填字面量

- literal run ID。
- original backup：`/etc/nginx/sites-available/partsignal-staging.conf.pre-<literal-run-id>.original`，必须不存在。
- fixed candidate maintenance template path 与 rendered SHA-256。
- same-directory temporary file literal prefix、`root:root 0644`、device equality。
- 完整命令顺序：重新校验 baseline → `cp -a` 排他备份 → render temp → 检查无 upstream/proxy/static root/object-storage、仅维护响应 → checksum/owner/mode → atomic replace target → `nginx -t`。
- `nginx -t` 失败时：由 original backup 生成同目录 temp，核对原 SHA-256，atomic restore，再次 `nginx -t`；不得 reload。

### 关闭条件

- target on disk 是 fixed candidate maintenance checksum；enabled symlink/security snippet 未变；`nginx -t` 成功。
- 运行中的 Nginx 此时仍可能使用旧配置，直到独立 Package N2 获批；若 N2 未获批，必须在 N1 授权内恢复 original target 并再次 `nginx -t`，不得开始维护。

## Package N2：Nginx Maintenance Reload

### exact command owner

- systemd unit：`nginx.service`，当前 active。
- reload：`systemctl reload nginx`；unit 实际向 `/run/nginx.pid` master 发送 HUP。

### 前置和证据

- target checksum 必须等于获批 maintenance render；`nginx -t` 必须在本 invocation 前重新成功。
- reload 只授权一次 maintenance transition，不授权 final Production 或 recovery reload。
- reload 后验证 unit active、master/worker state、站点业务 URL 返回维护状态、无 `19000/19080/19001` upstream 流量；其他 Nginx sites 不受影响。
- T0 定义为 maintenance response 首次经公网验证的时间，60 分钟硬窗口从这里开始。

## Package M：Maintenance / Data / Clean-init / External Gate

### 当前 exact stop baseline

停止顺序为写入/调度入口优先，数据库最后；每一步必须先重新核对 full ID + project/service label：

1. scheduler `e2fd2a6cf36a3a56640c9e245ee1284eadc3bc2d275205974f9f3df6793421a8`
2. worker `dd5cee10ef2ad33deeefa83beb31c41be74523a909ee87c02223048b3dd05f5d`
3. api `0b2c7f5b2d0dc4562cb5aa1b6ec1833f3785d33fac974481bc4b83ad57a38c94`
4. frontend `7e46e918710ae3f9b42a5880403b220ffc86c2b65b244908077f9d457e105b75`
5. fake-oss `57736713655b6695cb6cfb3adb7219ba1fbb926b384467223403a11333261c34`
6. postgres `680ac051e558b83894318e5b9ba3dd59cdfe905326fad084ba6662870b709acc`
7. redis `4a4d9ac94eaaf8c27c80c5ea406f03cd1de4483103546b9441e5dea812466bba`

这些 ID 只属于 baseline；最终 package 必须立即重读并替换，不允许盲用。

### 当前 exact data baseline

- data root `/root/partsignal-data`：uid:gid `0:0`、`0755`、device `2049`、80,654,336 bytes。
- postgres：uid:gid `70:0`、`0700`、68,210,688 bytes。
- redis：uid:gid `999:0`、`0755`、11,833,344 bytes。
- objects：uid:gid `0:0`、`0755`、606,208 bytes。
- quarantine root missing；cutover state missing。
- DB revision `0043_geo_platform_identity`；size `10,714,135` bytes。

### 最终 package 必填字面量

- literal release ID、run ID、manifest path/SHA-256、archive SHA-256、image identity、env path metadata、maintenance Nginx checksum。
- 7 个当时 full container ID 与逐项 stop 命令；禁止 `down`、`rm`、`--remove-orphans`。
- quarantine command的 literal run ID；固定 source/target/state path 与 device/owner/mode/size。
- clean-init deploy/activate 的完整字面量非 secret 环境；secret 只由受限 env file 注入。
- real AI/OSS 测试步骤和只含 ID/status/time 的证据 schema。
- 每个时间停止点、restore 命令和旧运行态恢复所需的三份历史 Compose source、`.env.staging` metadata、7 个旧 image ID。

### 顺序和硬停止点

1. T+0 maintenance guard 已生效；再做 final drift check。
2. T+10 前停止精确 7 个容器，确认 `19000/19001/19080` 释放、无 active/quarantine mount。
3. 执行权威 `quarantine <run-id>`，只接受状态机定义的续跑；不得手工 rename。
4. 用 fixed release、local mode、同一 manifest/run/env/data root 执行 clean-init。
5. T+20 前要求 `PRODUCTION_PREPARED`；否则 restore。
6. prepared 后重新验证实际容器 image ID、archive/manifest、实际 DB revision、integrity、账号、health；maintenance guard 仍阻断公网。
7. 在同一 candidate 上执行真实 AI/OSS Gate；T+35 未解决则 restore。
8. 只有证据完整才在单次命令环境设置 `PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET` 并 activate；验证 `PRODUCTION_INITIALIZED`、Worker/Scheduler health、fake-oss stopped。
9. T+45 前必须准备好 final Nginx write/reload；否则 restore。

### restore 边界

- 先停止新 Production 写入口与服务；保存 container/image/state/log/manifest 证据。
- 枚举所有运行容器 mount，证明 active root、quarantine target、failed-production 无重叠。
- 执行 fixed release `prepare-production-data.py restore <literal-run-id>`；失败新数据保留，旧三叶恢复。
- 状态=`RESTORED` 后不在本窗口第二次 clean-init；恢复精确旧 7-service runtime，继续保持 maintenance guard，验证旧 DB revision、ports、health/restart/OOM。
- 需要恢复公网时，使用独立 Nginx recovery write/reload package；不自动继承任何 reload 授权。

## Package N3：Final Production Nginx Write

- 仅在 Package M 达到本轮真实 `PRODUCTION_INITIALIZED` 且 health/identity/AI/OSS evidence 完整后生成。
- 输入是 fixed candidate `deploy/nginx/partsignal.conf.template` 以 `10.0.0.2` 渲染的 literal checksum。
- maintenance target 先排他备份为 `/etc/nginx/sites-available/partsignal-staging.conf.pre-<run-id>.maintenance`。
- 同目录 temp 必须 `root:root 0644`；只允许 upstream `19000/19080`，拒绝 `19001`、`/object-storage/`、静态 root 和非 candidate checksum。
- atomic replace 后运行 `nginx -t`。失败恢复 maintenance backup 并再次 test，不 reload，Package M 继续保持维护态或进入 restore。

## Package N4：Final Production Nginx Reload

- 只授权一次 final transition：重新确认 target checksum、security snippet、enabled symlink、`nginx -t`，然后 `systemctl reload nginx`。
- reload 后立即验证 public live/ready/login/home/deep links、assets/cache/map、CSP/security、`/object-storage/` boundary、Nginx unit/listener/5xx。
- 失败时原子恢复 maintenance 或 original backup、`nginx -t`，再申请独立 recovery reload；应用或数据失败同时进入 Package M restore。
- T+60 必须是已验证的新 Production 或已验证恢复的旧运行态；不能以“仍在排查”延长窗口。

## 永久清理

上述所有 package 都明确不授权删除 quarantine、failed-production、`.env.staging`、`.env.production`、fake-oss、V1/旧 image、release、archive、manifest、Nginx backup、build cache 或非 PartSignal 资源。任何永久清理必须在稳定观察后创建新的 destructive cleanup task，并重新 inventory 与逐对象授权。
