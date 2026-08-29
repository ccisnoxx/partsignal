# Hostdzire V2 Clean Deployment Implementation Plan

> 状态：in progress。用户已批准仓库实施；提交/push、远端镜像构建、Production env、容器、数据和 Nginx 操作仍受后续独立 Gate 约束。

## Validation

### Required

```sh
node deploy/scripts/check-nginx-security.mjs
deploy/scripts/test-deploy-staging.sh
deploy/scripts/test-deploy-production.sh
uv run --project backend pytest backend/tests/unit/test_cli.py
make test-deploy-scripts
git diff --check
```

新增 local image mode 后，Production script test 必须精确覆盖：default registry 仍 pull→verify；local mode 不 pull；相关 deploy/activate `run/up` 均 `--pull never`；candidate image 缺失/identity drift/非法 mode/V1 repository fail closed；既有 clean-init/activation/rollback 顺序不退化。

### Optional full-suite

```sh
make verify
```

共享 Production deployment contract 变更推荐运行 full suite。若因环境或时长跳过，必须报告 targeted/deploy/frontend-container/CLI checks 和剩余风险；optional failure 不授权范围外修复。

## Step 0: Final Planning Review

- [x] 用户于 2026-08-29 明确批准 planning summary，包括 quarantine-first、60 分钟窗口和独立远端写 Gate。
- [x] 用户在最终规划后续消息中明确授权运行 `task.py start`；该授权不自动放行四个远端写 Gate。
- [x] 激活后已完整读取最终 PRD/design/implement、适用 spec 和 manifest context，再复核代码。

## Step 1: Repository Contract Correction

- [x] 在 deploy/activate 的 image-delivery owner 增加 strict local candidate mode，保持 registry default。
- [x] local mode no-pull/`--pull never`，仍执行 manifest identity verification；未新增第二脚本或 Compose。
- [x] producer、shared manifest consumer、deploy/activate 增加 V1 repository hard reject，并覆盖非法/空 mode、缺失镜像、顺序和具体错误原因。
- [x] 更新 Production test、Hostdzire Runbook/附录，仅同步本次改变的合同。
- [ ] Required validation 尚差 `make test-deploy-scripts`：本机不存在 Docker Desktop/daemon，命令在 frontend image build 前以 Docker socket 缺失退出；其余 targeted checks 均通过，未发现 secret、test escape 泄漏、重复部署逻辑或范围外改动。
- [x] 已展示单 work commit 计划，用户于 2026-08-30 确认提交；本次不 push。

已通过：`check-nginx-security.mjs`、staging/Production deploy tests、backend CLI 4 tests、shell syntax、Python compile、Compose `--pull never` CLI help 和 `git diff --check`。`make verify` 未运行，因为它包含同一个不可用 Docker gate；环境未变化时不重复执行同一失败。

2026-08-30 收口决定：用户批准既定 work commit 并要求随后归档。Step 2-10 的 candidate freeze、全部远端写 Gate、维护、部署、Nginx、浏览器验收与 Observation 未执行，结果为 `CANCELLED_BY_SCOPE_DECISION / NOT_APPLICABLE / NOT_STARTED`；本任务不会进入 Hostdzire 部署阶段。

## Step 2: Candidate Freeze Gate

- [ ] 用户或另行授权的操作把批准代码同步到 `origin/main`。
- [ ] fresh fetch；证明本地主目录 `main`、clean、`HEAD == origin/main`；记录 full commit 和唯一 Alembic head。
- [ ] 定义不可复用 `release-id` 与 `run-id`；所有后续对象使用同一 identity。
- [ ] 形成 Artifact authorization package：exact host paths、origin、image refs、current V2 rollback identity、capacity thresholds、commands、stop conditions。

Stop：dirty tree、remote ref drift、multiple heads、release/run target exists、Hostdzire origin access unproven。

## Step 3: Remote Artifact and Configuration Gate

在用户批准精确 package 后：

- [ ] read-only capacity；available memory ≥2 GiB、root free ≥10 GiB。
- [ ] 在 absent `/root/partsignal/releases/<release-id>` 创建 clean authoritative checkout，证明 branch/status/HEAD/origin-main。
- [ ] 生成 sibling `git archive`，checkout remains clean。
- [ ] 顺序 build `partsignal-backend:<release-id>`、`partsignal-frontend:<release-id>`；每次前复查 memory/load。
- [ ] 跑 frontend container smoke 和部署脚本测试；失败不进入 maintenance。
- [ ] inspect image ID/RepoDigest；冻结 current active V2 `sha256:72b206...` rollback image。
- [ ] 用 fixed allowlist 排他生成 manifest，复算 source/manifest/tracked checksums。
- [ ] 用户/运维 owner 受控 provision `/root/partsignal/shared/.env.production`；值不进入参数、输出或 task file。
- [ ] 验证 non-symlink、`root:root 0600`；Production Compose config 与 status-only preflight 通过。

Stop：Git/manifest/image drift、V1 ref、RepoDigest missing、capacity、env metadata/config/preflight failure、secret output。

## Step 4: Final Read-only Pre-cutover Package

- [ ] 重新采集 host/capacity、Compose projects、7 container full IDs/service/image/state/restart/OOM/health、mount/listener。
- [ ] 重新采集 data numeric owner/mode/device/size、state/run absence、env metadata、current/release、candidate/rollback images。
- [ ] 重新采集 Nginx version/test、enabled target、site/security checksums、upstreams。
- [ ] 对比 planning inventory；任何差异重新生成 exact targets。
- [ ] 向用户展示 Maintenance/Data authorization package 和 recovery commands；等待批准。

## Step 5: Maintenance and Quarantine

- [ ] 宣布 maintenance，记录 T0。
- [ ] 停止现场精确 frontend/api/worker/scheduler/fake-oss/postgres/redis；不用 `down`/orphan removal。
- [ ] 确认 7 targets stopped、ports `19000/19001/19080` released、no active data mount。
- [ ] fixed release 执行 `prepare-production-data.py quarantine <run-id>`。
- [ ] allowlist state proves `QUARANTINED`；旧三叶在 exact quarantine，新 postgres/redis empty，objects absent。

Stop：T+10 未安全停止，target/state/path/mount/device/owner drift，quarantine failure not script-resumable。

## Step 6: Clean Init

- [ ] fixed release `deploy.sh` with local image mode、same release/manifest/run/env/data root。
- [ ] 证明 no pull，candidate images match manifest。
- [ ] PostgreSQL/Redis healthy，config preflight passed。
- [ ] migration 后 actual revision equals manifest schema head。
- [ ] integrity `[]`；account initialization confirms two accounts without passwords。
- [ ] API/frontend healthy，live/ready/homepage passed；state=`PRODUCTION_PREPARED`。
- [ ] Worker/Scheduler/fake-oss remain stopped。

Stop/restore：T+20 not prepared，revision/integrity/account/health/state mismatch，secret leak evidence。

## Step 7: External Services and Activation

- [ ] Same-manifest real AI/OSS permission/connectivity/timeout/CORS/upload/HEAD/read checks；record release-bound redacted evidence。
- [ ] Gate not `MET` keeps async stopped；fix within budget or restore。
- [ ] Gate=`MET` 后 fixed `activate-production.sh` local mode。
- [ ] Worker/Scheduler healthy，API/frontend ready，state=`PRODUCTION_INITIALIZED`；fake-oss stopped。

Stop/restore：T+35 external Gate unresolved or activation identity/health/state failure。

## Step 8: Nginx Write and Reload Gate

- [ ] 生成 old target、backup、new render、security snippet exact path/checksum package；用户批准 site write。
- [ ] `cp -a` current target to `.pre-<run-id>`，no overwrite。
- [ ] same-directory temp render，root:root `0644`；verify only `19000/19080`，no `19001`/object-storage/static root。
- [ ] atomic replace target；enabled symlink/security snippet unchanged。
- [ ] `nginx -t`；failure restores backup and retests，no reload。
- [ ] test 通过后展示 exact reload；用户批准后 reload。
- [ ] public live/ready/login/home/deep-links、cache/map/CSP/security/object-storage boundary passed。

Stop/restore：T+45 not cut over or public/security failure；restore Nginx backup；application fault also triggers data/application restore。

## Step 9: Browser Acceptance and Observation

- [ ] Existing Playwright Test preferred；temporary diagnostics use task session `hostdzire-v2-clean-deployment` only。
- [ ] 验证 login/must-change、Workbench、Product/Content/Publishing/GEO/Configuration/System、legacy redirect、direct/refresh/history、permission、revision、375/768/1024/1440。
- [ ] 代表 read/write 和 real AI/OSS；确认 Markdown/immutable history/server authority。
- [ ] 记录 Nginx 5xx/upstream、API error、container restart/OOM、async、DB/Redis、AI/OSS。
- [ ] 关闭本 task playwright-cli sessions 并确认无残留。
- [ ] T+60 hard decision：verified new runtime or verified restored old runtime。

## Step 10: Recovery if Triggered

- [ ] Stop new writes/services；preserve logs/manifest/container/state evidence。
- [ ] fixed `restore <run-id>`；failed-production preserved、old leaves restored、state=`RESTORED`。
- [ ] Exact historical `.env.staging`、Compose sources and frozen images restore old 7-service runtime。
- [ ] If Nginx changed，atomic backup restore，`nginx -t`，separate recovery reload approval。
- [ ] Verify old revision `0043`、containers、ports、public endpoints、restart/OOM。
- [ ] Never delete failed Production、quarantine、candidate release/images/manifest/logs。

## Step 11: Closeout Without Cleanup

- [ ] 汇总 actual commit/release/run/manifest/images、state transitions、Nginx checksums、validation、downtime、Observation、risks。
- [ ] Only actual current-task Gate may be `MET`；unexecuted is `NOT_STARTED`；old cancelled tasks unchanged。
- [ ] Update authoritative docs changed by actual contract/behavior；state why API/database contracts need no change if applicable。
- [ ] No old data/env/image/release/quarantine/fake-oss/V1 cleanup；future cleanup is a separate destructive plan。
- [ ] Quality check/diff review；present commit plan；no automatic commit/push/archive。

## Rollback Points

- Before remote write：repository change can be corrected by forward commit；no history rewrite。
- Artifact/config failure：stop，current runtime unchanged。
- Data：`restore <run-id>`，old data restored，failed new data retained。
- Frontend：manifest-bound current verified V2 only。
- Application：only current backend compatible with actual `0043`；otherwise data restore。
- Nginx：exact `.pre-<run-id>` backup，test，separate reload。

## Risky Targets

- Repository implementation：Production deploy/activate tests and Hostdzire docs only；exact list after pre-development context read。
- Remote creation：new release/archive/manifest/images and `.env.production`。
- Reversible mutation：7 PartSignal containers，three data leaves/state/quarantine，one Nginx target + backup。
- Never targets：non-PartSignal resources、old releases/images/env/quarantine/failed-production、DNS/TLS。
