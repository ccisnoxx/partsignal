# GEO-906：R8 核心发布验收记录

2026-10-05 入场 GEO-903/904/905 均 done，且各有明确人工接受记录，允许开始 GEO-906。
904/905 的接受未新增现场验证：生产 Browser 与平台批准 inventory、目标容量与冻结阈值仍未验证。
现有分支为 geo/GEO-906；入场工作树含大量前序任务改动，正式 candidate 尚未冻结。

本次只执行本地发布准备。**未访问或修改生产，未 expand/deploy/enable，未完成正式内部试用或生产最终验收。**
生产入口、candidate、阶段批准和负责人/观察期输入尚未提供；生产阶段 NOT_STARTED。
实施与本地验证结果见 [Trellis 记录](../../../.trellis/tasks/10-05-geo-906-rollout/implement.md)。
因必需生产输入/批准缺失，任务已由 planned → in_progress → **blocked**，没有进入 review/done。

## 1. 范围与现状

[ADR-006](../05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)决定 MANUAL 为正式回答级观测方式，R6 → R8。
801～803 done 代码保留，804～807 deferred/post-core；真实 Browser Adapter、生产截图及登录探针均不标已实现。
核心发布要求 GEO_BROWSER_COLLECTION_ENABLED=false、服务/profile 未启用、无生产会话。
该现场事实本次 **NOT_VERIFIED**，Browser 清理/会话恢复适用性 **NOT_DETERMINED**；不能从默认值或本地零材料填 N/A。

当前 MANUAL 提交/不可变证据、分析 revision/复核、指标/报告、显式机会评估、行动/同口径复测/显式解决已有实现。
当前生产 Plan cron 批次扫描及自动 opportunity evaluator 未接线；ADR-006 未延期这两项。
将缺口保留为 NOT_MET，不借 906 增加产品功能或让 Beat tick 冒充执行。
生产 API Collector 未批准且输入范围受限，核心 rollout 保持 API false，不用它绕过 MANUAL。

## 2. 交付材料与门禁

- [核心 rollout runbook](../03-technical/10-core-rollout-runbook.md)：每阶段输入/批准/退出，MANUAL 试用、监控、停止和恢复。
- [低敏发布记录模板](./geo-906-release-record.template.yaml)：未知 null/NOT_VERIFIED；引用不可变 candidate，不生成批准。
- 配置 gate 仅允许已验收 `partsignal.geo_cleanup_artifacts` 的注册/声明调度；保留 18 配置场景、共享 Settings 与启动零外部调用。
- OpenAPI/generated/database/Alembic/前端与运行配置无本任务变化；head 仍 0065_geo_observability，无回填、无生产前滚。

本地lint/typecheck/test-deploy-scripts通过。完整make verify退出2：集成1116 passed、54 failed、6 setup errors；
54项所在七个文件因本地fake OSS未运行，启动替身后定向82 passed；恢复setup缺显式PG工具，已有显式本地PG16补验证6 passed。
原完整门禁仍失败，补验证不替代完整verify；生产smoke和目标停止/恢复未运行。MANUAL隔离真实栈2 passed（1.3m），秘密扫描clean，独占数据库/Redis/端口/目录清理成功；具体命令与最终检查见Trellis原始日志。

现有发布脚本合并前滚与应用部署，执行前须同时取得 expand/deploy 批准；activation 仍要求真实全应用 AI/OSS Gate。
activation只启动Worker/Scheduler。MANUAL配置切换后须在UPGRADE_PREPARED按enable批准再次deploy重建API，然后activate；
已initialized的候选停止后恢复必须新的不可变release身份与批准，不能重跑旧activate或删除状态。
运行配置必须核对 API/Worker/Beat 重建后的实际值及部署 profile/overlay，不从 env 文件推断已生效。
新 retention 保持 dry-run，Worker 并发维持默认 1；增加并发或实际删除不是本任务自动批准内容。

## 3. 最终验收矩阵

| 验收项 | 当前证据与结论 | 尚需材料 |
|---|---|---|
| 依赖/ADR | 903/904/905 done；ADR-006 accepted | 既有现场限制在本任务收口，done 不改 |
| 固定候选 | NOT_VERIFIED；dirty GEO 分支不能冻结正式 candidate | clean main=origin/main、不可变 archive/manifest/images/schema/tracked hashes |
| expand/deploy | NOT_STARTED；本地发布流程测试结果另列，不作现场证明 | 目标/批准、备份、实际前滚、完整性、镜像/三进程配置与健康 |
| Browser false/零部署/零会话 | NOT_VERIFIED，适用性 NOT_DETERMINED | 同目标/时点的三进程 false、容器/profile/overlay/mount、PG 全部会话与材料库存 |
| MANUAL 正式闭环 | 代码已有；本地纵向结果以 Trellis 日志为准；生产 NOT_VERIFIED | 真实批准样本正式提交→分析→必要复核→指标→行动→可比复测→resolve 签署 |
| 内部试用 | NOT_STARTED | 获准人群/访问控制、计划/样本、反馈和缺陷负责人 |
| 监控/观察期 | 902 资产已有；生产接入/校准 NOT_VERIFIED | exporter/dashboard/alert 实测、目标容量/阈值/时间与值班签署 |
| 恢复/停止 | 903 隔离实现已有；本次本地结果另列；目标 NOT_VERIFIED；prepared阶段 artifact 失败恢复未覆盖 | 目标静默/备份、隔离恢复扫描、停止无新外发、恢复前对账、兼容镜像及发布所有者阶段恢复方案 |
| 生产 smoke/页面安全 | NOT_RUN | 获准目标回环/公网 live/ready、前端、安全头/缓存/deep link/权限 |
| Plan cron / 自动 evaluator | **NOT_MET / NOT_IMPLEMENTED** | 已授权后续实现与真实执行证据，或明确已接受的产品范围决策；906不补功能 |
| R7 延期 | DEFERRED_POST_CORE；不作为核心依赖，不标已实现 | 恢复另依 ADR-006 与平台/生产授权 |
| 最终核心正式可用 | **NOT_VERIFIED** | 上述必需门禁全部满足，人工签署后先 review，done 需用户接受 |

## 4. 阻断与恢复输入

必须补齐精确目标及获准入口或脱敏现场报告、固定 release/commit、各阶段人工批准、验收/恢复负责人、内部试用范围、目标容量/观察期/冻结停止阈值。
真实 AI/OSS、密钥与会话材料只能在既有保护通道配置，不在聊天或 evidence 中提交秘密。
生产阶段逐项取证，不把同一批准扩大到 Nginx reload、数据恢复或物理清理。
当前范围不允许实现 cron/自动 evaluator；全核心最终验收不能悄悄跳过该已知缺口。
当前frontend-only回滚仅支持PRODUCTION_INITIALIZED，prepared阶段不支持另一候选接管。
该阶段若artifact失败，必须保持维护并补齐发布所有者的安全恢复方案，不能为进入回滚条件先激活或手改状态。

本地已完成材料和原始验证结果保留，不改写 904/905 的失败/未验证历史，也不改 deferred 状态。
有明确输入后继续 GEO-906 的同一 Task Brief；本次不提交、推送、归档或宣称上线。
