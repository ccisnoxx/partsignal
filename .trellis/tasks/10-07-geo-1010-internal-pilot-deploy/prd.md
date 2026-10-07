# GEO-1010-DEPLOY：部署 MANUAL GEO 内部试运行环境

## 基本信息与执行门禁

- 展示 ID：GEO-1010-DEPLOY；Trellis ID/slug：`geo-1010-internal-pilot-deploy`。
- 初始状态：planned；必须等待 GEO-1009 done、GEO-1010-UI done。不得和 UI 并行部署，不增加第四个任务。
- 2026-10-07 UI已获[人工接受](../../../docs/geo-monitoring/06-reviews/2026-10-07-geo-1010-ui-acceptance.md)并done，GEO-1009/UI依赖满足；当前会话用户授权开启DEPLOY会话，任务转为ready。该启动授权不补足下述精确目标、阶段与恢复输入。
- 父任务：[GEO-1010](../10-07-geo-1010-manual-pilot/prd.md)。
- 目标：将通过候选门禁的固定 main 部署至获批内部 UAT/Pilot，证明安装、迁移、启动、登录和 MANUAL 主链路可用。
- 任务规划不授予目标环境写入权限。执行前必须记录获批环境/namespace/入口、操作范围与阶段、操作者及业务/运维/停止恢复负责人；未获批准或缺身份/恢复输入时不得部署。

## 当前交付与移交

GEO-1009 只接受固定 `e5949ab66989c1277424cfe9ab8b93e10ce10046` 的完整 main 门禁验证，详见[人工接受](../../../docs/geo-monitoring/06-reviews/2026-10-07-geo-1009-main-gate-acceptance.md)。本任务接管未完成的 source archive、正式镜像身份、release manifest、schema/hash、候选冻结和恢复输入。当前没有部署或冻结结果，旧本地通过不代表目标已验证。

## 范围内

1. UI done 后 fetch 并确认 clean、HEAD=origin/main，固定完整 main commit；执行或核实该候选所需的现有完整门禁，记录具体 SHA/命令/结果。输入变化后不能把旧 SHA 的通过直接用于新候选；同一候选已成功且未受影响的证据按项目规则复用。
2. 同身份冻结 source archive、backend/frontend 及适用 migrate/worker/scheduler 镜像、正式 digest、唯一 schema head、tracked-file hashes、release manifest；记录环境标识、部署时间、操作者。复用当前 producer/consumer，不伪造 repository/digest，不使用测试绕过或覆盖已冻结工件/tag。
3. PostgreSQL、Redis、API、Frontend、Worker、Scheduler 与获批 UAT 对象存储 namespace。按空环境或获批升级路径前滚 Alembic 到唯一 head，初始化内部账号，验证 readiness 和页面 smoke。升级路径严格沿现有发布状态所有者、维护隔离和失败恢复合同，不手改状态、提前 activate、直接绕过部署入口或 downgrade。
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
- 既有 runbook 要求的可拉取且已验证 previous V2/恢复材料；不得凭空构造，不能自行因“空环境”把必需恢复输入改成 N/A。确需不同空环境恢复路径时先取得明确批准并对齐权威 runbook。
- 获批 runtime 配置与内部账号、smoke 数据、备份和恢复负责人、容量/监控观察期与停止阈值。

规划阶段只登记缺口。2026-10-07 新会话已开展发布准备，接受身份、源码head、producer/consumer及配置/恢复路径核对完成；具体输入和分阶段操作见[preparation.md](./preparation.md)。Git 提交/push/fetch授权已于后续用户确认闭合；正在提交与固定候选，其余目标/阶段与材料输入尚缺，目标部署仍blocked；未请求或记录私有密钥，未创建账号/数据、未冻结候选或启动目标环境。

## 范围外

正式公网生产开放、公开流量切换、生产数据库/密钥、Browser 自动采集、外部 API Collection 供应商接入、真实 AI 平台账号接入、CRON、自动 Opportunity 调度、功能代码修复。发现代码问题另建缺陷任务。

## 独立验收

- [ ] 同一固定 UI 完成后 main 候选的门禁、archive、images、manifest、schema/hashes 可核验并可重现。
- [ ] 核心容器健康；API/Worker/Scheduler 的实际配置符合批准基线；API/Browser 自动采集关闭，业务 CRON 与自动 evaluator 未启用。
- [ ] 目标迁移到唯一 head、账号初始化、readiness 和完整 MANUAL 主链路 smoke 成功；无需手改数据库。
- [ ] 页面评估、Action、Retest 入口可用；所有 smoke 结果绑定环境、候选、时间和操作者。
- [ ] 有内部访问说明、日志/health 操作、停止与恢复步骤、数据库和证据备份/恢复证据。
- [ ] 明确声明这是受控内部试运行，不是正式生产发布；独立工作验收并人工接受后才 done。

## 验证与导航（尚未执行）

候选级现有 `run-verify.py`/`make verify`、candidate producer/consumer 完整性检查及对应部署路径检查由本任务在冻结候选上执行；目标 readiness、smoke、配置、health、备份/恢复检查只在获批目标和阶段执行，不把本地部署脚本自检冒充现场演练。

- [父任务设计](../10-07-geo-1010-manual-pilot/design.md)、[根 AGENTS](../../../AGENTS.md)
- [GEO README](../../../docs/geo-monitoring/README.md)、[能力矩阵](../../../docs/geo-monitoring/01-product/05-v1-release-capability-matrix.md)
- [部署运维](../../../docs/geo-monitoring/03-technical/08-deployment-and-operations.md)、[核心 Runbook](../../../docs/geo-monitoring/03-technical/10-core-rollout-runbook.md)、[备份恢复](../../../docs/geo-monitoring/03-technical/09-backup-recovery-runbook.md)
- [生产配置合同](../../../docs/production-configuration.md)、[测试质量](../../../docs/geo-monitoring/03-technical/07-testing-and-quality.md)、[ADR-008](../../../docs/geo-monitoring/05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md)

复用权威 runbook，不另造部署流程；选定目标后的具体执行计划应补入本任务 implement.md，当前没有实施结果。
