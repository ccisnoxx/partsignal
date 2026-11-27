# I04 执行与证据记录

> 当前 I04 实际目标已按 `docs/frontend-v2/11-frontend-redevelopment-task-list.md` 改为 Hostdzire 开发预览。下列原 Production planned phases 和历史 Gate 均保留为历史路线证据；实际完成依据见文末 I04-3 收口，不得把 `PRODUCTION_INITIALIZED` 或真实 External Services Gate 视为已达到。

## Phase 0 — 当前恢复点

- 候选工作树：`codex/frontend-redevelopment-candidate@a4c15a535f21621188a61f076cf7856c14509d42`，tree `9738ba36cb0f4fbe1f4352cfb89e043df7fa580c`，创建 I04 前 clean。
- `a4c15a53` 相对已验证产品候选 `387b802d` 仅包含 Trellis/会话收尾记录，没有产品代码、部署配置或依赖变化。
- 原检出区：`main@9100774b0e124d1d834f8c726cf85f2c0e171e5e`，创建 I04 前 clean。
- I04 已建立并链接为总体任务 child；总体任务保持 `in_progress`。

## Planned phases

1. Git 收口：fetch、严格 ancestry/远端分叉检查、候选 I04 规划记录 commit、原检出区 fast-forward only、非 force push、再次固定 local/origin/candidate identity。
2. Repository Release Gate：在最终 clean main 运行 Nginx security、三组 deploy 测试、CLI unit、Compose config、shell/Python syntax、diff check 与 secret scan，逐项保存日志和 SHA-256。
3. Hostdzire 只读预检：主机/资源、Docker、固定路径、repo/release/current/manifest、Compose service/container/image/health/profile、listener、migration、Nginx/TLS、数据 device/permissions/size、env 安全状态、rollback image、delivery 条件与 fake-oss inventory。
4. 冻结 release：生成唯一 release ID/run ID、可复现 source archive、候选镜像与 RepoDigest、排他 0600 manifest；完成 pre-cutover fresh critical review。
5. 维护与 quarantine：原子 maintenance Nginx、稳定 503/T0、精确停止旧服务、确认无写入与 mount、同一 run ID quarantine。
6. clean-init prepare：只通过 `deploy.sh` 完成 config/identity/health/preflight/migration/integrity/initialize-accounts/API/Frontend，达到 `PRODUCTION_PREPARED`。
7. 真实 AI/OSS Gate：实际权限、连通、timeout、失败语义、namespace、受控预签名上传/HEAD/read/CORS/cleanup；只在全部通过后标记 `MET`。
8. 激活与 final Nginx：只通过 `activate-production.sh` 启动 worker/scheduler，进入 `PRODUCTION_INITIALIZED`；原子切换最终 Nginx。
9. 验收与观察：回环/公网/浏览器/权限/受控写/AI/OSS/artifact/security/runtime/migration/state，记录多采样观察与 T0+60 分钟结论。
10. 精确清理与收尾：保留规定证据和 rollback/quarantine，fresh post-observation critical review，完成 I04 与总体任务，提交并非 force push 仅含 Trellis 收尾记录的 main commit。

## Evidence ledger

后续在本文件与 `task.json.meta` 中追加实际 commit/tree、release ID、run ID、manifest 路径与 SHA-256、archive SHA-256、image ID/RepoDigest、Nginx old/new checksum 与备份、T0/时间线、Gate/验收日志、观察采样、review audit ID、警告和覆盖缺口。不得记录 secret 值。

## Current status

`BLOCKED_REMOTE_PRECHECK`。Git 收口与 Repository Release Gate 已完成；Hostdzire 只读预检发现明确停止条件，未生成 release/manifest，未执行任何远端写入，未进入维护窗口。

## 2026-09-27 actual execution

### Git 收口

- fetch 后 `origin/main` 仍为 `9100774b0e124d1d834f8c726cf85f2c0e171e5e`；候选无分叉并领先 27 个提交。
- I04 规划记录提交为 `f91b98b52c1fd7e90b4767979c13915af423914b`；原检出区以 `git merge --ff-only` 更新到该提交并非 force push。
- push 后 local `main == origin/main == f91b98b52c1fd7e90b4767979c13915af423914b`，tree `4891af4b287fdedb983aeb87dcda7d82db5f4607`，两个工作树均 clean。

### Repository Release Gate

以下项目均在最终 clean `main` 实际退出 `0`：

| 检查 | 结果 | 日志 | SHA-256 |
| --- | --- | --- | --- |
| Nginx security | passed | `/tmp/partsignal-i04-check-nginx-security.log` | `17f63aff5334365b1891fde48a58f034158e44fbcd8f03382cd5ce49b589f99c` |
| deploy staging test | passed | `/tmp/partsignal-i04-test-deploy-staging.log` | `fd574621f03c8142222f748dfdb6f828574f70f8b1956da2a2726498e3cf9c51` |
| deploy production cleanup test | passed | `/tmp/partsignal-i04-test-deploy-production-cleanup.log` | `22d94cd0bddc580d9aa2112e89f28b8b3c40b2af6ef89b69e5dde64422fdd48b` |
| deploy production test | passed | `/tmp/partsignal-i04-test-deploy-production.log` | `e5ca00cf2fdd647e3b998fc42d10a212c043012e02f54b884b6b2c9d166246c7` |
| CLI unit | `4 passed` | `/tmp/partsignal-i04-pytest-cli.log` | `f6e6b8418565fbd6476bef4cd4eea6509c221f48d795a78ffe3933df059705b7` |
| Production Compose config | passed | `/tmp/partsignal-i04-compose-config.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| shell/Python syntax | `17 shell / 2 Python` | `/tmp/partsignal-i04-syntax.log` | `b09fa319357c0301cc3ddda0fec1ef52ddbe4274b3f0d8c61b974a8f2ca7564e` |
| diff/clean tree | passed | `/tmp/partsignal-i04-git-diff-check.log` | `0eab04424246f43275470005c9150cae8074b8de5e657b6fd983f195329388d1` |
| pattern secret scan | `2,415 tracked files / 0 high-signal findings` | `/tmp/partsignal-i04-secret-scan.log` | `90b456489ecd3dfb49a713e782131b94e143bd6fce2e35355f43be5523139a4f` |

I03 `make verify` 复用仍成立：`387b802d` 到 `f91b98b5` 的产品代码、部署配置和依赖没有变化；新增差异仅为 I03/I04 Trellis 与会话记录。本轮没有把 I03 日志当作 Hostdzire 部署证据。

### Hostdzire 只读 inventory

- OpenSSH alias `hostdzire` 正常通过既有 host-key 校验；主机 `scrapy`，x86_64，Docker `29.4.1`，Compose `5.1.3`，Nginx `1.29.8`；根盘约 105 GB、可用约 38.7 GB，内存约 6.2 GB、可用约 2.3 GB，无 swap。
- 当前 `/root/partsignal/current` 指向 `releases/mvp-20260830-133651-a663bcce`；该 checkout 为 clean `main@a663bcce9fd49da9c5aea7f257372fc318447234`。远端没有 release manifest 文件。
- `partsignal-staging` 当前运行 postgres、redis、api、worker、scheduler、frontend、fake-oss；健康检查存在的五个 service 为 healthy、restart count 均为 0。当前 migration 为 `0043_geo_platform_identity (head)`。
- 当前 Frontend image 为 `partsignal-frontend:mvp-20260830-133651-a663bcce`，image ID 与 RepoDigest 均为 `sha256:c0826f2a31e30d160252c1385e6b2b14d3fcfc58ec49692b0202cb45533dca1e`；历史 production frontend image 也有非空 RepoDigest，但没有 manifest 证明其为当次已验证 rollback identity。
- 19000、19001、19080 均仅监听 `127.0.0.1`；fake-oss 正在运行并挂载 `/root/partsignal-data/objects`，符合“当前仍是旧 staging 运行态”，不符合进入 Production 的最终态。
- Nginx enabled target 为 `/etc/nginx/sites-enabled/partsignal-staging.conf -> /etc/nginx/sites-available/partsignal-staging.conf`，SHA-256 `ea41efdb6c3b1535eaa3aa07a652f55b915002a8a792ed129b8f437907aea982`，`nginx -t` 通过；当前配置仍包含 19001 和 `/object-storage/`。证书有效期为 2026-08-31 至 2026-11-29，续期 owner 是 root-owned `/etc/cron.d/certbot`。
- postgres、redis、objects 和预期 quarantine parent 均在 device `2049`；quarantine root 尚未创建，但其 parent 与活动数据同 device。活动三目录均为普通目录、非 mountpoint、非 symlink。
- `/root/partsignal/shared/.env.production` **不存在**；只有 `.env.staging`。因此无法验证权限 `0600`、Production 安全键状态、真实 AI/OSS 配置或执行 Production preflight。

只读证据日志：

- core inventory：`/tmp/partsignal-i04-hostdzire-inventory-core.log`，SHA-256 `90cce087650b9f857e32ef27683493fc00e36c5d1f036113913a4bbced444085`
- corrected container inventory：`/tmp/partsignal-i04-hostdzire-containers.log`，SHA-256 `17c738a8649ac065e32bc7b12668aab5bad75351f8e28b68b01202fda3927efc`
- Nginx/data/env：`/tmp/partsignal-i04-hostdzire-nginx-data-env.log`，SHA-256 `e0fcb893b7ad367a5671641e02eb8725f10a79884e1add4c5329935d690b5986`
- certificate/image inventory：`/tmp/partsignal-i04-hostdzire-certs-images.log`，SHA-256 `7d0fe0107037e7c84fce526c6d5b250b8e77cacc59666bfd538de63afcb68df5`
- final identity inventory：`/tmp/partsignal-i04-hostdzire-final-inventory.log`，SHA-256 `dc00e08e46ff630439480dc7b2be36f4e0220c2f273e70774e975f8d06779e91`
- current checkout identity：`/tmp/partsignal-i04-hostdzire-current-git.log`，SHA-256 `2d1f6d29d49f43a559f3c310013c2d72d51ead3efbc16358d47d53ccd07a462a`

### Blocker and recovery point

停止条件为 `PRODUCTION_ENV_MISSING`：固定路径 `/root/partsignal/shared/.env.production` 不存在。根据用户明确停止条件与 runbook，不能从 `.env.staging` 复制、猜测、打印或合成 Production 值，也不能继续构建/上传 release、生成 manifest、安装维护配置、停止容器或 quarantine 数据。

恢复 I04 前需要由凭据 owner 在 Hostdzire 受控创建普通、非 symlink、权限 `0600` 的 `.env.production`，并确保 Production-only 安全配置和真实 AI/OSS 凭据完整；同时需要明确并验证上一份 V2 rollback frontend identity（最好以不可变 manifest 或等价审计记录固定）。下一会话从 Hostdzire 只读预检重跑开始，不复用本次缺失 env 的 Configuration Gate 结论。

## 2026-09-27 I04-1 continuation

- child：`.trellis/tasks/09-26-frontend-i04-1-production-config-rollback-identity/`，status=`in_progress / blocked_remote_precheck`。
- target `.env.production` 仍不存在；shared parent 与 `.env.staging` metadata 安全，未执行远端写入。
- 脱敏 source inspection 证明 staging 为 development object storage、没有 `OSS_ENDPOINT`、OSS AccessKey ID/secret 均未配置；因此触发 `PRODUCTION_OSS_CONFIGURATION_SOURCE_MISSING`，不能生成部分 Production env 或猜测真实 OSS 输入。
- sanitized log：`/tmp/partsignal-i04-1-hostdzire-config-precheck.log`，`1447` bytes，SHA-256 `d5c3bf92b888d19f08ffbd9fa8e61fcbb4705f09da71c2df348b72f26ece8929`。
- Settings/CLI preflight、Compose config、rollback identity freeze 与 critical review 均因前置配置不成立而未运行；release/manifest/maintenance/container/data/Nginx 仍未触碰。
- 恢复条件：credential owner 通过 Hostdzire 本机安全渠道 provision 可验证的真实 Aliyun OSS endpoint、bucket 和 AccessKey 输入，不通过聊天传递；随后重新执行 I04-1 的 target-absent precheck。

### I04-1 resume attempt

- main 工作区 `.env` 已有 bucket 与 AccessKey，文件权限从 `0644` 收紧为 `0600`；但 `OSS_ENDPOINT` 仍缺失，已有 development storage endpoints 为非 HTTPS、非 Aliyun host。
- candidate `.env` 与 Hostdzire shared/current env 也没有可用 endpoint；Production env fresh check 仍 absent，remote writes=`none`。
- blocker 更新为 `PRODUCTION_OSS_ENDPOINT_MISSING_OR_UNSAFE`。脱敏日志 SHA-256=`9b66d168257df73b52a462bf108eb45a3ccf3b377ebdecb85a3c7fe57dd8d1f2`。

### I04-1 controlled creation, validation, and critical review

- credential owner 后续在 Git-ignored、`0600` 的 main `.env` 补齐真实 Aliyun OSS 四项；值未进入对话、Trellis 或普通日志。`/root/partsignal/shared/.env.production` 已受控创建，当前为 `root:root 0600` 普通非 symlink 文件，`1480` bytes，SHA-256=`413092ab3459ca8c1198a1b352eca8009ff1bc965916073d002d2be4cdab6eba`。
- Production Settings、`python -m app.cli preflight-production-config`、Compose `config --quiet` 与 secret scan 通过；这些仅为 Configuration Gate，External Services Gate 仍为 `NOT_RUN`。
- rollback frontend 已冻结为 `partsignal-frontend:mvp-20260830-133651-a663bcce` / image ID `sha256:c0826f2a31e30d160252c1385e6b2b14d3fcfc58ec49692b0202cb45533dca1e` / RepoDigest 同 digest / `linux/amd64` / source `a663bcce9fd49da9c5aea7f257372fc318447234`，且 I04 完成前不得删除、retag 或覆盖。
- fresh critical review audit `20260927T133013Z-i04-1-production-config-rollback-review-922379db` 结论为 `BLOCKER`：`AI_CREDENTIAL_BOOTSTRAP_PATH_UNREACHABLE` 与 `PRODUCTION_ENV_CREATION_PROVENANCE_INCOMPLETE`。前者是 maintenance Gate 前没有可执行的 HTTPS AI credential owner 写入路径及安全 seed-admin handoff；后者是未保存实际 creator/validator 源码、精确脱敏调用方式与源码摘要，无法独立证明原子创建和随机源实现。
- I04-1 与 I04 均保持 `in_progress / blocked_high_risk_review`；不创建 release/manifest，不进入 maintenance、clean-init、activation 或任何容器/Nginx/数据修改。

### I04-1R remediation in progress

- 已建立 child-of-I04-1：`.trellis/tasks/09-27-frontend-i04-1r-bootstrap-provenance/`。
- 原 creator、validator、final secret-scan tool-call input/output 已从 session `01a0e19e-6636-75c2-a8a8-2703a2afe050` 恢复并固定 call ID、session SHA-256 和 evidence SHA-256；真实 OSS 值 evidence match=`0`，没有重建或覆盖 Production env。
- 经独立只读架构分析，冻结为 `prepare-production-data.py bootstrap-ai` + backend `bootstrap-production-ai`：deploy state owner 在同一锁内证明候选和阶段，host TTY no-echo credential 经 stdin pipe 注入，backend 按 T1 创建 / T2 真实测试 / T3 启用执行。
- I04-1R 只修改本地代码、测试、runbook/spec 与任务记录；未执行 Hostdzire、provider、release、manifest、maintenance、container、Nginx、数据库或活动数据操作。
- 在目标测试与 fresh critical review 得到 `NO BLOCKER` 前，I04-1 和 I04 继续保持 `in_progress / blocked_high_risk_review`，External Services Gate=`NOT_RUN`。

### I04-1 / I04-1R closure

- I04-1R 最终通过 backend unit `28 passed`、真实 PostgreSQL integration `16 passed`、完整 deploy regression 与 conclusive fresh critical review `NO BLOCKER`；audit ID=`20260927T141144Z-i04-1r-bootstrap-provenance-9918acde`。
- 两项原 blocker 已关闭，I04-1 与 I04-1R 均 completed；I04 进入 `in_progress / configuration_ready`。
- Repository Release Gate 因代码、runbook 与任务记录输入已变化仍为 `STALE_INPUT_CHANGED_NOT_RERUN`。下一步先完成 Git 收口，并在最终 clean main 上重新建立 Gate；随后才创建 I04-2、冻结 release/manifest 并执行实际 clean-init cutover。
- 本轮没有创建 release/manifest，没有进入 maintenance，没有停止或重建容器，没有修改 Nginx/数据库/活动数据，没有运行真实 provider 或 External Services Gate。

## 2026-09-28 final local closure and Repository Release Gate

### Git closure

- I04-1/I04-1R 产品代码、部署脚本、规范和 Trellis 记录收口为 `3de9d10ca7d52eb97a95ee29fd01994009f626fa`，并以 non-force fast-forward 推送 `main`。
- byte-exact creator/validator/secret-scan evidence 触发 `blank-at-eof` 范围检查后，使用三条路径精确的 `.gitattributes` 规则保留原始 blob；最终候选为 `e53b655b75b6d3418a96307d28f305c6bdb8245a`，tree `363c1e49f70c3595f44e5fe8568147ee09620200`。
- `main == origin/main == candidate HEAD`，两个工作树 clean；`git diff --check d20ecffa..e53b655b` 退出 `0`。identity/diff 日志 `171` bytes，SHA-256=`c6b32886b42ae4aa9e71df3fe0bafeb7ed428aecdbdd99ac5aa8e218ee83e1a8`。

### Fresh Repository Release Gate

- 同一最终候选完整 `make verify` 退出 `0`：backend unit `691 passed`、frontend Vitest `91 files / 848 tests`、PostgreSQL integration `344 passed`、real-stack `21 passed`、fixture E2E `494 passed / 44 skipped`，backend/frontend production build、container/lifecycle、DB lifecycle、post-run secret、staging/production deploy 与 dev/prod Compose config 全部通过。
- 完整日志 `/tmp/partsignal-i04-final-make-verify-4.log`，`231858` bytes，SHA-256=`6f9fc122b1ac763f7e740c934cb04f40437fefa6e70cc2bb3752c1020a36395a`。
- 先前一次 real-stack A→B→A 用例 90 秒超时后，定向复验 `5 passed`、secret clean、cleanup 完整；日志 SHA-256=`2d672bd267ac4477ea3fc4a42cdd480190865a3a7fe54486ed2b6d4defb1df97`。随后完整 `make verify` 在未变更候选上通过；更早两次失败分别来自缺少本地 DB/Redis 调用环境和错误注入整份 development env，均未被作为成功证据。
- final tracked secret scan：`2434` tracked files，通用高信号与本机真实 OSS endpoint/AccessKey exact match 均为 `0`；日志 `205` bytes，SHA-256=`234b9058cfbdf889c4af0373d81d1c2ed3c0459f3fc48d6d0b32e661de9ac323`。
- fresh independent high-risk review audit `20260928T013736Z-i04-git-closure-and-repository-release-gate-0cca1364` 结论为 `NO BLOCKER`。Repository Release Gate 更新为 `MET`。
- 该 Gate 不代表 Remote Preparation、真实 provider、release/archive/manifest、maintenance、clean-init、External Services、activation、生产验收或 Observation 已运行；这些仍为 `NOT_RUN`。

### I04-2 handoff

- 已建立 child `.trellis/tasks/09-27-frontend-i04-2-release-freeze-clean-init-cutover/`，I04 与总体前端任务继续 `in_progress`。
- I04-2 先完成本批 Trellis-only 记录的 commit/push 与最终 clean identity/diff/secret scan；完整 `make verify` 仅在变更严格限于 `.trellis` 且 release archive 继续受 `export-ignore` 排除时复用。
- 在 release/archive/image/manifest identity、远端只读 precheck、credential-owner TTY 路径与逐条命令冻结并通过 fresh pre-cutover critical review 前，不进入 maintenance，不停止容器，不 quarantine 或 clean-init。

## I04-2A 完成记录（2026-09-28）

child `09-28-frontend-i04-2a-compose-network-identity-remediation` completed，network identity 已修复。新完整 Repository Gate source `6c88563cce6edbce4b18fb010a840329600e69ee`，一次 make verify exit=0，253005 bytes，SHA-256=`1ba1e84ab20a5fd972c5b546f6a454fefa58bfc40ded2fce391433ac0416dc86`；两次 fresh critical review NO BLOCKER，audit=`20260928T035743Z-i04-2a-compose-network-identity-cec3f231`；受控资源归零/secret scan clean。旧 network blocker 是历史失败原因；本任务继续 in_progress，I04-2 stage=network_identity_remediated。旧冻结 release/archive/images/manifest 不变且不可复用，未生成新 release、进入维护或执行任何 cutover；本轮无远端写入。详细计数、日志、警告和 source continuity 合同见 child implement.md。

下一会话先解决真实 AI provider 非 secret metadata 和 credential owner true-TTY handoff；随后使用全新 commit/release ID/run ID/archive/image tags/manifest 冻结 release，并重新执行 pre-cutover review/cutover。

## 2026-09-29 I04-3 开发预览实际收口

- 目标环境来自 `11` 的“按届时目标环境重新定义候选”合同。用户当前授权开发预览，首次部署 child `09-29-development-preview-first-deploy` 为 `completed`；运行 source commit `4e85aaf9f8c4f96dc121658f08ca49aa74810409`，release `preview-20260929-082104-4e85aaf9`。
- 完整 `make verify` exit `0`，233,517 bytes，SHA-256 `d9566bb2d4fcc2a3a989c8f2c11cdddc23f174ba04e66e4aed2cd3d8ec74f24d`；最终独立只读复核 `NO BLOCKER`，audit `20260929T082204Z-development-preview-first-deploy-2ff4b279`。其后至 `66976eb0` 仅修改四个 Trellis 首次部署记录文件与 `docs/development-preview.md`，没有运行、依赖、构建、Compose 或部署输入变化，因此复用门禁，不重跑 `make verify`。
- I04-3 于 `2026-09-29T16:46:03Z` 经 alias `hostdzire` 只读复查 exit `0`：current/release/archive、七容器、三网络、公网四路径精确 200/六项安全头、pending/Nginx、其他九容器和历史失败冻结证据一致。脱敏详细结果 6,898 bytes，SHA-256 `d00dd33aa87ea0f93c6af58458a34628222609c12d02813f2c8601395055d668`，路径 `/Users/sc/.codex/audits/i04-3-development-preview-closeout-20260929/remote-readonly.json`；检查 receipt 546 bytes，SHA-256 `18b978d669f3d4a85314d41a5cd149ec2d135fa37456f30c89976cd071a41bbb`。
- I04-2 以 `outcome=SUPERSEDED_BY_AUTHORIZED_DEVELOPMENT_PREVIEW_TARGET` 终止；失败冻结 release `mvp-20260928-023635-649641cec3bd` 仅历史证据，未复用、覆盖或 retag。Production maintenance/quarantine/clean-init/AI bootstrap/External Services Gate/activation/observation 都是 `NOT_RUN`。
- 当前运行时使用确定性 AI 与开发 fake-oss；真实 AI 和真实 Aliyun OSS 未接入、未验证，Production cutover 未执行。这些是后续另行授权的覆盖缺口，不是开发预览完成的阻断项。

I04-3 的完整输入、状态和收尾验证见其 `implement.md` 与 `task.json`。原 Production 路线的历史“下一步”由本次授权目标取代，不应继续执行。
