# I04-2 执行记录

## 恢复点

- 父任务：`.trellis/tasks/09-27-frontend-i04-release-deployment/`，status=`in_progress / i04_2_release_freeze`。
- 产品候选：`e53b655b75b6d3418a96307d28f305c6bdb8245a`，tree `363c1e49f70c3595f44e5fe8568147ee09620200`。
- fresh Repository Release Gate：`MET`；完整 `make verify` SHA-256=`6f9fc122b1ac763f7e740c934cb04f40437fefa6e70cc2bb3752c1020a36395a`；fresh high-risk review audit `20260928T013736Z-i04-git-closure-and-repository-release-gate-0cca1364`=`NO BLOCKER`。
- Production env 已在 `/root/partsignal/shared/.env.production` 受控创建并通过 I04-1 Configuration Gate；rollback frontend identity 已冻结；真实 External Services Gate 尚未运行。

## 当前阶段

`LOCAL_RECORD_CLOSURE`。本目录和父/总体任务的 Gate 记录是本批唯一预期变更；提交并 push 后必须重新固定最终 Git identity、range diff、clean trees 和 tracked secret scan。

## Pending evidence ledger

- final release source commit/tree
- local closure commit/push、diff/identity/secret-scan 日志与 SHA-256
- remote read-only precheck 日志与 SHA-256
- release ID、run ID、archive path/bytes/SHA-256
- backend/frontend reference、image ID、全部 RepoDigest、platform
- manifest path/mode/owner/bytes/SHA-256
- pre-cutover review audit ID/verdict
- maintenance/final Nginx config checksum、backup、`nginx -t` 与 reload
- T0、quarantine paths、deploy-state timeline
- Production prepare、AI bootstrap、真实 AI/OSS Gate、activation 与 acceptance 日志
- observation samples、post-observation review 与保留/清理清单

除固定枚举、脱敏状态、hash 和不可变 identity 外，不记录任何 secret。

## 2026-09-28 actual release freeze

### Final local closure

- Trellis-only commit `649641cec3bdd62fa612021f0841970f99d31dfb` 已 non-force fast-forward push；tree=`90886aece059f12d072c327148911de7d528740d`。
- `main == origin/main == candidate`，两个工作树 clean，`git diff --check d20ecffa..649641ce` 通过。日志 `243` bytes，SHA-256=`719b86e166e8353dabe2a7385f59e2af4064aed8a1f75b7b80cc6d868eb77773`。
- corrected tracked scan：`2440` files、四类 OSS 输入 configured、high-signal=`0`、敏感 endpoint/AccessKey exact match=`0`；两处非 secret bucket 字符串 overlap 单独记录。日志 `142` bytes，SHA-256=`7b55c08f76b7a6417c86e4f16fe5f8017e6b8feade699385321fd8d935ea6206`。
- `e53b655b..649641ce` 严格只有 `.trellis`，且 `.trellis` 受顶层 `export-ignore` 排除；完整 `make verify` 证据继续绑定未变化的 exported product/deploy 输入。

### Hostdzire precheck and frozen artifacts

- fresh precheck：host=`scrapy`、`linux/amd64`、Docker `29.4.1`、Compose `5.1.3`、Nginx `1.29.8`；remote main 与 `649641ce` 一致；候选 release/archive/manifest/tags 在创建前均 absent。
- Production env 保持普通非 symlink `root:root 0600`，`1480` bytes，SHA-256=`413092ab3459ca8c1198a1b352eca8009ff1bc965916073d002d2be4cdab6eba`；未读取或输出任何值。
- release ID=`mvp-20260928-023635-649641cec3bd`；run ID 预留=`prr_20260928_023635`，尚未写入 cutover state。
- release checkout=`/root/partsignal/releases/mvp-20260928-023635-649641cec3bd`，clean `main@649641ce`。
- source archive=`/root/partsignal/releases/mvp-20260928-023635-649641cec3bd.tar.gz`，`1903548` bytes，mode `0600`，SHA-256=`d51eb7ad0b703931a417f8233444a0d2ceafa39055656a5f46c95c6277dce250`。
- backend=`partsignal-backend:mvp-20260928-023635-649641cec3bd`，ID/RepoDigest=`sha256:095b31d1065db7da74cde93b9cde52e491895fc39033d64c873f91a55ac111a5`，platform=`linux/amd64`。
- frontend=`partsignal-frontend:mvp-20260928-023635-649641cec3bd`，ID/RepoDigest=`sha256:c39f66dfb58568e471480dde019e78cd2c93dfbee00cb38f3895e64905569b42`，platform=`linux/amd64`。
- rollback frontend 保持 `partsignal-frontend:mvp-20260830-133651-a663bcce` / `sha256:c0826f2a31e30d160252c1385e6b2b14d3fcfc58ec49692b0202cb45533dca1e` / `linux/amd64`。
- manifest=`/root/partsignal/releases/mvp-20260928-023635-649641cec3bd.manifest.json`，普通非 symlink `root:root 0600`，`2258` bytes，SHA-256=`d9fc3543d2dd73523c0b436d956e22a3f94e61bae19b005aeb2fbecbe55e1ad9`；archive/images/schema/8 个 tracked file identity 均由 producer 验证。
- release build 日志 SHA-256=`4ae3d1b4f5c77b009a2ffd2f7a5ce0997e64ad49913a20b7f1dd8b4ea04b01fc`；manifest/config 日志 SHA-256=`4cc78abeb97d2e99636e2750e561999165a999ad0375694f9891203f7b343778`。
- candidate backend 隔离式 `preflight-production-config` 与 frontend `nginx -t` 通过；日志 SHA-256=`f9e07565bdddc5872463ef8c80dc07f4d4cd9cc7f281e46f99359eb5459a2ccb`。这是结构验证，不是 External Services Gate。

### Pre-cutover blocker

- Production Compose `config --quiet` 通过，但首次 Engine-backed `run --rm --pull never --no-deps api` 在创建容器前失败：线上物理 network `partsignal-staging-internal` 的 `com.docker.compose.network=partsignal-staging-internal`，而 `deploy/compose.prod.yaml` 对同一物理 network 期望逻辑键 `partsignal-internal`。
- egress/edge 同样分别是 `partsignal-staging-egress/edge` label，而 Production Compose 使用 `partsignal-egress/edge`。因此 `deploy.sh` 的 postgres/redis、API/frontend，`activate-production.sh` 的 worker/scheduler，以及 frontend rollback 都会触发同类错误。
- Docker 不能原地修改 network label；权威脚本固定 project/Compose 文件。不存在“不改部署合同、不删除或重建现有 network”的合规绕行路径。
- fresh critical reviewer `/root/i04_2_network_pre_cutover_review` verdict=`BLOCKER`。最小修复是把 Production Compose 三组逻辑键和 service 引用统一为既有 `partsignal-staging-*` 逻辑键，补真实 network label compatibility 回归，并修正文档 preflight 的 manifest identity/`--pull never --no-deps` 合同。
- 该修复会修改 manifest tracked deploy input；当前 Repository Release Gate、archive、images 和 manifest 随即失效。恢复时必须使用新 commit、新 release ID、新 archive/images/manifest；不得覆盖、retag 或删除本轮冻结证据。
- 当前旧数据库 AI channel/model/header counts 均为 `0`，本地 `.env` 也只有结构型 AI key；真实 provider 的非 secret metadata 和 credential-owner true-TTY handoff 尚未提供，是 maintenance 前的另一未满足条件。API Key 不得进入聊天。

### Fail-closed state

- post-failure evidence：旧 7 个容器均继续运行，restart=`0`、OOM=`false`；one-off=`0`；`current`、Nginx target/checksum、Production env hash 均未漂移；public root=`200`；quarantine 与 cutover state 均 absent。日志 SHA-256=`8d328dc40db2a36d94d07712e5412dde8b010a1649f240d0fb61097efe9d8d82`。
- maintenance、container stop、Nginx write/reload、quarantine、clean-init、AI bootstrap、真实 AI/OSS Gate、activation 和 Observation 全部=`NOT_RUN`。
- 当前阶段=`BLOCKED_PRE_CUTOVER_COMPOSE_NETWORK_IDENTITY`。按停止条件不在本 task 内临时修改部署合同。

## I04-2A 完成记录（2026-09-28）

child `09-28-frontend-i04-2a-compose-network-identity-remediation` completed，network identity 已修复。新完整 Repository Gate source `6c88563cce6edbce4b18fb010a840329600e69ee`，一次 make verify exit=0，253005 bytes，SHA-256=`1ba1e84ab20a5fd972c5b546f6a454fefa58bfc40ded2fce391433ac0416dc86`；两次 fresh critical review NO BLOCKER，audit=`20260928T035743Z-i04-2a-compose-network-identity-cec3f231`；受控资源归零/secret scan clean。旧 network blocker 是历史失败原因；本任务继续 in_progress，I04-2 stage=network_identity_remediated。旧冻结 release/archive/images/manifest 不变且不可复用，未生成新 release、进入维护或执行任何 cutover；本轮无远端写入。详细计数、日志、警告和 source continuity 合同见 child implement.md。

下一会话先解决真实 AI provider 非 secret metadata 和 credential owner true-TTY handoff；随后使用全新 commit/release ID/run ID/archive/image tags/manifest 冻结 release，并重新执行 pre-cutover review/cutover。
