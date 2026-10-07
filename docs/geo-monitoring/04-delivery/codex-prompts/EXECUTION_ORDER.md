# 建议执行顺序

以下按任务清单顺序列出；仍以依赖状态为最终门禁。

## R0

- `GEO-003` 冻结当前 GEO 实现与契约基线（依赖：GEO-001, GEO-002）
- `GEO-004` 增加 GEO 渐进启用配置和安全默认值（依赖：GEO-003）
- `GEO-005` 建立 GEO 测试夹具和金标目录（依赖：GEO-003）

## R1

- `GEO-101` 定义 GEO Catalog 公共契约与数据库合同（依赖：GEO-003, GEO-002）
- `GEO-102` 实现 GEO Catalog ORM 与 Alembic（依赖：GEO-101）
- `GEO-103` 实现 GEO Catalog Schema 与领域策略（依赖：GEO-101, GEO-102）
- `GEO-104` 实现 GEO Catalog 应用服务和 API（依赖：GEO-103）
- `GEO-105` 实现监测对象、竞品、别名和域名管理页面（依赖：GEO-104）
- `GEO-106` 完成 Catalog 纵向验收和产品引导（依赖：GEO-105）
- `GEO-201` 定义并实现 PromptVariant 契约与数据模型（依赖：GEO-003, GEO-101）
- `GEO-202` 实现问题变体服务、API 和前端工作区（依赖：GEO-201）
- `GEO-203` 定义并实现 EngineSurface 与 CollectionProfile 数据契约（依赖：GEO-004, GEO-101）
- `GEO-204` 建立 Collector Registry 和 Profile 资格策略（依赖：GEO-203）
- `GEO-205` 实现观测面/Profile 管理 API 和页面（依赖：GEO-204）
- `GEO-206` 定义并实现 MonitoringPlan 数据契约（依赖：GEO-202, GEO-205）
- `GEO-207` 实现服务端运行矩阵预览和费用覆盖（依赖：GEO-206, GEO-204）
- `GEO-208` 实现 Plan 命令、查询、状态机和 API（依赖：GEO-207）
- `GEO-209` 实现监测计划列表和向导（依赖：GEO-208）

## R2

- `GEO-301` 定义 Batch/Run 公共契约与数据库模型（依赖：GEO-208, GEO-002）
- `GEO-302` 实现 Batch/Run 状态策略与动作投影（依赖：GEO-301）
- `GEO-303` 实现批次工厂、计划快照和创建幂等（依赖：GEO-302, GEO-207）
- `GEO-304` 定义并实现 AnswerSnapshot、Citation 与证据关联（依赖：GEO-301）
- `GEO-305` 实现 MANUAL 草稿和正式提交（依赖：GEO-303, GEO-304）
- `GEO-306` 实现 Batch/Run 列表与详情读模型（依赖：GEO-303, GEO-305）
- `GEO-307` 实现运行中心、人工录入和详情页面（依赖：GEO-306）
- `GEO-308` 完成 R2 并发、不可变和兼容性验收（依赖：GEO-307）

## R3

- `GEO-401` 定义 GeoCollector 协议和稳定错误模型（依赖：GEO-204, GEO-301）
- `GEO-402` 实现 GEO fake provider 和 Collector 合同套件（依赖：GEO-401, GEO-005）
- `GEO-403` 实现 API Profile 连接测试和能力验证（依赖：GEO-402, GEO-205）
- `GEO-404` 实现 OpenAI-compatible GEO Collector（依赖：GEO-401, GEO-403）
- `GEO-405` 实现采集 Worker、lease、dispatch 和补投递（依赖：GEO-303, GEO-404, GEO-004）
- `GEO-406` 实现 external_call_state 与 at-most-once 恢复（依赖：GEO-405）
- `GEO-407` 实现引用、usage、cost、预算和 profile rate limit（依赖：GEO-405, GEO-406）
- `GEO-408` 完成 API 自动观测 UI 和纵向验收（依赖：GEO-407, GEO-307）

## R4

- `GEO-501` 定义 AnalysisRevision、Mention、Recommendation、Claim、Review 契约和表（依赖：GEO-304, GEO-005）
- `GEO-502` 实现监测对象别名快照和确定性提及识别（依赖：GEO-501, GEO-106）
- `GEO-503` 实现推荐分类和可靠位置识别（依赖：GEO-501, GEO-502）
- `GEO-504` 实现引用归属和来源类别分析（依赖：GEO-501, GEO-106, GEO-304）
- `GEO-505` 实现声明提取、事实版本装配和准确性评估（依赖：GEO-501, GEO-502）
- `GEO-506` 实现 Analysis Worker 和 revision 生命周期（依赖：GEO-502, GEO-503, GEO-504, GEO-505, GEO-405）
- `GEO-507` 实现人工复核策略、API 和当前结果选择（依赖：GEO-506）
- `GEO-508` 实现分析/复核前端并完成 R4 金标验收（依赖：GEO-507）

## R5

- `GEO-601` 实现 MetricEligibility、样本等级和公式库（依赖：GEO-507）
- `GEO-602` 实现 GEO Overview 读模型和 API（依赖：GEO-601）
- `GEO-603` 实现趋势、竞品 SOV 和问题/平台覆盖（依赖：GEO-601）
- `GEO-604` 实现引用、事实风险和数据质量洞察（依赖：GEO-601, GEO-504, GEO-505）
- `GEO-605` 实现总览和分析洞察前端（依赖：GEO-602, GEO-603, GEO-604）
- `GEO-606` 实现打印报告和安全 CSV 导出（依赖：GEO-605）
- `GEO-607` 完成洞察性能、索引和 R5 验收（依赖：GEO-606）

## R6

- `GEO-701` 定义 GEO 规则集契约和配置（依赖：GEO-601）
- `GEO-702` 实现 Opportunity 数据模型、identity 和评估器（依赖：GEO-701, GEO-603, GEO-604）
- `GEO-703` 实现 Opportunity API、读模型和工作台（依赖：GEO-702）
- `GEO-704` 集成事实修订、内容任务和发布修复行动（依赖：GEO-703）
- `GEO-705` 实现 RetestPlanner、基线冻结和可比性门禁（依赖：GEO-704, GEO-303）
- `GEO-706` 实现干预前后比较和机会解决流程（依赖：GEO-705, GEO-605）
- `GEO-707` 完成机会闭环 E2E、审计和 R6 验收（依赖：GEO-706）

## R7

- `GEO-801` 建立独立 Browser Collector 服务骨架和 Compose profile（依赖：GEO-408, GEO-002）
- `GEO-802` 实现浏览器会话加密引用和撤销流程（依赖：GEO-801）
- `GEO-803` 建设本地模拟 AI 产品和 Browser Adapter 合同套件（依赖：GEO-801, GEO-402）
- `GEO-804` 实现第一个合规批准的真实界面 Adapter（依赖：GEO-802, GEO-803）
- `GEO-805` 实现浏览器证据捕获、敏感裁剪和对象存储提交（依赖：GEO-804, GEO-304）
- `GEO-806` 实现 Browser Profile 健康、频率、kill switch 和管理 UI（依赖：GEO-805, GEO-205）
- `GEO-807` 执行真实平台小规模试点和人工交叉验收（依赖：GEO-806）

## R8

- `GEO-901` 实现 GEO 数据保留、归档和清理任务（依赖：GEO-707）
- `GEO-902` 完善运行、成本、失败和积压可观察性（依赖：GEO-408, GEO-607, GEO-707）
- `GEO-903` 完成数据库、OSS、密钥和会话备份恢复演练（依赖：GEO-901, GEO-902）
- `GEO-904` 执行 GEO 安全与合规专项复核（依赖：GEO-903）
- `GEO-905` 完成大数据量性能和容量硬化（依赖：GEO-607, GEO-902）
- `GEO-906` 执行生产渐进上线、最终验收和文档状态更新（依赖：GEO-903, GEO-904, GEO-905）

## R9A 当前推进（2026-10-07）

R0—R8条目保留为历史顺序；当前状态以manifest及Trellis为准，旧done不代替现场验收。[ADR-008](../../05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md)规定核心页面先于候选冻结。

1. GEO-1002～1008已接受，GEO-1009固定main门禁获[人工接受](../../06-reviews/2026-10-07-geo-1009-main-gate-acceptance.md)并done；候选冻结移交DEPLOY。
2. [GEO-1010-UI](../../../../.trellis/tasks/10-07-geo-1010-ui-business-closure/prd.md)：done，依赖1009、1006、704、705、706、707全部done；UI已实现与本地验证，2026-10-07获[人工接受](../../06-reviews/2026-10-07-geo-1010-ui-acceptance.md)。
3. [GEO-1010-DEPLOY](../../../../.trellis/tasks/10-07-geo-1010-internal-pilot-deploy/prd.md)：ready，1009/UI均done，已获新会话启动授权；不与UI并行，具体部署在获批内部目标和阶段执行。
4. [GEO-1010-UAT](../../../../.trellis/tasks/10-07-geo-1010-manual-uat-performance/prd.md)：planned，等待UI/DEPLOY done；代码问题另建缺陷任务，具名内部Go/No-Go。
5. [GEO-1010父任务](../../../../.trellis/tasks/10-07-geo-1010-manual-pilot/prd.md)：in_progress；三个done且集成工作验收后review，另有人工接受才done。子任务完成不代表生产Go。

当前只启动UI，DEPLOY/UAT仍未开始；不增加第四任务、不创建GEO-1011～1013。原manifest顶层数字ID保留，parent/children由Trellis双向关系裁决。

2026-10-07 DEPLOY 后续进度：发布准备已开始；用户已授权提交/push/fetch并固定新候选，候选门禁待执行；精确目标、镜像/runtime、阶段与恢复实际输入尚缺，目标部署 blocked。上文 ready 为 UI 接受时的移交状态；当前执行状态以 DEPLOY task.json/implement.md 为准，UAT 未开始。
