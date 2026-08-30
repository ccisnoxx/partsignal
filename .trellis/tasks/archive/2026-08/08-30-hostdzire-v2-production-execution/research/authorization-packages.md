# Hostdzire 远端授权包基线

## 状态与使用规则

- 基线 ID：`INV-20260830T005302+0800`
- 主机：SSH alias `hostdzire` / hostname `scrapy`
- 当前状态：`DRAFT_NOT_AUTHORIZED`
- 本文件不是远端写授权，也不允许以变量占位符直接执行命令。
- 规划批准和 `task.py start` 只允许进入实施准备；每个包必须在执行当时重新渲染为全字面量 package，展示给用户并取得单独批准。
- 任一 hostname、commit、release/run ID、container full ID/label、image ID/RepoDigest、path metadata/device/size、env metadata、Nginx target/checksum、listener、capacity 或 state 漂移都会使对应 package 失效，必须重新生成。
- 任一 package 的授权不自动授权下一 package、恢复 package、reload 或永久清理。

## Package A：Artifact / Configuration

### 当前 readiness

- `main == origin/main == d78b299069b222adb78507067334751737f679da`，但当前 planning task 尚未提交，因此该 commit 不是最终 candidate。
- Host 当前可用内存 2,301,513,728 bytes，无 swap；根盘可用 46,581,321,728 bytes。
- `/root/partsignal/shared/.env.production` missing，所有配置 allowlist `*_configured=false`。
- 当前 V2 rollback baseline 是 `partsignal-frontend:mvp-20260825-172239-2a6fd940b848` / `sha256:72b206963f479d0dd75132708dac3c37e4d9243fcb75e380d80f8e12fe721111`。
- 状态：`BLOCKED_PENDING_PLANNING_APPROVAL_CANDIDATE_FREEZE_ENV_PROVISION`。

### 最终 package 必填字面量

1. full 40-char candidate commit，且 fresh fetch 后本地和 Host clean checkout 都证明 `main == origin/main == commit`。
2. 不可复用 release ID、source archive path/SHA-256、manifest path/SHA-256、唯一 Alembic head。
3. 新且不存在的精确目标：
   - `/root/partsignal/releases/<literal-release-id>`
   - `/root/partsignal/releases/<literal-release-id>.tar.gz`
   - `/root/partsignal/releases/<literal-release-id>.manifest.json`
   - `partsignal-backend:<literal-release-id>`
   - `partsignal-frontend:<literal-release-id>`
4. backend/frontend/rollback frontend 的 full image ID 与全部 RepoDigest；repository 末段不得为 V1。
5. 固定 candidate 中 Production/maintenance Nginx 模板和全部 manifest tracked files 的 checksum。
6. `/root/partsignal/shared/.env.production` 的普通非 symlink、`root:root 0600` metadata，以及仅含 `*_configured`/固定枚举的 preflight 结果。
7. 每条 create/build/manifest/config 命令、预计最长耗时、停止条件和“当前 Staging 不受影响”的退出证据。

### mutation allowlist

- 只创建上述新 release/archive/manifest/image；存在即停止，不覆盖。
- env 文件只由用户或运维 owner 经安全渠道 provision；代理不接收、复制、显示或记录值。
- backend 仅从 fixed checkout `backend/` 顺序构建；frontend 仅从 fixed checkout canonical `frontend/` 顺序构建。
- 每次 build 前 available memory ≥2 GiB、root available ≥10 GiB；不满足立即停止。
- 禁止任何 prune、旧 image/release/env/manifest 删除或 tag 覆盖。

### required evidence before package closes

- clean source、archive checksum、image identity、frontend container artifact check、Production deploy script tests。
- manifest 排他创建且 producer/consumer allowlist 一致；archive checksum 在生成后重新比较。
- Production env metadata、Compose `config --quiet` 与 status-only preflight 通过；输出审计无 secret。
- 当前 7-service runtime、Nginx、data path 和 public HTTP 保持 package 前状态。

## Package N1：Nginx Maintenance Write

这个包必须在 Package A 完成后、Maintenance/Data 前执行。它只写站点文件，不 reload。

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
