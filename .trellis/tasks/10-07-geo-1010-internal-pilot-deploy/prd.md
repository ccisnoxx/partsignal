# GEO-1010-DEPLOY：部署 MANUAL GEO 内部试运行环境

## 基本信息与执行门禁

- 展示 ID：GEO-1010-DEPLOY；Trellis ID/slug：`geo-1010-internal-pilot-deploy`。
- 初始状态：planned；必须等待 GEO-1009 done、GEO-1010-UI done。不得和 UI 并行部署，不增加第四个任务。
- 2026-10-07 UI已获[人工接受](../../../docs/geo-monitoring/06-reviews/2026-10-07-geo-1010-ui-acceptance.md)并done，GEO-1009/UI依赖满足；当前会话用户授权开启DEPLOY会话，任务转为ready。该启动授权不补足下述精确目标、阶段与恢复输入。
- 父任务：[GEO-1010](../10-07-geo-1010-manual-pilot/prd.md)。
- 目标：将通过候选门禁的固定 main 部署至获批内部 UAT/Pilot，证明安装、迁移、启动、登录和 MANUAL 主链路可用。
- 任务规划不授予目标环境写入权限。执行前必须记录获批环境/namespace/入口、操作范围与阶段、操作者及业务/运维/停止恢复负责人；未获批准或缺身份/恢复输入时不得部署。

## 已选目标与现场核对（当前）

用户选定Hostdzire现有站点，并随后明确纠正：**不需要隔离之前部署的，也不需要保留数据，因为是推到重来**。本次沿既有`hostdzire` SSH别名与`geo.962850.xyz`清空旧PartSignal数据并新装，不再走保留数据升级；旧postgres/redis/objects内容丢弃已获明确指示，不重复索取保留/清空选择。

2026-10-08T01:34–01:36Z（当地2026-10-07）只读核对确认现有preview/0043、Production配置引用和匹配网络，见[低敏inventory](./evidence/hostdzire-existing-site-inventory.json)。旧状态缺失及0043存量升级不再作为本次阻断；正在补齐不依赖quarantine/previous V2的显式fresh-init路径，范围、输入与进度见[清空重建准备](./hostdzire-fresh-rebuild.md)。受保护runtime/TLS与其他项目不在清理范围。

## 当前交付与移交

GEO-1009 只接受固定 `e5949ab66989c1277424cfe9ab8b93e10ce10046` 的完整 main 门禁验证，详见[人工接受](../../../docs/geo-monitoring/06-reviews/2026-10-07-geo-1009-main-gate-acceptance.md)。本任务接管未完成的 source archive、正式镜像身份、release manifest、schema/hash、候选冻结和恢复输入。后续已固定源码候选76d1d523并完成完整门禁、archive/hash；正式images/manifest与完整release冻结仍未完成，未部署。源码通过不代表目标已验证。

## 范围内

1. UI done 后 fetch 并确认 clean、HEAD=origin/main，固定完整 main commit；执行或核实该候选所需的现有完整门禁，记录具体 SHA/命令/结果。输入变化后不能把旧 SHA 的通过直接用于新候选；同一候选已成功且未受影响的证据按项目规则复用。
2. 同身份冻结 source archive、backend/frontend 及适用 migrate/worker/scheduler 镜像、正式 digest、唯一 schema head、tracked-file hashes、release manifest；记录环境标识、部署时间、操作者。复用当前 producer/consumer，不伪造 repository/digest，不使用测试绕过或覆盖已冻结工件/tag。
3. PostgreSQL、Redis、API、Frontend、Worker、Scheduler与内部对象存储范围。按用户批准的fresh-init清空重建，在状态owner下认证新候选、静止旧project、清空固定三个数据目录内容，再从空库前滚到唯一head、初始化新内部账号并验证readiness/smoke；不伪造quarantine/initialized历史，不手工Compose绕过，不downgrade。
4. 部署后人工 smoke：登录；创建或读取产品；监测对象；问题；MANUAL Plan；Batch/Run；保存草稿；上传截图；提交回答；Worker 分析；人工复核；Overview/Insights/Reports；管理员评估页面；Action 和 Retest 页面入口。只使用获批内部 smoke 数据，无需开发者手改数据库。
5. 运维最小闭环：日志、health、停止 Worker、重启服务、数据库与对象证据备份、可执行恢复/安全停止步骤、明确内部访问边界。保留旧 GEO-906/904/905 的现场未知，新目标证据单独绑定候选/环境/时间。

## 配置基线与 Scheduler

以下名称已按 `backend/app/config.py` 和当前公开部署样例核实；执行时仍需核对选定 commit 的实际实现：

| 变量 | 内部试运行值 |
|---|---|
| GEO_MONITORING_ENABLED | true |
| GEO_API_COLLECTION_ENABLED | false |
| GEO_BROWSER_COLLECTION_ENABLED | false |
| GEO_OPPORTUNITY_EVALUATION_ENABLED | true |
| GEO_RETENTION_DRY_RUN | true |
| CELERY_CONCURRENCY | 1 |

API/Worker/Scheduler 必须读取同一获批 runtime 配置；配置声明不是现场证据。保留策略日期不自行启用，未知费用不补零。Browser 服务/profile/session/material 必须按目标清点；N/A 需证据，不从默认 false 推断。

Scheduler 只运行既有分析恢复、过期采集 lease 恢复、PENDING 分析/Run 补投递、retention dry-run，以及当前应用原有 generation 恢复/补投递和平台 logo 清理；不新增或启用 Plan CRON 或周期 Opportunity evaluator。不能因为业务 CRON 禁用而停掉恢复扫描。依据 `backend/app/worker.py`，执行时核对实际注册表，不添加新任务。

当前发布入口使用 `PARTSIGNAL_RUNTIME_ENV_FILE`、`PARTSIGNAL_BACKEND_IMAGE`、`PARTSIGNAL_FRONTEND_IMAGE`、`PARTSIGNAL_MIGRATION_IMAGE`、版本、DATA_ROOT 和 RELEASE_MANIFEST 等身份输入。密钥走受保护通道，不写入任务、日志或提交。部署不会自动调用外部 AI 产品平台；如既有生产配置校验要求真实 AI/OSS 参数，必须取得获批真实配置，不能用假适配器伪装通过。

## 待执行前闭合的输入

- 精确内部目标、访问/部署入口、数据归属、UAT namespace、访问控制、时间窗口和阶段批准。
- 真实镜像 repository/交付方式、UI 完成后的固定候选、唯一 schema head及当前 producer/consumer 所需输入。
- 用户已批准直接清空重建，旧数据隔离/备份恢复及previous V2不作为fresh-init前提。发布工具与权威runbook须明确fresh候选和安全停止/重建策略；旧clean-init/upgrade仍保持原恢复合同，不伪造previous身份。
- 获批 runtime 配置与内部账号、smoke 数据、备份和恢复负责人、容量/监控观察期与停止阈值。

规划阶段只登记缺口。2026-10-07 新会话已开展发布准备，接受身份、源码head、producer/consumer及配置/恢复路径核对完成；具体输入和分阶段操作见[preparation.md](./preparation.md)。Git提交/push/fetch授权已闭合并用于既有候选及本次工具准备。主机/站点/清空路径已选定，fresh工具/定向验证/独立复核完成；新完整候选Gate、AI初始化交接和现场阶段未闭合，目标部署仍blocked。未索取聊天凭据，未创建目标账号/数据或部署。

## 范围外

新增正式公网人群、其他站点/数据库、密钥轮换、真实OSS共享bucket删除、Browser自动采集、外部API Collection供应商接入、真实AI平台账号创建、CRON、自动Opportunity调度和无关功能修复。用户本次清空重建所必要的发布入口与状态owner修复属于当前范围；不为已撤销的保留数据升级增加接管能力。

## 独立验收

- [ ] 同一固定 UI 完成后 main 候选的门禁、archive、images、manifest、schema/hashes 可核验并可重现。
- [ ] 核心容器健康；API/Worker/Scheduler 的实际配置符合批准基线；API/Browser 自动采集关闭，业务 CRON 与自动 evaluator 未启用。
- [ ] 目标迁移到唯一 head、账号初始化、readiness 和完整 MANUAL 主链路 smoke 成功；无需手改数据库。
- [ ] 页面评估、Action、Retest 入口可用；所有 smoke 结果绑定环境、候选、时间和操作者。
- [ ] 有内部访问说明、日志/health和安全停止/重新安装步骤；旧数据不保留的范围与执行结果清晰，新内部环境的数据保护义务另按实际试运行范围验收。
- [ ] 明确声明这是受控内部试运行，不是正式生产发布；独立工作验收并人工接受后才 done。

## 验证与导航（尚未执行）

候选级现有 `run-verify.py`/`make verify`、candidate producer/consumer 完整性检查及对应部署路径检查由本任务在冻结候选上执行；目标 readiness、smoke、配置、health、备份/恢复检查只在获批目标和阶段执行，不把本地部署脚本自检冒充现场演练。

- [父任务设计](../10-07-geo-1010-manual-pilot/design.md)、[根 AGENTS](../../../AGENTS.md)
- [GEO README](../../../docs/geo-monitoring/README.md)、[能力矩阵](../../../docs/geo-monitoring/01-product/05-v1-release-capability-matrix.md)
- [部署运维](../../../docs/geo-monitoring/03-technical/08-deployment-and-operations.md)、[核心 Runbook](../../../docs/geo-monitoring/03-technical/10-core-rollout-runbook.md)、[备份恢复](../../../docs/geo-monitoring/03-technical/09-backup-recovery-runbook.md)
- [生产配置合同](../../../docs/production-configuration.md)、[测试质量](../../../docs/geo-monitoring/03-technical/07-testing-and-quality.md)、[ADR-008](../../../docs/geo-monitoring/05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md)

复用权威 runbook，不另造部署流程；选定目标后的具体执行计划应补入本任务 implement.md，当前没有实施结果。


## Hostdzire 直接构建与当前现场状态（2026-10-08 UTC）

源码852c6d5e完整本地Gate及Hostdzire镜像/manifest通过；现有env已核对，正确OSS地域与Production runtime已受控交付。真实OSS上传/HEAD/签名读取成功，但Bucket公开读取及CORS范围待确认，AI上线后管理UI配置已获选择、部署owner移交实现与定向验证/独立复核完成，新候选准备中；尚未维护、清空、迁移或切换。当前以[直接执行记录](./hostdzire-direct-build.md)和[配置执行证据](./evidence/hostdzire-runtime-config-execution.json)为准；此前404/NoSuchBucket是旧服务器配置的历史失败，不是缺少现有本地配置。配置交付本身未改应用源码/镜像；新增部署owner须新候选验证，旧完整Gate仅作历史。Actions不要求且未触发。DEPLOY blocked，UAT未开始。
