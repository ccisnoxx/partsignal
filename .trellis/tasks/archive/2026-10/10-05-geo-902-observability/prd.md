# GEO-902 Task Brief

## 1. 基本信息

Task ID GEO-902；完善运行、成本、失败和积压可观察性；R8；状态review；负责人本会话Codex；依赖408/607/707全部done且Trellis completed、人工接受；当前分支geo/GEO-902，无PR/commit。

## 2. 目标

低敏感运维指标、dashboard/alerts、稳定日志字段、Scheduler/Worker health；定位oldest pending/expired lease、费用异常及失败分布，系统故障和业务低表现分开。

## 3. 关联需求

REQ-GEO-OPS-004；运行数据质量/费用追溯沿已接受ADR-002/004，不修改公式。

## 4. 必读文档

用户列出的GEO README、治理、PRD、领域/状态机/指标、技术01/02/06/07/08、路线图/WBS/执行指南/模板/manifest和ADR001–005全部纳入；补读ADR006、现有408/607/707记录、根/Backend AGENTS、相关spec、当前OpenAPI/database与0064、Worker/Run/Analysis/Admission/文件代码。文档分工/核对证据在research与实施记录。

## 5. 当前行为

Run/Analysis/Reservation持有真实状态与元数据；没有统一运维CLI/指标/alerts；日志是分散文本；Compose worker/Beat只验证PID。生产计划批次扫描与机会自动评估调度尚未接线，不为902添加它们。

## 6. 目标行为

受保护CLI输出JSON定位和无高基数ID的Prometheus指标；空值不补零、全模式分离、API UTC日账按所有发送attempt。真实tick/publish/worker heartbeat与扫描执行时间分别记录，独立低敏故障不会改变业务。dashboard/rules能离线验证并导入现有监控设施。

## 7. 范围内

- [x] 状态/积压/失败/延迟/费用指标与有限ID定位
- [x] 健康钩子、Compose进程检查、低敏日志
- [x] Dashboard/告警阈值模拟与runbook
- [x] 一致合同、加法迁移及定向验证

## 8. 范围外

903备份恢复、905容量/索引硬化、904全安全专项、906生产启用；任何新业务公式/状态机/产品页面/调度能力；真实provider及Browser延期恢复；无关重构/依赖升级。

## 9. 不变量

PG业务权威、Redis稳定ID、服务拥有transaction/locks；原始证据及历史不可变；失败不能作零表现；未知费用null/分币；无正文/secret；观测失败不重试外部调用、不更改已提交业务；不新增业务审计事件。

## 10. 契约

OpenAPI无变化。0065_geo_observability仅新增geo_operation_health，有限operation枚举、原子计数、时间/耗时约束，不引用或更新业务聚合，无回填；拒绝破坏性downgrade、前向修复。

## 11. 后端

受保护运维CLI，无Router；独立只读RR聚合；元数据独立短事务，不持业务行锁。按design记录实际heartbeat/tick/publish与任务执行，不伪造计划调度；业务失败分布从PG读取，task正常返回不代表采集成功。

## 12. 前端

N/A；运维Grafana资产，不新增产品路由/query key/URL状态。

## 13. 测试计划

Unit：固定字段、canary拒绝、空值/指标格式、health失败。PG：旧head/空库前滚、历史不变、metadata、原子并发计数、费用/失败/积压聚合。Ops：promtool规则和阈值模拟、dashboard字段、真实Worker/Beat与stale检测；指定仓库检查。

## 14. 验收

MANUAL待录入与业务低表现不触发自动故障；自动pending与expired collection/analysis各有最老ID/年龄；多币费用与未知/预算异常可定位；健康必须观察真实任务/进程而非PID；canary不进入日志/指标。

## 15. 命令

Baseline: 888 unit passed；PG首轮55passed/3failed（Redis容器hostname在宿主不可解析）；显式REDIS_URL本地端口后58passed。首两条不存在测试路径exit4无执行。精确命令在implement。
候选：git diff --check；make lint；make typecheck；make test-deploy-scripts；make contract-check；定向pytest及迁移、Prometheus规则模拟。

## 16. 数据/上线

先0065再统一Worker/Beat/应用；无历史回填，无新业务开关；保护现有功能开关。部署监控资产需要已有Prometheus/Grafana和受保护采集通道，当前不部署生产；schema保留并前滚修复。

## 17. 风险

心跳与工作完成混淆、旧textfile误报、未知费用补零、敏感日志、观测I/O影响业务；通过分指标/时间/固定字段/短事务验证。用户规定五种实质阻断才blocked。

## 18. 完成证据

见implement.md、evidence及audit bundle；实现/本地验证后仅review，不自行done，不提交推送或归档。

## 19. 后续

GEO-903、905，及904/906依其依赖单独执行；不实现。
