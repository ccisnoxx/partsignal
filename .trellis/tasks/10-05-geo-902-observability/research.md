# GEO-902 开始前合同研究

GEO-902 在 manifest 中原为 planned，R8，无阻断标记；GEO-408、607、707 均为 done，相关 Trellis task 为 completed 且有明确人工接受记录。已读取 WBS 完整任务行：logging / metrics / ops docs；交付低敏指标、dashboard/alerts、稳定日志字段、Scheduler/Worker health；测试指标模拟、告警阈值、日志 secret scan；定位 oldest pending / expired lease，区分系统故障与业务低表现。

## 阅读范围

根 AGENTS.md、backend/AGENTS.md、.trellis/workflow.md，以及 backend 的 directory/database/error/logging/quality 指南、infra 入口与 CI/隔离、跨层指南。没有产品前端修改。

用户指定的 GEO README、04-delivery/01-implementation-roadmap、02-work-breakdown-structure、04-codex-execution-guide、05-task-template、task-manifest、00-governance/01-document-governance、01-product/02-geo-core-prd、02-business/02-domain-model、03-workflows-and-state-machines、04-monitoring-methodology-and-metrics、03-technical/01-technical-architecture、02-data-architecture、06-security-and-compliance、07-testing-and-quality、08-deployment-and-operations，以及 ADR-001 至 ADR-005 均已读取。另核对已接受 ADR-006 的 Browser 延期限制和前置任务记录。

当前实现证据包括 contracts/openapi.yaml / database.md，0064 及相关模型、Worker、collection / analysis 生命周期、dispatch / recovery、admission reservation / UTC 日账、批次、机会、文件存储和相关测试。只读文档研究委派给 analyst，主代理检查当前代码/契约并据此输出十二项 preflight；审计 acceptance basis 保存在 evidence/subagent-acceptance.json。

## 当前实现与目标差异

1. Run、AnalysisRevision、AnalysisJob、Reservation 持有真实状态和费用；尚无统一受保护运维快照与低敏指标出口。
2. Compose Worker/Beat 原只检查 PID。Celery 已有 collection / analysis dispatch/recovery 和 retention 扫描；PID/tick 不证明扫描成功。
3. 日志散落文本和异常类型，字段不稳定。原始供应商/SQL/Broker 异常不能进入 GEO 运维日志。
4. 尚未有 Grafana dashboard、Prometheus 系统阈值/持续时间模拟与原子 textfile 导出。
5. 生产计划 cron 批次扫描和自动机会 evaluator 未接线。GEO-902 仅观察已有服务调用和实际循环，不添加调度业务。
6. Browser 会话只观察既有 PG 材料健康/到期；ADR-006 不允许以本任务恢复延期 adapter 或伪装真实登录探针。

## 已确定的设计

受保护 CLI，无新公开 API/身份/产品页面。PG 只读 RR 从业务事实聚合；全 attempt 与业务 latest-attempt 指标分别拥有，未知不补零、金额分币、失败不作零表现。有限 operation 表保存执行时间与计数，不是业务指标缓存。自身短事务不提交调用方事务、不持业务行锁；失败不得改变已接受回执。稳定字段日志与无资源 UUID 的 metrics 配合有限稳定 ID 的私有定位快照。

没有发现需 blocked 的业务/ADR 冲突、破坏性历史迁移、公式/状态/安全变更、缺失授权或未完成依赖。指定部署脚本的旧断言失败属于需报告的验证限制，不是用户定义的阻断条件。
