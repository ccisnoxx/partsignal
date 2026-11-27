# I04-3 执行记录

## 执行顺序

1. 本地身份、差异、任务树与旧候选工作区前置核对。
2. Hostdzire 固定目标只读复查，并与首次部署证据比较。
3. 核对完整门禁日志及最终独立复核；若发现输入或远端实质漂移，记录 blocker 后停止。
4. 关闭被取代的旧 Production 路线；更新 I04 与总体任务的实际目标、状态和覆盖缺口。
5. JSON、diff、tracked secret scan 与 Git 范围检查；一次记录提交、非强制 push、最终身份及旧候选复核。

## 本地基线与门禁连续性

- 2026-09-29 开始前，权威工作树 clean；`HEAD=main=origin/main=66976eb05dcc153f60bcca334f96076e82da6c71`。远端 `refs/heads/main` 只读 `git ls-remote` 同值。旧候选工作区 `HEAD=975ea0f05a2a4bd7a3c62e7de41902c6408d043f`、clean，仅检查未修改。
- `4e85aaf9f8c4f96dc121658f08ca49aa74810409..66976eb0` 的 `git diff --name-only` 精确为首次部署 task 的 `prd.md`、`design.md`、`implement.md`、`task.json` 与 `docs/development-preview.md` 五个文件；`git diff --check` exit `0`。产品运行、依赖、构建、Compose、Nginx 与部署脚本输入未变化。
- R00–I03 和已完成 I04 子任务的 JSON 实查：总体任务的 98 个原后代中 96 个 `completed`，仅 I04 与旧 I04-2 为 `in_progress`；首次开发预览部署为 `completed`。I04-3 建立后是第 99 个后代。
- 首次部署 `make verify` 结果文件 `/Users/sc/.codex/audits/development-preview-deploy-20260929/make-verify-final-result.json` 记录 exit `0`、831.434 秒、233,517 bytes，完整日志 SHA-256 `d9566bb2d4fcc2a3a989c8f2c11cdddc23f174ba04e66e4aed2cd3d8ec74f24d`。backend unit 691、PostgreSQL integration 344、frontend Vitest 848、real-stack E2E 21、browser E2E 494 passed/44 skipped、secret artifact scan clean。
- 独立复核 audit `20260929T082204Z-development-preview-first-deploy-2ff4b279` 的 manifest 为 `closed`、verification=`passed`、0 anomalies；最终 `critical_reviewer` 派发在验证的 digest 中为 accepted/independent/read-only。首次部署 task 记录的最终结论为 `NO BLOCKER`。本轮没有重新运行完整门禁或伪造新的 reviewer 结论。

## Hostdzire 只读复查

- SSH alias `hostdzire`，最终检查 `2026-09-29T16:46:02Z`–`16:46:03Z`，SSH/检查退出码 `0`。脱敏原始日志：`/Users/sc/.codex/audits/i04-3-development-preview-closeout-20260929/remote-readonly.json`，6,898 bytes，SHA-256 `d00dd33aa87ea0f93c6af58458a34628222609c12d02813f2c8601395055d668`；receipt：同目录 `readonly-check-receipt.json`，546 bytes，SHA-256 `18b978d669f3d4a85314d41a5cd149ec2d135fa37456f30c89976cd071a41bbb`。仅使用远端只读 Docker inspect、固定文件哈希/链接、`nginx -t` 与公开 HTTPS GET；未读取 env 值或业务数据。
- `current -> releases/preview-20260929-082104-4e85aaf9`，预览 archive SHA-256 `766f65d2d9bb42aa244722e6315ac561545fe87bef97ac3df5800093b11ed6c4` 与首次部署一致。七个项目容器 ID/image 与激活后快照逐项相同，均 running、restart `0`、OOM false、一时容器 `0`；API/PostgreSQL/Redis/worker/scheduler 的 health 为 healthy，Frontend/fake-oss 无 healthcheck。
- 三组网络 `partsignal-staging-internal/egress/edge` 物理名与 `com.docker.compose.network` 逻辑 label 精确一致，internal 组仍为 internal；网络 ID 未漂移。其他非项目九个容器的 ID、运行、restart/OOM 与 StartedAt 均未改变。
- 公网 root、JS asset、`/api/health/live`、`/api/health/ready` 全部精确 200，六项安全响应头逐项匹配权威 snippet；ready body 仅检查 PostgreSQL/Redis 状态均 `ok`，不记录正文。pending marker 不存在；enabled Nginx target 和站点 SHA 未漂移，`nginx -t` exit `0`。
- 历史失败冻结 release 目录、archive（SHA-256 `d51eb7ad0b703931a417f8233444a0d2ceafa39055656a5f46c95c6277dce250`）、manifest（SHA-256 `d9fc3543d2dd73523c0b436d956e22a3f94e61bae19b005aeb2fbecbe55e1ad9`）及其 backend/frontend 两个镜像原 ID/tag/RepoDigest 仍存在且未覆盖。更早 rollback frontend 镜像 `c0826f2a` 已在 09-28 用户授权环境清理时移除，不属于当前保留的两个冻结镜像，旧 manifest 不可作为当前 rollback package 复用。
- 前两次预备检查脚本各 exit `1`：第一次错误要求更早 rollback tag 仍在，第二次错误假定 git archive 解包 release 目录有 `.git`。两者是本机只读检查器假设错误，未发现线上写入或漂移；依据 09-28 清理记录和首次部署 archive 合同修正后，最终检查 exit `0`。这两次不计为通过。

## 状态校正与覆盖缺口

旧 I04-2 路线以 Trellis 支持的终止状态 `completed` 关闭，但 `outcome=SUPERSEDED_BY_AUTHORIZED_DEVELOPMENT_PREVIEW_TARGET`、`production_cutover=NOT_RUN`、`external_services_gate=NOT_RUN` 明确阻止解释成 Production 成功。I04 当前目标按 `docs/frontend-v2/11-frontend-redevelopment-task-list.md` 定义为 Hostdzire 开发预览。该预览运行确定性 AI 和开发 fake-oss；真实 AI、真实 Aliyun OSS 和 Production cutover 未接入、未验证。Production maintenance、quarantine、clean-init、AI bootstrap、External Services Gate、activation、observation 均未执行。

## 收尾记录验证（提交前）

- `2026-09-29T16:53:27Z`–`16:53:28Z`：16 个拟提交文件全部属于 I04-3、旧 I04-2、I04/总体任务记录与两处因状态变化过期的前端计划段落；没有 env、日志、Key 或其他敏感文件被暂存。四个修改的 `task.json` 均可解析，99 个总体任务后代全部为 `completed`。语义与范围日志 `/Users/sc/.codex/audits/i04-3-development-preview-closeout-20260929/json-scope-validation.log`，exit `0`，1,522 bytes，SHA-256 `1197337b56cf1b6582d8ffb7593e48b202274dd64b45e209c319b41172acb77c`。
- `git diff --cached --check` exit `0`、0 bytes、SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；日志同目录 `staged-diff-check.log`。
- tracked/unignored secret pattern scan：2,476 个普通文件、0 high-signal findings，exit `0`，47 bytes，SHA-256 `3319af151d762708e2184dd66dea56d21a2630a2a8ac16fcc1265ca27d4a7ae5`；日志同目录 `tracked-secret-scan.log`。暂存新增行 credential assignment shape 检查 296 行、0 finding，exit `0`，132 bytes，SHA-256 `95d58745680b05cd3adc6517bd2a71a1ead18b33bbe30184dadcba23462fe626`；日志同目录 `added-lines-secret-shape.log`。检查器没有读取远端 env 值，日志不包含凭据。

该轮验证后仅补充本段验证事实和稳定文档两处过期入口措辞；最终暂存内容仍须在提交前复查。非强制 push 与最终 Git/旧候选身份由提交后只读核对，不能预先当作已通过。
